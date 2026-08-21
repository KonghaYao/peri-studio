//! 命令终态发布与终态响应构造。
//!
//! 拆分动机：`adjudicate_existing` 主流程（持锁重读 + 观测者附着）与终态
//! 发布/响应构造合计超 500 行，按"终态"主题拆出：`publish_terminal`（含
//! missing-durable fallback 容量控制）与 `terminal_response` /
//! `initial_terminal_response` / `action_error` / `error_code_from_str` 等
//! 响应构造样板。gate 锁语义（发布与判定共用同一把 outcome-state 锁）与
//! 观测者 fan-out 顺序保持不变；`publish_terminal` 可见性为 `pub(crate)`，
//! 因调用方在 channel 层（terminal_io），类型本身仍为 `pub(super)`，
//! 对外 pub 面不变。

use peri_studio_proto::ack::{AckStatus, ActionAck, ActionError, ErrorCode};
use peri_studio_proto::frame::Frame;
use uuid::Uuid;

use crate::channel::broadcaster::OutboundMsg;
use crate::channel::command_outcome_broker::{
    CommandOutcomeBroker, ExistingCommandResponse, OutcomeKey, OutcomeState, TerminalOutcome,
    TerminalPublication, MAX_TERMINAL_FALLBACKS,
};
use crate::persist::outbox::{LastError, OutboxRecord, OutboxStatus};

impl CommandOutcomeBroker {
    pub(crate) async fn publish_terminal(&self, publication: TerminalPublication<'_>) {
        let outbound = match publication.outcome {
            TerminalOutcome::Committed { turn_id, chat_id } => {
                OutboundMsg::Frame(Frame::ActionAck(ActionAck {
                    command_id: publication.command_id_text.to_string(),
                    status: AckStatus::Committed,
                    turn_id,
                    chat_id,
                    project_id: None,
                    session_id: None,
                    acp_session_id: None,
                    committed_projection_version: None,
                }))
            }
            TerminalOutcome::Error(error) => OutboundMsg::Frame(Frame::ActionError(error)),
        };

        let key = publication.chat_id.and_then(|chat_id| {
            Uuid::parse_str(publication.command_id_text)
                .ok()
                .map(|command_id| OutcomeKey {
                    chat_id,
                    command_id,
                })
        });
        let observers = if let Some(key) = key {
            let mut state = self.state.lock().await;
            let missing_durable_unknown = matches!(
                &outbound,
                OutboundMsg::Frame(Frame::ActionError(error))
                    if error.code == ErrorCode::DeliveryUnknown
            ) && !self.durable_unknown(key).await;
            if missing_durable_unknown {
                if let OutboundMsg::Frame(Frame::ActionError(error)) = &outbound {
                    admit_terminal_fallback(&mut state, key, error.clone());
                }
            }
            state.observers.remove(&key).unwrap_or_default()
        } else {
            Vec::new()
        };

        let _ = publication.original.send(outbound.clone()).await;
        for observer in observers {
            if !observer.same_channel(publication.original) && !observer.is_closed() {
                let _ = observer.send(outbound.clone()).await;
            }
        }
    }

    async fn durable_unknown(&self, key: OutcomeKey) -> bool {
        let Some(store) = self.store.chat(key.chat_id) else {
            return false;
        };
        store
            .outbox_get(key.command_id)
            .await
            .is_some_and(|record| record.status == OutboxStatus::DeliveryUnknown)
    }
}

pub(super) fn admit_terminal_fallback(
    state: &mut OutcomeState,
    key: OutcomeKey,
    error: ActionError,
) {
    if state.terminal_fallbacks.len() >= MAX_TERMINAL_FALLBACKS
        && !state.terminal_fallbacks.contains_key(&key)
    {
        state.terminal_fallback_overflow = true;
    } else {
        state.terminal_fallbacks.insert(key, error);
    }
}

pub(super) fn degraded_observer_error(command_id: &str) -> ActionError {
    action_error(
        command_id,
        ErrorCode::DeliveryUnknown,
        "delivery terminal storage is degraded; observer attachment is blocked",
        false,
    )
}

pub(super) fn terminal_response(
    command_id: &str,
    record: &OutboxRecord,
    duplicate_chat_id: Option<&str>,
) -> Option<ExistingCommandResponse> {
    match record.status {
        OutboxStatus::Completed => Some(ExistingCommandResponse::Duplicate(ActionAck {
            command_id: command_id.to_string(),
            status: AckStatus::Duplicate,
            turn_id: record.turn_id.map(|turn| turn.to_string()),
            chat_id: duplicate_chat_id.map(str::to_string),
            project_id: None,
            session_id: None,
            acp_session_id: None,
            committed_projection_version: None,
        })),
        OutboxStatus::Failed => {
            let error = record
                .last_error
                .clone()
                .unwrap_or_else(|| LastError::from_error_code(ErrorCode::InvalidState));
            Some(ExistingCommandResponse::Failed(ActionError {
                command_id: command_id.to_string(),
                code: error_code_from_str(&error.code),
                message: "command previously failed; retry not permitted".to_string(),
                retryable: error.retryable,
                retry_after_ms: None,
            }))
        }
        OutboxStatus::DeliveryUnknown => Some(ExistingCommandResponse::Failed(action_error(
            command_id,
            ErrorCode::DeliveryUnknown,
            "delivery outcome is unknown; retry is blocked",
            false,
        ))),
        _ => None,
    }
}

pub(super) fn initial_terminal_response(
    command_id: &str,
    record: &OutboxRecord,
    duplicate_chat_id: Option<&str>,
) -> Option<ExistingCommandResponse> {
    if record.status == OutboxStatus::DeliveryUnknown {
        return Some(ExistingCommandResponse::Failed(action_error(
            command_id,
            ErrorCode::DeliveryUnknown,
            "delivery unknown; automatic retry not permitted (path B)",
            false,
        )));
    }
    terminal_response(command_id, record, duplicate_chat_id)
}

pub(super) fn action_error(
    command_id: &str,
    code: ErrorCode,
    message: &str,
    retryable: bool,
) -> ActionError {
    ActionError {
        command_id: command_id.to_string(),
        code,
        message: message.to_string(),
        retryable,
        retry_after_ms: None,
    }
}

pub(super) fn error_code_from_str(code: &str) -> ErrorCode {
    match code {
        "UNAUTHENTICATED" => ErrorCode::Unauthenticated,
        "FORBIDDEN" => ErrorCode::Forbidden,
        "CHAT_NOT_FOUND" => ErrorCode::ChatNotFound,
        "INSTANCE_OFFLINE" => ErrorCode::InstanceOffline,
        "VERSION_CONFLICT" => ErrorCode::VersionConflict,
        "INVALID_STATE" => ErrorCode::InvalidState,
        "RATE_LIMITED" => ErrorCode::RateLimited,
        "AGENT_UNAVAILABLE" => ErrorCode::AgentUnavailable,
        "DELIVERY_UNKNOWN" => ErrorCode::DeliveryUnknown,
        "PAYLOAD_TOO_LARGE" => ErrorCode::PayloadTooLarge,
        _ => ErrorCode::InvalidState,
    }
}
