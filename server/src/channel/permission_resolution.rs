//! Durable permission-decision lifecycle.
//!
//! This module owns exact recovery evidence, the Control Doc CAS, the
//! no-redelivery barrier, official/legacy ACP response tracks and terminal
//! outbox ordering. It deliberately owns no client sender, auth context or
//! audit policy; callers only translate its structured outcome to wire frames.
//!
//! 拆分说明（纯结构拆分，行为语义不变）：
//! - `permission_resolution_terminal`：official / legacy 两条交付轨道的终态收尾
//!   （`finish_official` / `finish_legacy`），与主流程 `execute` 分离；
//! - `permission_resolution_failure`：终态失败与交付未知的失败落库样板
//!   （`terminal_failed` / `delivery_unknown`）。
//!   本文件保留 `execute` 主流程、类型定义与模块内共享自由函数。

#[path = "permission_resolution_failure.rs"]
mod permission_resolution_failure;
#[path = "permission_resolution_terminal.rs"]
mod permission_resolution_terminal;

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use uuid::Uuid;

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::PermissionDecision;

use crate::channel::relay_event_handler::RelayEventHandler;
use crate::control::{ChatRegistry, InstanceError, InstanceRegistry};
use crate::persist::outbox::{CommandRecovery, LastError};
use crate::persist::Store;
use crate::protocol::Translator;
use crate::state::aggregator::ApplyReason;
use crate::state::doc_manager::{DocCommand, DocManager, SubmitError, SubmitResult};

#[derive(Clone)]
pub(super) struct PermissionResolution {
    store: Arc<Store>,
    doc: Arc<DocManager>,
    chats: ChatRegistry,
    relay: Arc<RelayEventHandler>,
    instance: Arc<InstanceRegistry>,
    translator: Arc<Translator>,
    l3_timeout: Duration,
}

pub(super) struct PermissionResolutionRequest {
    pub command_id: Uuid,
    pub chat_id: String,
    pub permission_id: String,
    pub decision: PermissionDecision,
    pub option_id: Option<String>,
}

pub(super) enum PermissionResolutionOutcome {
    Committed,
    Duplicate,
}

#[derive(Debug)]
pub(super) struct PermissionResolutionFailure {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub audit_outcome: &'static str,
}

impl PermissionResolution {
    pub fn new(
        store: Arc<Store>,
        doc: Arc<DocManager>,
        chats: ChatRegistry,
        relay: Arc<RelayEventHandler>,
        instance: Arc<InstanceRegistry>,
        translator: Arc<Translator>,
        l3_timeout: Duration,
    ) -> Self {
        Self {
            store,
            doc,
            chats,
            relay,
            instance,
            translator,
            l3_timeout,
        }
    }

    pub async fn execute(
        &self,
        request: PermissionResolutionRequest,
    ) -> Result<PermissionResolutionOutcome, PermissionResolutionFailure> {
        let command_id_text = request.command_id.to_string();
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
                "chat_not_found",
            )
        })?;

        let persisted_recovery = store
            .outbox_get(request.command_id)
            .await
            .and_then(|record| record.recovery.map(|recovery| *recovery));
        let live_option_valid = self
            .relay
            .permission_option_valid(
                &request.permission_id,
                &request.chat_id,
                request.decision,
                request.option_id.as_deref(),
            )
            .await;
        let recovery_option_valid = match (&persisted_recovery, request.option_id.as_deref()) {
            (_, None) => true,
            (
                Some(CommandRecovery::PermissionResponse {
                    permission_id,
                    options,
                    decision,
                    option_id,
                    ..
                }),
                Some(selected),
            ) => {
                permission_id == &request.permission_id
                    && *decision == request.decision
                    && option_id.as_deref() == Some(selected)
                    && crate::protocol::permission_option_matches(
                        options,
                        request.decision,
                        selected,
                    )
            }
            _ => false,
        };
        if !live_option_valid.unwrap_or(recovery_option_valid) {
            return Err(failure(
                ErrorCode::InvalidState,
                "permission optionId does not match the pending request",
                false,
                "invalid_option_id",
            ));
        }

        if persisted_recovery.is_none()
            && store
                .outbox()
                .lock()
                .await
                .mark_intent_durable(request.command_id)
                .is_err()
        {
            let cleared = store
                .outbox()
                .lock()
                .await
                .mark_failed(
                    request.command_id,
                    LastError::from_error_code(ErrorCode::AgentUnavailable),
                )
                .is_ok();
            return Err(if cleared {
                failure(
                    ErrorCode::AgentUnavailable,
                    "permission intent could not be persisted",
                    true,
                    "intent_persist_failed",
                )
            } else {
                failure(
                    ErrorCode::DeliveryUnknown,
                    "permission command storage is degraded; retry is blocked",
                    false,
                    "intent_terminal_unknown",
                )
            });
        }

        let live_permission = self
            .relay
            .claim_pending_permission(
                &request.permission_id,
                &request.chat_id,
                &command_id_text,
                request.decision,
                request.option_id.as_deref(),
            )
            .await;
        let recovery = live_permission
            .as_ref()
            .map(|permission| CommandRecovery::PermissionResponse {
                permission_id: request.permission_id.clone(),
                request_id: permission.request_id.clone(),
                options: permission.options.clone(),
                decision: request.decision,
                option_id: request.option_id.clone(),
            })
            .or(persisted_recovery);
        if let Some(evidence) = recovery.clone() {
            if store
                .outbox()
                .lock()
                .await
                .set_recovery(request.command_id, evidence)
                .is_err()
            {
                let cleared = store
                    .outbox()
                    .lock()
                    .await
                    .mark_failed(
                        request.command_id,
                        LastError::from_error_code(ErrorCode::AgentUnavailable),
                    )
                    .is_ok();
                return Err(if cleared {
                    failure(
                        ErrorCode::AgentUnavailable,
                        "permission recovery evidence could not be persisted",
                        true,
                        "recovery_persist_failed",
                    )
                } else {
                    failure(
                        ErrorCode::DeliveryUnknown,
                        "permission recovery storage is degraded; retry is blocked",
                        false,
                        "recovery_terminal_unknown",
                    )
                });
            }
        }

        let replay_same_decision = match self
            .doc
            .submit_command(
                &request.chat_id,
                DocCommand::ResolvePermission {
                    permission_id: request.permission_id.clone(),
                    decision: request.decision,
                },
            )
            .await
        {
            SubmitResult::Applied(result)
                if !result.applied
                    && result.reason == Some(ApplyReason::PermissionDecisionReplay) =>
            {
                true
            }
            SubmitResult::Applied(result) if !result.applied => {
                if store
                    .outbox()
                    .lock()
                    .await
                    .clear_for_retry(request.command_id)
                    .is_err()
                {
                    return self
                        .delivery_unknown(
                            &store,
                            request.command_id,
                            "duplicate permission command cleanup could not be persisted",
                            "duplicate_cleanup_failed",
                        )
                        .await;
                }
                return Ok(PermissionResolutionOutcome::Duplicate);
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
                if recovery.is_some() {
                    return Err(failure(
                        ErrorCode::AgentUnavailable,
                        "permission decision projection could not be persisted",
                        true,
                        "cas_persist_failed",
                    ));
                }
                return self
                    .delivery_unknown(
                        &store,
                        request.command_id,
                        "legacy permission projection is uncertain; retry is blocked",
                        "legacy_cas_persist_unknown",
                    )
                    .await;
            }
            _ => false,
        };

        if replay_same_decision && recovery.is_none() {
            if store
                .outbox()
                .lock()
                .await
                .clear_for_retry(request.command_id)
                .is_err()
            {
                return self
                    .delivery_unknown(
                        &store,
                        request.command_id,
                        "duplicate permission command cleanup could not be persisted",
                        "duplicate_cleanup_failed",
                    )
                    .await;
            }
            return Ok(PermissionResolutionOutcome::Duplicate);
        }
        let Some(entry) = self.chats.entry(&request.chat_id).await else {
            return self
                .delivery_unknown(
                    &store,
                    request.command_id,
                    "the permission decision was projected but its ACP runtime is unavailable",
                    "runtime_missing",
                )
                .await;
        };

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
                    "permission dispatch barrier could not be persisted; retry is blocked",
                    "dispatch_barrier_failed",
                )
                .await;
        }

        match recovery {
            Some(CommandRecovery::PermissionResponse {
                permission_id,
                request_id,
                options,
                decision,
                option_id,
            }) => {
                if permission_id != request.permission_id
                    || decision != request.decision
                    || option_id != request.option_id
                {
                    return self
                        .terminal_failed(
                            &store,
                            request.command_id,
                            ErrorCode::InvalidState,
                            "permission recovery evidence mismatch",
                            "recovery_mismatch",
                        )
                        .await;
                }
                let message = self.translator.permission_response_rpc(
                    &request_id,
                    decision,
                    option_id.as_deref(),
                    &options,
                );
                match self
                    .instance
                    .forward_rpc(&entry.instance_id, &request.chat_id, &message)
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
                            .is_err()
                        {
                            return self
                                .delivery_unknown(
                                    &store,
                                    request.command_id,
                                    "permission delivery could not be proven absent",
                                    "barrier_clear_failed",
                                )
                                .await;
                        }
                        return Err(failure(
                            code,
                            "permission response was not delivered",
                            code.default_retryable(),
                            "definite_not_delivered",
                        ));
                    }
                    Err(_) => {
                        return self
                            .delivery_unknown(
                                &store,
                                request.command_id,
                                "permission response may have reached ACP; automatic retry is blocked",
                                "forward_unknown",
                            )
                            .await;
                    }
                }
                self.finish_official(&store, &request).await
            }
            Some(CommandRecovery::ElicitationResponse { .. }) => {
                self.terminal_failed(
                    &store,
                    request.command_id,
                    ErrorCode::InvalidState,
                    "permission recovery evidence has the wrong command kind",
                    "recovery_kind_mismatch",
                )
                .await
            }
            None => self.finish_legacy(&store, &entry, &request).await,
        }
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
) -> PermissionResolutionFailure {
    PermissionResolutionFailure {
        code,
        message: message.into(),
        retryable,
        audit_outcome,
    }
}
