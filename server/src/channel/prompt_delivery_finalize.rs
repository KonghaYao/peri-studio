//! PromptDelivery 的响应等待与终态收尾（拆分自 prompt_delivery.rs，原文件 707 行）。
//!
//! 拆分动机：`execute` 主流程超过一屏且与终结路径主题混杂，本文件收敛
//! （1）`await_terminal`：dispatch 之后等待 ACP RPC 响应、按 active-turn 租赁与
//! 空闲时间判定 delivery unknown，并在成功时落 terminal 投影与 outbox 终态；
//! （2）`delivery_unknown`：dispatch 后无法确认结果时收束 outbox 与投影。
//! dispatch 前失败处理位于 `prompt_delivery_failure.rs`；前置校验、pending 投影与
//! dispatch 屏障保留在父模块 `prompt_delivery.rs`。

use std::sync::Arc;

use chrono::Utc;
use peri_studio_proto::schema::TurnStatus;
use tokio::sync::oneshot;
use tracing::warn;
use uuid::Uuid;

use crate::persist::outbox::OutboxStatus;
use crate::persist::ChatStore;
use crate::state::aggregator::ApplyReason;
use crate::state::doc_manager::{DocCommand, SubmitResult};

use super::prompt_delivery_public_error::public_error_from_prompt_response;
use super::{unknown, PromptDelivery, PromptDeliveryOutcome, PromptDeliveryRequest};

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
            if self
                .projected_turn_is_terminal(&request.chat_id, turn_id)
                .await
            {
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
            if self
                .projected_turn_is_terminal(&request.chat_id, turn_id)
                .await
            {
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
        let terminal_persist_failed = matches!(terminal, SubmitResult::PersistFailed);
        if !matches!(
            terminal,
            SubmitResult::Applied(ref result)
                if result.applied || result.reason == Some(ApplyReason::DuplicateIdempotent)
        ) {
            // PersistFailed 只代表 writer 内存已应用，不能把未落盘状态当作
            // “既有终态”越过第二持久屏障；只有拒绝路径才检查并发已有终态。
            if !terminal_persist_failed
                && self
                    .projected_turn_is_terminal(&request.chat_id, turn_id)
                    .await
            {
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
}
