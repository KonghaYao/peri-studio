//! 事件应用与 turn/权限辅助（`doc_manager.rs` 拆分，§6.3/§7.3）。
//!
//! 职责边界：[`apply_event`]（聚合器单事件路径：预读 → apply → persist/
//! 广播，§6.4 事务顺序）与 turn/权限辅助（[`is_terminal_turn`]/
//! [`read_session_active_turn`]/[`migrate_permission_tool`]/
//! [`bump_control_projection`]/[`report_projection_failure`]）。
//!
//! 拆分动机（结构拆分，行为不变）：原 `doc_manager.rs` 2014 行超限，按主题
//! 拆分——事件应用与命令应用分文件（本文件 / `doc_manager_apply_command.rs`）。

use std::sync::Arc;

use tokio::sync::{mpsc, RwLock};
use tracing::trace;
use yrs::{Map, Transact, WriteTxn};

use peri_studio_proto::schema::ToolCallStatus;

use crate::state::aggregator::Aggregator;
use crate::state::chat_writer;
use crate::state::doc_manager::{DocCommand, DocUpdate, SubmitResult, UpdateSink};
use crate::state::doc_pair::DocPair;
use crate::state::normalized::NormalizedEvent;
use crate::state::registry::{DegradeCause, RegistryState};

use super::doc_manager_persist::{persist_and_broadcast, report_gap};

/// 单事件应用 + 持久化/广播（doc_manager 主循环拆分实现段）。
#[allow(clippy::too_many_arguments)] // 提交管线完整输入上下文（doc 对/聚合器/双更新流/镜像/广播/registry）。
pub(crate) async fn apply_event(
    chat_id: &str,
    pair: &mut DocPair,
    agg: &mut Aggregator,
    ev: &NormalizedEvent,
    chat_updates: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    control_updates: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    sink: &Arc<dyn UpdateSink>,
    broadcast: &Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>>,
    registry: &RegistryState,
    persist_retry: &mut Vec<DocUpdate>,
) -> SubmitResult {
    let result = agg.apply(pair, ev);
    let ok = persist_and_broadcast(
        chat_id,
        chat_updates,
        control_updates,
        sink,
        broadcast,
        registry,
        persist_retry,
    )
    .await;
    report_gap(chat_id, pair, registry).await;
    trace!(chat_id, seq = ev.seq, kind = ev.kind(), applied = result.applied, reason = ?result.reason, "event applied");
    if !ok {
        SubmitResult::PersistFailed
    } else {
        SubmitResult::Applied(result)
    }
}

/// 命令应用（§8.5 DocCommand 表）。
#[allow(clippy::too_many_arguments)]
pub(crate) fn command_kind(cmd: &DocCommand) -> &'static str {
    match cmd {
        DocCommand::ObserveStreamFrame { .. } => "observe_stream_frame",
        DocCommand::RegisterUserEntry { .. } => "register_user_entry",
        DocCommand::RegisterPendingPromptEntry { .. } => "register_pending_prompt_entry",
        DocCommand::SetPromptEntryDelivery { .. } => "set_prompt_entry_delivery",
        DocCommand::ResolvePermission { .. } => "resolve_permission",
        DocCommand::ExpirePermission { .. } => "expire_permission",
        DocCommand::ExpirePendingPermissions => "expire_pending_permissions",
        DocCommand::RegisterElicitation { .. } => "register_elicitation",
        DocCommand::BeginElicitationResponse { .. } => "begin_elicitation_response",
        DocCommand::CompleteElicitationResponse { .. } => "complete_elicitation_response",
        DocCommand::ExpirePendingElicitations { .. } => "expire_pending_elicitations",
        DocCommand::MarkTurnInterrupted { .. } => "mark_turn_interrupted",
        DocCommand::MarkTurnCancelling { .. } => "mark_turn_cancelling",
        DocCommand::SetTurnTerminal { .. } => "set_turn_terminal",
        DocCommand::UpdateTitle { .. } => "update_title",
        DocCommand::CancelStaleAssistantEntry { .. } => "cancel_stale_assistant_entry",
        DocCommand::SetChatTerminal { .. } => "set_chat_terminal",
        DocCommand::BeginLoadReplay { .. } => "begin_load_replay",
        DocCommand::SetAgentSessionId { .. } => "set_agent_session_id",
        DocCommand::SetAgentConfig { .. } => "set_agent_config",
        DocCommand::SetAgentExtensions { .. } => "set_agent_extensions",
        DocCommand::ResumeAfterGap => "resume_after_gap",
        DocCommand::EndLoadReplay => "end_load_replay",
        _ => "registry",
    }
}

pub(crate) fn is_terminal_turn(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled" | "interrupted")
}

/// 读 Session Doc `session` map 的 active turn 内嵌投影
/// （`active_turn_id`/`active_turn_status`）。
pub(crate) fn read_session_active_turn(pair: &DocPair) -> (Option<String>, String) {
    let txn = pair.session.transact();
    match chat_writer::root_map_read(&txn) {
        Some(root) => {
            let sm = root
                .get(&txn, "session")
                .and_then(|v| v.cast::<yrs::MapRef>().ok());
            let tid = sm.as_ref().and_then(|m| {
                m.get(&txn, "active_turn_id")
                    .and_then(|t| t.cast::<String>().ok())
            });
            let status = sm
                .as_ref()
                .and_then(|m| {
                    m.get(&txn, "active_turn_status")
                        .and_then(|t| t.cast::<String>().ok())
                })
                .unwrap_or_default();
            (tid, status)
        }
        None => (None, String::new()),
    }
}

pub(crate) fn migrate_permission_tool(
    pair: &mut DocPair,
    tool_call_id: Option<&str>,
    next: ToolCallStatus,
) {
    let Some(tool_call_id) = tool_call_id else {
        return;
    };
    let existing = {
        let txn = pair.chat.transact();
        chat_writer::tool_call_projection(&txn, tool_call_id)
    };
    let Some(mut tool) = existing else {
        return;
    };
    if matches!(
        tool.status,
        ToolCallStatus::Completed | ToolCallStatus::Error | ToolCallStatus::Cancelled
    ) {
        return;
    }
    tool.status = next;
    let mut txn = pair.chat_txn();
    let root = txn.get_or_insert_map(crate::state::factory::ROOT);
    chat_writer::upsert_tool_call(&mut txn, &root, &tool);
    chat_writer::bump_projection_version(&mut txn, &root);
}

pub(crate) fn bump_control_projection(pair: &mut DocPair) {
    let mut txn = pair.session_txn();
    let root = txn.get_or_insert_map(crate::state::factory::ROOT);
    chat_writer::bump_projection_version(&mut txn, &root);
}

/// observe 注册失败的上报辅助（§17.2）：panic 前异步上报 ProjectionError。
/// writer task 即将终止，ChatHandle 仍滞留 map——后续提交返回 ChannelClosed，
/// degraded 条件给出可定位的根因信号。
pub(crate) fn report_projection_failure(registry: &RegistryState) {
    let registry = registry.clone();
    tokio::spawn(async move {
        let _ = registry
            .report_condition(DegradeCause::ProjectionError)
            .await;
    });
}
