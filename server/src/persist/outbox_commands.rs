//! outbox 状态机迁移 API（§5.1/§5.2）：`insert` + `mark_*`/`set_*`/`clear_*`
//! 系列（去重账本 + 迁移；纯内存，无落盘）。
//!
//! 本文件是 [`OutboxStore`](super::OutboxStore) 的实现段（结构拆分，行为
//! 语义不变）；restart 对账族与人工裁决见 `outbox_reconcile.rs`。

use chrono::{DateTime, Utc};

use super::*;
impl OutboxStore {
    /// 插入新记录 → `Received`（§5.2）。遇已存在 commandId（任意状态）→
    /// [`StoreError::DuplicateCommand`]（重发穿透防护，§4.4）；重发判定与
    /// duplicate Ack 由 coordinator 经 [`OutboxStore::get`] 完成。
    pub fn insert(&mut self, rec: NewOutboxRecord) -> Result<(), StoreError> {
        if let Some(existing) = self.index.get(&rec.command_id) {
            return Err(StoreError::DuplicateCommand {
                command_id: rec.command_id,
                state: existing.status,
            });
        }
        let now = Utc::now();
        let record = OutboxRecord {
            command_id: rec.command_id,
            chat_id: rec.chat_id,
            command_type: rec.command_type,
            turn_id: rec.turn_id,
            status: OutboxStatus::Received,
            retryable_class: rec.retryable_class,
            dispatched_at: None,
            created_at: now,
            updated_at: now,
            last_error: None,
            attempt_count: 0,
            delivery_protocol_version: None,
            payload_fingerprint: None,
            dispatch_barrier_at: None,
            recovery: None,
        };
        self.append_record(&record)
    }

    /// `received → accepted`（§5.2）。
    pub fn mark_accepted(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.transition(id, OutboxStatus::Accepted, |r| {
            r.dispatched_at = None;
        })
    }

    /// `accepted → intent_durable`（意图记录，§4.4 提交点纪律第一步）。
    pub fn mark_intent_durable(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.transition(id, OutboxStatus::IntentDurable, |_| {})
    }

    /// Establish prompt-delivery-v2 intent and its body-free equality proof in
    /// the same durable record transition. The caller must already have
    /// persisted the matching Pending user projection.
    pub fn mark_prompt_intent_durable(
        &mut self,
        id: Uuid,
        payload_fingerprint: String,
    ) -> Result<(), StoreError> {
        if payload_fingerprint.is_empty() {
            return Err(StoreError::Corrupt {
                detail: format!("empty prompt payload fingerprint for command {id}"),
            });
        }
        if self
            .index
            .get(&id)
            .and_then(|record| record.payload_fingerprint.as_deref())
            .is_some_and(|existing| existing != payload_fingerprint)
        {
            return Err(StoreError::Corrupt {
                detail: format!("conflicting prompt payload fingerprint for command {id}"),
            });
        }
        self.transition(id, OutboxStatus::IntentDurable, |record| {
            record.delivery_protocol_version = Some(2);
            record.payload_fingerprint = Some(payload_fingerprint);
            record.dispatch_barrier_at = None;
        })
    }

    /// Attach body-free equality evidence while the command is Accepted so a
    /// concurrent same-id retry can be validated before the executor reaches
    /// the Pending projection barrier.
    pub fn set_prompt_payload_fingerprint(
        &mut self,
        id: Uuid,
        payload_fingerprint: String,
    ) -> Result<(), StoreError> {
        let mut record = self
            .index
            .get(&id)
            .cloned()
            .ok_or_else(|| self.not_found(id))?;
        if record.status != OutboxStatus::Accepted {
            return self.reject(id, record.status, OutboxStatus::Accepted);
        }
        // 空指纹是输入非法（调用方未附等值证据），不是状态迁移错误——
        // 与 mark_prompt_intent_durable 的 Corrupt 语义一致（§9 错误面）。
        if payload_fingerprint.is_empty() {
            return Err(StoreError::Corrupt {
                detail: format!("empty prompt payload fingerprint for command {id}"),
            });
        }
        match record.payload_fingerprint.as_deref() {
            Some(existing) if existing == payload_fingerprint => return Ok(()),
            Some(_) => {
                return Err(StoreError::Corrupt {
                    detail: format!("conflicting prompt payload fingerprint for command {id}"),
                })
            }
            None => {}
        }
        record.payload_fingerprint = Some(payload_fingerprint);
        record.updated_at = Utc::now();
        self.append_record(&record)
    }

    /// Persist the no-redelivery barrier before the frame can enter the
    /// instance writer. This deliberately does not change `status`:
    /// `intent_durable + dispatch_barrier_at` is the additive effective
    /// Dispatching state and remains readable by older binaries.
    pub fn mark_dispatch_barrier(&mut self, id: Uuid, at: DateTime<Utc>) -> Result<(), StoreError> {
        let mut record = self
            .index
            .get(&id)
            .cloned()
            .ok_or_else(|| self.not_found(id))?;
        if record.status != OutboxStatus::IntentDurable
            || record.delivery_protocol_version != Some(2)
            || record
                .payload_fingerprint
                .as_deref()
                .is_none_or(str::is_empty)
        {
            return self.reject(id, record.status, OutboxStatus::Dispatched);
        }
        if record.dispatch_barrier_at.is_some() {
            return Ok(());
        }
        record.dispatch_barrier_at = Some(at);
        record.updated_at = at;
        self.append_record(&record)
    }

    /// Persist a no-redelivery barrier for a non-prompt command before its
    /// frame can enter the instance writer. This is deliberately additive:
    /// `status` remains `intent_durable`, while the barrier records that a
    /// crash or ambiguous transport result must never authorize blind retry.
    pub fn mark_no_redelivery_barrier(
        &mut self,
        id: Uuid,
        at: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        let mut record = self
            .index
            .get(&id)
            .cloned()
            .ok_or_else(|| self.not_found(id))?;
        if record.status != OutboxStatus::IntentDurable
            || record.command_type == CommandType::Prompt
            || record.retryable_class != RetryableClass::NoAutoRedeliver
        {
            return self.reject(id, record.status, OutboxStatus::Dispatched);
        }
        if record.dispatch_barrier_at.is_some() {
            return Ok(());
        }
        record.dispatch_barrier_at = Some(at);
        record.updated_at = at;
        self.append_record(&record)
    }

    /// Record proof that an official permission response definitely did not
    /// reach ACP. Only exact durable recovery evidence permits clearing the
    /// no-redelivery barrier; without it the caller must fail closed.
    pub fn mark_recovery_not_delivered(
        &mut self,
        id: Uuid,
        error: LastError,
    ) -> Result<(), StoreError> {
        let mut record = self
            .index
            .get(&id)
            .cloned()
            .ok_or_else(|| self.not_found(id))?;
        if record.status != OutboxStatus::IntentDurable
            || !matches!(
                record.command_type,
                CommandType::Resolve
                    | CommandType::ElicitationRespond
                    | CommandType::QuestionRespond
            )
            || record.recovery.is_none()
            || record.dispatch_barrier_at.is_none()
        {
            return self.reject(id, record.status, OutboxStatus::IntentDurable);
        }
        record.dispatch_barrier_at = None;
        record.last_error = Some(error.clone());
        record.updated_at = error.at;
        self.append_record(&record)
    }

    /// Record proof that a cancel notification did not enter ACP stdin.
    ///
    /// Only the instance's explicit negative writer acknowledgement (or a
    /// failure before an instance connection exists) may clear this barrier.
    /// Timeout/connection loss is ambiguous and must remain fail-closed.
    pub fn mark_cancel_not_delivered(
        &mut self,
        id: Uuid,
        error: LastError,
    ) -> Result<(), StoreError> {
        let mut record = self
            .index
            .get(&id)
            .cloned()
            .ok_or_else(|| self.not_found(id))?;
        if record.status != OutboxStatus::IntentDurable
            || record.command_type != CommandType::Cancel
            || record.dispatch_barrier_at.is_none()
        {
            return self.reject(id, record.status, OutboxStatus::IntentDurable);
        }
        record.dispatch_barrier_at = None;
        record.last_error = Some(error.clone());
        record.updated_at = error.at;
        self.append_record(&record)
    }

    /// Record exact proof that a partially-created runtime no longer exists.
    ///
    /// The create executor may call this only after an explicit negative
    /// `spawn_ack`, or after `kill_ack.ok=true` for the same chat id. It is not
    /// permission to replay `session/new`: once that non-idempotent RPC may
    /// have entered ACP, callers must preserve the barrier and converge to
    /// `delivery_unknown` instead.
    pub fn mark_create_cleanup_confirmed(
        &mut self,
        id: Uuid,
        error: LastError,
    ) -> Result<(), StoreError> {
        let mut record = self
            .index
            .get(&id)
            .cloned()
            .ok_or_else(|| self.not_found(id))?;
        if record.command_type != CommandType::Create
            || record.retryable_class != RetryableClass::NoAutoRedeliver
            || record.dispatch_barrier_at.is_none()
            || !matches!(
                record.status,
                OutboxStatus::IntentDurable
                    | OutboxStatus::Dispatched
                    | OutboxStatus::DeliveryConfirmed
            )
        {
            return self.reject(id, record.status, OutboxStatus::IntentDurable);
        }
        record.status = OutboxStatus::IntentDurable;
        record.dispatch_barrier_at = None;
        record.dispatched_at = None;
        record.last_error = Some(error.clone());
        record.updated_at = error.at;
        self.append_record(&record)
    }

    /// 为已记录意图附加恢复证据。证据与 commandId 同一条记录保存；
    /// outbox 纯内存、重启即空，该证据仅用于进程内回退判定。
    pub fn set_recovery(&mut self, id: Uuid, recovery: CommandRecovery) -> Result<(), StoreError> {
        let mut record = self
            .index
            .get(&id)
            .cloned()
            .ok_or_else(|| self.not_found(id))?;
        if record.status != OutboxStatus::IntentDurable {
            return self.reject(id, record.status, OutboxStatus::IntentDurable);
        }
        if let Some(existing) = &record.recovery {
            if existing.as_ref() == &recovery {
                return Ok(());
            }
            return Err(StoreError::Corrupt {
                detail: format!("conflicting recovery evidence for command {id}"),
            });
        }
        record.recovery = Some(Box::new(recovery));
        record.updated_at = Utc::now();
        self.append_record(&record)
    }

    /// 投递已确认后删除不再需要的恢复材料，降低长期保留面。
    pub fn clear_recovery(&mut self, id: Uuid) -> Result<(), StoreError> {
        let mut record = self
            .index
            .get(&id)
            .cloned()
            .ok_or_else(|| self.not_found(id))?;
        if record.status != OutboxStatus::DeliveryConfirmed {
            return self.reject(id, record.status, OutboxStatus::DeliveryConfirmed);
        }
        if record.recovery.is_none() {
            return Ok(());
        }
        record.recovery = None;
        record.updated_at = Utc::now();
        self.append_record(&record)
    }

    /// `intent_durable → dispatched`（下发 instance；置 `dispatched_at`，
    /// attempt_count +1）。此后崩溃 → 重发由 outbox 兜底返回 `duplicate`。
    pub fn mark_dispatched(&mut self, id: Uuid, at: DateTime<Utc>) -> Result<(), StoreError> {
        self.transition(id, OutboxStatus::Dispatched, |r| {
            r.dispatched_at = Some(at);
            r.attempt_count = r.attempt_count.saturating_add(1);
        })
    }

    /// `dispatched → delivery_confirmed`（L1+L2 达成，M1 合并）。
    pub fn mark_delivery_confirmed(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.transition(id, OutboxStatus::DeliveryConfirmed, |_| {})
    }

    /// `delivery_confirmed → projection_committed`（投影 update 已投递后）。
    pub fn mark_projection_committed(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.transition(id, OutboxStatus::ProjectionCommitted, |_| {})
    }

    /// `projection_committed → completed`（committed Ack 返回，终态）。
    pub fn mark_completed(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.transition(id, OutboxStatus::Completed, |_| {})
    }

    /// 失败迁移（§5.2 + **H1 裁决**）：
    ///
    /// - `err.retryable == false`（`INVALID_STATE`/`FORBIDDEN`/`CHAT_NOT_FOUND`
    ///   ，§4.4）→ `failed`（终态）；来源状态为投递前（received/accepted/
    ///   intent_durable）或投递后（dispatched/delivery_confirmed/
    ///   projection_committed）。
    /// - `err.retryable == true`（`AGENT_UNAVAILABLE`/`INSTANCE_OFFLINE`）：
    ///   投递后（dispatched/delivery_confirmed/projection_committed）→
    ///   **回退**到 `intent_durable`（记录保留、去重索引不删、`dispatched_at`
    ///   清除、状态标记可重发）【H1 裁决】；投递前（received/accepted/
    ///   intent_durable）→ tombstone 清除（允许重发重新执行，§5.2 原语义）。
    ///
    /// `delivery_unknown` 不由此迁移（须经 [`OutboxStore::resolve_delivery_unknown`]）；
    /// 终态拒绝。
    pub fn mark_failed(&mut self, id: Uuid, err: LastError) -> Result<(), StoreError> {
        let from = self
            .index
            .get(&id)
            .map(|r| r.status)
            .ok_or_else(|| self.not_found(id))?;
        if from.is_terminal() {
            return self.reject(id, from, OutboxStatus::Failed);
        }
        if from == OutboxStatus::DeliveryUnknown {
            return self.reject(id, from, OutboxStatus::Failed);
        }
        if err.retryable {
            // Once the v2 dispatch barrier is durable, even an
            // `intent_durable` record may already have entered the instance
            // writer. Never tombstone or rewind it on an ambiguous transport
            // error: doing so would authorize a second ACP execution.
            if self
                .index
                .get(&id)
                .is_some_and(|record| record.dispatch_barrier_at.is_some())
            {
                return self.transition(id, OutboxStatus::DeliveryUnknown, |record| {
                    record.last_error = Some(err);
                });
            }
            // H1 裁决：投递后回退；投递前 tombstone 清除。
            if matches!(
                from,
                OutboxStatus::Dispatched
                    | OutboxStatus::DeliveryConfirmed
                    | OutboxStatus::ProjectionCommitted
            ) {
                let mut record = self.index.get(&id).expect("checked").clone();
                let chat_id = record.chat_id;
                record.status = OutboxStatus::IntentDurable;
                record.dispatched_at = None;
                record.updated_at = err.at;
                record.last_error = Some(err);
                self.append_record(&record)?;
                tracing::info!(
                    event = "outbox.retryable_fallback", command_id = %id,
                    chat_id = %chat_id,
                    "outbox record fell back to intent_durable for retry"
                );
                return Ok(());
            }
            // 投递前：清除记录允许重发。
            self.tombstone(id)?;
            tracing::info!(
                event = "outbox.clear_for_retry", command_id = %id,
                "outbox record cleared for retry (pre-dispatch retryable failure)"
            );
            return Ok(());
        }
        // 非 retryable → failed（终态）。
        self.transition(id, OutboxStatus::Failed, |r| {
            r.last_error = Some(err);
        })
    }

    /// `dispatched → delivery_unknown`（L2 后 L3 不可得，M1 路径 B，§5.3）。
    pub fn mark_delivery_unknown(&mut self, id: Uuid) -> Result<(), StoreError> {
        self.transition(id, OutboxStatus::DeliveryUnknown, |record| {
            record.last_error = Some(LastError::from_error_code(
                peri_studio_proto::ack::ErrorCode::DeliveryUnknown,
            ));
        })
    }
}
