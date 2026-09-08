//! 聚合器写入族·chat 侧（`aggregator.rs` 拆分，§6.4 事务顺序；原 2201 行
//! 超限，`write` 按事务边界一分为二，行为不变）。
//!
//! [`Aggregator::write`] 编排回放、消息与 turn 终态的 Chat Doc 事务；tool 与
//! permission 投影见 `aggregator_write_tool.rs`，control 侧写入见
//! `aggregator_write_control.rs`。事务顺序保持 chat → control。

use super::{aggregator::Aggregator, aggregator_write_helpers::extension_negotiated};
use crate::state::{
    chat_writer::{self, ContentKind},
    doc_pair::DocPair,
    factory::ROOT,
    normalized::{EventBody, EventProvenance, NormalizedEvent},
};
use peri_studio_proto::schema::{EntryKind, EntryRole, EntryStatus, EntryTokenUsage, TurnStatus};
use yrs::WriteTxn;

fn active_turn_writable_for_entry_usage(status: TurnStatus) -> bool {
    !matches!(
        status,
        TurnStatus::Cancelling
            | TurnStatus::Completed
            | TurnStatus::Failed
            | TurnStatus::Cancelled
    )
}

impl Aggregator {
    pub(crate) fn write(&self, pair: &mut DocPair, ev: &NormalizedEvent) {
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
                    | EventBody::ToolCallPatched { .. }
            ) {
            let t = format!("load:{}", ev.seq);
            pair.stream.replay_turn = Some(t.clone());
            pair.stream.replay_turns.push(t.clone());
            Some((t.clone(), format!("{t}:user")))
        } else {
            None
        };
        let tool_context =
            self.prepare_tool_chat_context(pair, ev, replay_active, replay_producer_verified);
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
        // 预读：AgentUsage 双写 entry token_usage 依赖 active_turn（§7.4 借位纪律）。
        let usage_active_turn = if matches!(ev.body, EventBody::AgentUsage { .. }) {
            self.read_active_turn(pair)
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
                    chat_writer::set_reasoning_visibility(
                        &mut txn,
                        &root,
                        &entry_id,
                        &block_id,
                        *visibility,
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
                EventBody::ToolCallStarted { .. }
                | EventBody::ToolCallUpdated { .. }
                | EventBody::ToolCallCompleted { .. }
                | EventBody::ToolCallPatched { .. } => self.write_tool_chat_event(
                    &mut txn,
                    &root,
                    ev,
                    tool_context.as_ref().expect("tool 事件必须具有预读上下文"),
                ),
                EventBody::TurnTerminal {
                    turn_id,
                    status,
                    completed_at,
                    public_error,
                } => {
                    // Chat 侧：assistant entry 终态迁移（§7.2）。
                    let entry_status = match status {
                        TurnStatus::Completed => EntryStatus::Completed,
                        TurnStatus::Failed => EntryStatus::Error,
                        TurnStatus::Cancelled | TurnStatus::Interrupted => EntryStatus::Cancelled,
                        _ => unreachable!("judge 已拒绝非终态"),
                    };
                    chat_writer::migrate_assistant_segments_terminal(
                        &mut txn,
                        &root,
                        turn_id,
                        entry_status,
                        completed_at,
                        public_error.as_ref(),
                    );
                    let tool_status = match status {
                        TurnStatus::Completed => {
                            peri_studio_proto::schema::ToolCallStatus::Completed
                        }
                        TurnStatus::Failed => peri_studio_proto::schema::ToolCallStatus::Error,
                        TurnStatus::Cancelled | TurnStatus::Interrupted => {
                            peri_studio_proto::schema::ToolCallStatus::Cancelled
                        }
                        _ => unreachable!("judge 已拒绝非终态"),
                    };
                    chat_writer::settle_nonterminal_tools_for_turn(
                        &mut txn,
                        &root,
                        turn_id,
                        tool_status,
                    );
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
                EventBody::AgentUsage {
                    context_window,
                    context_used,
                    input_tokens,
                    output_tokens,
                    ..
                } => {
                    if let Some(active) = usage_active_turn.as_ref() {
                        if active_turn_writable_for_entry_usage(active.turn_status) {
                            let entry_id = format!("{}:assistant", active.turn_id);
                            let usage = EntryTokenUsage {
                                total_tokens: *context_used,
                                context_window: *context_window,
                                input_tokens: *input_tokens,
                                output_tokens: *output_tokens,
                            };
                            if chat_writer::set_entry_token_usage(
                                &mut txn,
                                &root,
                                &entry_id,
                                &usage,
                            ) {
                                chat_writer::bump_projection_version(&mut txn, &root);
                            }
                        }
                    }
                }
                EventBody::PermissionRequested { .. }
                | EventBody::PermissionResolved { .. }
                | EventBody::PermissionExpired { .. } => self.write_tool_chat_event(
                    &mut txn,
                    &root,
                    ev,
                    tool_context
                        .as_ref()
                        .expect("permission 事件必须具有预读上下文"),
                ),
                // 不涉 chat doc 的事件：无 chat 写入。
                EventBody::AgentStatus { .. }
                | EventBody::AgentConfig { .. }
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
