//! entry 终态与 active_turn 投影写族（`chat_writer.rs` 拆分，§7.2/§7.3）。
//!
//! 职责边界：entry 终态迁移（[`migrate_entry_terminal`]）、Session Doc
//! `session` map 的 active_turn 三字段投影（[`set_active_turn`]/
//! [`set_active_turn_status_if`]）与 projection_version 维护
//! （[`bump_projection_version`]/[`projection_version`]）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `chat_writer.rs` 1340 行超限，按主题
//! 一分为四——本文件承载「turn 生命周期收尾」写入；读辅助/枚举值域留在
//! `chat_writer.rs`，entry 创建族在 `chat_writer_entries.rs`，内容块与
//! tool_call 写入在 `chat_writer_blocks.rs`；函数经 `chat_writer.rs`
//! `pub use` re-export，调用方路径不变。

use yrs::{Map, ReadTxn};

use peri_studio_proto::schema::{ActiveTurnProjection, EntryStatus, PublicError, TurnStatus};

use crate::state::chat_writer::{entry_status_str, root_map_read};
use crate::state::chat_writer_blocks::write_public_error;
use crate::state::view_store::TransactionCtx;

/// entry 终态迁移（status/completed_at/error；Chat Doc 侧）。
/// 返回是否找到 entry 并迁移。
pub fn migrate_entry_terminal(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
    status: EntryStatus,
    completed_at: &str,
    error: Option<&PublicError>,
) -> bool {
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    let Some(entry_map) = entries
        .get(txn, entry_id)
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    entry_map.insert(txn, "status", entry_status_str(status));
    entry_map.insert(txn, "completed_at", completed_at.to_string());
    match error {
        Some(e) => write_public_error(txn, &entry_map, "error", e),
        None => {
            entry_map.insert(txn, "error", yrs::Any::Null);
        }
    };
    true
}

/// 将同一 turn 的全部 assistant 分段一次性终态化，避免 tool/agent 交替产生的
/// `assistant:2+` 永久保持 streaming。
pub fn migrate_assistant_segments_terminal(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    turn_id: &str,
    status: EntryStatus,
    completed_at: &str,
    error: Option<&PublicError>,
) -> usize {
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    let ids: Vec<String> = entries.iter(txn).map(|(id, _)| id.to_string()).collect();
    let mut migrated = 0;
    for id in ids {
        let belongs = entries
            .get(txn, id.as_str())
            .and_then(|value| value.cast::<yrs::MapRef>().ok())
            .is_some_and(|entry| {
                entry
                    .get(txn, "turn_id")
                    .and_then(|value| value.cast::<String>().ok())
                    .as_deref()
                    == Some(turn_id)
                    && entry
                        .get(txn, "role")
                        .and_then(|value| value.cast::<String>().ok())
                        .as_deref()
                        == Some("assistant")
            });
        if belongs && migrate_entry_terminal(txn, root, &id, status, completed_at, error) {
            migrated += 1;
        }
    }
    migrated
}

/// active_turn 更新（Session Doc `session` map 内嵌字段；§7.2 权威投影）。
///
/// 对齐 Chat/Session 双 Doc：active turn 不是独立根键，而是 `session` map 的
/// `active_turn_id`/`active_turn_status`/`active_turn_updated_at` 三字段
/// （参考实现 Session Doc 形态）。`None` 清空三字段（终态后归位）。
/// 返回是否写入（值与既有不同或新增）。
pub fn set_active_turn(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    active: Option<&ActiveTurnProjection>,
) -> bool {
    let sm = root.get_or_init::<_, yrs::MapRef>(txn, "session");
    let loading = active.is_some_and(|turn| turn_loading(turn.turn_status));
    let loading_changed = sm
        .get(txn, "loading")
        .and_then(|value| value.cast::<bool>().ok())
        != Some(loading);
    if loading_changed {
        sm.insert(txn, "loading", loading);
    }
    match active {
        Some(a) => {
            let changed = sm
                .get(txn, "active_turn_id")
                .and_then(|t| t.cast::<String>().ok())
                .as_deref()
                != Some(a.turn_id.as_str())
                || sm
                    .get(txn, "active_turn_status")
                    .and_then(|t| t.cast::<String>().ok())
                    != Some(turn_status_str(a.turn_status).to_string());
            if changed {
                sm.insert(txn, "active_turn_id", a.turn_id.clone());
                sm.insert(txn, "active_turn_status", turn_status_str(a.turn_status));
                sm.insert(txn, "active_turn_updated_at", a.updated_at.clone());
            }
            changed || loading_changed
        }
        None => {
            let had = sm.get(txn, "active_turn_id").is_some()
                || sm.get(txn, "active_turn_status").is_some();
            sm.remove(txn, "active_turn_id");
            sm.remove(txn, "active_turn_status");
            sm.remove(txn, "active_turn_updated_at");
            had || loading_changed
        }
    }
}

/// 条件更新 active_turn_status（Session Doc `session` map 内嵌字段）：
/// 现值 == `expect` 时写 `new`（§7.2 状态推进——awaitingPermission →
/// running/cancelled 只在状态仍为 awaitingPermission 时成立，避免
/// 覆盖后续终态）。返回是否写入。
pub fn set_active_turn_status_if(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    expect: &str,
    new: &str,
) -> bool {
    let sm = root.get_or_init::<_, yrs::MapRef>(txn, "session");
    let cur = sm
        .get(txn, "active_turn_status")
        .and_then(|s| s.cast::<String>().ok())
        .unwrap_or_default();
    if cur == expect {
        sm.insert(txn, "active_turn_status", new.to_string());
        sm.insert(txn, "loading", loading_status(new));
        true
    } else {
        false
    }
}

fn turn_loading(status: TurnStatus) -> bool {
    matches!(
        status,
        TurnStatus::Accepting
            | TurnStatus::Running
            | TurnStatus::AwaitingPermission
            | TurnStatus::Cancelling
    )
}

fn loading_status(status: &str) -> bool {
    matches!(
        status,
        "accepting" | "running" | "awaitingPermission" | "cancelling"
    )
}

/// turn 状态字符串（§7.2 值域；camelCase 存储）。
pub(crate) fn turn_status_str(status: peri_studio_proto::schema::TurnStatus) -> &'static str {
    use peri_studio_proto::schema::TurnStatus;
    match status {
        TurnStatus::Accepting => "accepting",
        TurnStatus::Running => "running",
        TurnStatus::AwaitingPermission => "awaitingPermission",
        TurnStatus::Cancelling => "cancelling",
        TurnStatus::Completed => "completed",
        TurnStatus::Cancelled => "cancelled",
        TurnStatus::Interrupted => "interrupted",
        TurnStatus::Failed => "failed",
    }
}

/// projection_version += 1（每次成功投影 +1，§5.3/§5.6）。返回新版本。
pub fn bump_projection_version(txn: &mut TransactionCtx<'_>, root: &yrs::MapRef) -> u32 {
    let current = root
        .get(txn, "projection_version")
        .and_then(|v| v.cast::<u32>().ok())
        .unwrap_or(0);
    let next = current + 1;
    root.insert(txn, "projection_version", next);
    next
}

/// 读取当前 projection_version（只读）。
///
/// 拆分前经 `pub mod chat_writer` 对外可见（无 crate 内调用方）；拆分后
/// 模块私有化，保留为预留读接口。
#[allow(dead_code)]
pub fn projection_version<T: ReadTxn>(txn: &T) -> u32 {
    root_map_read(txn)
        .and_then(|root| root.get(txn, "projection_version"))
        .and_then(|v| v.cast::<u32>().ok())
        .unwrap_or(0)
}
