//! user entry / prompt-delivery entry 创建族（`chat_writer.rs` 拆分，§6.5/§P1-6）。
//!
//! 职责边界：user entry 的 turn_id 幂等创建与 source_command 关联
//! （[`create_user_entry`]/[`create_pending_prompt_entry`]）、prompt-delivery-v2
//! 状态机（[`set_prompt_entry_delivery`]）、输入预测清除与通用 entry 创建
//! （[`ensure_entry`]/[`record_entry_origin`]）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `chat_writer.rs` 1340 行超限，按主题
//! 一分为四——读辅助/枚举值域（`chat_writer.rs`）、内容块与 tool_call 写入
//! （`chat_writer_blocks.rs`）、entry 创建族（本文件）、终态与 active_turn
//! 投影（`chat_writer_turn.rs`）；函数经 `chat_writer.rs` `pub use`
//! re-export，调用方 `chat_writer::xxx` 路径不变。

use std::collections::HashSet;

use std::collections::HashMap;

use yrs::{Array, Map};

use peri_studio_proto::schema::{ChatEntry, ContentBlock, EntryKind, EntryRole, EntryStatus, EntryTokenUsage};

use crate::state::chat_writer::{
    ensure_user_entry_indexed, entry_kind_str, entry_role_str, entry_status_str,
    turn_has_terminal_assistant, user_entry_for_turn, UserEntryRegistration,
};
use crate::state::chat_writer_blocks::{write_content_block, write_public_error};
use crate::state::view_store::TransactionCtx;

// ---------------------------------------------------------------------------
// 写入原语（§7）
// ---------------------------------------------------------------------------

/// 确保 entry 存在（entry_id 幂等：已存在返回 false，不覆盖）。
///
/// `ChatEntry` 的 `blocks` 会以 `ContentBlock` 物理形态写入（Text/Reasoning
/// 块文本为 Y.Text）。
pub fn ensure_entry(txn: &mut TransactionCtx<'_>, root: &yrs::MapRef, entry: &ChatEntry) -> bool {
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    if entries.get(txn, entry.entry_id.as_str()).is_some() {
        return false;
    }
    let entry_map = entries.insert(txn, entry.entry_id.as_str(), yrs::MapPrelim::default());
    entry_map.insert(txn, "entry_id", entry.entry_id.clone());
    match &entry.turn_id {
        Some(t) => entry_map.insert(txn, "turn_id", t.clone()),
        None => entry_map.insert(txn, "turn_id", yrs::Any::Null),
    };
    entry_map.insert(txn, "kind", entry_kind_str(entry.kind));
    entry_map.insert(txn, "role", entry_role_str(entry.role));
    entry_map.insert(txn, "status", entry_status_str(entry.status));
    match &entry.author_user_id {
        Some(u) => entry_map.insert(txn, "author_user_id", u.clone()),
        None => entry_map.insert(txn, "author_user_id", yrs::Any::Null),
    };
    match &entry.source_command_id {
        Some(command_id) => entry_map.insert(txn, "source_command_id", command_id.clone()),
        None => entry_map.insert(txn, "source_command_id", yrs::Any::Null),
    };
    match entry.origin {
        Some(peri_studio_proto::schema::EntryOrigin::Live) => {
            entry_map.insert(txn, "origin", "live");
        }
        Some(peri_studio_proto::schema::EntryOrigin::SessionReplay) => {
            entry_map.insert(txn, "origin", "session_replay");
        }
        None => {
            entry_map.insert(txn, "origin", yrs::Any::Null);
        }
    }
    match entry.replay_verified {
        Some(value) => entry_map.insert(txn, "replay_verified", value),
        None => entry_map.insert(txn, "replay_verified", yrs::Any::Null),
    };
    entry_map.insert(txn, "created_at", entry.created_at.clone());
    match &entry.completed_at {
        Some(t) => entry_map.insert(txn, "completed_at", t.clone()),
        None => entry_map.insert(txn, "completed_at", yrs::Any::Null),
    };
    match &entry.error {
        Some(e) => write_public_error(txn, &entry_map, "error", e),
        None => {
            entry_map.insert(txn, "error", yrs::Any::Null);
        }
    };
    if let Some(usage) = &entry.token_usage {
        write_entry_token_usage_map(txn, &entry_map, usage);
    }
    let block_order = entry_map.get_or_init::<_, yrs::ArrayRef>(txn, "block_order");
    let blocks = entry_map.get_or_init::<_, yrs::MapRef>(txn, "blocks");
    let mut written = HashSet::new();
    for bid in &entry.block_order {
        if written.insert(bid.as_str()) {
            if let Some(block) = entry.blocks.get(bid) {
                write_content_block(txn, &blocks, &block_order, bid, block);
            }
        }
    }
    // 防御性保留未列入 block_order 的块；排序后写入，避免 HashMap 迭代
    // 顺序泄漏到持久投影。
    let mut unlisted = entry
        .blocks
        .keys()
        .filter(|bid| !written.contains(bid.as_str()))
        .collect::<Vec<_>>();
    unlisted.sort();
    for bid in unlisted {
        write_content_block(txn, &blocks, &block_order, bid, &entry.blocks[bid]);
    }
    let order = root.get_or_init::<_, yrs::ArrayRef>(txn, "entry_order");
    order.push_back(txn, entry.entry_id.clone());
    true
}

/// 无 prompt turn 的 callback 流：建 `{callback_id}` user + `{callback_id}:assistant`
/// 对；`turn_id` 为 null，不注册 active_turn（§6.5 / O-001 G2）。
pub fn create_callback_stream_entries(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    callback_entry_id: &str,
    text: &str,
    created_at: &str,
) -> bool {
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    if entries.get(txn, callback_entry_id).is_some() {
        return false;
    }
    let assistant_id = format!("{callback_entry_id}:assistant");
    let user_entry = ChatEntry {
        entry_id: callback_entry_id.to_string(),
        turn_id: None,
        kind: EntryKind::Message,
        role: EntryRole::User,
        status: EntryStatus::Completed,
        author_user_id: None,
        source_command_id: None,
        origin: None,
        replay_verified: None,
        created_at: created_at.to_string(),
        completed_at: Some(created_at.to_string()),
        block_order: if text.is_empty() {
            vec![]
        } else {
            vec![format!("{callback_entry_id}:text")]
        },
        blocks: if text.is_empty() {
            HashMap::new()
        } else {
            [(
                format!("{callback_entry_id}:text"),
                ContentBlock::Text {
                    block_id: format!("{callback_entry_id}:text"),
                    text: text.to_string(),
                },
            )]
            .into_iter()
            .collect()
        },
        error: None,
        token_usage: None,
    };
    let assistant_entry = ChatEntry {
        entry_id: assistant_id.clone(),
        turn_id: None,
        kind: EntryKind::Message,
        role: EntryRole::Assistant,
        status: EntryStatus::Streaming,
        author_user_id: None,
        source_command_id: None,
        origin: None,
        replay_verified: None,
        created_at: created_at.to_string(),
        completed_at: None,
        block_order: vec![],
        blocks: HashMap::new(),
        error: None,
        token_usage: None,
    };
    let created_user = ensure_entry(txn, root, &user_entry);
    let _ = ensure_entry(txn, root, &assistant_entry);
    created_user
}

/// Chat 时间线 plan system entry（`plan:{turnId|global}`）原位覆盖（G3 双写之一）。
pub fn upsert_plan_system_entry(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
    turn_id: Option<&str>,
    entries: &[peri_studio_proto::schema::AgentPlanEntryProjection],
    created_at: &str,
) {
    let entries_map = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    if entries_map.get(txn, entry_id).is_none() {
        let entry = ChatEntry {
            entry_id: entry_id.to_string(),
            turn_id: turn_id.map(str::to_string),
            kind: EntryKind::System,
            role: EntryRole::System,
            status: EntryStatus::Completed,
            author_user_id: None,
            source_command_id: None,
            origin: None,
            replay_verified: None,
            created_at: created_at.to_string(),
            completed_at: Some(created_at.to_string()),
            block_order: vec![],
            blocks: HashMap::new(),
            error: None,
            token_usage: None,
        };
        ensure_entry(txn, root, &entry);
    } else if let Some(entry_map) = entries_map
        .get(txn, entry_id)
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
    {
        entry_map.insert(txn, "status", entry_status_str(EntryStatus::Completed));
        entry_map.insert(txn, "completed_at", created_at.to_string());
    }
    let Some(entry_map) = entries_map
        .get(txn, entry_id)
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
    else {
        return;
    };
    let payload = serde_json::to_string(entries).unwrap_or_else(|_| "[]".to_string());
    entry_map.insert(txn, "plan_entries", payload);
}

/// 覆盖已存在 entry 的 `token_usage`（Y.Map snake_case 键）。entry 不存在时不
/// 创建 assistant 骨架，返回 false。
pub fn set_entry_token_usage(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
    usage: &EntryTokenUsage,
) -> bool {
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    let Some(entry_map) = entries
        .get(txn, entry_id)
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    entry_map.remove(txn, "token_usage");
    write_entry_token_usage_map(txn, &entry_map, usage);
    true
}

fn write_entry_token_usage_map(
    txn: &mut TransactionCtx<'_>,
    entry_map: &yrs::MapRef,
    usage: &EntryTokenUsage,
) {
    let usage_map = entry_map.insert(txn, "token_usage", yrs::MapPrelim::default());
    usage_map.insert(txn, "total_tokens", usage.total_tokens);
    usage_map.insert(txn, "context_window", usage.context_window);
    if let Some(value) = usage.input_tokens {
        usage_map.insert(txn, "input_tokens", value);
    }
    if let Some(value) = usage.output_tokens {
        usage_map.insert(txn, "output_tokens", value);
    }
}

/// Set durable entry provenance without allowing later live traffic to erase
/// replay history. For replay entries, verification is monotonic downward:
/// one unverified event makes the whole entry inferred rather than verified.
pub fn record_entry_origin(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
    replay: bool,
    replay_verified: bool,
) {
    let Some(entry) = root
        .get(txn, "entries")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .and_then(|entries| entries.get(txn, entry_id))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    else {
        return;
    };
    if replay {
        entry.insert(txn, "origin", "session_replay");
        let already_unverified = entry
            .get(txn, "replay_verified")
            .and_then(|value| value.cast::<bool>().ok())
            == Some(false);
        entry.insert(
            txn,
            "replay_verified",
            replay_verified && !already_unverified,
        );
    } else if entry
        .get(txn, "origin")
        .and_then(|value| value.cast::<String>().ok())
        .is_none()
    {
        entry.insert(txn, "origin", "live");
    }
}

/// 创建 user entry（turn_id 幂等：同 turnId 已存在则跳过，§6.5「同 turnId 重放
/// 跳过」）。
#[allow(clippy::too_many_arguments)]
pub fn create_user_entry(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    turn_id: &str,
    entry_id: &str,
    text: &str,
    author_user_id: Option<&str>,
    source_command_id: Option<&str>,
    created_at: &str,
) -> UserEntryRegistration {
    // 同 turn_id 的 user entry 已存在。Hub command may backfill only an
    // absent identity; an existing different identity is never overwritten.
    if let Some((existing_id, existing)) = user_entry_for_turn(txn, turn_id) {
        // 写路径自愈：索引缺失/不一致时回填（正常路径幂等无操作）。
        ensure_user_entry_indexed(txn, root, turn_id, &existing_id);
        return match source_command_id {
            None => UserEntryRegistration::Duplicate,
            Some(command_id) => match existing
                .get(txn, "source_command_id")
                .and_then(|value| value.cast::<String>().ok())
            {
                Some(current) if current == command_id => UserEntryRegistration::Duplicate,
                Some(_) => UserEntryRegistration::SourceCommandConflict,
                None => {
                    existing.insert(txn, "source_command_id", command_id.to_string());
                    UserEntryRegistration::Correlated
                }
            },
        };
    }
    let entry = ChatEntry {
        entry_id: entry_id.to_string(),
        turn_id: Some(turn_id.to_string()),
        kind: EntryKind::Message,
        role: EntryRole::User,
        status: EntryStatus::Completed,
        author_user_id: author_user_id.map(|s| s.to_string()),
        source_command_id: source_command_id.map(str::to_string),
        origin: None,
        replay_verified: None,
        created_at: created_at.to_string(),
        completed_at: Some(created_at.to_string()),
        block_order: vec![format!("{entry_id}:text")],
        blocks: [(
            format!("{entry_id}:text"),
            ContentBlock::Text {
                block_id: format!("{entry_id}:text"),
                text: text.to_string(),
            },
        )]
        .into_iter()
        .collect(),
        error: None,
        token_usage: None,
    };
    if ensure_entry(txn, root, &entry) {
        // 创建成功 → 索引随条目同事务写入（§P1-6）。
        ensure_user_entry_indexed(txn, root, turn_id, &entry.entry_id);
        UserEntryRegistration::Created
    } else {
        // `ensure_entry` 冲突（entry_id 已被占用）不写索引：该 entry_id
        // 可能被非 user entry 占用（防御），写入会造成索引污染。
        UserEntryRegistration::Duplicate
    }
}

/// Create the prompt-delivery-v2 user entry before ACP dispatch. The body is
/// durable in the chat projection while the outbox retains only the matching
/// fingerprint. A replay is idempotent only when command, turn and fingerprint
/// all match; any mismatch fails closed.
#[allow(clippy::too_many_arguments)]
pub fn create_pending_prompt_entry(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    turn_id: &str,
    entry_id: &str,
    text: &str,
    author_user_id: Option<&str>,
    source_command_id: &str,
    payload_fingerprint: &str,
    created_at: &str,
) -> UserEntryRegistration {
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    if let Some((existing_id, existing)) = user_entry_for_turn(txn, turn_id) {
        // 写路径自愈：索引缺失/不一致时回填（正常路径幂等无操作）。
        ensure_user_entry_indexed(txn, root, turn_id, &existing_id);
        let same_command = existing
            .get(txn, "source_command_id")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref()
            == Some(source_command_id);
        let same_fingerprint = existing
            .get(txn, "payload_fingerprint")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref()
            == Some(payload_fingerprint);
        return if same_command && same_fingerprint {
            UserEntryRegistration::Duplicate
        } else {
            UserEntryRegistration::SourceCommandConflict
        };
    }

    let entry = ChatEntry {
        entry_id: entry_id.to_string(),
        turn_id: Some(turn_id.to_string()),
        kind: EntryKind::Message,
        role: EntryRole::User,
        status: EntryStatus::Pending,
        author_user_id: author_user_id.map(str::to_string),
        source_command_id: Some(source_command_id.to_string()),
        origin: Some(peri_studio_proto::schema::EntryOrigin::Live),
        replay_verified: None,
        created_at: created_at.to_string(),
        completed_at: None,
        block_order: vec![format!("{entry_id}:text")],
        blocks: [(
            format!("{entry_id}:text"),
            ContentBlock::Text {
                block_id: format!("{entry_id}:text"),
                text: text.to_string(),
            },
        )]
        .into_iter()
        .collect(),
        error: None,
        token_usage: None,
    };
    if !ensure_entry(txn, root, &entry) {
        // `ensure_entry` 冲突（entry_id 已被占用）不写索引：防污染（同
        // `create_user_entry` 创建路径）。
        return UserEntryRegistration::Duplicate;
    }
    // 创建成功 → 索引随条目同事务写入（§P1-6）。
    ensure_user_entry_indexed(txn, root, turn_id, &entry.entry_id);
    if let Some(entry_map) = entries
        .get(txn, entry_id)
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    {
        entry_map.insert(txn, "delivery_schema_version", 2_i64);
        entry_map.insert(txn, "delivery_state", "pending");
        entry_map.insert(txn, "delivery_error_code", yrs::Any::Null);
        entry_map.insert(txn, "payload_fingerprint", payload_fingerprint.to_string());
    }
    UserEntryRegistration::Created
}

/// Transition Hub-owned prompt delivery evidence on the existing user entry.
/// Returns false for duplicate state or non-v2/unknown entries.
pub fn prompt_entry_turn_id(
    txn: &TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
) -> Option<String> {
    root.get(txn, "entries")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .and_then(|entries| entries.get(txn, entry_id))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .filter(|entry| {
            entry
                .get(txn, "delivery_schema_version")
                .and_then(|value| value.cast::<i64>().ok())
                == Some(2)
        })
        .and_then(|entry| entry.get(txn, "turn_id"))
        .and_then(|value| value.cast::<String>().ok())
}

/// 清除 agent 投影的输入预测（新 user 消息投递即失效）。用户消息单写注入
/// （§6.5 RegisterPendingPromptEntry/RegisterUserEntry）与 ACP 回放共用
/// （聚合器 UserMessage 写分支）；非回放回声已由聚合器拒绝。
pub fn clear_input_prediction(txn: &mut TransactionCtx<'_>, root: &yrs::MapRef) {
    let agent = root.get_or_init::<_, yrs::MapRef>(txn, "agent");
    agent.remove(txn, "input_prediction");
}

pub fn set_prompt_entry_delivery(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
    delivery_state: &str,
    delivery_error_code: Option<&str>,
    completed_at: Option<&str>,
) -> bool {
    if !matches!(
        delivery_state,
        "pending" | "completed" | "failed_not_delivered" | "delivery_unknown"
    ) {
        return false;
    }
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    let Some(entry_map) = entries
        .get(txn, entry_id)
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    let is_v2 = entry_map
        .get(txn, "delivery_schema_version")
        .and_then(|value| value.cast::<i64>().ok())
        == Some(2);
    if !is_v2 {
        return false;
    }
    let previous = entry_map
        .get(txn, "delivery_state")
        .and_then(|value| value.cast::<String>().ok());
    let previous_error = entry_map
        .get(txn, "delivery_error_code")
        .and_then(|value| value.cast::<String>().ok());
    if previous.as_deref() == Some(delivery_state)
        && previous_error.as_deref() == delivery_error_code
    {
        return false;
    }
    // 回合已有精确完成证据后，不得被迟到的 L3 超时/对账降级成 unknown。
    // assistant 终态也算完成证据：user entry 的 delivery_state 可能仍是 pending。
    if delivery_state == "delivery_unknown" {
        if previous.as_deref() == Some("completed") {
            return false;
        }
        let turn_id = entry_map
            .get(txn, "turn_id")
            .and_then(|value| value.cast::<String>().ok());
        if turn_id
            .as_deref()
            .is_some_and(|turn_id| turn_has_terminal_assistant(txn, turn_id))
        {
            return false;
        }
    }
    if previous.as_deref() == Some("completed") && delivery_state != "completed" {
        return false;
    }
    entry_map.insert(txn, "delivery_state", delivery_state.to_string());
    match delivery_error_code {
        Some(code) => entry_map.insert(txn, "delivery_error_code", code.to_string()),
        None => entry_map.insert(txn, "delivery_error_code", yrs::Any::Null),
    };
    if delivery_state == "completed" {
        entry_map.insert(txn, "status", entry_status_str(EntryStatus::Completed));
        match completed_at {
            Some(at) => entry_map.insert(txn, "completed_at", at.to_string()),
            None => entry_map.insert(txn, "completed_at", yrs::Any::Null),
        };
    } else if delivery_state == "failed_not_delivered" {
        entry_map.insert(txn, "status", entry_status_str(EntryStatus::Error));
        match completed_at {
            Some(at) => entry_map.insert(txn, "completed_at", at.to_string()),
            None => entry_map.insert(txn, "completed_at", yrs::Any::Null),
        };
    }
    true
}
