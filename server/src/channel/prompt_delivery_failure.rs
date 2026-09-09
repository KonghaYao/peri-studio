//! PromptDelivery 在 dispatch 前失败时的终结与投影。
//!
//! 本模块只处理“确认未投递”与对应的 delivery_unknown 降级；dispatch 后的
//! RPC 响应和成功终态屏障保留在 `prompt_delivery_finalize.rs`。

use std::sync::Arc;

use chrono::Utc;
use peri_studio_proto::ack::ErrorCode;
use tracing::warn;
use uuid::Uuid;

use crate::persist::outbox::{CommandType, LastError, OutboxStatus};
use crate::persist::ChatStore;
use crate::state::doc_manager::{DocCommand, SubmitResult};

use super::{
    unknown, PromptDelivery, PromptDeliveryFailure, PromptDeliveryOutcome, PromptDeliveryRequest,
};

impl PromptDelivery {
    pub(super) async fn fail_before_dispatch(
        &self,
        request: &PromptDeliveryRequest,
        store: &Arc<ChatStore>,
        code: ErrorCode,
        message: &str,
        retryable: bool,
    ) -> PromptDeliveryOutcome {
        // Retryable pre-dispatch failure tombstones the outbox by design. Keep
        // the exact turn identity before adjudication so the projected Pending
        // entry and active turn can still reach a definite terminal state.
        let turn_id = store
            .outbox_get(request.command_id)
            .await
            .filter(|record| record.command_type == CommandType::Prompt)
            .and_then(|record| record.turn_id);
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_failed(request.command_id, LastError::from_error_code(code))
        {
            warn!(chat_id = request.chat_id, ?error, "mark_failed failed");
            return self
                .delivery_unknown_for_turn(
                    request,
                    turn_id,
                    "the non-delivery verdict could not be persisted; automatic retry is blocked",
                )
                .await;
        }
        if store
            .outbox_get(request.command_id)
            .await
            .is_some_and(|record| record.status == OutboxStatus::DeliveryUnknown)
        {
            return self
                .delivery_unknown_for_turn(
                    request,
                    turn_id,
                    "delivery may have occurred; automatic retry is blocked",
                )
                .await;
        }
        if let Some(turn_id) = turn_id {
            self.project_delivery_for_turn(
                request,
                turn_id,
                "failed_not_delivered",
                Some(error_code_name(code)),
            )
            .await;
        }
        PromptDeliveryOutcome::Failed(PromptDeliveryFailure {
            code,
            message: message.to_string(),
            retryable: retryable && code.default_retryable(),
        })
    }

    async fn delivery_unknown_for_turn(
        &self,
        request: &PromptDeliveryRequest,
        turn_id: Option<Uuid>,
        message: &str,
    ) -> PromptDeliveryOutcome {
        if let Some(turn_id) = turn_id {
            self.project_delivery_for_turn(
                request,
                turn_id,
                "delivery_unknown",
                Some("DELIVERY_UNKNOWN"),
            )
            .await;
        }
        PromptDeliveryOutcome::Failed(unknown(message))
    }

    async fn project_delivery_for_turn(
        &self,
        request: &PromptDeliveryRequest,
        turn_id: Uuid,
        delivery_state: &str,
        delivery_error_code: Option<&str>,
    ) {
        let result = self
            .doc
            .submit_command(
                &request.chat_id,
                DocCommand::SetPromptEntryDelivery {
                    entry_id: format!("{turn_id}:user"),
                    delivery_state: delivery_state.to_string(),
                    delivery_error_code: delivery_error_code.map(str::to_string),
                    completed_at: (delivery_state == "failed_not_delivered")
                        .then(|| Utc::now().to_rfc3339()),
                },
            )
            .await;
        if matches!(result, SubmitResult::PersistFailed) {
            warn!(
                chat_id = request.chat_id,
                "prompt delivery projection persist failed"
            );
        }
    }
}

fn error_code_name(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::Unauthenticated => "UNAUTHENTICATED",
        ErrorCode::Forbidden => "FORBIDDEN",
        ErrorCode::ChatNotFound => "CHAT_NOT_FOUND",
        ErrorCode::InstanceOffline => "INSTANCE_OFFLINE",
        ErrorCode::VersionConflict => "VERSION_CONFLICT",
        ErrorCode::InvalidState => "INVALID_STATE",
        ErrorCode::RateLimited => "RATE_LIMITED",
        ErrorCode::AgentUnavailable => "AGENT_UNAVAILABLE",
        ErrorCode::DeliveryUnknown => "DELIVERY_UNKNOWN",
        ErrorCode::PayloadTooLarge => "PAYLOAD_TOO_LARGE",
        ErrorCode::UnsupportedFrame => "UNSUPPORTED_FRAME",
        _ => "INVALID_STATE",
    }
}
