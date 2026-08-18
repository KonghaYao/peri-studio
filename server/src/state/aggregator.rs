//! 幂等聚合器（§6.3）。
//!
//! **纯函数**：无 I/O、无日志副作用（脱敏日志由调用方在返回后统一打，§9.3/
//! §12 测试前提）；可重入——同一事件流应用两次视图等价。
//!
//! 判定顺序（§9.2）：epoch 校验 → seq 水位/gap → uncalibratable → chat
//! 终态 → 幂等键 → 终态守卫（interrupted 校准例外，§9.3）→ 关联检查 → 应用
//! （chat 写入 → control 写入，事务顺序固定 chat → control，§6.4/§7.4）。
//!
//! 拆分说明（结构拆分，行为不变）：本文件保留类型/常量与 apply 入口族；
//! 判定族 → `aggregator_judge.rs`，写入 → `aggregator_write.rs`（chat 侧）
//! 与 `aggregator_write_control.rs`（control 侧），写辅助 →
//! `aggregator_write_helpers.rs` / `aggregator_write_catalog.rs`。
//! 以下 `pub(crate) use` 使外部调用方 `aggregator::xxx` 路径保持不变。

//! 幂等聚合器（§6.3）。
//!
//! **纯函数**：无 I/O、无日志副作用（脱敏日志由调用方在返回后统一打，§9.3/
//! §12 测试前提）；可重入——同一事件流应用两次视图等价。
//!
//! 判定顺序（§9.2）：epoch 校验 → seq 水位/gap → uncalibratable → chat
//! 终态 → 幂等键 → 终态守卫（interrupted 校准例外，§9.3）→ 关联检查 → 应用
//! （chat 写入 → control 写入，事务顺序固定 chat → control，§6.4/§7.4）。

use yrs::{Array, Map, Transact, WriteTxn};

use peri_studio_proto::schema::{
    ActiveTurnProjection, ChatStatus, EntryKind, EntryRole, TurnStatus,
};

use crate::state::chat_writer::{self, ContentKind};
use crate::state::doc_pair::{DocPair, StreamState};
use crate::state::factory::ROOT;
use crate::state::normalized::{EventBody, EventProvenance, NormalizedEvent};
use crate::state::view_store::TransactionCtx;

pub(crate) use super::aggregator_write_catalog::{chat_status_from_str, chat_status_str};
pub(crate) use super::aggregator_write_catalog::turn_status_from_str;
pub(crate) use super::aggregator_write_helpers::write_session_config_catalog;

/// 幂等聚合器（§6.3）。无跨调用状态：全部状态在 DocPair 内（§4）。
#[derive(Debug, Default, Clone, Copy)]
pub struct Aggregator;

/// 工具结果截断阈值（§9.5【决策】默认 4KB，对齐 §14 开放问题 2 方向）。
pub const TOOL_RESULT_MAX_BYTES: usize = 4096;

/// Per-session privacy-safe activity history. This is intentionally small: the
/// projection is a status surface, not a second event log.
pub const AGENT_ACTIVITY_LIMIT: u32 = 64;

/// 应用结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyResult {
    /// 是否投影成功（false 时为拒绝/幂等跳过）。
    pub applied: bool,
    /// 拒绝原因（applied=false 时；幂等跳过/守卫拒绝）。
    pub reason: Option<ApplyReason>,
}

impl ApplyResult {
    fn applied() -> Self {
        ApplyResult {
            applied: true,
            reason: None,
        }
    }

    fn rejected(reason: ApplyReason) -> Self {
        ApplyResult {
            applied: false,
            reason: Some(reason),
        }
    }
}

/// 拒绝原因（§6.3「拒绝投影并记录脱敏诊断」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyReason {
    /// 幂等键（turn_id/entry_id/tool_call_id/permission_id）已存在，重放跳过。
    DuplicateIdempotent,
    /// A Hub user entry already carries a different browser command identity.
    /// Never overwrite it: this is persisted-correlation corruption, not a
    /// normal duplicate.
    SourceCommandConflict,
    /// A control-plane terminal command targets another turn or contradicts
    /// an already persisted terminal state.
    TerminalProjectionConflict,
    /// 权限已经记录为同一 decision；调用方可用仍存在的 ACP request 回投材料
    /// 恢复一次明确未送达的 response。相反 decision 不得进入此分支。
    PermissionDecisionReplay,
    /// The same elicitation action is already durably selected.
    ElicitationResponseReplay,
    /// The form is unknown to the selected runtime projection.
    UnknownElicitation,
    /// A different response action was already selected for this form.
    ElicitationResponseConflict,
    /// The runtime disconnected or reset before this form was answered.
    ElicitationExpired,
    /// 终态守卫：turn 处于 cancelling/completed/failed/cancelled，晚到增量丢弃
    /// （§6.3）。
    TurnTerminalGuard,
    /// 工具仍等待权限时收到完成帧。消费 seq 但拒绝矛盾的完成证据。
    AwaitingPermissionGuard,
    /// interrupted 状态下：非终态事件丢弃；或终态事件缺重放序依据（§6.3
    /// 例外）。
    InterruptedGuard,
    /// interrupted 校准恰一次：该 turn 已被校准（active_turn 已是实际终态）或
    /// seq 非单调。
    CalibrationDone,
    /// 缺少必要关联信息（关联的 turn/entry/tool_call/permission 未知）。
    UnknownTurn,
    /// tool_call_id 未知。
    UnknownToolCall,
    /// permission_id 未知。
    UnknownPermission,
    /// 防御性：epoch 与当前流不一致（§4.5.1 帧直接丢弃并计数）。
    EpochMismatch,
    /// 防御性：seq 回退（低于 last_seq；补推纪律下不应出现，§8.5）。
    SeqOutOfOrder,
    /// chat 已终态（ended/closed/crashed），拒绝新事件（§8.2）。
    ChatClosed,
    /// 不可校准缺口存在时的补推事件（epoch 变化路径，§8.5）——拒绝除
    /// `session/load` 显式重建（F7 命令路径）外的一切投影。
    UncalibratableGap,
    /// TurnTerminal 携带非终态状态值（§3.2【决策】防御：状态仅限终态四值）。
    InvalidTerminalStatus,
}

/// control doc 只读快照（批次内稳定：delta 不写 control）。
#[derive(Debug, Clone, Default)]
struct ControlSnapshot {
    /// chat.status（ended/closed/crashed → 拒绝新事件，§8.2）。
    chat_closed: bool,
    /// active_turn 投影（终态守卫依据，§6.3）。
    active_turn: Option<ActiveTurnProjection>,
    /// `peri.replay` was explicitly echoed for this runtime. Captured once per
    /// delta batch so the hot path does not reopen the Control Doc per chunk.
    replay_negotiated: bool,
}

impl Aggregator {
    /// Consume transport ordering evidence for a frame that intentionally has
    /// no document projection, such as a JSON-RPC response. This shares the
    /// exact epoch/sequence judge with projected events so a received response
    /// cannot be mistaken for a dropped frame.
    pub fn observe_stream_frame(
        &mut self,
        pair: &mut DocPair,
        epoch: u64,
        seq: u64,
    ) -> ApplyResult {
        match self.judge_stream(&mut pair.stream, epoch, seq) {
            Ok(()) => ApplyResult::applied(),
            Err(reason) => ApplyResult::rejected(reason),
        }
    }

    /// 应用单个事件（纯函数）。自管理事务：chat 一次、control 一次，顺序固定
    /// chat → control（§6.4/§7.4）；不涉及某 doc 时跳过该事务。
    pub fn apply(&mut self, pair: &mut DocPair, ev: &NormalizedEvent) -> ApplyResult {
        // 判定（只读，含 stream 状态推进）。
        if let Err(reason) = self.judge(pair, ev) {
            return ApplyResult::rejected(reason);
        }
        // 应用：chat → control。
        self.write(pair, ev);
        ApplyResult::applied()
    }

    /// 微批次入口（§6.4/§8.3）：delta 类事件共享一次 chat 事务；非 delta
    /// 事件（防御）回落单事件路径。返回逐事件结果。
    pub fn apply_batch(&mut self, pair: &mut DocPair, evs: &[NormalizedEvent]) -> Vec<ApplyResult> {
        let mut results = Vec::with_capacity(evs.len());
        let mut i = 0;
        while i < evs.len() {
            let is_delta = matches!(
                evs[i].body,
                EventBody::MessageDelta { .. } | EventBody::ReasoningDelta { .. }
            );
            if !is_delta {
                // 防御：非 delta 事件不进批次（控制类应先 flush）；独立事务。
                results.push(self.apply(pair, &evs[i]));
                i += 1;
                continue;
            }
            // 连续 delta 段：共享一次 chat 事务（§6.4/§8.3 微批次合并）。
            let mut end = i;
            while end < evs.len()
                && matches!(
                    evs[end].body,
                    EventBody::MessageDelta { .. } | EventBody::ReasoningDelta { .. }
                )
            {
                end += 1;
            }
            // 字段级拆分借用：chat 写事务与 control 只读快照并存（不同 doc，
            // 无并发事务冲突，§7.4）。
            let chat = &mut pair.chat;
            let control = &pair.session;
            let mut txn = chat.transact_mut();
            let snapshot = self.read_control_snapshot(control);
            let mut applied_in_segment = false;
            for ev in &evs[i..end] {
                let r = self.apply_delta_in_txn(&mut pair.stream, &mut txn, ev, &snapshot);
                if r.applied {
                    applied_in_segment = true;
                }
                results.push(r);
            }
            // txn drop = 段批次单事务提交。
            drop(txn);
            // §7.2 状态推进：内容增量到达 → accepting → running（参考实现：
            // 首条内容增量即 turn 开始运行）。段内任一增量应用成功即推进；
            // 回放模式跳过（回放 turn 由 EndLoadReplay 终态化）。共享一次
            // session 事务。
            if applied_in_segment && !pair.stream.replay_active {
                let mut txn = pair.session_txn();
                let root = txn.get_or_insert_map(ROOT);
                if chat_writer::set_active_turn_status_if(&mut txn, &root, "accepting", "running") {
                    chat_writer::bump_projection_version(&mut txn, &root);
                }
            }
            i = end;
        }
        results
    }

    fn read_control_snapshot(&self, session: &yrs::Doc) -> ControlSnapshot {
        let txn = session.transact();
        let mut snap = ControlSnapshot::default();
        let Some(root) = chat_writer::root_map_read(&txn) else {
            return snap;
        };
        // session map：status（chat 终态）与 active turn 内嵌字段。
        let sm = root
            .get(&txn, "session")
            .and_then(|v| v.cast::<yrs::MapRef>().ok());
        snap.replay_negotiated = root
            .get(&txn, "agent")
            .and_then(|value| value.cast::<yrs::MapRef>().ok())
            .and_then(|agent| agent.get(&txn, "extensions"))
            .and_then(|value| value.cast::<yrs::ArrayRef>().ok())
            .is_some_and(|extensions| {
                extensions.iter(&txn).any(|value| {
                    matches!(
                        value,
                        yrs::Out::Any(yrs::Any::String(extension))
                            if extension.as_ref() == "peri.replay"
                    )
                })
            });
        // status。
        snap.chat_closed = sm
            .as_ref()
            .and_then(|m| m.get(&txn, "status"))
            .and_then(|s| s.cast::<String>().ok())
            .map(|s| {
                chat_status_from_str(&s)
                    .map(|st| {
                        matches!(
                            st,
                            ChatStatus::Ended | ChatStatus::Closed | ChatStatus::Crashed
                        )
                    })
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        // active_turn（session map 内嵌：active_turn_id/status/updated_at）。
        snap.active_turn = sm.as_ref().and_then(|m| {
            let str_or = |k: &str| -> Option<String> {
                m.get(&txn, k).and_then(|v| v.cast::<String>().ok())
            };
            Some(ActiveTurnProjection {
                turn_id: str_or("active_turn_id")?,
                turn_status: str_or("active_turn_status")
                    .as_deref()
                    .map(turn_status_from_str)
                    .unwrap_or(TurnStatus::Accepting),
                updated_at: str_or("active_turn_updated_at").unwrap_or_default(),
            })
        });
        snap
    }

    /// delta 事件在共享 chat 事务内判定 + 写入（批次路径）。
    fn apply_delta_in_txn(
        &self,
        stream: &mut StreamState,
        txn: &mut TransactionCtx<'_>,
        ev: &NormalizedEvent,
        snapshot: &ControlSnapshot,
    ) -> ApplyResult {
        // 判定：epoch/seq/gap（步骤 1/2/3）。
        if let Err(reason) = self.judge_stream(stream, ev.epoch, ev.seq) {
            return ApplyResult::rejected(reason);
        }
        // 判定：chat 终态（步骤 4）。
        if snapshot.chat_closed {
            return ApplyResult::rejected(ApplyReason::ChatClosed);
        }
        // 判定：终态守卫（步骤 5）+ 关联检查（步骤 6，delta 自动建 entry）。
        // 回放模式（§8.5）无宿主驱动 active_turn——守卫跳过（归位由
        // resolve 按回放 turn 处理）。
        if !stream.replay_active {
            if let Err(reason) = self.judge_turn_guard(snapshot.active_turn.as_ref(), &ev.body) {
                return ApplyResult::rejected(reason);
            }
        }
        // 写入（chat doc，共享事务内）。
        let root = txn.get_or_insert_map(ROOT);
        // 回放合成（§8.5 REPLAY_NEEDS_TURN）：历史首帧即为 agent 增量且无
        // 活动回放 turn → 先合成空文本 user 占位 turn（参考实现规则；避免
        // 空 id 垃圾条目）。合成后归位到该 turn。
        if stream.replay_active && stream.replay_turn.is_none() {
            let t = format!("load:{}", ev.seq);
            stream.replay_turn = Some(t.clone());
            stream.replay_turns.push(t.clone());
            chat_writer::create_user_entry(
                txn,
                &root,
                &t,
                &format!("{t}:user"),
                "",
                None,
                None,
                &ev.ts,
            );
            chat_writer::record_entry_origin(txn, &root, &format!("{t}:user"), true, false);
            chat_writer::bump_projection_version(txn, &root);
        }
        match &ev.body {
            EventBody::MessageDelta {
                turn_id,
                entry_id,
                block_id,
                text,
            } => {
                let (turn_id, entry_id, block_id) = self.resolve_entry_ids_from_snapshot(
                    stream, snapshot, turn_id, entry_id, block_id, "text",
                );
                chat_writer::ensure_entry_with_blocks(
                    txn,
                    &root,
                    &entry_id,
                    EntryKind::Message,
                    EntryRole::Assistant,
                    Some(&turn_id),
                    &ev.ts,
                );
                chat_writer::append_text_delta(
                    txn,
                    &root,
                    &entry_id,
                    &block_id,
                    text,
                    ContentKind::Text,
                );
                chat_writer::record_entry_origin(
                    txn,
                    &root,
                    &entry_id,
                    stream.replay_active,
                    stream.replay_active
                        && snapshot.replay_negotiated
                        && ev.provenance == EventProvenance::PeriReplay,
                );
                chat_writer::bump_projection_version(txn, &root);
            }
            EventBody::ReasoningDelta {
                turn_id,
                entry_id,
                block_id,
                text,
                visibility,
            } => {
                let (turn_id, entry_id, block_id) = self.resolve_entry_ids_from_snapshot(
                    stream,
                    snapshot,
                    turn_id,
                    entry_id,
                    block_id,
                    "reasoning",
                );
                chat_writer::ensure_entry_with_blocks(
                    txn,
                    &root,
                    &entry_id,
                    EntryKind::Message,
                    EntryRole::Assistant,
                    Some(&turn_id),
                    &ev.ts,
                );
                chat_writer::append_text_delta(
                    txn,
                    &root,
                    &entry_id,
                    &block_id,
                    text,
                    ContentKind::Reasoning,
                );
                chat_writer::set_reasoning_visibility(txn, &root, &entry_id, &block_id, *visibility);
                chat_writer::record_entry_origin(
                    txn,
                    &root,
                    &entry_id,
                    stream.replay_active,
                    stream.replay_active
                        && snapshot.replay_negotiated
                        && ev.provenance == EventProvenance::PeriReplay,
                );
                chat_writer::bump_projection_version(txn, &root);
            }
            _ => unreachable!("batch 只含 delta（防御已过滤）"),
        }
        ApplyResult::applied()
    }

    /// 批次快照路径的增量归位（同 [`Self::resolve_entry_ids`]，从批次快照的
    /// active_turn 读取，避免重读 control doc）。回放模式（§8.5）优先归位
    /// 到回放 turn。
    fn resolve_entry_ids_from_snapshot(
        &self,
        stream: &mut StreamState,
        snapshot: &ControlSnapshot,
        turn_id: &str,
        entry_id: &str,
        block_id: &str,
        block_kind: &str,
    ) -> (String, String, String) {
        if !turn_id.is_empty() {
            return (
                turn_id.to_string(),
                entry_id.to_string(),
                block_id.to_string(),
            );
        }
        let resolved_turn = stream
            .replay_turn
            .clone()
            .or_else(|| {
                snapshot
                    .active_turn
                    .as_ref()
                    .map(|active| active.turn_id.clone())
            })
            .unwrap_or_default();
        let entry_id = Self::projection_segment_entry(stream, &resolved_turn, "agent");
        (resolved_turn, entry_id, block_kind.to_string())
    }
}
