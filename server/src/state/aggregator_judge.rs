//! 聚合器判定族（`aggregator.rs` 拆分，§9.2 判定顺序）。
//!
//! 职责边界：只读 doc + 推进 `pair.stream` 的**拒绝判定**（[`judge`] 及其
//! 子判定：stream 水位/epoch、终态守卫、幂等键、关联检查），返回
//! [`ApplyReason`]。判定不写入任何 doc。
//!
//! 拆分动机（结构拆分，行为不变）：原 `aggregator.rs` 2201 行超限，按主题
//! 一分为六——类型/apply 入口（`aggregator.rs`）、判定族（本文件）、写入
//! （`aggregator_write.rs` + `aggregator_write_control.rs`）、写辅助
//! （`aggregator_write_helpers.rs` / `aggregator_write_catalog.rs`）。

use yrs::{Map, ReadTxn, Transact};

use peri_studio_proto::schema::{ActiveTurnProjection, ChatStatus, ToolCallStatus, TurnStatus};

use crate::state::chat_writer;
use crate::state::doc_pair::{DocPair, StreamState};
use crate::state::normalized::{EventBody, NormalizedEvent};

use super::aggregator::{Aggregator, ApplyReason};
use super::aggregator_write_catalog::{chat_status_from_str, turn_status_from_str};

impl Aggregator {
    /// 判定（§9.2 顺序）。只读 doc + 推进 pair.stream；返回拒绝原因。
    pub(crate) fn judge(
        &self,
        pair: &mut DocPair,
        ev: &NormalizedEvent,
    ) -> Result<(), ApplyReason> {
        // 1/2/3. epoch/seq/gap/uncalibratable。
        self.judge_stream(&mut pair.stream, ev.epoch, ev.seq)?;
        // 4. chat 终态（§8.2）：读 session doc session map status。
        {
            let txn = pair.session.transact();
            if let Some(root) = chat_writer::root_map_read(&txn) {
                let status = root
                    .get(&txn, "session")
                    .and_then(|v| v.cast::<yrs::MapRef>().ok())
                    .and_then(|m| m.get(&txn, "status"))
                    .and_then(|s| s.cast::<String>().ok());
                if let Some(s) = status {
                    if let Some(st) = chat_status_from_str(&s) {
                        if matches!(
                            st,
                            ChatStatus::Ended | ChatStatus::Closed | ChatStatus::Crashed
                        ) {
                            return Err(ApplyReason::ChatClosed);
                        }
                    }
                }
            }
        }
        // 5. 终态守卫（§6.3/§7.2/§9.3）：读 control doc active_turn。
        let active = self.read_active_turn(pair);
        // 6. 幂等键（§6.3）与关联检查（按事件体分派）。
        self.judge_body(pair, ev, active.as_ref())?;
        Ok(())
    }

    /// 判定步骤 1/2/3：epoch 校验、seq 水位 + gap、uncalibratable（§9.2）。
    pub(crate) fn judge_stream(
        &self,
        stream: &mut StreamState,
        epoch: u64,
        seq: u64,
    ) -> Result<(), ApplyReason> {
        // 1. epoch 校验（§4.5.1 防御；正常路径 hello 已对账）。
        if epoch != stream.epoch {
            if epoch > stream.epoch {
                // 新 chat 首事件（instance 新开 chat epoch=1，§4.5.1）
                // 为**基线采纳**：流尚无任何事件（last_seq=0 且无既有 gap），
                // 不存在缓冲丢失可能，采纳 epoch 后正常应用本帧，不置不可
                // 校准缺口（hello 对账对新建 chat 的落点；修复
                // relay_event_handler_test 已知缺口注释记录的「epoch=1 首
                // 事件触发 uncalibratable 缺口」）。
                let fresh_baseline =
                    stream.last_seq == 0 && stream.gap_count == 0 && !stream.gap_dirty;
                stream.epoch = epoch;
                if !fresh_baseline {
                    // 既有流上的合法新纪元（daemon 重启/进程重建，§8.5）：
                    // 置不可校准缺口并拒绝本帧（补推契约失效）。
                    stream.uncalibratable = true;
                    stream.gap_dirty = true;
                    return Err(ApplyReason::EpochMismatch);
                }
            } else {
                return Err(ApplyReason::EpochMismatch);
            }
        }
        // 2. seq 水位 + gap 计算（§8.5/§9.4）。
        if seq <= stream.last_seq {
            return Err(ApplyReason::SeqOutOfOrder);
        }
        let expected = stream.last_seq + 1;
        if seq > expected {
            stream.gap_count += seq - expected;
            stream.gap_dirty = true;
        } else if stream.gap_count > 0 {
            // 追平：无缺口且此前有 gap → 清零（§9.4）。
            stream.gap_count = 0;
            stream.gap_dirty = true;
        }
        stream.last_seq = seq;
        // 3. 不可校准缺口：拒绝一切投影（重建经 F7 命令路径）。
        if stream.uncalibratable {
            return Err(ApplyReason::UncalibratableGap);
        }
        Ok(())
    }

    pub(crate) fn read_active_turn(&self, pair: &DocPair) -> Option<ActiveTurnProjection> {
        let txn = pair.session.transact();
        let root = chat_writer::root_map_read(&txn)?;
        let sm = root.get(&txn, "session")?.cast::<yrs::MapRef>().ok()?;
        let str_or =
            |k: &str| -> Option<String> { sm.get(&txn, k).and_then(|v| v.cast::<String>().ok()) };
        Some(ActiveTurnProjection {
            turn_id: str_or("active_turn_id")?,
            turn_status: str_or("active_turn_status")
                .as_deref()
                .map(turn_status_from_str)
                .unwrap_or(TurnStatus::Accepting),
            updated_at: str_or("active_turn_updated_at").unwrap_or_default(),
        })
    }

    /// 增量帧 id 归位（§7.2 宿主驱动 turn 模型）：帧携带 turn_id（peri-studio
    /// 私有帧/test-child）原样使用；帧无 id（真实 peri agent_message_chunk /
    /// agent_thought_chunk，无 turnId/entryId/blockId）按 active_turn 与当前展示段
    /// 归位。展示段由写路径按 `agent ↔ tools` 类型切换推进。
    pub(crate) fn resolve_entry_ids(
        &self,
        pair: &mut DocPair,
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
        let resolved_turn = pair
            .stream
            .replay_turn
            .clone()
            .or_else(|| self.read_active_turn(pair).map(|active| active.turn_id))
            .unwrap_or_default();
        let entry_id = Self::projection_segment_entry(&mut pair.stream, &resolved_turn, "agent");
        (resolved_turn, entry_id, block_kind.to_string())
    }

    pub(crate) fn projection_segment_entry(
        stream: &mut StreamState,
        turn_id: &str,
        segment_kind: &str,
    ) -> String {
        if stream.projection_segment_turn.as_deref() != Some(turn_id) {
            stream.projection_segment_turn = Some(turn_id.to_string());
            stream.projection_segment_kind = None;
            stream.projection_segment_index = 0;
        }
        if stream.projection_segment_kind.as_deref() != Some(segment_kind) {
            stream.projection_segment_kind = Some(segment_kind.to_string());
            stream.projection_segment_index += 1;
        }
        if stream.projection_segment_index <= 1 {
            format!("{turn_id}:assistant")
        } else {
            format!("{turn_id}:assistant:{}", stream.projection_segment_index)
        }
    }

    /// 幂等键 + 关联检查 + 终态守卫（步骤 5/6 合并：守卫依赖 active_turn）。
    fn judge_body(
        &self,
        pair: &mut DocPair,
        ev: &NormalizedEvent,
        active: Option<&ActiveTurnProjection>,
    ) -> Result<(), ApplyReason> {
        if ev.subagent_scoped() {
            if matches!(
                ev.body,
                EventBody::MessageDelta { .. }
                    | EventBody::ReasoningDelta { .. }
                    | EventBody::UserMessage { .. }
                    | EventBody::ToolCallStarted { .. }
                    | EventBody::ToolCallUpdated { .. }
                    | EventBody::ToolCallCompleted { .. }
                    | EventBody::ToolCallPatched { .. }
                    | EventBody::PermissionRequested { .. }
                    | EventBody::PermissionResolved { .. }
                    | EventBody::PermissionExpired { .. }
                    | EventBody::AgentUsage { .. }
            ) {
                return Ok(());
            }
        }
        match &ev.body {
            EventBody::MessageDelta { entry_id, .. }
            | EventBody::ReasoningDelta { entry_id, .. } => {
                if !pair.stream.replay_active {
                    self.judge_turn_guard(active, &ev.body)?;
                }
                // 关联：entry 未知自动建（§7 注释），不拒绝。
                let _ = entry_id;
                Ok(())
            }
            EventBody::UserMessage {
                turn_id, entry_id, ..
            } => {
                // `session/load` 回放（§8.5）：历史 user 消息同样无 turn_id，
                // 但回放是**显式重建**——聚合器按回放序生成 turn 归位
                // （`load:{seq}`，seq 水位单调 → 天然幂等，见 write 分支），
                // 不拒绝。
                if pair.stream.replay_active {
                    return Ok(());
                }
                // 用户消息只由服务端单写注入（§6.5 RegisterUserEntry /
                // RegisterPendingPromptEntry，携带 server 生成 turn_id）。
                // ACP 回显一律拒绝：真实 peri 不回声 user_message_chunk，
                // 且 v2 通道强制（chat_channel 对无 prompt-delivery-v2 的
                // 客户端直接断连），回声携带 agent 自造 turn_id/entry_id
                // 时幂等键与注入 entry 不匹配，会双写同文本 user entry
                // （前端"输入 hello 显示 hello hello"）。回放已在上面放行。
                let _ = (turn_id, entry_id);
                Err(ApplyReason::UnknownTurn)
            }
            EventBody::ToolCallStarted { tool_call_id, .. } => {
                if tool_call_id.is_empty() {
                    return Err(ApplyReason::UnknownToolCall);
                }
                // 普通重复 start 幂等跳过。唯一例外是 permission-first：官方
                // request 已用同 id 合成 awaitingPermission 工具，稍后正式
                // tool_call 可补全 name/arguments，但不得回退状态或覆盖终态。
                let txn = pair.chat.transact();
                if let Some(existing) = chat_writer::tool_call_projection(&txn, tool_call_id) {
                    if existing.permission_id.is_none()
                        || existing.status != ToolCallStatus::AwaitingPermission
                    {
                        return Err(ApplyReason::DuplicateIdempotent);
                    }
                }
                if !pair.stream.replay_active {
                    self.judge_turn_guard(active, &ev.body)?;
                }
                Ok(())
            }
            EventBody::ToolCallUpdated { tool_call_id, .. } => {
                if tool_call_id.is_empty() {
                    return Err(ApplyReason::UnknownToolCall);
                }
                if !pair.stream.replay_active {
                    self.judge_turn_guard(active, &ev.body)?;
                }
                let txn = pair.chat.transact();
                match chat_writer::tool_call_projection(&txn, tool_call_id) {
                    None => return Err(ApplyReason::UnknownToolCall),
                    Some(existing)
                        if matches!(
                            existing.status,
                            ToolCallStatus::Completed
                                | ToolCallStatus::Error
                                | ToolCallStatus::Cancelled
                        ) =>
                    {
                        return Err(ApplyReason::DuplicateIdempotent);
                    }
                    Some(_) => {}
                }
                Ok(())
            }
            EventBody::ToolCallCompleted { tool_call_id, .. } => {
                if tool_call_id.is_empty() {
                    return Err(ApplyReason::UnknownToolCall);
                }
                if !pair.stream.replay_active {
                    self.judge_turn_guard(active, &ev.body)?;
                }
                let txn = pair.chat.transact();
                match chat_writer::tool_call_projection(&txn, tool_call_id) {
                    None => return Err(ApplyReason::UnknownToolCall),
                    Some(existing)
                        if matches!(
                            existing.status,
                            ToolCallStatus::Completed
                                | ToolCallStatus::Error
                                | ToolCallStatus::Cancelled
                        ) =>
                    {
                        return Err(ApplyReason::DuplicateIdempotent);
                    }
                    Some(existing) if existing.status == ToolCallStatus::AwaitingPermission => {
                        return Err(ApplyReason::AwaitingPermissionGuard);
                    }
                    Some(_) => {}
                }
                Ok(())
            }
            EventBody::ToolCallPatched {
                turn_id,
                tool_call_id,
                patch,
            } => self.judge_tool_patch(pair, active, turn_id, tool_call_id, patch),
            EventBody::PermissionRequested { permission_id, .. } => {
                // 幂等：permission_id 已存在 → 跳过。
                let txn = pair.session.transact();
                if self.permission_exists(&txn, permission_id) {
                    return Err(ApplyReason::DuplicateIdempotent);
                }
                self.judge_turn_guard(active, &ev.body)
            }
            EventBody::PermissionResolved { permission_id, .. } => {
                let txn = pair.session.transact();
                if !self.permission_exists(&txn, permission_id) {
                    return Err(ApplyReason::UnknownPermission);
                }
                Ok(())
            }
            EventBody::PermissionExpired { permission_id } => {
                let txn = pair.session.transact();
                if !self.permission_exists(&txn, permission_id) {
                    return Err(ApplyReason::UnknownPermission);
                }
                Ok(())
            }
            EventBody::AgentStatus { .. }
            | EventBody::AgentConfig { .. }
            | EventBody::AgentUsage { .. }
            | EventBody::AgentActivity { .. }
            | EventBody::PeriTaskStarted { .. }
            | EventBody::PeriTaskCompleted { .. }
            | EventBody::PeriTaskCancelled { .. }
            | EventBody::InputPrediction { .. }
            | EventBody::AgentPlan { .. }
            | EventBody::Capabilities { .. }
            | EventBody::SessionInfo { .. }
            | EventBody::SessionListResponse { .. } => Ok(()),
            EventBody::TurnTerminal {
                turn_id, status, ..
            } => {
                // 防御：仅终态四值（§3.2【决策】）。
                if !matches!(
                    status,
                    TurnStatus::Completed
                        | TurnStatus::Failed
                        | TurnStatus::Cancelled
                        | TurnStatus::Interrupted
                ) {
                    return Err(ApplyReason::InvalidTerminalStatus);
                }
                // 终态守卫：active_turn 决定应用/拒绝。
                match active {
                    None => Err(ApplyReason::UnknownTurn),
                    Some(a) if a.turn_id != *turn_id => Err(ApplyReason::TurnTerminalGuard),
                    Some(a) => match a.turn_status {
                        // 不可逆终态：终态事件二次到达 → 校准完成（§7.2）。
                        TurnStatus::Completed | TurnStatus::Failed | TurnStatus::Cancelled => {
                            Err(ApplyReason::CalibrationDone)
                        }
                        // cancelling：终态事件应用（状态机迁移，§7.2）；非终态
                        // 事件由 judge_turn_guard 拒绝。
                        TurnStatus::Cancelling => Ok(()),
                        // interrupted：校准例外（§6.3/§9.3 双条件：状态位 +
                        // 重放序单调；单调已由步骤 2 保证）。
                        TurnStatus::Interrupted => Ok(()),
                        _ => Ok(()),
                    },
                }
            }
        }
    }

    /// 终态守卫（§6.3）：active_turn 非活动（cancelling/不可逆终态/interrupted）
    /// 时拒绝带 turn_id 的非终态事件；interrupted 时拒绝一切非终态事件。
    /// 供批次快照路径（不重读 control doc）。
    pub(super) fn judge_turn_guard(
        &self,
        active: Option<&ActiveTurnProjection>,
        body: &EventBody,
    ) -> Result<(), ApplyReason> {
        let turn_id = match body {
            EventBody::MessageDelta { turn_id, .. }
            | EventBody::ReasoningDelta { turn_id, .. }
            | EventBody::ToolCallStarted { turn_id, .. }
            | EventBody::ToolCallUpdated { turn_id, .. }
            | EventBody::ToolCallCompleted { turn_id, .. }
            | EventBody::ToolCallPatched { turn_id, .. }
            | EventBody::PermissionRequested { turn_id, .. } => Some(turn_id.as_str()),
            _ => None,
        };
        match (active, turn_id) {
            // 事件不带 turn（AgentStatus/Capabilities/SessionInfo/...）：无守卫。
            (_, None) => Ok(()),
            // 帧无 turn_id（真实 peri 增量，§7.2 宿主驱动 turn 模型；照抄
            // @fenix/chat-channel canWriteToTurn）：按 active_turn 归位校验——
            // 无活动 turn → 未知 turn；活动 turn 终态/cancelling → 拒绝。
            (None, Some("")) => Err(ApplyReason::UnknownTurn),
            (Some(a), Some("")) => match a.turn_status {
                TurnStatus::Cancelling
                | TurnStatus::Completed
                | TurnStatus::Failed
                | TurnStatus::Cancelled => Err(ApplyReason::TurnTerminalGuard),
                TurnStatus::Interrupted => Err(ApplyReason::InterruptedGuard),
                _ => Ok(()),
            },
            // 带 turn 但无 active_turn：turn 未知（§9.2 步骤 6）。
            (None, Some(_)) => Err(ApplyReason::UnknownTurn),
            (Some(a), Some(tid)) if a.turn_id != tid => Err(ApplyReason::TurnTerminalGuard),
            (Some(a), Some(_)) => match a.turn_status {
                TurnStatus::Cancelling
                | TurnStatus::Completed
                | TurnStatus::Failed
                | TurnStatus::Cancelled => Err(ApplyReason::TurnTerminalGuard),
                TurnStatus::Interrupted => Err(ApplyReason::InterruptedGuard),
                _ => Ok(()),
            },
        }
    }

    fn permission_exists<T: ReadTxn>(&self, txn: &T, permission_id: &str) -> bool {
        chat_writer::root_map_read(txn)
            .and_then(|root| root.get(txn, "pending_permissions"))
            .and_then(|v| v.cast::<yrs::MapRef>().ok())
            .map(|perms| perms.get(txn, permission_id).is_some())
            .unwrap_or(false)
    }

    pub(crate) fn permission_context<T: ReadTxn>(
        &self,
        txn: &T,
        permission_id: &str,
    ) -> Option<(String, Option<String>)> {
        let root = chat_writer::root_map_read(txn)?;
        let permissions = root
            .get(txn, "pending_permissions")?
            .cast::<yrs::MapRef>()
            .ok()?;
        let permission = permissions
            .get(txn, permission_id)?
            .cast::<yrs::MapRef>()
            .ok()?;
        let status = permission
            .get(txn, "status")
            .and_then(|value| value.cast::<String>().ok())
            .unwrap_or_default();
        let tool_call_id = permission
            .get(txn, "tool_call_id")
            .and_then(|value| value.cast::<String>().ok());
        Some((status, tool_call_id))
    }
}
