//! 聚合器写入族·chat tool/permission 投影。
//!
//! 本模块拥有 tool-call 与其 permission 链接在 Chat Doc 的预读上下文和事务
//! 写入。调用方只负责保持 chat → control 的事务顺序，不需要了解 tool 生命周期
//! 的单向迁移、回放时间戳或 permission 联动细节。

use peri_studio_proto::{
    action::PermissionDecision,
    schema::{EntryKind, EntryRole, ToolCallProjection, ToolCallStatus},
};
use yrs::{MapRef, Transact};

use crate::state::{
    chat_writer,
    doc_pair::DocPair,
    normalized::{EventBody, NormalizedEvent},
    permission,
    view_store::TransactionCtx,
};

use super::{
    aggregator::{Aggregator, TOOL_RESULT_MAX_BYTES},
    aggregator_write_helpers::{advance_tool_status, default_tool_call},
};

/// 一次 tool/permission Chat Doc 写入所需的稳定预读快照。
pub(super) struct ToolChatWriteContext {
    pre_read: Option<ToolCallProjection>,
    permission_link: Option<(String, Option<String>)>,
    linked_pending_count: usize,
    resolved_tool: (String, String),
    replay_active: bool,
    replay_producer_verified: bool,
}

impl Aggregator {
    /// 在打开 Chat Doc 写事务前准备 tool/permission 所需的全部只读事实。
    pub(super) fn prepare_tool_chat_context(
        &self,
        pair: &mut DocPair,
        ev: &NormalizedEvent,
        replay_active: bool,
        replay_producer_verified: bool,
    ) -> Option<ToolChatWriteContext> {
        if !matches!(
            ev.body,
            EventBody::ToolCallStarted { .. }
                | EventBody::ToolCallUpdated { .. }
                | EventBody::ToolCallCompleted { .. }
                | EventBody::PermissionRequested { .. }
                | EventBody::PermissionResolved { .. }
                | EventBody::PermissionExpired { .. }
        ) {
            return None;
        }
        let permission_link = match &ev.body {
            EventBody::PermissionResolved { permission_id, .. }
            | EventBody::PermissionExpired { permission_id } => {
                let txn = pair.session.transact();
                self.permission_context(&txn, permission_id)
            }
            _ => None,
        };
        let linked_pending_count = permission_link
            .as_ref()
            .and_then(|(_, tool_call_id)| tool_call_id.as_deref())
            .map(|tool_call_id| permission::pending_count_for_tool(pair, tool_call_id))
            .unwrap_or(0);
        let pre_read = match &ev.body {
            EventBody::ToolCallStarted { tool_call_id, .. }
            | EventBody::ToolCallUpdated { tool_call_id, .. }
            | EventBody::ToolCallCompleted { tool_call_id, .. } => {
                let txn = pair.chat.transact();
                chat_writer::tool_call_projection(&txn, tool_call_id)
            }
            EventBody::PermissionRequested {
                tool_call_id: Some(tool_call_id),
                ..
            } => {
                let txn = pair.chat.transact();
                chat_writer::tool_call_projection(&txn, tool_call_id)
            }
            EventBody::PermissionResolved { .. } | EventBody::PermissionExpired { .. } => {
                let txn = pair.chat.transact();
                permission_link
                    .as_ref()
                    .and_then(|(_, tool_call_id)| tool_call_id.as_deref())
                    .and_then(|tool_call_id| chat_writer::tool_call_projection(&txn, tool_call_id))
            }
            _ => None,
        };
        let resolved_tool = match &ev.body {
            EventBody::ToolCallStarted { turn_id, .. } if turn_id.is_empty() => {
                let turn_id = pair
                    .stream
                    .replay_turn
                    .clone()
                    .or_else(|| self.read_active_turn(pair).map(|active| active.turn_id))
                    .unwrap_or_default();
                let entry_id = Self::projection_segment_entry(&mut pair.stream, &turn_id, "tools");
                (turn_id, entry_id)
            }
            EventBody::ToolCallStarted { turn_id, .. } => {
                (turn_id.clone(), format!("{turn_id}:assistant"))
            }
            _ => (String::new(), String::new()),
        };
        Some(ToolChatWriteContext {
            pre_read,
            permission_link,
            linked_pending_count,
            resolved_tool,
            replay_active,
            replay_producer_verified,
        })
    }

    /// 把一个已判定的 tool/permission 事件写入调用方持有的 Chat Doc 事务。
    pub(super) fn write_tool_chat_event(
        &self,
        txn: &mut TransactionCtx<'_>,
        root: &MapRef,
        ev: &NormalizedEvent,
        context: &ToolChatWriteContext,
    ) {
        match &ev.body {
            EventBody::ToolCallStarted {
                tool_call_id,
                name,
                status,
                arguments,
                created_at,
                ..
            } => {
                let (turn_id, entry_id) = &context.resolved_tool;
                let tc = if let Some(mut existing) = context.pre_read.clone() {
                    existing.name = name.clone();
                    if arguments.is_some() {
                        existing.arguments = arguments.clone();
                    }
                    existing.status = advance_tool_status(existing.status, *status, false);
                    existing
                } else {
                    ToolCallProjection {
                        tool_call_id: tool_call_id.clone(),
                        turn_id: turn_id.clone(),
                        name: name.clone(),
                        status: *status,
                        arguments: arguments.clone(),
                        result: None,
                        result_omitted: Some(false),
                        result_bytes: None,
                        public_error: None,
                        permission_id: None,
                        // 回放通知不携带原始执行时间，不能用传输耗时伪造。
                        started_at: (!context.replay_active).then(|| created_at.clone()),
                        completed_at: None,
                    }
                };
                chat_writer::upsert_tool_call(txn, root, &tc);
                chat_writer::ensure_entry_with_blocks(
                    txn,
                    root,
                    entry_id,
                    EntryKind::Message,
                    EntryRole::Assistant,
                    Some(turn_id),
                    &ev.ts,
                );
                chat_writer::append_block(
                    txn,
                    root,
                    entry_id,
                    peri_studio_proto::schema::ContentBlock::ToolCall {
                        block_id: format!("tool:{tool_call_id}"),
                        tool_call_id: tool_call_id.clone(),
                    },
                );
                chat_writer::record_entry_origin(
                    txn,
                    root,
                    entry_id,
                    context.replay_active,
                    context.replay_producer_verified,
                );
                chat_writer::bump_projection_version(txn, root);
            }
            EventBody::ToolCallUpdated {
                status, arguments, ..
            } => {
                // 缺省 arguments 表示未提供，不能清空已有输入证据。
                let mut tc = context.pre_read.clone().unwrap_or_else(default_tool_call);
                if arguments.is_some() {
                    tc.arguments = arguments.clone();
                }
                if let Some(next) = status {
                    tc.status = advance_tool_status(tc.status, *next, false);
                }
                chat_writer::upsert_tool_call(txn, root, &tc);
                let entry_id = format!("{}:assistant", tc.turn_id);
                chat_writer::record_entry_origin(
                    txn,
                    root,
                    &entry_id,
                    context.replay_active,
                    context.replay_producer_verified,
                );
                chat_writer::bump_projection_version(txn, root);
            }
            EventBody::ToolCallCompleted {
                result,
                public_error,
                completed_at,
                ..
            } => {
                let mut tc = context.pre_read.clone().unwrap_or_else(default_tool_call);
                let terminal = if public_error.is_some() {
                    ToolCallStatus::Error
                } else {
                    ToolCallStatus::Completed
                };
                let previous_status = tc.status;
                tc.status = advance_tool_status(tc.status, terminal, false);
                if tc.status != previous_status {
                    let serialized_bytes = result
                        .as_ref()
                        .and_then(|value| serde_json::to_vec(value).ok())
                        .map(|bytes| bytes.len());
                    let result_omitted = result.is_some()
                        && serialized_bytes
                            .map(|size| size > TOOL_RESULT_MAX_BYTES)
                            .unwrap_or(true);
                    tc.result_omitted = Some(result_omitted);
                    tc.result_bytes = serialized_bytes.and_then(|size| u64::try_from(size).ok());
                    tc.result = if result_omitted { None } else { result.clone() };
                    tc.public_error = public_error.clone();
                    tc.completed_at = (!context.replay_active).then(|| completed_at.clone());
                    chat_writer::upsert_tool_call(txn, root, &tc);
                    let entry_id = format!("{}:assistant", tc.turn_id);
                    chat_writer::record_entry_origin(
                        txn,
                        root,
                        &entry_id,
                        context.replay_active,
                        context.replay_producer_verified,
                    );
                    chat_writer::bump_projection_version(txn, root);
                }
            }
            EventBody::PermissionRequested {
                permission_id,
                tool_call_id,
                tool,
                turn_id,
                ..
            } => {
                if let Some(tool_call_id) = tool_call_id {
                    let synthesized = tool.as_ref().and_then(|snapshot| {
                        (snapshot.tool_call_id == *tool_call_id && !turn_id.is_empty()).then(|| {
                            ToolCallProjection {
                                tool_call_id: tool_call_id.clone(),
                                turn_id: turn_id.clone(),
                                name: snapshot.name.clone(),
                                status: ToolCallStatus::AwaitingPermission,
                                arguments: snapshot.arguments.clone(),
                                result: None,
                                result_omitted: Some(false),
                                result_bytes: None,
                                public_error: None,
                                permission_id: Some(permission_id.clone()),
                                started_at: (!context.replay_active).then(|| ev.ts.clone()),
                                completed_at: None,
                            }
                        })
                    });
                    if let Some(mut tc) = context.pre_read.clone().or(synthesized) {
                        tc.status = advance_tool_status(
                            tc.status,
                            ToolCallStatus::AwaitingPermission,
                            true,
                        );
                        tc.permission_id = Some(permission_id.clone());
                        chat_writer::upsert_tool_call(txn, root, &tc);
                        let entry_id = format!("{}:assistant", tc.turn_id);
                        chat_writer::ensure_entry_with_blocks(
                            txn,
                            root,
                            &entry_id,
                            EntryKind::Message,
                            EntryRole::Assistant,
                            Some(&tc.turn_id),
                            &ev.ts,
                        );
                        chat_writer::append_block(
                            txn,
                            root,
                            &entry_id,
                            peri_studio_proto::schema::ContentBlock::ToolCall {
                                block_id: format!("tool:{tool_call_id}"),
                                tool_call_id: tool_call_id.clone(),
                            },
                        );
                        chat_writer::record_entry_origin(
                            txn,
                            root,
                            &entry_id,
                            context.replay_active,
                            context.replay_producer_verified,
                        );
                        chat_writer::bump_projection_version(txn, root);
                    }
                }
            }
            EventBody::PermissionResolved { decision, .. } => {
                if context
                    .permission_link
                    .as_ref()
                    .is_some_and(|(status, _)| status == "pending")
                {
                    if let Some(mut tc) = context.pre_read.clone() {
                        let next = match decision {
                            PermissionDecision::Allow if context.linked_pending_count > 1 => {
                                ToolCallStatus::AwaitingPermission
                            }
                            PermissionDecision::Allow => ToolCallStatus::Running,
                            PermissionDecision::Deny => ToolCallStatus::Cancelled,
                        };
                        tc.status = advance_tool_status(tc.status, next, true);
                        chat_writer::upsert_tool_call(txn, root, &tc);
                        chat_writer::bump_projection_version(txn, root);
                    }
                }
            }
            EventBody::PermissionExpired { .. } => {
                if context
                    .permission_link
                    .as_ref()
                    .is_some_and(|(status, _)| status == "pending")
                {
                    if let Some(mut tc) = context.pre_read.clone() {
                        tc.status = advance_tool_status(tc.status, ToolCallStatus::Cancelled, true);
                        chat_writer::upsert_tool_call(txn, root, &tc);
                        chat_writer::bump_projection_version(txn, root);
                    }
                }
            }
            _ => unreachable!("tool chat context only accepts tool/permission events"),
        }
    }
}
