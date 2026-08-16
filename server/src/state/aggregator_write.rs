//! 聚合器写入族·chat 侧（`aggregator.rs` 拆分，§6.4 事务顺序；原 2201 行
//! 超限，`write` 按事务边界一分为二，行为不变）。
//!
//! [`Aggregator::write`] 的预读与 Chat Doc 事务内写入；control 侧写入
//! （CAS 自开事务，须在 chat 事务 drop 后）见 `aggregator_write_control.rs`。

use yrs::{Transact, WriteTxn};
use peri_studio_proto::{action::PermissionDecision, schema::{EntryKind, EntryRole, EntryStatus, ToolCallProjection, ToolCallStatus, TurnStatus}};
use crate::state::{chat_writer::{self, ContentKind}, doc_pair::DocPair, factory::ROOT, normalized::{EventBody, EventProvenance, NormalizedEvent}, permission};
use super::{aggregator::{Aggregator, TOOL_RESULT_MAX_BYTES}, aggregator_write_helpers::{advance_tool_status, default_tool_call, extension_negotiated}};

impl Aggregator {
    pub(crate) fn write(&self, pair: &mut DocPair, ev: &NormalizedEvent) {
        // Permission resolution events only carry a permission id. Resolve their optional
        // tool link before opening the chat transaction; the aggregator is the serialized
        // single writer, so a pending snapshot cannot race the following CAS.
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
        // 预读：chat 侧 upsert 需要保留的现有投影（开写事务前完成）。
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
        // 预读：回放合成（§8.5 REPLAY_NEEDS_TURN）——历史首帧即为 agent
        // 增量（无 user 消息先行）时无 turn 可归位，先分配回放归位 turn
        // （`load:{seq}`，seq 水位单调天然幂等）；user 占位 entry 在 chat
        // 事务内创建（参考实现：合成一条空文本 user_message 回放 turn，
        // 避免空 id 垃圾条目）。
        let replay_active = pair.stream.replay_active;
        let replay_producer_verified = replay_active
            && ev.provenance == EventProvenance::PeriReplay
            && extension_negotiated(pair, "peri.replay");
        let replay_synth = if replay_active
            && pair.stream.replay_turn.is_none()
            && matches!(
                ev.body,
                EventBody::MessageDelta { .. }
                    | EventBody::ReasoningDelta { .. }
                    | EventBody::ToolCallStarted { .. }
            ) {
            let t = format!("load:{}", ev.seq);
            pair.stream.replay_turn = Some(t.clone());
            pair.stream.replay_turns.push(t.clone());
            Some((t.clone(), format!("{t}:user")))
        } else {
            None
        };
        // 预读：帧无 id（真实 peri 增量）按 active_turn 归位（§7.2；读
        // control doc 须在 chat 写事务之前，§7.4 借位纪律）。
        let resolved = match &ev.body {
            EventBody::MessageDelta {
                turn_id,
                entry_id,
                block_id,
                ..
            } => Some(self.resolve_entry_ids(pair, turn_id, entry_id, block_id, "text")),
            EventBody::ReasoningDelta {
                turn_id,
                entry_id,
                block_id,
                ..
            } => Some(self.resolve_entry_ids(pair, turn_id, entry_id, block_id, "reasoning")),
            _ => None,
        };
        let resolved_tool_turn = match &ev.body {
            EventBody::ToolCallStarted { turn_id, .. } if turn_id.is_empty() => {
                self.resolve_entry_ids(pair, turn_id, "", "", "tool").0
            }
            EventBody::ToolCallStarted { turn_id, .. } => turn_id.clone(),
            _ => String::new(),
        };
        // 预读：回放模式（§8.5）历史 user 消息的归位 turn（chat 事务前
        // 计算——事务借用与 stream 可变借用互斥，§7.4）。
        let replay = if pair.stream.replay_active {
            match &ev.body {
                EventBody::UserMessage { .. } => {
                    let t = format!("load:{}", ev.seq);
                    pair.stream.replay_turn = Some(t.clone());
                    pair.stream.replay_turns.push(t.clone());
                    Some((t.clone(), format!("{t}:user")))
                }
                _ => None,
            }
        } else {
            None
        };
        // chat 侧写入（一次事务）。
        {
            let mut txn = pair.chat_txn();
            let root = txn.get_or_insert_map(ROOT);
            // 回放合成占位 user entry（预读区已分配 turn，§8.5）。
            if let Some((t, e)) = &replay_synth {
                chat_writer::create_user_entry(&mut txn, &root, t, e, "", None, None, &ev.ts);
                chat_writer::record_entry_origin(&mut txn, &root, e, true, false);
                chat_writer::bump_projection_version(&mut txn, &root);
            }
            match &ev.body {
                EventBody::MessageDelta { text, .. } => {
                    // 帧无 id（真实 peri 增量）：按 active_turn 归位（§7.2；
                    // chat-channel ASSISTANT_ENTRY 派生规则）。
                    let (turn_id, entry_id, block_id) = resolved.clone().unwrap();
                    chat_writer::ensure_entry_with_blocks(
                        &mut txn,
                        &root,
                        &entry_id,
                        EntryKind::Message,
                        EntryRole::Assistant,
                        Some(&turn_id),
                        &ev.ts,
                    );
                    chat_writer::append_text_delta(
                        &mut txn,
                        &root,
                        &entry_id,
                        &block_id,
                        text,
                        ContentKind::Text,
                    );
                    chat_writer::record_entry_origin(
                        &mut txn,
                        &root,
                        &entry_id,
                        replay_active,
                        replay_producer_verified,
                    );
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
                EventBody::ReasoningDelta {
                    text, visibility, ..
                } => {
                    let (turn_id, entry_id, block_id) = resolved.clone().unwrap();
                    chat_writer::ensure_entry_with_blocks(
                        &mut txn,
                        &root,
                        &entry_id,
                        EntryKind::Message,
                        EntryRole::Assistant,
                        Some(&turn_id),
                        &ev.ts,
                    );
                    chat_writer::append_text_delta(
                        &mut txn,
                        &root,
                        &entry_id,
                        &block_id,
                        text,
                        ContentKind::Reasoning,
                    );
                    chat_writer::set_reasoning_visibility(&mut txn, &root, &entry_id, &block_id, *visibility);
                    chat_writer::record_entry_origin(
                        &mut txn,
                        &root,
                        &entry_id,
                        replay_active,
                        replay_producer_verified,
                    );
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
                EventBody::UserMessage {
                    turn_id,
                    entry_id,
                    text,
                    author_user_id,
                    created_at,
                } => {
                    // 回放模式（§8.5）：历史 user 消息无 turn_id——按回放序
                    // 生成归位 turn（`load:{seq}`；seq 水位单调，天然幂等），
                    // 后续 agent chunk 归位到该 turn。turn 在预读区计算。
                    let (replay_turn, replay_entry) = match &replay {
                        Some((t, e)) => (t.clone(), e.clone()),
                        None => (turn_id.clone(), entry_id.clone()),
                    };
                    chat_writer::create_user_entry(
                        &mut txn,
                        &root,
                        &replay_turn,
                        &replay_entry,
                        text,
                        author_user_id.as_deref(),
                        None,
                        created_at,
                    );
                    chat_writer::record_entry_origin(
                        &mut txn,
                        &root,
                        &replay_entry,
                        replay_active,
                        replay_producer_verified,
                    );
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
                EventBody::ToolCallStarted {
                    tool_call_id,
                    name,
                    status,
                    arguments,
                    created_at,
                    ..
                } => {
                    let turn_id = &resolved_tool_turn;
                    let tc = if let Some(mut existing) = pre_read.clone() {
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
                            // session/load emits fresh notifications for historical
                            // calls but does not carry original execution timestamps.
                            // Do not manufacture a replay-duration from transport speed.
                            started_at: (!replay_active).then(|| created_at.clone()),
                            completed_at: None,
                        }
                    };
                    chat_writer::upsert_tool_call(&mut txn, &root, &tc);
                    let entry_id = format!("{turn_id}:assistant");
                    chat_writer::ensure_entry_with_blocks(
                        &mut txn,
                        &root,
                        &entry_id,
                        EntryKind::Message,
                        EntryRole::Assistant,
                        Some(turn_id),
                        &ev.ts,
                    );
                    chat_writer::append_block(
                        &mut txn,
                        &root,
                        &entry_id,
                        peri_studio_proto::schema::ContentBlock::ToolCall {
                            block_id: format!("tool:{tool_call_id}"),
                            tool_call_id: tool_call_id.clone(),
                        },
                    );
                    chat_writer::record_entry_origin(
                        &mut txn,
                        &root,
                        &entry_id,
                        replay_active,
                        replay_producer_verified,
                    );
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
                EventBody::ToolCallUpdated {
                    status, arguments, ..
                } => {
                    // ACP 提供 arguments 时全量覆盖；缺省表示“未提供”，不能
                    // 清空先前输入证据。状态只允许服务端定义的单向迁移。
                    let mut tc = pre_read.clone().unwrap_or_else(default_tool_call);
                    if arguments.is_some() {
                        tc.arguments = arguments.clone();
                    }
                    if let Some(next) = status {
                        tc.status = advance_tool_status(tc.status, *next, false);
                    }
                    chat_writer::upsert_tool_call(&mut txn, &root, &tc);
                    let entry_id = format!("{}:assistant", tc.turn_id);
                    chat_writer::record_entry_origin(
                        &mut txn,
                        &root,
                        &entry_id,
                        replay_active,
                        replay_producer_verified,
                    );
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
                EventBody::ToolCallCompleted {
                    result,
                    public_error,
                    completed_at,
                    ..
                } => {
                    let mut tc = pre_read.clone().unwrap_or_else(default_tool_call);
                    let terminal = if public_error.is_some() {
                        ToolCallStatus::Error
                    } else {
                        ToolCallStatus::Completed
                    };
                    let previous_status = tc.status;
                    tc.status = advance_tool_status(tc.status, terminal, false);
                    if tc.status != previous_status {
                        // 序列化一次：超限时不保留内容，但投影明确说明是省略而非空结果。
                        let serialized_bytes = result
                            .as_ref()
                            .and_then(|value| serde_json::to_vec(value).ok())
                            .map(|bytes| bytes.len());
                        let result_omitted = result.is_some()
                            && serialized_bytes
                                .map(|size| size > TOOL_RESULT_MAX_BYTES)
                                .unwrap_or(true);
                        tc.result_omitted = Some(result_omitted);
                        tc.result_bytes =
                            serialized_bytes.and_then(|size| u64::try_from(size).ok());
                        tc.result = if result_omitted { None } else { result.clone() };
                        tc.public_error = public_error.clone();
                        tc.completed_at = (!replay_active).then(|| completed_at.clone());
                        chat_writer::upsert_tool_call(&mut txn, &root, &tc);
                        let entry_id = format!("{}:assistant", tc.turn_id);
                        chat_writer::record_entry_origin(
                            &mut txn,
                            &root,
                            &entry_id,
                            replay_active,
                            replay_producer_verified,
                        );
                        chat_writer::bump_projection_version(&mut txn, &root);
                    } else {
                        // Awaiting permission blocks ordinary completion, just as it
                        // blocks running updates. Do not persist a result/completion
                        // timestamp that would contradict the visible lifecycle.
                    }
                }
                EventBody::TurnTerminal {
                    turn_id,
                    status,
                    completed_at,
                    public_error,
                } => {
                    // Chat 侧：assistant entry 终态迁移（§7.2）。
                    let entry_id = format!("{turn_id}:assistant");
                    let entry_status = match status {
                        TurnStatus::Completed => EntryStatus::Completed,
                        TurnStatus::Failed => EntryStatus::Error,
                        TurnStatus::Cancelled | TurnStatus::Interrupted => EntryStatus::Cancelled,
                        _ => unreachable!("judge 已拒绝非终态"),
                    };
                    chat_writer::migrate_entry_terminal(
                        &mut txn,
                        &root,
                        &entry_id,
                        entry_status,
                        completed_at,
                        public_error.as_ref(),
                    );
                    if matches!(status, TurnStatus::Cancelled | TurnStatus::Interrupted) {
                        chat_writer::cancel_nonterminal_tools_for_turn(&mut txn, &root, turn_id);
                    }
                    chat_writer::bump_projection_version(&mut txn, &root);
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
                            (snapshot.tool_call_id == *tool_call_id && !turn_id.is_empty()).then(
                                || ToolCallProjection {
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
                                    started_at: (!replay_active).then(|| ev.ts.clone()),
                                    completed_at: None,
                                },
                            )
                        });
                        if let Some(mut tc) = pre_read.clone().or(synthesized) {
                            tc.status = advance_tool_status(
                                tc.status,
                                ToolCallStatus::AwaitingPermission,
                                true,
                            );
                            tc.permission_id = Some(permission_id.clone());
                            chat_writer::upsert_tool_call(&mut txn, &root, &tc);
                            let entry_id = format!("{}:assistant", tc.turn_id);
                            chat_writer::ensure_entry_with_blocks(
                                &mut txn,
                                &root,
                                &entry_id,
                                EntryKind::Message,
                                EntryRole::Assistant,
                                Some(&tc.turn_id),
                                &ev.ts,
                            );
                            chat_writer::append_block(
                                &mut txn,
                                &root,
                                &entry_id,
                                peri_studio_proto::schema::ContentBlock::ToolCall {
                                    block_id: format!("tool:{tool_call_id}"),
                                    tool_call_id: tool_call_id.clone(),
                                },
                            );
                            chat_writer::record_entry_origin(
                                &mut txn,
                                &root,
                                &entry_id,
                                replay_active,
                                replay_producer_verified,
                            );
                            chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                }
                EventBody::PermissionResolved { decision, .. } => {
                    if permission_link
                        .as_ref()
                        .is_some_and(|(status, _)| status == "pending")
                    {
                        if let Some(mut tc) = pre_read.clone() {
                            let next = match decision {
                                PermissionDecision::Allow if linked_pending_count > 1 => {
                                    ToolCallStatus::AwaitingPermission
                                }
                                PermissionDecision::Allow => ToolCallStatus::Running,
                                PermissionDecision::Deny => ToolCallStatus::Cancelled,
                            };
                            tc.status = advance_tool_status(tc.status, next, true);
                            chat_writer::upsert_tool_call(&mut txn, &root, &tc);
                            chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                }
                EventBody::PermissionExpired { .. } => {
                    if permission_link
                        .as_ref()
                        .is_some_and(|(status, _)| status == "pending")
                    {
                        if let Some(mut tc) = pre_read.clone() {
                            tc.status =
                                advance_tool_status(tc.status, ToolCallStatus::Cancelled, true);
                            chat_writer::upsert_tool_call(&mut txn, &root, &tc);
                            chat_writer::bump_projection_version(&mut txn, &root);
                        }
                    }
                }
                // 不涉 chat doc 的事件：无 chat 写入。
                EventBody::AgentStatus { .. }
                | EventBody::AgentConfig { .. }
                | EventBody::AgentUsage { .. }
                | EventBody::AgentActivity { .. }
                | EventBody::InputPrediction { .. }
                | EventBody::AgentPlan { .. }
                | EventBody::Capabilities { .. }
                | EventBody::SessionInfo { .. }
                | EventBody::SessionListResponse { .. } => {}
            }
        }
        self.write_control_side(pair, ev, replay_active);
    }
}








