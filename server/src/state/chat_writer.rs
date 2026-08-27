//! doc 写入原语（§5.3 物理映射的执行层）。
//!
//! 所有函数在调用方事务内执行；**不做幂等/终态判定**（判定归聚合器），只保证
//! 「写出的结构合法」。每条原语幂等或由调用方保证幂等（§6.3）。
//!
//! 物理映射（§5.3/§5.4）：根对象/`entries`/`blocks`/`tool_calls` 用 `Y.Map`；
//! 顺序索引用 `Y.Array`（元素 `String`）；流式文本用 `Y.Text`；删除采用领域
//! tombstone，不由客户端物理删除权威记录。枚举值域按 schema 镜像的 serde
//! camelCase 字符串存储（`"completed"`/`"awaitingPermission"` 等）。
//!
//! 拆分说明（结构拆分，行为不变）：本文件保留枚举（[`ContentKind`]/
//! [`UserEntryRegistration`]）、枚举值域字符串映射与读取辅助（聚合器判定
//! 用）；entry 创建族 → `chat_writer_entries.rs`，内容块/tool_call 写入 →
//! `chat_writer_blocks.rs`，终态与 active_turn 投影 → `chat_writer_turn.rs`，
//! user entry 索引测试 → `chat_writer_test.rs`。以下 `pub use` 使调用方
//! `chat_writer::xxx` 路径保持不变。

//! doc 写入原语（§5.3 物理映射的执行层）。
//!
//! 所有函数在调用方事务内执行；**不做幂等/终态判定**（判定归聚合器），只保证
//! 「写出的结构合法」。每条原语幂等或由调用方保证幂等（§6.3）。
//!
//! 物理映射（§5.3/§5.4）：根对象/`entries`/`blocks`/`tool_calls` 用 `Y.Map`；
//! 顺序索引用 `Y.Array`（元素 `String`）；流式文本用 `Y.Text`；删除采用领域
//! tombstone，不由客户端物理删除权威记录。枚举值域按 schema 镜像的 serde
//! camelCase 字符串存储（`"completed"`/`"awaitingPermission"` 等）。

use yrs::{Map, ReadTxn, WriteTxn};

use peri_studio_proto::schema::{
    BlockVisibility, EntryKind, EntryRole, EntryStatus, PublicError, ToolCallProjection,
    ToolCallStatus,
};

use crate::state::factory::ROOT;
use crate::state::view_store::TransactionCtx;

pub(crate) use super::chat_writer_blocks::{
    append_block, append_text_delta, cancel_nonterminal_tools_for_turn, ensure_entry_with_blocks,
    set_reasoning_visibility, settle_nonterminal_tools_for_turn, upsert_tool_call,
};
pub(crate) use super::chat_writer_entries::{
    clear_input_prediction, create_pending_prompt_entry, create_user_entry, prompt_entry_turn_id,
    record_entry_origin, set_prompt_entry_delivery,
};
pub(crate) use super::chat_writer_turn::{
    bump_projection_version, migrate_assistant_segments_terminal, migrate_entry_terminal,
    set_active_turn, set_active_turn_status_if, turn_status_str,
};

/// 内容块种类（`append_text_delta` 的目标块类型）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentKind {
    /// 文本块（`ContentBlock::Text`，§5.3）。
    Text,
    /// 推理块（`ContentBlock::Reasoning`，§5.3）。
    Reasoning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserEntryRegistration {
    Created,
    /// A legacy same-turn entry was safely linked to the Hub command that owns
    /// the persisted outbox turn.
    Correlated,
    Duplicate,
    SourceCommandConflict,
}

// ---------------------------------------------------------------------------
// 枚举值域（schema 镜像 serde camelCase 字符串）
// ---------------------------------------------------------------------------

pub(crate) fn entry_kind_str(kind: EntryKind) -> &'static str {
    match kind {
        EntryKind::Message => "message",
        EntryKind::Tool => "tool",
        EntryKind::System => "system",
    }
}

pub(crate) fn entry_role_str(role: EntryRole) -> &'static str {
    match role {
        EntryRole::User => "user",
        EntryRole::Assistant => "assistant",
        EntryRole::System => "system",
    }
}

pub(crate) fn entry_status_str(status: EntryStatus) -> &'static str {
    match status {
        EntryStatus::Pending => "pending",
        EntryStatus::Streaming => "streaming",
        EntryStatus::Completed => "completed",
        EntryStatus::Cancelled => "cancelled",
        EntryStatus::Error => "error",
    }
}

pub(crate) fn tool_call_status_str(status: ToolCallStatus) -> &'static str {
    match status {
        ToolCallStatus::Pending => "pending",
        ToolCallStatus::AwaitingPermission => "awaitingPermission",
        ToolCallStatus::Running => "running",
        ToolCallStatus::Completed => "completed",
        ToolCallStatus::Error => "error",
        ToolCallStatus::Cancelled => "cancelled",
    }
}

pub(crate) fn visibility_str(v: BlockVisibility) -> &'static str {
    match v {
        BlockVisibility::Summary => "summary",
        BlockVisibility::Hidden => "hidden",
    }
}

// ---------------------------------------------------------------------------
// 读取辅助（聚合器判定用；只读，不写）
// ---------------------------------------------------------------------------

/// 根 MapRef（事务内获取；缺失时创建——root 恒存在，Factory 已补结构）。
pub fn root_map(txn: &mut TransactionCtx<'_>) -> yrs::MapRef {
    txn.get_or_insert_map(ROOT)
}

/// 只读根 MapRef（缺失返回 None；恢复/测试路径用）。
pub fn root_map_read<T: ReadTxn>(txn: &T) -> Option<yrs::MapRef> {
    txn.get_map(ROOT)
}

/// 读取 entry 是否存在（幂等键判定）。
pub fn entry_exists<T: ReadTxn>(txn: &T, entry_id: &str) -> bool {
    root_map_read(txn)
        .and_then(|root| root.get(txn, "entries"))
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .map(|entries| entries.get(txn, entry_id).is_some())
        .unwrap_or(false)
}

/// 读取 tool_call 是否存在（关联检查/幂等键判定）。
pub fn tool_call_exists<T: ReadTxn>(txn: &T, tool_call_id: &str) -> bool {
    root_map_read(txn)
        .and_then(|root| root.get(txn, "tool_calls"))
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .map(|calls| calls.get(txn, tool_call_id).is_some())
        .unwrap_or(false)
}

/// user entry 二级索引根键（turn_id → entry_id，§P1-6 加速结构）。
/// 与 entries 同事务写入；索引 map 缺失时查询回落全量扫描，语义等价。
pub(crate) const USER_ENTRY_INDEX: &str = "user_entry_by_turn";

/// 索引查询 turn 的 user entry（O(1)）。防御校验：索引指向的 entry 必须
/// 存在且 role==user 且 turn_id==key；任一不满足视为 miss（None）。
fn indexed_user_entry<T: ReadTxn>(
    txn: &T,
    root: &yrs::MapRef,
    turn_id: &str,
) -> Option<(String, yrs::MapRef)> {
    let index = root
        .get(txn, USER_ENTRY_INDEX)?
        .cast::<yrs::MapRef>()
        .ok()?;
    let entry_id = index.get(txn, turn_id)?.cast::<String>().ok()?;
    let entry = root
        .get(txn, "entries")?
        .cast::<yrs::MapRef>()
        .ok()?
        .get(txn, entry_id.as_str())?
        .cast::<yrs::MapRef>()
        .ok()?;
    let is_user = entry
        .get(txn, "role")
        .and_then(|r| r.cast::<String>().ok())
        .as_deref()
        == Some("user");
    let same_turn = entry
        .get(txn, "turn_id")
        .and_then(|t| t.cast::<String>().ok())
        .as_deref()
        == Some(turn_id);
    (is_user && same_turn).then_some((entry_id, entry))
}

/// 兜底全量扫描（原 find_map 谓词提取；语义与索引查询等价）。
fn scan_user_entry<T: ReadTxn>(
    txn: &T,
    root: &yrs::MapRef,
    turn_id: &str,
) -> Option<(String, yrs::MapRef)> {
    let entries = root.get(txn, "entries")?.cast::<yrs::MapRef>().ok()?;
    entries.iter(txn).find_map(|(entry_id, value)| {
        let entry = value.cast::<yrs::MapRef>().ok()?;
        let is_user = entry
            .get(txn, "role")
            .and_then(|r| r.cast::<String>().ok())
            .as_deref()
            == Some("user");
        let same_turn = entry
            .get(txn, "turn_id")
            .and_then(|t| t.cast::<String>().ok())
            .as_deref()
            == Some(turn_id);
        (is_user && same_turn).then(|| (entry_id.to_string(), entry))
    })
}

/// 查询 turn 的 user entry：索引 map 存在 → 索引查询（O(1)，miss 即不存在）；
/// 索引 map 缺失（异常 doc 兜底）→ 全量扫描（原行为）。
///
/// **只读查询不回填**：本函数供只读事务（聚合器 judge 路径等）与写事务共用，
/// 扫描兜底命中/索引 stale 时**不写回**索引——自愈只发生在写路径
/// （`create_user_entry`/`create_pending_prompt_entry` 的命中分支内
/// `ensure_user_entry_indexed`）。对索引缺失/键 stale 的 doc，judge 重复命中
/// （不经过写路径）时每次查询仍 O(n) 扫描，属已知边界；一旦任何新 user
/// entry 写路径经过即整体自愈。
pub fn user_entry_for_turn<T: ReadTxn>(txn: &T, turn_id: &str) -> Option<(String, yrs::MapRef)> {
    let root = root_map_read(txn)?;
    let Some(index) = root
        .get(txn, USER_ENTRY_INDEX)
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    else {
        // 索引 map 缺失（异常 doc 兜底）：全量扫描（原行为）。
        return scan_user_entry(txn, &root, turn_id);
    };
    match indexed_user_entry(txn, &root, turn_id) {
        Some(found) => Some(found),
        // 索引有该 turn 键但防御校验失败（stale，正常不可达）→ 回落扫描。
        None if index.get(txn, turn_id).is_some() => scan_user_entry(txn, &root, turn_id),
        // 热路径：索引无该 turn 键 → 断言不存在（O(1)，不扫描）。
        None => None,
    }
}

/// 幂等回填索引（读-比较-写）：仅当索引缺键或值与 entry_id 不同时写入，
/// 避免同值 insert 产生多余 CRDT update。写路径自愈用。
pub(crate) fn ensure_user_entry_indexed(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    turn_id: &str,
    entry_id: &str,
) {
    let index = root.get_or_init::<_, yrs::MapRef>(txn, USER_ENTRY_INDEX);
    let current = index
        .get(txn, turn_id)
        .and_then(|value| value.cast::<String>().ok());
    if current.as_deref() != Some(entry_id) {
        index.insert(txn, turn_id, entry_id.to_string());
    }
}

/// 读取 tool_call 投影（聚合器 upsert 前读取以保留未覆盖字段）。
pub fn tool_call_projection<T: ReadTxn>(txn: &T, tool_call_id: &str) -> Option<ToolCallProjection> {
    let root = root_map_read(txn)?;
    let calls = root.get(txn, "tool_calls")?.cast::<yrs::MapRef>().ok()?;
    let map = calls.get(txn, tool_call_id)?.cast::<yrs::MapRef>().ok()?;
    Some(proj_from_map(txn, &map))
}

fn proj_from_map<T: ReadTxn>(txn: &T, map: &yrs::MapRef) -> ToolCallProjection {
    let str_or =
        |key: &str| -> Option<String> { map.get(txn, key).and_then(|v| v.cast::<String>().ok()) };
    ToolCallProjection {
        tool_call_id: str_or("tool_call_id").unwrap_or_default(),
        turn_id: str_or("turn_id").unwrap_or_default(),
        name: str_or("name").unwrap_or_default(),
        kind: str_or("kind")
            .as_deref()
            .map(tool_kind_from_str)
            .unwrap_or_default(),
        status: str_or("status")
            .as_deref()
            .map(status_from_str)
            .unwrap_or(ToolCallStatus::Pending),
        arguments: map
            .get(txn, "arguments")
            .and_then(out_any)
            .and_then(non_null_json),
        arguments_omitted: map
            .get(txn, "arguments_omitted")
            .and_then(|value| value.cast::<bool>().ok()),
        arguments_bytes: map
            .get(txn, "arguments_bytes")
            .and_then(|value| value.cast::<f64>().ok())
            .and_then(|value| (value >= 0.0 && value <= u64::MAX as f64).then_some(value as u64)),
        content: map
            .get(txn, "content")
            .and_then(out_any)
            .and_then(non_null_json),
        content_omitted: map
            .get(txn, "content_omitted")
            .and_then(|value| value.cast::<bool>().ok()),
        content_bytes: map
            .get(txn, "content_bytes")
            .and_then(|value| value.cast::<f64>().ok())
            .and_then(|value| (value >= 0.0 && value <= u64::MAX as f64).then_some(value as u64)),
        locations: map
            .get(txn, "locations")
            .and_then(out_any)
            .and_then(non_null_json),
        locations_omitted: map
            .get(txn, "locations_omitted")
            .and_then(|value| value.cast::<bool>().ok()),
        locations_bytes: map
            .get(txn, "locations_bytes")
            .and_then(|value| value.cast::<f64>().ok())
            .and_then(|value| (value >= 0.0 && value <= u64::MAX as f64).then_some(value as u64)),
        result: map
            .get(txn, "result")
            .and_then(out_any)
            .and_then(non_null_json),
        result_omitted: map
            .get(txn, "result_omitted")
            .and_then(|value| value.cast::<bool>().ok()),
        result_bytes: map
            .get(txn, "result_bytes")
            .and_then(|value| value.cast::<f64>().ok())
            .and_then(|value| (value >= 0.0 && value <= u64::MAX as f64).then_some(value as u64)),
        public_error: map
            .get(txn, "public_error")
            .and_then(|v| v.cast::<yrs::MapRef>().ok())
            .map(|error| PublicError {
                code: error
                    .get(txn, "code")
                    .and_then(|v| v.cast::<String>().ok())
                    .unwrap_or_default(),
                message: error
                    .get(txn, "message")
                    .and_then(|v| v.cast::<String>().ok())
                    .unwrap_or_default(),
            }),
        permission_id: str_or("permission_id"),
        started_at: str_or("started_at"),
        completed_at: str_or("completed_at"),
    }
}

fn tool_kind_from_str(value: &str) -> peri_studio_proto::schema::ToolCallKind {
    use peri_studio_proto::schema::ToolCallKind;
    match value {
        "read" => ToolCallKind::Read,
        "edit" => ToolCallKind::Edit,
        "delete" => ToolCallKind::Delete,
        "move" => ToolCallKind::Move,
        "search" => ToolCallKind::Search,
        "execute" => ToolCallKind::Execute,
        "think" => ToolCallKind::Think,
        "fetch" => ToolCallKind::Fetch,
        "switch_mode" => ToolCallKind::SwitchMode,
        _ => ToolCallKind::Other,
    }
}

/// `Out::Any` 提取（`Any` 未实现 `TryFrom<Out>`，需模式匹配）。
fn out_any(v: yrs::Out) -> Option<yrs::Any> {
    match v {
        yrs::Out::Any(a) => Some(a),
        _ => None,
    }
}

fn non_null_json(value: yrs::Any) -> Option<serde_json::Value> {
    (!matches!(value, yrs::Any::Null)).then(|| any_to_json(value))
}

fn status_from_str(s: &str) -> ToolCallStatus {
    match s {
        "pending" => ToolCallStatus::Pending,
        "awaitingPermission" => ToolCallStatus::AwaitingPermission,
        "running" => ToolCallStatus::Running,
        "completed" => ToolCallStatus::Completed,
        "error" => ToolCallStatus::Error,
        "cancelled" => ToolCallStatus::Cancelled,
        _ => ToolCallStatus::Pending,
    }
}

fn any_to_json(a: yrs::Any) -> serde_json::Value {
    let mut s = String::new();
    a.to_json(&mut s);
    serde_json::from_str(&s).unwrap_or(serde_json::Value::Null)
}

/// 读取 entries MapRef（写入遍历/读取用）。
pub fn entries_map(txn: &mut TransactionCtx<'_>) -> yrs::MapRef {
    root_map(txn).get_or_init::<_, yrs::MapRef>(txn, "entries")
}

/// 读取 tool_calls MapRef。
pub fn tool_calls_map(txn: &mut TransactionCtx<'_>) -> yrs::MapRef {
    root_map(txn).get_or_init::<_, yrs::MapRef>(txn, "tool_calls")
}

/// 读取 entry_order ArrayRef。
pub fn entry_order_array(txn: &mut TransactionCtx<'_>) -> yrs::ArrayRef {
    root_map(txn).get_or_init::<_, yrs::ArrayRef>(txn, "entry_order")
}
