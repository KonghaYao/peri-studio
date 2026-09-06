//! Durable cancellation for one active ACP turn.
//!
//! ACP models `session/cancel` as a JSON-RPC notification, so there is no ACP
//! response. The Hub still requires the instance writer's `forward_ack` before
//! treating the notification as delivered. A durable no-redelivery barrier is
//! established before the frame can enter that writer.

use std::sync::Arc;

use chrono::Utc;
use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::{ActionEnvelope, CancelChatPayload};
use peri_studio_proto::schema::TurnStatus;
use uuid::Uuid;

use crate::control::{ChatRegistry, InstanceError, InstanceRegistry};
use crate::persist::outbox::LastError;
use crate::persist::Store;
use crate::protocol::{OutboundCtx, OutboundMessage, Translator};
use crate::state::aggregator::ApplyReason;
use crate::state::doc_manager::{DocCommand, DocManager, SubmitResult};

#[derive(Clone)]
pub(super) struct TurnCancellation {
    store: Arc<Store>,
    doc: Arc<DocManager>,
    instance: Arc<InstanceRegistry>,
    chats: ChatRegistry,
    translator: Arc<Translator>,
}

pub(super) struct CancelTurnRequest {
    pub command_id: Uuid,
    pub chat_id: String,
}

pub(super) struct CancelTurnFailure {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub audit_outcome: &'static str,
}

impl TurnCancellation {
    pub fn new(
        store: Arc<Store>,
        doc: Arc<DocManager>,
        instance: Arc<InstanceRegistry>,
        chats: ChatRegistry,
        translator: Arc<Translator>,
    ) -> Self {
        Self {
            store,
            doc,
            instance,
            chats,
            translator,
        }
    }

    pub async fn execute(&self, request: CancelTurnRequest) -> Result<(), CancelTurnFailure> {
        let chat_uuid = Uuid::parse_str(&request.chat_id).map_err(|_| {
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
                "store_missing",
            )
        })?;
        if store
            .outbox()
            .lock()
            .await
            .mark_intent_durable(request.command_id)
            .is_err()
        {
            return self
                .predispatch_failure(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "cancel intent could not be persisted",
                    "intent_persist_failed",
                )
                .await;
        }

        let Some(entry) = self.chats.entry(&request.chat_id).await else {
            return self
                .terminal_failure(
                    &store,
                    request.command_id,
                    ErrorCode::ChatNotFound,
                    "chat not found",
                    "chat_missing",
                )
                .await;
        };
        let Some(acp_session_id) = entry.session_id.clone() else {
            return self
                .terminal_failure(
                    &store,
                    request.command_id,
                    ErrorCode::InvalidState,
                    "chat binding not established",
                    "binding_missing",
                )
                .await;
        };
        let action = ActionEnvelope::Cancel {
            command_id: request.command_id.to_string(),
            payload: CancelChatPayload {
                chat_id: request.chat_id.clone(),
            },
        };
        let message = match self.translator.translate(
            &action,
            &OutboundCtx {
                cwd: entry.cwd.clone(),
                acp_session_id,
            },
        ) {
            Ok(OutboundMessage::JsonRpc(message)) if message.get("id").is_none() => message,
            _ => {
                return self
                    .terminal_failure(
                        &store,
                        request.command_id,
                        ErrorCode::InvalidState,
                        "cancel notification translation failed",
                        "translate_failed",
                    )
                    .await;
            }
        };
        let active_turn = self.chats.active_turn(&request.chat_id).await;
        if let Some(turn_id) = active_turn.as_ref() {
            let result = self
                .doc
                .submit_command(
                    &request.chat_id,
                    DocCommand::MarkTurnCancelling {
                        turn_id: turn_id.clone(),
                    },
                )
                .await;
            if !matches!(result, SubmitResult::Applied(result) if result.applied) {
                return self
                    .predispatch_failure(
                        &store,
                        request.command_id,
                        ErrorCode::InvalidState,
                        "active turn could not enter cancelling state",
                        "cancelling_projection_failed",
                    )
                    .await;
            }
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
                    "cancel dispatch barrier could not be persisted",
                    "dispatch_barrier_failed",
                )
                .await;
        }

        match self
            .instance
            .forward_notification(
                &entry.instance_id,
                &request.chat_id,
                &request.command_id.to_string(),
                &message,
            )
            .await
        {
            Ok(()) => {}
            Err(error) if definitely_not_delivered(&error) => {
                return self
                    .definitely_not_delivered(
                        &store,
                        request.command_id,
                        instance_error_code(&error),
                    )
                    .await;
            }
            Err(_) => {
                return self
                    .delivery_unknown(
                        &store,
                        request.command_id,
                        "cancel may have reached ACP; automatic retry is blocked",
                        "forward_unknown",
                    )
                    .await;
            }
        }
        if store
            .outbox()
            .lock()
            .await
            .mark_dispatched(request.command_id, Utc::now())
            .is_err()
        {
            return self
                .delivery_unknown(
                    &store,
                    request.command_id,
                    "cancel reached ACP but dispatch state was not persisted",
                    "dispatch_persist_failed",
                )
                .await;
        }
        if store
            .outbox()
            .lock()
            .await
            .mark_delivery_confirmed(request.command_id)
            .is_err()
        {
            return self
                .delivery_unknown(
                    &store,
                    request.command_id,
                    "cancel reached ACP but delivery state was not persisted",
                    "delivery_persist_failed",
                )
                .await;
        }

        if let Some(turn_id) = active_turn {
            let result = self
                .doc
                .submit_command(
                    &request.chat_id,
                    DocCommand::SetTurnTerminal {
                        turn_id,
                        status: TurnStatus::Cancelled,
                        completed_at: Utc::now().to_rfc3339(),
                    },
                )
                .await;
            let terminal_persisted = matches!(
                result,
                SubmitResult::Applied(result)
                    if result.applied || result.reason == Some(ApplyReason::DuplicateIdempotent)
            );
            if !terminal_persisted {
                self.chats.clear_active_turn(&request.chat_id).await;
                return self
                    .delivery_unknown(
                        &store,
                        request.command_id,
                        "cancel reached ACP but its terminal projection was not persisted",
                        "terminal_projection_failed",
                    )
                    .await;
            }
            self.chats.clear_active_turn(&request.chat_id).await;
        }
        if store
            .outbox()
            .lock()
            .await
            .mark_projection_committed(request.command_id)
            .is_err()
        {
            return self
                .delivery_unknown(
                    &store,
                    request.command_id,
                    "cancel terminal projection barrier was not persisted",
                    "projection_barrier_failed",
                )
                .await;
        }
        if store
            .outbox()
            .lock()
            .await
            .mark_completed(request.command_id)
            .is_err()
        {
            return self
                .delivery_unknown(
                    &store,
                    request.command_id,
                    "cancel completion was not persisted",
                    "completion_persist_failed",
                )
                .await;
        }
        Ok(())
    }

    async fn predispatch_failure(
        &self,
        store: &Arc<crate::persist::ChatStore>,
        command_id: Uuid,
        code: ErrorCode,
        message: &str,
        audit_outcome: &'static str,
    ) -> Result<(), CancelTurnFailure> {
        let durable = store
            .outbox()
            .lock()
            .await
            .mark_failed(command_id, LastError::from_error_code(code))
            .is_ok();
        if durable {
            Err(failure(
                code,
                message,
                code.default_retryable(),
                audit_outcome,
            ))
        } else {
            Err(failure(
                ErrorCode::DeliveryUnknown,
                "cancel terminal storage is degraded; retry is blocked",
                false,
                "terminal_persist_unknown",
            ))
        }
    }

    async fn terminal_failure(
        &self,
        store: &Arc<crate::persist::ChatStore>,
        command_id: Uuid,
        code: ErrorCode,
        message: &str,
        audit_outcome: &'static str,
    ) -> Result<(), CancelTurnFailure> {
        let mut error = LastError::from_error_code(code);
        error.retryable = false;
        if store
            .outbox()
            .lock()
            .await
            .mark_failed(command_id, error)
            .is_err()
        {
            return Err(failure(
                ErrorCode::DeliveryUnknown,
                "cancel failure could not be persisted",
                false,
                "failure_persist_unknown",
            ));
        }
        Err(failure(code, message, false, audit_outcome))
    }

    async fn definitely_not_delivered(
        &self,
        store: &Arc<crate::persist::ChatStore>,
        command_id: Uuid,
        code: ErrorCode,
    ) -> Result<(), CancelTurnFailure> {
        let durable = {
            let mut outbox = store.outbox().lock().await;
            outbox
                .mark_cancel_not_delivered(command_id, LastError::from_error_code(code))
                .and_then(|_| outbox.mark_failed(command_id, LastError::from_error_code(code)))
                .is_ok()
        };
        if durable {
            Err(failure(
                code,
                "cancel was not delivered",
                code.default_retryable(),
                "definite_not_delivered",
            ))
        } else {
            self.delivery_unknown(
                store,
                command_id,
                "cancel non-delivery proof could not be persisted",
                "non_delivery_persist_failed",
            )
            .await
        }
    }

    async fn delivery_unknown(
        &self,
        store: &Arc<crate::persist::ChatStore>,
        command_id: Uuid,
        message: &str,
        audit_outcome: &'static str,
    ) -> Result<(), CancelTurnFailure> {
        let _ = store
            .outbox()
            .lock()
            .await
            .mark_delivery_unknown(command_id);
        Err(failure(
            ErrorCode::DeliveryUnknown,
            message,
            false,
            audit_outcome,
        ))
    }
}

fn definitely_not_delivered(error: &InstanceError) -> bool {
    matches!(
        error,
        InstanceError::Offline
            | InstanceError::UnknownInstance(_)
            | InstanceError::ForwardRejected(_)
    )
}

fn instance_error_code(error: &InstanceError) -> ErrorCode {
    match error {
        InstanceError::Offline => ErrorCode::InstanceOffline,
        InstanceError::Timeout
        | InstanceError::ForwardRejected(_)
        | InstanceError::UnknownInstance(_)
        | InstanceError::ConnectionGone => ErrorCode::AgentUnavailable,
        // 协议形态错误：确定性失败（非 retryable，与 default_retryable 一致）。
        InstanceError::MalformedFrame(_)
        | InstanceError::ResourceUnsupported
        | InstanceError::TerminalUnsupported => ErrorCode::InvalidState,
    }
}

fn failure(
    code: ErrorCode,
    message: impl Into<String>,
    retryable: bool,
    audit_outcome: &'static str,
) -> CancelTurnFailure {
    CancelTurnFailure {
        code,
        message: message.into(),
        retryable,
        audit_outcome,
    }
}
