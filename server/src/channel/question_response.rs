//! Durable `question/respond` lifecycle（WP-C / O-001）。

use std::sync::Arc;

use chrono::Utc;
use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::RespondQuestionPayload;
use uuid::Uuid;

use crate::control::{ChatRegistry, InstanceRegistry};
use crate::persist::Store;
use crate::state::aggregator::ApplyReason;
use crate::state::doc_manager::{DocCommand, DocManager, SubmitError, SubmitResult};
use crate::state::question::QuestionCasOutcome;

use super::relay_event_handler::RelayEventHandler;

#[derive(Clone)]
pub(super) struct QuestionResponse {
    store: Arc<Store>,
    doc: Arc<DocManager>,
    chats: ChatRegistry,
    relay: Arc<RelayEventHandler>,
    instance: Arc<InstanceRegistry>,
}

pub(super) struct QuestionResponseRequest {
    pub command_id: Uuid,
    pub payload: RespondQuestionPayload,
}

pub(super) enum QuestionResponseOutcome {
    Committed,
    Duplicate,
}

#[derive(Debug)]
pub(super) struct QuestionResponseFailure {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub audit_outcome: &'static str,
}

impl QuestionResponse {
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
        request: QuestionResponseRequest,
    ) -> Result<QuestionResponseOutcome, QuestionResponseFailure> {
        let chat_id = request.payload.chat_id.clone();
        let question_id = request.payload.question_id.clone();
        let answers = request.payload.answers.clone();
        let command_id_text = request.command_id.to_string();

        let chat_uuid = Uuid::parse_str(&chat_id).map_err(|_| {
            failure(
                ErrorCode::InvalidState,
                "invalid chatId",
                false,
                "invalid_chat_id",
            )
        })?;
        let store = self.store.chat(chat_uuid).ok_or_else(|| {
            failure(
                ErrorCode::ChatNotFound,
                "chat not found",
                false,
                "chat_not_found",
            )
        })?;

        let bound = self.relay.pending_question_chat(&question_id).await;
        if bound.as_deref() != Some(chat_id.as_str()) {
            return Err(failure(
                ErrorCode::InvalidState,
                "question is no longer pending or belongs to another chat",
                false,
                "question_unavailable",
            ));
        }

        if store
            .outbox()
            .lock()
            .await
            .mark_intent_durable(request.command_id)
            .is_err()
        {
            return Err(failure(
                ErrorCode::AgentUnavailable,
                "question intent could not be persisted",
                true,
                "intent_persist_failed",
            ));
        }

        let cas = match self
            .doc
            .submit_command(
                &chat_id,
                DocCommand::ResolveQuestion {
                    question_id: question_id.clone(),
                    answers: answers.clone(),
                },
            )
            .await
        {
            SubmitResult::Applied(result) if result.applied => QuestionCasOutcome::Migrated,
            SubmitResult::Applied(result)
                if result.reason == Some(ApplyReason::QuestionAnswerReplay) =>
            {
                return Ok(QuestionResponseOutcome::Duplicate);
            }
            SubmitResult::Applied(result) if !result.applied => {
                return match result.reason {
                    Some(ApplyReason::QuestionAnswerReplay) => {
                        Ok(QuestionResponseOutcome::Duplicate)
                    }
                    Some(ApplyReason::UnknownQuestion) => Err(failure(
                        ErrorCode::InvalidState,
                        "question is unknown or not pending",
                        false,
                        "question_unknown",
                    )),
                    _ => Err(failure(
                        ErrorCode::InvalidState,
                        "question was already answered or expired",
                        false,
                        "cas_rejected",
                    )),
                };
            }
            SubmitResult::Rejected(SubmitError::ChatNotFound) => {
                return Err(failure(
                    ErrorCode::ChatNotFound,
                    "chat not found",
                    false,
                    "chat_not_found",
                ));
            }
            SubmitResult::PersistFailed => {
                return Err(failure(
                    ErrorCode::AgentUnavailable,
                    "question response could not be persisted",
                    true,
                    "cas_persist_failed",
                ));
            }
            _ => QuestionCasOutcome::Unknown,
        };

        if cas != QuestionCasOutcome::Migrated {
            return Err(failure(
                ErrorCode::InvalidState,
                "question is unknown or not pending",
                false,
                "question_unknown",
            ));
        }

        let Some(runtime) = self.chats.entry(&chat_id).await else {
            let _ = store
                .outbox()
                .lock()
                .await
                .mark_delivery_unknown(request.command_id);
            return Err(failure(
                ErrorCode::DeliveryUnknown,
                "question was resolved but runtime is unavailable",
                false,
                "runtime_missing",
            ));
        };

        if store
            .outbox()
            .lock()
            .await
            .mark_no_redelivery_barrier(request.command_id, Utc::now())
            .is_err()
        {
            let _ = store
                .outbox()
                .lock()
                .await
                .mark_delivery_unknown(request.command_id);
            return Err(failure(
                ErrorCode::DeliveryUnknown,
                "question dispatch barrier could not be persisted",
                false,
                "dispatch_barrier_failed",
            ));
        }

        if self
            .relay
            .forward_question_control_response(
                &chat_id,
                &question_id,
                true,
                &answers,
                &command_id_text,
            )
            .await
            .is_err()
        {
            let _ = store
                .outbox()
                .lock()
                .await
                .mark_delivery_unknown(request.command_id);
            return Err(failure(
                ErrorCode::DeliveryUnknown,
                "control_response delivery is uncertain",
                false,
                "control_response_unknown",
            ));
        }

        self.relay.clear_pending_question(&question_id).await;
        let _ = store
            .outbox()
            .lock()
            .await
            .mark_completed(request.command_id);
        let _ = self.instance;
        let _ = runtime;
        Ok(QuestionResponseOutcome::Committed)
    }
}

fn failure(
    code: ErrorCode,
    message: &str,
    retryable: bool,
    audit_outcome: &'static str,
) -> QuestionResponseFailure {
    QuestionResponseFailure {
        code,
        message: message.to_string(),
        retryable,
        audit_outcome,
    }
}
