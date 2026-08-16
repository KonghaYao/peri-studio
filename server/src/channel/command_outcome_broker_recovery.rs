//! 命令恢复证据轨道的判定（permission / elicitation）。
//!
//! 拆分动机：`adjudicate_existing` 主流程（持锁重读 + 观测者附着）与两条
//! 恢复证据轨道的判定逻辑合计超 500 行，按"恢复证据"主题拆出：
//! `permission_recovery_disposition` / `elicitation_recovery_disposition`
//! 及其 payload 指纹匹配函数。持锁等待重读的线性化语义、dispatch barrier
//! 检查与错误消息保持不变；方法可见性提升为 `pub(super)` 仅为了跨子模块
//! 调用，对外 pub 面不变。

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::ActionEnvelope;

use crate::channel::command_identity::elicitation_response_fingerprint;
use crate::channel::command_outcome_broker::{
    ExistingCommandDisposition, ExistingCommandRequest, ExistingCommandResponse,
};
use super::command_outcome_broker_terminal::action_error;
use crate::persist::outbox::{CommandRecovery, OutboxRecord, OutboxStatus};

impl super::CommandOutcomeBroker {
    pub(super) async fn permission_recovery_disposition(
        &self,
        record: &OutboxRecord,
        request: &ExistingCommandRequest<'_>,
    ) -> ExistingCommandDisposition {
        if !permission_recovery_payload_matches(record, request.action) {
            return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(
                action_error(
                    request.command_id_text,
                    ErrorCode::InvalidState,
                    "command payload conflicts with durable permission recovery evidence",
                    false,
                ),
            ));
        }
        if record.dispatch_barrier_at.is_some() {
            return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(
                action_error(
                    request.command_id_text,
                    ErrorCode::DeliveryUnknown,
                    "permission dispatch crossed the no-redelivery barrier; automatic retry is not permitted",
                    false,
                ),
            ));
        }
        if record.status != OutboxStatus::IntentDurable {
            return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(
                action_error(
                    request.command_id_text,
                    ErrorCode::DeliveryUnknown,
                    "permission delivery result is unknown; automatic retry is not permitted",
                    false,
                ),
            ));
        }
        if self
            .chats
            .entry(&request.chat_id.to_string())
            .await
            .is_none_or(|entry| entry.state.is_terminal())
        {
            return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(
                action_error(
                    request.command_id_text,
                    ErrorCode::DeliveryUnknown,
                    "the original runtime no longer exists; permission delivery requires operator reconciliation",
                    false,
                ),
            ));
        }
        ExistingCommandDisposition::ResumePermission
    }

    pub(super) async fn elicitation_recovery_disposition(
        &self,
        record: &OutboxRecord,
        request: &ExistingCommandRequest<'_>,
    ) -> ExistingCommandDisposition {
        if !elicitation_recovery_payload_matches(record, request.action) {
            return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(
                action_error(
                    request.command_id_text,
                    ErrorCode::InvalidState,
                    "command payload conflicts with durable elicitation response evidence",
                    false,
                ),
            ));
        }
        if record.dispatch_barrier_at.is_some() || record.status != OutboxStatus::IntentDurable {
            return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(
                action_error(
                    request.command_id_text,
                    ErrorCode::DeliveryUnknown,
                    "elicitation delivery crossed the no-redelivery boundary",
                    false,
                ),
            ));
        }
        if self
            .chats
            .entry(&request.chat_id.to_string())
            .await
            .is_none_or(|entry| entry.state.is_terminal())
        {
            return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(
                action_error(
                    request.command_id_text,
                    ErrorCode::DeliveryUnknown,
                    "the original elicitation runtime no longer exists",
                    false,
                ),
            ));
        }
        ExistingCommandDisposition::ResumeElicitation
    }
}

pub(super) fn permission_recovery_payload_matches(record: &OutboxRecord, action: &ActionEnvelope) -> bool {
    let ActionEnvelope::ResolvePermission { payload, .. } = action else {
        return false;
    };
    matches!(
        record.recovery.as_deref(),
        Some(CommandRecovery::PermissionResponse {
            permission_id,
            decision,
            ..
        }) if permission_id == &payload.permission_id && decision == &payload.decision
    )
}

pub(super) fn elicitation_recovery_payload_matches(record: &OutboxRecord, action: &ActionEnvelope) -> bool {
    let ActionEnvelope::RespondElicitation { payload, .. } = action else {
        return false;
    };
    let Ok(incoming) = elicitation_response_fingerprint(payload) else {
        return false;
    };
    matches!(
        record.recovery.as_deref(),
        Some(CommandRecovery::ElicitationResponse {
            elicitation_id,
            response_fingerprint,
            ..
        }) if elicitation_id == &payload.elicitation_id && response_fingerprint == &incoming
    )
}
