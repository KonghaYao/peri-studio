//! Durable response lifecycle for ACP form elicitation.
//!
//! 拆分说明（纯结构拆分，行为语义不变）：
//! - `elicitation_response_validation`：应答校验（`validate_answers` /
//!   `answer_is_empty`），按字段 schema 校验答案；
//! - `elicitation_response_delivery`：交付前失败与交付未知的失败落库样板
//!   （`fail_before_delivery` / `delivery_unknown`）、响应帧构造
//!   （`response_frame`）与 instance 错误映射。
//!   本文件保留 `execute` 主流程、类型定义与 `failure` helper。

#[path = "elicitation_response_delivery.rs"]
mod elicitation_response_delivery;
#[path = "elicitation_response_validation.rs"]
mod elicitation_response_validation;

use self::elicitation_response_delivery::{
    definitely_not_delivered, instance_error_code, response_frame,
};
use self::elicitation_response_validation::validate_answers;

use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::RespondElicitationPayload;

use crate::channel::command_identity::elicitation_response_fingerprint;
use crate::channel::relay_event_handler::RelayEventHandler;
use crate::control::{ChatRegistry, InstanceRegistry};
use crate::persist::outbox::{CommandRecovery, LastError};
use crate::persist::Store;
use crate::state::aggregator::ApplyReason;
use crate::state::doc_manager::{DocCommand, DocManager, SubmitError, SubmitResult};

#[derive(Clone)]
pub(super) struct ElicitationResponse {
    store: Arc<Store>,
    doc: Arc<DocManager>,
    chats: ChatRegistry,
    relay: Arc<RelayEventHandler>,
    instance: Arc<InstanceRegistry>,
}

pub(super) struct ElicitationResponseRequest {
    pub command_id: Uuid,
    pub payload: RespondElicitationPayload,
}

pub(super) enum ElicitationResponseOutcome {
    Committed,
    Duplicate,
}

#[derive(Debug)]
pub(super) struct ElicitationResponseFailure {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub audit_outcome: &'static str,
}

impl ElicitationResponse {
    pub fn new(
        store: Arc<Store>,
        doc: Arc<DocManager>,
        chats: ChatRegistry,
        relay: Arc<RelayEventHandler>,
        instance: Arc<InstanceRegistry>,
    ) -> Self {
        Self {
            store,
            doc,
            chats,
            relay,
            instance,
        }
    }

    pub async fn execute(
        &self,
        request: ElicitationResponseRequest,
    ) -> Result<ElicitationResponseOutcome, ElicitationResponseFailure> {
        let chat_id = Uuid::parse_str(&request.payload.chat_id).map_err(|_| {
            failure(
                ErrorCode::InvalidState,
                "invalid chatId",
                false,
                "invalid_chat_id",
            )
        })?;
        let store = self.store.chat(chat_id).ok_or_else(|| {
            failure(
                ErrorCode::ChatNotFound,
                "chat not found",
                false,
                "chat_not_found",
            )
        })?;
        let fingerprint = elicitation_response_fingerprint(&request.payload).map_err(|_| {
            failure(
                ErrorCode::InvalidState,
                "elicitation response identity is invalid",
                false,
                "fingerprint_invalid",
            )
        })?;
        let command_id = request.command_id.to_string();

        let preview = self
            .relay
            .pending_elicitation(&request.payload.elicitation_id)
            .await
            .ok_or_else(|| {
                failure(
                    ErrorCode::InvalidState,
                    "elicitation is no longer pending or belongs to another response",
                    false,
                    "request_unavailable",
                )
            })?;
        validate_answers(&request.payload, &preview.fields)?;

        let persisted_recovery = store
            .outbox_get(request.command_id)
            .await
            .and_then(|record| record.recovery.map(|recovery| *recovery));
        if persisted_recovery.is_none()
            && store
                .outbox()
                .lock()
                .await
                .mark_intent_durable(request.command_id)
                .is_err()
        {
            return self
                .fail_before_delivery(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "elicitation intent could not be persisted",
                    "intent_persist_failed",
                )
                .await;
        }
        let Some(pending) = self
            .relay
            .claim_pending_elicitation(&request.payload.elicitation_id, &command_id, &fingerprint)
            .await
        else {
            return self
                .fail_before_delivery(
                    &store,
                    request.command_id,
                    ErrorCode::InvalidState,
                    "elicitation belongs to another response",
                    "claim_conflict",
                )
                .await;
        };

        if persisted_recovery.is_none()
            && store
                .outbox()
                .lock()
                .await
                .set_recovery(
                    request.command_id,
                    CommandRecovery::ElicitationResponse {
                        elicitation_id: request.payload.elicitation_id.clone(),
                        request_id: pending.request_id.clone(),
                        response_fingerprint: fingerprint.clone(),
                    },
                )
                .is_err()
        {
            return self
                .fail_before_delivery(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "elicitation recovery evidence could not be persisted",
                    "recovery_persist_failed",
                )
                .await;
        }

        let replay = match self
            .doc
            .submit_command(
                &request.payload.chat_id,
                DocCommand::BeginElicitationResponse {
                    elicitation_id: request.payload.elicitation_id.clone(),
                    action: request.payload.action,
                    updated_at: Utc::now().to_rfc3339(),
                },
            )
            .await
        {
            SubmitResult::Applied(result) if result.applied => false,
            SubmitResult::Applied(result)
                if result.reason == Some(ApplyReason::ElicitationResponseReplay) =>
            {
                true
            }
            SubmitResult::Applied(_) => {
                return self
                    .fail_before_delivery(
                        &store,
                        request.command_id,
                        ErrorCode::InvalidState,
                        "elicitation was already answered or expired",
                        "cas_rejected",
                    )
                    .await
            }
            SubmitResult::Rejected(SubmitError::ChatNotFound) => {
                return Err(failure(
                    ErrorCode::ChatNotFound,
                    "chat not found",
                    false,
                    "chat_not_found",
                ))
            }
            _ => {
                return Err(failure(
                    ErrorCode::AgentUnavailable,
                    "elicitation response could not be persisted",
                    true,
                    "cas_persist_failed",
                ))
            }
        };

        let Some(runtime) = self.chats.entry(&request.payload.chat_id).await else {
            return self
                .delivery_unknown(
                    &store,
                    request.command_id,
                    "elicitation was selected but its runtime is unavailable",
                    "runtime_missing",
                )
                .await;
        };
        if runtime.state.is_terminal() {
            return self
                .delivery_unknown(
                    &store,
                    request.command_id,
                    "elicitation runtime has ended",
                    "runtime_terminal",
                )
                .await;
        }
        if store
            .outbox()
            .lock()
            .await
            .mark_no_redelivery_barrier(request.command_id, Utc::now())
            .is_err()
        {
            return self
                .delivery_unknown(
                    &store,
                    request.command_id,
                    "elicitation dispatch barrier could not be persisted",
                    "dispatch_barrier_failed",
                )
                .await;
        }

        let response = response_frame(&pending.request_id, &request.payload);
        match self
            .instance
            .forward_rpc_response(
                &runtime.instance_id,
                &request.payload.chat_id,
                &command_id,
                &response,
            )
            .await
        {
            Ok(()) => {}
            Err(error) if definitely_not_delivered(&error) => {
                let code = instance_error_code(&error);
                if store
                    .outbox()
                    .lock()
                    .await
                    .mark_recovery_not_delivered(
                        request.command_id,
                        LastError::from_error_code(code),
                    )
                    .is_ok()
                {
                    return Err(failure(
                        code,
                        "elicitation response was not delivered",
                        code.default_retryable(),
                        "definite_not_delivered",
                    ));
                }
                return self
                    .delivery_unknown(
                        &store,
                        request.command_id,
                        "elicitation delivery could not be proven absent",
                        "barrier_clear_failed",
                    )
                    .await;
            }
            Err(_) => {
                return self
                    .delivery_unknown(
                        &store,
                        request.command_id,
                        "elicitation response may have reached ACP; retry is blocked",
                        "forward_unknown",
                    )
                    .await
            }
        }

        {
            let mut outbox = store.outbox().lock().await;
            if outbox
                .mark_dispatched(request.command_id, Utc::now())
                .and_then(|_| outbox.mark_delivery_confirmed(request.command_id))
                .is_err()
            {
                drop(outbox);
                return self
                    .delivery_unknown(
                        &store,
                        request.command_id,
                        "elicitation reached ACP but delivery evidence is incomplete",
                        "delivery_persist_failed",
                    )
                    .await;
            }
        }
        match self
            .doc
            .submit_command(
                &request.payload.chat_id,
                DocCommand::CompleteElicitationResponse {
                    elicitation_id: request.payload.elicitation_id.clone(),
                    updated_at: Utc::now().to_rfc3339(),
                },
            )
            .await
        {
            SubmitResult::Applied(_) => {}
            _ => {
                return self
                    .delivery_unknown(
                        &store,
                        request.command_id,
                        "elicitation response was delivered but projection is incomplete",
                        "projection_failed",
                    )
                    .await
            }
        }
        let mut outbox = store.outbox().lock().await;
        if outbox
            .clear_recovery(request.command_id)
            .and_then(|_| outbox.mark_projection_committed(request.command_id))
            .and_then(|_| outbox.mark_completed(request.command_id))
            .is_err()
        {
            drop(outbox);
            return self
                .delivery_unknown(
                    &store,
                    request.command_id,
                    "elicitation terminal state could not be persisted",
                    "terminal_persist_failed",
                )
                .await;
        }
        drop(outbox);
        self.relay
            .remove_pending_elicitation(&request.payload.elicitation_id)
            .await;
        Ok(if replay {
            ElicitationResponseOutcome::Duplicate
        } else {
            ElicitationResponseOutcome::Committed
        })
    }
}

fn failure(
    code: ErrorCode,
    message: impl Into<String>,
    retryable: bool,
    audit_outcome: &'static str,
) -> ElicitationResponseFailure {
    ElicitationResponseFailure {
        code,
        message: message.into(),
        retryable,
        audit_outcome,
    }
}
