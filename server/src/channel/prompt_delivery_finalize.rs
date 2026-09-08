//! PromptDelivery 的响应等待与终态收尾（拆分自 prompt_delivery.rs，原文件 707 行）。
//!
//! 拆分动机：`execute` 主流程超过一屏且与终结路径主题混杂，本文件收敛
//! （1）`await_terminal`：dispatch 之后等待 ACP RPC 响应、按 active-turn 租赁与
//! 空闲时间判定 delivery unknown，并在成功时落 terminal 投影与 outbox 终态；
//! （2）失败终结方法族：fail_before_dispatch / delivery_unknown /
//! delivery_unknown_for_turn / project_delivery_for_turn，以及 error_code_name。
//! 前置校验、pending 投影与 dispatch 屏障保留在父模块 `prompt_delivery.rs`；
//! 方法由模块私有提升为 `pub(super)`（等价于拆分前父模块内的私有可见域），
//! 不改变任何分支语义、错误消息与日志文案。

use std::sync::Arc;

use chrono::Utc;
use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::schema::TurnStatus;
use tokio::sync::oneshot;
use tracing::warn;
use uuid::Uuid;

use crate::persist::outbox::{CommandType, LastError, OutboxStatus};
use crate::persist::ChatStore;
use crate::state::aggregator::ApplyReason;
use crate::state::doc_manager::{DocCommand, SubmitResult};

use super::{
    unknown, PromptDelivery, PromptDeliveryFailure, PromptDeliveryOutcome, PromptDeliveryRequest,
};
use super::prompt_delivery_public_error::public_error_from_prompt_response;

impl PromptDelivery {
    pub(super) async fn await_terminal(
        &self,
        request: &PromptDeliveryRequest,
        store: &Arc<ChatStore>,
        entry_id: &str,
        turn_id: Uuid,
        rpc_id: &str,
        response: &mut oneshot::Receiver<serde_json::Value>,
    ) -> PromptDeliveryOutcome {
        let rpc_result = loop {
            match tokio::time::timeout(self.inactivity_timeout, &mut *response).await {
                Ok(Ok(response)) => break Some(response),
                Ok(Err(_)) => break None,
                Err(_) => {
                    if self.chats.active_turn(&request.chat_id).await != Some(turn_id.to_string()) {
                        break None;
                    }
                    if self
                        .chats
                        .active_turn_idle(&request.chat_id)
                        .await
                        .is_none_or(|idle| idle > self.inactivity_timeout)
                    {
                        break None;
                    }
                }
            }
        };
        let Some(rpc_response) = rpc_result else {
            self.relay.cancel_rpc(rpc_id).await;
            if self.projected_turn_is_terminal(&request.chat_id, turn_id).await {
                return self
                    .commit_existing_terminal(request, store, entry_id, turn_id)
                    .await;
            }
            return self
                .delivery_unknown(
                    request,
                    store,
                    entry_id,
                    "delivery unknown; automatic retry not permitted (path B)",
                )
                .await;
        };
        if rpc_response.get("error").is_some() {
            if self.projected_turn_is_terminal(&request.chat_id, turn_id).await {
                return self
                    .commit_existing_terminal(request, store, entry_id, turn_id)
                    .await;
            }
            return self
                .delivery_unknown(
                    request,
                    store,
                    entry_id,
                    "ACP returned an error after accepting the prompt; replay is blocked",
                )
                .await;
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_delivery_confirmed(request.command_id)
        {
            warn!(
                chat_id = request.chat_id,
                ?error,
                "mark_delivery_confirmed failed"
            );
            return self
                .delivery_unknown(
                    request,
                    store,
                    entry_id,
                    "prompt completed but its delivery confirmation could not be persisted",
                )
                .await;
        }

        let terminal_status = match rpc_response
            .get("result")
            .and_then(|result| result.get("stopReason"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
        {
            "cancelled" => TurnStatus::Cancelled,
            "failed" | "error" => TurnStatus::Failed,
            _ => TurnStatus::Completed,
        };
        let turn_failed = matches!(terminal_status, TurnStatus::Failed);
        let public_error = public_error_from_prompt_response(&rpc_response, turn_failed);
        let terminal = self
            .doc
            .submit_command(
                &request.chat_id,
                DocCommand::SetTurnTerminal {
                    turn_id: turn_id.to_string(),
                    status: terminal_status,
                    completed_at: Utc::now().to_rfc3339(),
                    public_error,
                },
            )
            .await;
        if !matches!(
            terminal,
            SubmitResult::Applied(ref result)
                if result.applied || result.reason == Some(ApplyReason::DuplicateIdempotent)
        ) {
            if self.projected_turn_is_terminal(&request.chat_id, turn_id).await {
                return self
                    .commit_existing_terminal(request, store, entry_id, turn_id)
                    .await;
            }
            return self
                .delivery_unknown(
                    request,
                    store,
                    entry_id,
                    "prompt executed but its terminal projection was not durably committed",
                )
                .await;
        }
        if matches!(
            self.doc
                .submit_command(
                    &request.chat_id,
                    DocCommand::SetPromptEntryDelivery {
                        entry_id: entry_id.to_string(),
                        delivery_state: "completed".to_string(),
                        delivery_error_code: None,
                        completed_at: Some(Utc::now().to_rfc3339()),
                    },
                )
                .await,
            SubmitResult::PersistFailed | SubmitResult::Rejected(_)
        ) {
            return self
                .delivery_unknown(
                    request,
                    store,
                    entry_id,
                    "prompt completed but durable projection is uncertain",
                )
                .await;
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_projection_committed(request.command_id)
        {
            warn!(
                chat_id = request.chat_id,
                ?error,
                "mark_projection_committed failed"
            );
            return self
                .delivery_unknown(
                    request,
                    store,
                    entry_id,
                    "prompt projection exists but its commit barrier is uncertain",
                )
                .await;
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_completed(request.command_id)
        {
            warn!(chat_id = request.chat_id, ?error, "mark_completed failed");
            return self
                .delivery_unknown(
                    request,
                    store,
                    entry_id,
                    "prompt projection is durable but command completion is uncertain",
                )
                .await;
        }
        self.chats.clear_active_turn(&request.chat_id).await;
        PromptDeliveryOutcome::Committed { turn_id }
    }

    async fn projected_turn_is_terminal(&self, chat_id: &str, turn_id: Uuid) -> bool {
        let turn = turn_id.to_string();
        if self
            .doc
            .read_session_active_turn(chat_id)
            .await
            .is_some_and(|(active_id, status)| {
                active_id.as_deref() == Some(turn.as_str())
                    && matches!(
                        status.as_str(),
                        "completed" | "failed" | "cancelled" | "interrupted"
                    )
            })
        {
            return true;
        }
        // Session active_turn 可能已切走或清空；Chat Doc assistant 终态仍是精确证据。
        self.doc.read_chat_turn_terminal(chat_id, &turn).await
    }

    async fn commit_existing_terminal(
        &self,
        request: &PromptDeliveryRequest,
        store: &Arc<ChatStore>,
        entry_id: &str,
        turn_id: Uuid,
    ) -> PromptDeliveryOutcome {
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_delivery_confirmed(request.command_id)
        {
            if !self
                .outbox_reached(
                    store,
                    request.command_id,
                    &[
                        OutboxStatus::DeliveryConfirmed,
                        OutboxStatus::ProjectionCommitted,
                        OutboxStatus::Completed,
                    ],
                )
                .await
            {
                warn!(
                    chat_id = request.chat_id,
                    ?error,
                    "mark_delivery_confirmed after existing terminal failed"
                );
                return self
                    .delivery_unknown(
                        request,
                        store,
                        entry_id,
                        "prompt completed but its delivery confirmation could not be persisted",
                    )
                    .await;
            }
        }
        if matches!(
            self.doc
                .submit_command(
                    &request.chat_id,
                    DocCommand::SetPromptEntryDelivery {
                        entry_id: entry_id.to_string(),
                        delivery_state: "completed".to_string(),
                        delivery_error_code: None,
                        completed_at: Some(Utc::now().to_rfc3339()),
                    },
                )
                .await,
            SubmitResult::PersistFailed | SubmitResult::Rejected(_)
        ) {
            return self
                .delivery_unknown(
                    request,
                    store,
                    entry_id,
                    "prompt completed but durable projection is uncertain",
                )
                .await;
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_projection_committed(request.command_id)
        {
            if !self
                .outbox_reached(
                    store,
                    request.command_id,
                    &[OutboxStatus::ProjectionCommitted, OutboxStatus::Completed],
                )
                .await
            {
                warn!(
                    chat_id = request.chat_id,
                    ?error,
                    "mark_projection_committed after existing terminal failed"
                );
                return self
                    .delivery_unknown(
                        request,
                        store,
                        entry_id,
                        "prompt projection exists but its commit barrier is uncertain",
                    )
                    .await;
            }
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_completed(request.command_id)
        {
            if !self
                .outbox_reached(store, request.command_id, &[OutboxStatus::Completed])
                .await
            {
                warn!(
                    chat_id = request.chat_id,
                    ?error,
                    "mark_completed after existing terminal failed"
                );
                return self
                    .delivery_unknown(
                        request,
                        store,
                        entry_id,
                        "prompt projection is durable but command completion is uncertain",
                    )
                    .await;
            }
        }
        self.chats.clear_active_turn(&request.chat_id).await;
        PromptDeliveryOutcome::Committed { turn_id }
    }

    async fn outbox_reached(
        &self,
        store: &Arc<ChatStore>,
        command_id: Uuid,
        accepted: &[OutboxStatus],
    ) -> bool {
        store
            .outbox_get(command_id)
            .await
            .is_some_and(|record| accepted.contains(&record.status))
    }

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

    pub(super) async fn delivery_unknown(
        &self,
        request: &PromptDeliveryRequest,
        store: &Arc<ChatStore>,
        entry_id: &str,
        message: &str,
    ) -> PromptDeliveryOutcome {
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_delivery_unknown(request.command_id)
        {
            warn!(
                chat_id = request.chat_id,
                ?error,
                "mark_delivery_unknown failed"
            );
        }
        let projection = self
            .doc
            .submit_command(
                &request.chat_id,
                DocCommand::SetPromptEntryDelivery {
                    entry_id: entry_id.to_string(),
                    delivery_state: "delivery_unknown".to_string(),
                    delivery_error_code: Some("DELIVERY_UNKNOWN".to_string()),
                    completed_at: None,
                },
            )
            .await;
        if matches!(projection, SubmitResult::PersistFailed) {
            warn!(
                chat_id = request.chat_id,
                "prompt unknown projection persist failed"
            );
        }
        // 官方 ACP：回合只由 session/prompt 的 JSON-RPC result 结束。L3 丢失/
        // 超时不等于 turn 仍在跑——必须投影终态，否则 session.loading 卡住输入框。
        let turn_id = entry_id
            .strip_suffix(":user")
            .filter(|id| !id.is_empty())
            .unwrap_or(entry_id);
        let terminal = self
            .doc
            .submit_command(
                &request.chat_id,
                DocCommand::SetTurnTerminal {
                    turn_id: turn_id.to_string(),
                    status: TurnStatus::Failed,
                    completed_at: Utc::now().to_rfc3339(),
                    public_error: None,
                },
            )
            .await;
        if !matches!(
            terminal,
            SubmitResult::Applied(ref result)
                if result.applied || result.reason == Some(ApplyReason::DuplicateIdempotent)
        ) {
            warn!(
                chat_id = request.chat_id,
                "prompt unknown did not terminalize session.loading"
            );
        }
        self.chats.clear_active_turn(&request.chat_id).await;
        PromptDeliveryOutcome::Failed(unknown(message))
    }

    pub(super) async fn delivery_unknown_for_turn(
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

    pub(super) async fn project_delivery_for_turn(
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
