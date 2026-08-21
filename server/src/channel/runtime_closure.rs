//! Durable runtime closure for one Hub chat.
//!
//! `instance/kill` is idempotent by contract: an already-dead child also
//! acknowledges success. That lets this module repair any incomplete close by
//! replaying the same command, but only after the current outbox record has
//! been durably retired. Callers only need to handle one terminal outcome.

use std::sync::Arc;

use chrono::Utc;
use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::instance::InstanceKill;
use uuid::Uuid;

use crate::control::{ChatRegistry, ChatState, InstanceError, InstanceRegistry, KillOutcome};
use crate::persist::outbox::LastError;
use crate::persist::Store;
use crate::state::doc_manager::{DocCommand, DocManager, SubmitResult};

#[derive(Clone)]
pub(super) struct RuntimeClosure {
    store: Arc<Store>,
    doc: Arc<DocManager>,
    instance: Arc<InstanceRegistry>,
    chats: ChatRegistry,
}

pub(super) struct CloseRuntimeRequest {
    pub command_id: Uuid,
    pub chat_id: String,
}

pub(super) struct CloseRuntimeFailure {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub audit_outcome: &'static str,
}

impl RuntimeClosure {
    pub fn new(
        store: Arc<Store>,
        doc: Arc<DocManager>,
        instance: Arc<InstanceRegistry>,
        chats: ChatRegistry,
    ) -> Self {
        Self {
            store,
            doc,
            instance,
            chats,
        }
    }

    pub async fn execute(&self, request: CloseRuntimeRequest) -> Result<(), CloseRuntimeFailure> {
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
                .retryable_failure(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "close intent could not be persisted",
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
        let kill = InstanceKill {
            command_id: request.command_id.to_string(),
            chat_id: request.chat_id.clone(),
            grace: None,
        };
        let kill_ok = match self.instance.send_kill(&entry.instance_id, kill).await {
            Ok(KillOutcome::Acked(ack)) => ack.ok,
            Err(error) => {
                let code = instance_error_code(&error);
                if code == ErrorCode::InstanceOffline {
                    let _ = self.chats.request_close_offline(&request.chat_id).await;
                }
                return self
                    .retryable_failure(
                        &store,
                        request.command_id,
                        code,
                        "runtime kill was not confirmed",
                        "kill_not_confirmed",
                    )
                    .await;
            }
        };
        if !kill_ok {
            return self
                .retryable_failure(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "runtime kill was rejected",
                    "kill_rejected",
                )
                .await;
        }

        if store
            .outbox()
            .lock()
            .await
            .mark_dispatched(request.command_id, Utc::now())
            .is_err()
        {
            return self
                .retryable_failure(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "kill succeeded but dispatch state was not persisted",
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
                .retryable_failure(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "kill succeeded but delivery state was not persisted",
                    "delivery_persist_failed",
                )
                .await;
        }

        if !matches!(
            self.doc
                .submit_command(
                    &request.chat_id,
                    DocCommand::SetChatTerminal {
                        status: peri_studio_proto::schema::ChatStatus::Closed,
                    },
                )
                .await,
            SubmitResult::Applied(_)
        ) {
            return self
                .retryable_failure(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "runtime was killed but the closed projection was not persisted",
                    "projection_persist_failed",
                )
                .await;
        }
        if store
            .outbox()
            .lock()
            .await
            .mark_projection_committed(request.command_id)
            .is_err()
        {
            return self
                .retryable_failure(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "closed projection succeeded but its barrier was not persisted",
                    "projection_barrier_failed",
                )
                .await;
        }
        if self
            .chats
            .transition(&request.chat_id, ChatState::Closed)
            .await
            .is_err()
        {
            return self
                .retryable_failure(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "closed registry projection could not be persisted",
                    "registry_transition_failed",
                )
                .await;
        }
        // 终态语义：Registry 已达成 terminal；outbox 完成迁移。
        if store
            .outbox()
            .lock()
            .await
            .mark_completed(request.command_id)
            .is_err()
        {
            return self
                .retryable_failure(
                    &store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "close completion could not be persisted",
                    "completion_persist_failed",
                )
                .await;
        }

        // Durable close is already complete. Teardown is idempotent and must
        // not turn a committed close back into an unobservable command.
        let _ = self.doc.close_chat(&request.chat_id).await;
        Ok(())
    }

    async fn retryable_failure(
        &self,
        store: &Arc<crate::persist::ChatStore>,
        command_id: Uuid,
        code: ErrorCode,
        message: &str,
        audit_outcome: &'static str,
    ) -> Result<(), CloseRuntimeFailure> {
        let durable_retry = {
            let mut outbox = store.outbox().lock().await;
            if outbox
                .mark_failed(command_id, LastError::from_error_code(code))
                .is_err()
            {
                false
            } else if outbox.get(command_id).is_some() {
                outbox.clear_for_retry(command_id).is_ok()
            } else {
                true
            }
        };
        if durable_retry {
            Err(failure(
                code,
                message,
                code.default_retryable(),
                audit_outcome,
            ))
        } else {
            Err(failure(
                ErrorCode::DeliveryUnknown,
                "close terminal storage is degraded; retry is blocked until restart reconciliation",
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
    ) -> Result<(), CloseRuntimeFailure> {
        let mut last_error = LastError::from_error_code(code);
        last_error.retryable = false;
        if store
            .outbox()
            .lock()
            .await
            .mark_failed(command_id, last_error)
            .is_err()
        {
            return Err(failure(
                ErrorCode::DeliveryUnknown,
                "close failure could not be persisted",
                false,
                "failure_persist_unknown",
            ));
        }
        Err(failure(code, message, false, audit_outcome))
    }
}

fn instance_error_code(error: &InstanceError) -> ErrorCode {
    match error {
        InstanceError::Offline => ErrorCode::InstanceOffline,
        InstanceError::Timeout
        | InstanceError::ForwardRejected(_)
        | InstanceError::UnknownInstance(_)
        | InstanceError::ConnectionGone => ErrorCode::AgentUnavailable,
        // 协议形态错误：确定性失败（非 retryable，与 default_retryable 一致）。
        InstanceError::MalformedFrame(_) => ErrorCode::InvalidState,
    }
}

fn failure(
    code: ErrorCode,
    message: impl Into<String>,
    retryable: bool,
    audit_outcome: &'static str,
) -> CloseRuntimeFailure {
    CloseRuntimeFailure {
        code,
        message: message.into(),
        retryable,
        audit_outcome,
    }
}
