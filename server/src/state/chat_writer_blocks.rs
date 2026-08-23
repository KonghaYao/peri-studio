//! 内容块 / tool_call 写入族（`chat_writer.rs` 拆分，§5.3/§7）。
//!
//! 职责边界：assistant/system entry 骨架与内容块物理写入
//! （[`ensure_entry_with_blocks`]/[`append_block`]/[`append_text_delta`]/
//! [`set_reasoning_visibility`]）、tool_call upsert 与终态取消
//! （[`upsert_tool_call`]/[`cancel_nonterminal_tools_for_turn`]）及 JSON/
//! 公共错误字段序列化辅助（[`insert_opt_json`]/[`write_public_error`]）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `chat_writer.rs` 1340 行超限，按主题
//! 一分为四——本文件承载「写入 Chat Doc 内容面」的块与工具调用原语；
//! 读辅助/枚举值域留在 `chat_writer.rs`，entry 创建族在
//! `chat_writer_entries.rs`，终态与 active_turn 投影在 `chat_writer_turn.rs`；
//! 函数经 `chat_writer.rs` `pub use` re-export，调用方路径不变。

use yrs::{Array, Map, Text};

use peri_studio_proto::schema::{
    BlockVisibility, ContentBlock, EntryKind, EntryRole, EntryStatus, PublicError,
    ToolCallProjection, ToolCallStatus,
};

use crate::state::chat_writer::{
    entry_kind_str, entry_role_str, entry_status_str, tool_call_status_str, visibility_str,
    ContentKind,
};
use crate::state::view_store::TransactionCtx;

/// 创建 assistant/system entry 骨架 + 首块（message_delta 的 entry 未知时由
/// 聚合器先建）。
pub fn ensure_entry_with_blocks(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
    kind: EntryKind,
    role: EntryRole,
    turn_id: Option<&str>,
    created_at: &str,
) -> bool {
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    if entries.get(txn, entry_id).is_some() {
        return false;
    }
    let entry_map = entries.insert(txn, entry_id, yrs::MapPrelim::default());
    entry_map.insert(txn, "entry_id", entry_id.to_string());
    match turn_id {
        Some(t) => entry_map.insert(txn, "turn_id", t.to_string()),
        None => entry_map.insert(txn, "turn_id", yrs::Any::Null),
    };
    entry_map.insert(txn, "kind", entry_kind_str(kind));
    entry_map.insert(txn, "role", entry_role_str(role));
    entry_map.insert(txn, "status", entry_status_str(EntryStatus::Pending));
    entry_map.insert(txn, "created_at", created_at.to_string());
    entry_map.insert(txn, "author_user_id", yrs::Any::Null);
    entry_map.insert(txn, "completed_at", yrs::Any::Null);
    entry_map.insert(txn, "error", yrs::Any::Null);
    entry_map.get_or_init::<_, yrs::ArrayRef>(txn, "block_order");
    entry_map.get_or_init::<_, yrs::MapRef>(txn, "blocks");
    let order = root.get_or_init::<_, yrs::ArrayRef>(txn, "entry_order");
    order.push_back(txn, entry_id.to_string());
    true
}

/// 追加内容块（block_id 幂等），返回块引用。
pub fn append_block(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
    block: ContentBlock,
) -> bool {
    let Some(block_id) = block_id_of(&block) else {
        return false;
    };
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    let Some(entry_map) = entries
        .get(txn, entry_id)
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    let blocks = entry_map.get_or_init::<_, yrs::MapRef>(txn, "blocks");
    if blocks.get(txn, &block_id).is_some() {
        return false;
    }
    let block_order = entry_map.get_or_init::<_, yrs::ArrayRef>(txn, "block_order");
    write_content_block(txn, &blocks, &block_order, &block_id, &block)
}

fn block_id_of(block: &ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text { block_id, .. }
        | ContentBlock::Reasoning { block_id, .. }
        | ContentBlock::ToolCall { block_id, .. }
        | ContentBlock::Resource { block_id, .. } => Some(block_id.clone()),
    }
}

pub(crate) fn write_content_block(
    txn: &mut TransactionCtx<'_>,
    blocks: &yrs::MapRef,
    block_order: &yrs::ArrayRef,
    block_id: &str,
    block: &ContentBlock,
) -> bool {
    // Chat Doc 会直接同步给浏览器。hidden reasoning 不得写入该共享数据面；
    // 如未来需要内部留存，应使用独立的 principal-bound projection。
    if matches!(
        block,
        ContentBlock::Reasoning {
            visibility: BlockVisibility::Hidden,
            ..
        }
    ) {
        return false;
    }
    let bm = blocks.insert(txn, block_id, yrs::MapPrelim::default());
    match block {
        ContentBlock::Text { block_id, text } => {
            bm.insert(txn, "block_id", block_id.clone());
            bm.insert(txn, "kind", "text");
            bm.insert(txn, "text", yrs::TextPrelim::new(text.clone()));
        }
        ContentBlock::Reasoning {
            block_id,
            text,
            visibility,
        } => {
            bm.insert(txn, "block_id", block_id.clone());
            bm.insert(txn, "kind", "reasoning");
            bm.insert(txn, "text", yrs::TextPrelim::new(text.clone()));
            bm.insert(txn, "visibility", visibility_str(*visibility));
        }
        ContentBlock::ToolCall {
            block_id,
            tool_call_id,
        } => {
            bm.insert(txn, "block_id", block_id.clone());
            bm.insert(txn, "kind", "tool_call");
            bm.insert(txn, "tool_call_id", tool_call_id.clone());
        }
        ContentBlock::Resource {
            block_id,
            resource_id,
            media_type,
            name,
        } => {
            bm.insert(txn, "block_id", block_id.clone());
            bm.insert(txn, "kind", "resource");
            bm.insert(txn, "resource_id", resource_id.clone());
            bm.insert(txn, "media_type", media_type.clone());
            bm.insert(txn, "name", name.clone());
        }
    }
    block_order.push_back(txn, block_id.to_string());
    true
}

/// 文本增量追加：block 不存在则先建（block_id 幂等），`Y.Text` insert（块
/// 尾部）。
///
/// 返回：新建块返回 `true`（首帧），追加已有块返回 `false`。
pub fn append_text_delta(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
    block_id: &str,
    delta: &str,
    kind: ContentKind,
) -> bool {
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    let Some(entry_map) = entries
        .get(txn, entry_id)
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    let blocks = entry_map.get_or_init::<_, yrs::MapRef>(txn, "blocks");
    let block_order = entry_map.get_or_init::<_, yrs::ArrayRef>(txn, "block_order");
    let created = match blocks.get(txn, block_id) {
        Some(v) => {
            // 已有块：定位 Y.Text 追加。
            if let Some(text) = v.cast::<yrs::MapRef>().ok().and_then(|m| {
                m.get(txn, "text")
                    .and_then(|t| t.cast::<yrs::TextRef>().ok())
            }) {
                text.push(txn, delta);
            }
            false
        }
        None => {
            let bm = blocks.insert(txn, block_id, yrs::MapPrelim::default());
            bm.insert(txn, "block_id", block_id.to_string());
            match kind {
                ContentKind::Text => {
                    bm.insert(txn, "kind", "text");
                    bm.insert(txn, "text", yrs::TextPrelim::new(delta.to_string()));
                }
                ContentKind::Reasoning => {
                    bm.insert(txn, "kind", "reasoning");
                    bm.insert(txn, "text", yrs::TextPrelim::new(delta.to_string()));
                    // 默认可见性 summary；ReasoningDelta 后续经
                    // set_reasoning_visibility 覆盖。
                    bm.insert(txn, "visibility", "summary");
                }
            }
            block_order.push_back(txn, block_id.to_string());
            true
        }
    };
    // 首帧后 entry 置 streaming（有内容产出）。
    if created {
        entry_map.insert(txn, "status", entry_status_str(EntryStatus::Streaming));
    }
    created
}

/// reasoning 可见性设置（summary/hidden；hidden 绝不发给无权客户端，§5.3）。
/// 返回是否找到并更新。
///
/// `entry_id` 由调用方（聚合器）传入——增量归位时已知当前 entry，避免每
/// 条 reasoning delta 全表扫描 `entries` 定位块所在 entry（§6 渲染成本）。
pub fn set_reasoning_visibility(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    entry_id: &str,
    block_id: &str,
    visibility: BlockVisibility,
) -> bool {
    let entries = root.get_or_init::<_, yrs::MapRef>(txn, "entries");
    let Some(entry_map) = entries
        .get(txn, entry_id)
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    else {
        return false;
    };
    let blocks = entry_map.get_or_init::<_, yrs::MapRef>(txn, "blocks");
    if let Some(bm) = blocks
        .get(txn, block_id)
        .and_then(|b| b.cast::<yrs::MapRef>().ok())
    {
        bm.insert(txn, "visibility", visibility_str(visibility));
        return true;
    }
    false
}

/// tool_call upsert（tool_call_id 幂等：存在则更新字段，不存在则创建）。
/// 返回是否新建。
pub fn upsert_tool_call(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    tc: &ToolCallProjection,
) -> bool {
    let calls = root.get_or_init::<_, yrs::MapRef>(txn, "tool_calls");
    let created = calls.get(txn, &tc.tool_call_id).is_none();
    let cm = calls.get_or_init::<_, yrs::MapRef>(txn, tc.tool_call_id.as_str());
    cm.insert(txn, "tool_call_id", tc.tool_call_id.clone());
    cm.insert(txn, "turn_id", tc.turn_id.clone());
    cm.insert(txn, "name", tc.name.clone());
    cm.insert(txn, "status", tool_call_status_str(tc.status));
    insert_opt_json(txn, &cm, "arguments", tc.arguments.as_ref());
    insert_opt_json(txn, &cm, "result", tc.result.as_ref());
    match tc.result_omitted {
        Some(value) => cm.insert(txn, "result_omitted", value),
        None => cm.insert(txn, "result_omitted", yrs::Any::Null),
    };
    match tc.result_bytes {
        Some(value) => cm.insert(txn, "result_bytes", value as f64),
        None => cm.insert(txn, "result_bytes", yrs::Any::Null),
    };
    match &tc.public_error {
        Some(e) => write_public_error(txn, &cm, "public_error", e),
        None => {
            cm.insert(txn, "public_error", yrs::Any::Null);
        }
    };
    match &tc.permission_id {
        Some(p) => cm.insert(txn, "permission_id", p.clone()),
        None => cm.insert(txn, "permission_id", yrs::Any::Null),
    };
    match &tc.started_at {
        Some(value) => cm.insert(txn, "started_at", value.clone()),
        None => cm.insert(txn, "started_at", yrs::Any::Null),
    };
    match &tc.completed_at {
        Some(value) => cm.insert(txn, "completed_at", value.clone()),
        None => cm.insert(txn, "completed_at", yrs::Any::Null),
    };
    created
}

/// Cancel every non-terminal tool belonging to a turn. Used only when the turn itself reaches
/// a cancellation/interruption terminal so cards cannot remain visually running forever.
pub fn cancel_nonterminal_tools_for_turn(
    txn: &mut TransactionCtx<'_>,
    root: &yrs::MapRef,
    turn_id: &str,
) -> usize {
    let calls = root.get_or_init::<_, yrs::MapRef>(txn, "tool_calls");
    let ids: Vec<String> = calls.iter(txn).map(|(id, _)| id.to_string()).collect();
    let mut migrated = 0;
    for id in ids {
        let Some(tool) = calls
            .get(txn, id.as_str())
            .and_then(|value| value.cast::<yrs::MapRef>().ok())
        else {
            continue;
        };
        let linked_turn = tool
            .get(txn, "turn_id")
            .and_then(|value| value.cast::<String>().ok());
        let status = tool
            .get(txn, "status")
            .and_then(|value| value.cast::<String>().ok())
            .unwrap_or_default();
        if linked_turn.as_deref() == Some(turn_id)
            && !matches!(status.as_str(), "completed" | "error" | "cancelled")
        {
            tool.insert(
                txn,
                "status",
                tool_call_status_str(ToolCallStatus::Cancelled),
            );
            migrated += 1;
        }
    }
    migrated
}

fn insert_opt_json(
    txn: &mut TransactionCtx<'_>,
    map: &yrs::MapRef,
    key: &str,
    v: Option<&serde_json::Value>,
) {
    match v {
        Some(value) => {
            let s = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
            let any = yrs::Any::from_json(&s).unwrap_or(yrs::Any::Null);
            map.insert(txn, key, yrs::In::from(any));
        }
        None => {
            map.insert(txn, key, yrs::Any::Null);
        }
    };
}

pub(crate) fn write_public_error(
    txn: &mut TransactionCtx<'_>,
    map: &yrs::MapRef,
    key: &str,
    e: &PublicError,
) {
    let em = map.insert(txn, key, yrs::MapPrelim::default());
    em.insert(txn, "code", e.code.clone());
    em.insert(txn, "message", e.message.clone());
}
