//! outbox restart 对账族（§5.3）：server 重启后收敛全部未终态命令。
//!
//! 重启即空的内存 outbox 在 gateway 接受客户端前必须被收敛：进程内
//! executor 与恢复证据已消失，`intent_durable`/`dispatched` 等中间态不再
//! 有所有者。收敛策略按命令固有幂等性分类（§5.2）：
//!
//! - **可安全重发**（close）：直接 tombstone（kill 对 chat 幂等，重放权威）；
//! - **证明未投递**（pre-barrier）：tombstone 允许以同 commandId 重发；
//! - **歧义**（post-barrier）：`delivery_unknown`，仅可经运维裁决；
//! - **投影已确认**（projection_committed）：可完成（§5.3 终态）。
//!
//! 本文件是 [`OutboxStore`](super::OutboxStore) 的实现段（结构拆分，行为
//! 语义不变）；permission/elicitation 与 create/cancel 各合并为一个带
//! `CommandType` 参数的泛化收敛函数（§7 复用稳定语义）。

use std::collections::HashSet;

use tracing::info;

use peri_studio_proto::ack::ErrorCode;

use super::*;

impl OutboxStore {
    /// server 重启时收敛带恢复证据的未终态命令。进程内
    /// `intent_durable` 原本可在同一 runtime 恢复，但重启后 ChatRegistry /
    /// binding 均需重建，不得默认原 ACP request 仍可投递。`dispatched`
    /// 更无法确认副作用是否已发生。两者统一进入持久化
    /// `delivery_unknown`，仅可经运维裁决。
    pub fn reconcile_recovery_after_restart(&mut self) -> Result<usize, StoreError> {
        let ids = self
            .index
            .values()
            .filter(|record| {
                record.recovery.is_some()
                    && matches!(
                        record.status,
                        OutboxStatus::IntentDurable | OutboxStatus::Dispatched
                    )
            })
            .map(|record| record.command_id)
            .collect::<Vec<_>>();
        for id in &ids {
            self.transition(*id, OutboxStatus::DeliveryUnknown, |_| {})?;
        }
        Ok(ids.len())
    }

    /// Converge non-prompt commands that crossed the additive dispatch
    /// barrier but have no recoverable terminal result. Prompt records are
    /// reconciled separately against exact projection evidence.
    pub fn reconcile_no_redelivery_barriers_after_restart(&mut self) -> Result<usize, StoreError> {
        let ids = self
            .index
            .values()
            .filter(|record| {
                !matches!(
                    record.command_type,
                    CommandType::Prompt | CommandType::Create
                )
            })
            .filter(|record| record.status == OutboxStatus::IntentDurable)
            .filter(|record| record.dispatch_barrier_at.is_some())
            .map(|record| record.command_id)
            .collect::<Vec<_>>();
        for id in &ids {
            self.mark_delivery_unknown(*id)?;
        }
        Ok(ids.len())
    }

    /// 泛化「可安全重发」对账（create/cancel 同构，§7 复用）：证明未投递
    /// → tombstone（允许以同 commandId 重发）；歧义 → `delivery_unknown`；
    /// 投影已确认 → 完成。终态记录跳过。
    ///
    /// create 语境（§4.5）：进程内 executor 与清理证据已消失，只有证明
    /// 从未越过 spawn barrier 的记录可退役重发；post-barrier 记录保守地
    /// 置未知；projection_committed 可完成（binding 投影已持久确认）。
    /// cancel 语境：被取消 turn 的投影证据已落盘时可完成。
    fn converge_safe_retry_after_restart(
        &mut self,
        command_type: CommandType,
    ) -> Result<usize, StoreError> {
        enum Decision {
            Replay,
            Unknown,
            Complete,
        }
        let decisions = self
            .index
            .values()
            .filter(|record| record.command_type == command_type)
            .filter_map(|record| {
                let decision = match record.status {
                    OutboxStatus::Received | OutboxStatus::Accepted => Decision::Replay,
                    OutboxStatus::IntentDurable if record.dispatch_barrier_at.is_none() => {
                        Decision::Replay
                    }
                    OutboxStatus::IntentDurable
                    | OutboxStatus::Dispatched
                    | OutboxStatus::DeliveryConfirmed => Decision::Unknown,
                    OutboxStatus::ProjectionCommitted => Decision::Complete,
                    OutboxStatus::Completed
                    | OutboxStatus::Failed
                    | OutboxStatus::DeliveryUnknown => return None,
                };
                Some((record.command_id, decision))
            })
            .collect::<Vec<_>>();
        for (id, decision) in &decisions {
            match decision {
                Decision::Replay => self.tombstone(*id)?,
                Decision::Unknown => self.mark_delivery_unknown(*id)?,
                Decision::Complete => self.mark_completed(*id)?,
            }
        }
        Ok(decisions.len())
    }

    /// 收敛全部 create 命令（gateway 接受客户端前）。
    pub fn reconcile_create_after_restart(&mut self) -> Result<usize, StoreError> {
        self.converge_safe_retry_after_restart(CommandType::Create)
    }

    /// 收敛全部 cancel 记录（进程内 executor 丢失后）。
    ///
    /// Pre-barrier records are proven not delivered and may be replayed with
    /// the same command id. Post-ack records without a durable terminal
    /// projection are ambiguous; a projection-committed record can finish
    /// because the cancelled turn evidence is already durable.
    pub fn reconcile_cancel_after_restart(&mut self) -> Result<usize, StoreError> {
        self.converge_safe_retry_after_restart(CommandType::Cancel)
    }

    /// Retire every Close record whose executor was lost across restart.
    ///
    /// `instance/kill` is idempotent for one chat: an absent/already-exited
    /// child acknowledges success. Replay is therefore authoritative even if
    /// the old process crossed L1/L2 or projected part of the close. Keeping
    /// these records would attach observers to an executor that no longer
    /// exists; keeping `delivery_unknown` would conflict with reinsertion.
    pub fn reconcile_close_after_restart(&mut self) -> Result<usize, StoreError> {
        let ids = self
            .index
            .values()
            .filter(|record| {
                record.command_type == CommandType::Close
                    && matches!(
                        record.status,
                        OutboxStatus::Received
                            | OutboxStatus::Accepted
                            | OutboxStatus::IntentDurable
                            | OutboxStatus::Dispatched
                            | OutboxStatus::DeliveryConfirmed
                            | OutboxStatus::ProjectionCommitted
                            | OutboxStatus::DeliveryUnknown
                    )
            })
            .map(|record| record.command_id)
            .collect::<Vec<_>>();
        for id in &ids {
            self.tombstone(*id)?;
        }
        Ok(ids.len())
    }

    /// 泛化一次性请求对账（permission/elicitation 同构，§7 复用）：
    /// Received/Accepted 与 pre-barrier intent 证明未投递 → `failed`；
    /// post-barrier 歧义 → `delivery_unknown`；确认投递/投影完成 →
    /// `completed`。终态记录跳过。
    ///
    /// 语义（两命令共享）：官方 request_permission / elicitation 响应都是
    /// 一次性请求；响应 CAS 先于投递，因此投递确认后可直接完成。
    fn converge_one_shot_after_restart(
        &mut self,
        command_type: CommandType,
    ) -> Result<usize, StoreError> {
        let decisions = self
            .index
            .values()
            .filter(|record| record.command_type == command_type)
            .filter_map(|record| {
                let target = match record.status {
                    OutboxStatus::Received | OutboxStatus::Accepted => OutboxStatus::Failed,
                    OutboxStatus::IntentDurable if record.dispatch_barrier_at.is_none() => {
                        OutboxStatus::Failed
                    }
                    OutboxStatus::IntentDurable | OutboxStatus::Dispatched => {
                        OutboxStatus::DeliveryUnknown
                    }
                    OutboxStatus::DeliveryConfirmed | OutboxStatus::ProjectionCommitted => {
                        OutboxStatus::Completed
                    }
                    OutboxStatus::Completed
                    | OutboxStatus::Failed
                    | OutboxStatus::DeliveryUnknown => return None,
                };
                Some((record.command_id, target))
            })
            .collect::<Vec<_>>();
        for (id, target) in &decisions {
            match target {
                OutboxStatus::Failed => {
                    let mut error = LastError::from_error_code(ErrorCode::AgentUnavailable);
                    error.retryable = false;
                    self.mark_failed(*id, error)?;
                }
                OutboxStatus::DeliveryUnknown => self.mark_delivery_unknown(*id)?,
                OutboxStatus::Completed => {
                    if self
                        .get(*id)
                        .is_some_and(|record| record.status == OutboxStatus::DeliveryConfirmed)
                    {
                        if self
                            .get(*id)
                            .is_some_and(|record| record.recovery.is_some())
                        {
                            self.clear_recovery(*id)?;
                        }
                        self.mark_projection_committed(*id)?;
                    }
                    self.mark_completed(*id)?;
                }
                _ => unreachable!("one-shot restart reconciliation only writes terminal decisions"),
            }
        }
        Ok(decisions.len())
    }

    /// Converge every nonterminal permission command before executors and
    /// process-local request material are available. Confirmed delivery can be
    /// completed because the permission CAS precedes dispatch; ambiguous
    /// post-barrier states fail closed, and pre-barrier states are known not to
    /// have reached ACP.
    pub fn reconcile_permission_after_restart(&mut self) -> Result<usize, StoreError> {
        self.converge_one_shot_after_restart(CommandType::Resolve)
    }

    /// Form responses follow the same one-shot request semantics as official
    /// permission responses. Before the barrier they are definitely absent;
    /// after it they require operator reconciliation; writer-confirmed
    /// delivery may complete because the response projection CAS preceded it.
    pub fn reconcile_elicitation_after_restart(&mut self) -> Result<usize, StoreError> {
        self.converge_one_shot_after_restart(CommandType::ElicitationRespond)
    }

    pub fn reconcile_question_after_restart(&mut self) -> Result<usize, StoreError> {
        self.converge_one_shot_after_restart(CommandType::QuestionRespond)
    }

    /// Converge prompt-delivery records before the gateway accepts clients.
    ///
    /// A v2 prompt that never crossed the durable dispatch barrier is known
    /// not to have reached ACP and becomes a deterministic failure. Legacy
    /// intent records and every post-barrier state are ambiguous and therefore
    /// become `delivery_unknown`; they must never be automatically replayed.
    pub fn reconcile_prompt_delivery_after_restart(
        &mut self,
        exact_terminal_evidence: &HashSet<Uuid>,
    ) -> Result<usize, StoreError> {
        let decisions = self
            .index
            .values()
            .filter(|record| record.command_type == CommandType::Prompt)
            .filter_map(|record| {
                let target = match record.status {
                    OutboxStatus::Received | OutboxStatus::Accepted => OutboxStatus::Failed,
                    OutboxStatus::IntentDurable
                        if record.delivery_protocol_version == Some(2)
                            && record.dispatch_barrier_at.is_none() =>
                    {
                        OutboxStatus::Failed
                    }
                    OutboxStatus::DeliveryConfirmed | OutboxStatus::ProjectionCommitted
                        if record.delivery_protocol_version == Some(2)
                            && record.payload_fingerprint.is_some()
                            && exact_terminal_evidence.contains(&record.command_id) =>
                    {
                        OutboxStatus::Completed
                    }
                    OutboxStatus::IntentDurable
                    | OutboxStatus::Dispatched
                    | OutboxStatus::DeliveryConfirmed
                    | OutboxStatus::ProjectionCommitted => OutboxStatus::DeliveryUnknown,
                    OutboxStatus::Completed
                    | OutboxStatus::Failed
                    | OutboxStatus::DeliveryUnknown => return None,
                };
                Some((record.command_id, target))
            })
            .collect::<Vec<_>>();

        for (id, target) in &decisions {
            match target {
                OutboxStatus::Failed => self.transition(*id, OutboxStatus::Failed, |record| {
                    record.last_error =
                        Some(LastError::from_error_code(ErrorCode::AgentUnavailable));
                    if let Some(error) = record.last_error.as_mut() {
                        error.retryable = false;
                    }
                })?,
                OutboxStatus::DeliveryUnknown => {
                    self.transition(*id, OutboxStatus::DeliveryUnknown, |record| {
                        record.last_error =
                            Some(LastError::from_error_code(ErrorCode::DeliveryUnknown));
                    })?;
                }
                OutboxStatus::Completed => {
                    let current = self.get(*id).expect("reconciliation record exists").status;
                    if current == OutboxStatus::DeliveryConfirmed {
                        self.mark_projection_committed(*id)?;
                    }
                    self.mark_completed(*id)?;
                }
                _ => unreachable!("restart reconciliation only writes terminal decisions"),
            }
        }
        Ok(decisions.len())
    }

    /// delivery_unknown 人工裁决（§5.3 runbook；审计日志由本方法写入）：
    ///
    /// - `ConfirmedDelivered` → completed；
    /// - `ConfirmedNotDelivered` → tombstone 清除（允许重发）；
    /// - `StillUnknown` → 保持（幂等，重载不推进）。
    pub fn resolve_delivery_unknown(
        &mut self,
        id: Uuid,
        verdict: DeliveryVerdict,
    ) -> Result<(), StoreError> {
        let from = self
            .index
            .get(&id)
            .map(|r| r.status)
            .ok_or_else(|| self.not_found(id))?;
        let chat_id = self.index.get(&id).expect("checked").chat_id;
        if from != OutboxStatus::DeliveryUnknown {
            return self.reject(
                id,
                from,
                match verdict {
                    DeliveryVerdict::ConfirmedDelivered => OutboxStatus::Completed,
                    DeliveryVerdict::ConfirmedNotDelivered | DeliveryVerdict::StillUnknown => {
                        OutboxStatus::DeliveryUnknown
                    }
                },
            );
        }
        info!(
            event = "outbox.resolve", command_id = %id, chat_id = %chat_id,
            verdict = ?verdict,
            "delivery_unknown resolved by operator"
        );
        match verdict {
            DeliveryVerdict::ConfirmedDelivered => {
                self.transition(id, OutboxStatus::Completed, |_| {})
            }
            DeliveryVerdict::ConfirmedNotDelivered => self.tombstone(id),
            DeliveryVerdict::StillUnknown => Ok(()), // 幂等：重载不推进
        }
    }

    /// 清除记录（tombstone；§5.2：retryable 失败清除 / 裁决「确认未送达」）。
    /// 合法来源：`intent_durable`（投递前）与 `delivery_unknown`（裁决）。
    pub fn clear_for_retry(&mut self, id: Uuid) -> Result<(), StoreError> {
        let from = self
            .index
            .get(&id)
            .map(|r| r.status)
            .ok_or_else(|| self.not_found(id))?;
        if !matches!(
            from,
            OutboxStatus::IntentDurable | OutboxStatus::DeliveryUnknown
        ) {
            return self.reject(id, from, OutboxStatus::IntentDurable);
        }
        self.tombstone(id)
    }
}
