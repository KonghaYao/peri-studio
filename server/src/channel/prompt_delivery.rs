//! Durable delivery lifecycle for one Hub-originated ACP prompt.
//!
//! The module owns the complete phase order across the outbox, Chat/Control
//! projection and ACP writer. Callers provide one validated command identity
//! and receive one already-adjudicated terminal result; they do not need to
//! know which side-effect boundary was crossed.
//!
//! 本文件按主题拆分（原 707 行 → 两个文件，均 ≤500 行）：类型定义、构造与
//! `execute` 主流程（前置校验、pending 投影、dispatch 屏障）保留在本文件；
//! 响应等待与终态收尾（`await_terminal`）及失败终结方法
//! （fail_before_dispatch/delivery_unknown 系列）见 [`super::prompt_delivery_finalize`]，
//! 其方法以 `pub(super)` 暴露（等价于拆分前父模块内的私有可见域），
//! 不改变任何分支语义。

use std::sync::Arc;
use std::time::Duration;

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::{ActionEnvelope, PromptChatPayload};
use chrono::Utc;
use tokio::sync::RwLock;
use tracing::warn;
use uuid::Uuid;

use crate::control::{ChatRegistry, InstanceRegistry, ProjectService};
use crate::persist::Store;
use crate::protocol::{OutboundCtx, OutboundMessage, Translator};
use crate::state::aggregator::ApplyReason;
use crate::state::doc_manager::{DocCommand, DocManager, SubmitError, SubmitResult};

use super::command_identity::prompt_payload_fingerprint;
use super::relay_event_handler::RelayEventHandler;

#[derive(Clone)]
pub(super) struct PromptDelivery {
    store: Arc<Store>,
    doc: Arc<DocManager>,
    instance: Arc<InstanceRegistry>,
    chats: ChatRegistry,
    relay: Arc<RelayEventHandler>,
    translator: Arc<Translator>,
    projects: Arc<RwLock<Option<ProjectService>>>,
    inactivity_timeout: Duration,
}

pub(super) struct PromptDeliveryDeps {
    pub store: Arc<Store>,
    pub doc: Arc<DocManager>,
    pub instance: Arc<InstanceRegistry>,
    pub chats: ChatRegistry,
    pub relay: Arc<RelayEventHandler>,
    pub translator: Arc<Translator>,
    pub projects: Arc<RwLock<Option<ProjectService>>>,
}

pub(super) struct PromptDeliveryRequest {
    pub command_id: Uuid,
    /// Exact wire identity retained for Yjs source correlation and ACP RPC
    /// metadata; it must not be silently canonicalized from the parsed UUID.
    pub command_id_text: String,
    pub chat_id: String,
    pub payload: PromptChatPayload,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PromptDeliveryFailure {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PromptDeliveryOutcome {
    Committed { turn_id: Uuid },
    Failed(PromptDeliveryFailure),
}

impl PromptDelivery {
    pub fn new(deps: PromptDeliveryDeps, inactivity_timeout: Duration) -> Self {
        Self {
            store: deps.store,
            doc: deps.doc,
            instance: deps.instance,
            chats: deps.chats,
            relay: deps.relay,
            translator: deps.translator,
            projects: deps.projects,
            inactivity_timeout,
        }
    }

    pub async fn execute(&self, request: PromptDeliveryRequest) -> PromptDeliveryOutcome {
        // A config mutation holds this gate through its Agent response and
        // projection. Conversely, once a prompt registers its active turn,
        // config validation observes that fact and rejects before dispatch.
        let runtime_guard = self.chats.runtime_transition_guard(&request.chat_id).await;
        if self.chats.active_turn(&request.chat_id).await.is_some() {
            return PromptDeliveryOutcome::Failed(PromptDeliveryFailure {
                code: ErrorCode::InvalidState,
                message: "another turn is already active".into(),
                retryable: false,
            });
        }
        let Some(chat_id) = Uuid::parse_str(&request.chat_id).ok() else {
            return PromptDeliveryOutcome::Failed(unknown(
                "prompt chat identity is invalid; automatic retry is blocked",
            ));
        };
        let Some(store) = self.store.chat(chat_id) else {
            return PromptDeliveryOutcome::Failed(unknown(
                "prompt evidence is unavailable; automatic retry is blocked",
            ));
        };
        let turn_id = store
            .outbox_get(request.command_id)
            .await
            .and_then(|record| record.turn_id)
            .unwrap_or_else(Uuid::new_v4);
        let entry_id = format!("{turn_id}:user");
        let fingerprint = match prompt_payload_fingerprint(&request.payload) {
            Ok(fingerprint) => fingerprint,
            Err(error) => {
                warn!(
                    chat_id = request.chat_id,
                    ?error,
                    "prompt fingerprint failed"
                );
                return self
                    .fail_before_dispatch(
                        &request,
                        &store,
                        ErrorCode::InvalidState,
                        "prompt fingerprint failed",
                        false,
                    )
                    .await;
            }
        };

        let created_at = Utc::now().to_rfc3339();
        match self
            .doc
            .submit_command(
                &request.chat_id,
                DocCommand::RegisterPendingPromptEntry {
                    turn_id: turn_id.to_string(),
                    entry_id: entry_id.clone(),
                    text: request.payload.message.clone(),
                    author_user_id: None,
                    source_command_id: request.command_id_text.clone(),
                    payload_fingerprint: fingerprint.clone(),
                    created_at,
                },
            )
            .await
        {
            SubmitResult::Applied(result)
                if result.reason == Some(ApplyReason::SourceCommandConflict) =>
            {
                return self
                    .fail_before_dispatch(
                        &request,
                        &store,
                        ErrorCode::InvalidState,
                        "prompt identity conflicts with durable projection",
                        false,
                    )
                    .await;
            }
            SubmitResult::PersistFailed => {
                return self
                    .fail_before_dispatch(
                        &request,
                        &store,
                        ErrorCode::AgentUnavailable,
                        "pending prompt projection persist failed",
                        true,
                    )
                    .await;
            }
            SubmitResult::Rejected(SubmitError::ChatNotFound) => {
                return self
                    .fail_before_dispatch(
                        &request,
                        &store,
                        ErrorCode::ChatNotFound,
                        "chat not found",
                        false,
                    )
                    .await;
            }
            SubmitResult::Rejected(SubmitError::QueueFull) => {
                return self
                    .fail_before_dispatch(
                        &request,
                        &store,
                        ErrorCode::RateLimited,
                        "prompt projection queue is full",
                        true,
                    )
                    .await;
            }
            SubmitResult::Rejected(SubmitError::ChannelClosed) => {
                return self
                    .fail_before_dispatch(
                        &request,
                        &store,
                        ErrorCode::AgentUnavailable,
                        "prompt projection writer is unavailable",
                        true,
                    )
                    .await;
            }
            _ => {}
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_prompt_intent_durable(request.command_id, fingerprint)
        {
            warn!(
                chat_id = request.chat_id,
                ?error,
                "mark_prompt_intent_durable failed"
            );
            return self
                .fail_before_dispatch(
                    &request,
                    &store,
                    ErrorCode::AgentUnavailable,
                    "prompt intent could not be persisted",
                    false,
                )
                .await;
        }

        let Some(chat) = self.chats.entry(&request.chat_id).await else {
            return self
                .fail_before_dispatch(
                    &request,
                    &store,
                    ErrorCode::ChatNotFound,
                    "chat not found",
                    false,
                )
                .await;
        };
        let Some(acp_session_id) = chat.session_id.clone() else {
            return self
                .fail_before_dispatch(
                    &request,
                    &store,
                    ErrorCode::InvalidState,
                    "chat binding not established",
                    false,
                )
                .await;
        };
        let action = ActionEnvelope::Prompt {
            command_id: request.command_id_text.clone(),
            payload: request.payload.clone(),
        };
        let message = match self.translator.translate(
            &action,
            &OutboundCtx {
                cwd: chat.cwd,
                acp_session_id: acp_session_id.clone(),
            },
        ) {
            Ok(OutboundMessage::JsonRpc(message)) => message,
            Ok(_) => {
                return self
                    .fail_before_dispatch(
                        &request,
                        &store,
                        ErrorCode::InvalidState,
                        "unexpected outbound shape",
                        false,
                    )
                    .await;
            }
            Err(error) => {
                warn!(
                    chat_id = request.chat_id,
                    ?error,
                    "prompt translation failed"
                );
                return self
                    .fail_before_dispatch(
                        &request,
                        &store,
                        ErrorCode::InvalidState,
                        "prompt translation failed",
                        false,
                    )
                    .await;
            }
        };
        let rpc_id = message["id"].as_str().unwrap_or_default().to_string();
        let mut response = self
            .relay
            .register_rpc(&rpc_id, request.command_id_text.clone())
            .await;

        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_dispatch_barrier(request.command_id, Utc::now())
        {
            warn!(
                chat_id = request.chat_id,
                ?error,
                "mark_dispatch_barrier failed"
            );
            self.relay.cancel_rpc(&rpc_id).await;
            return self
                .fail_before_dispatch(
                    &request,
                    &store,
                    ErrorCode::AgentUnavailable,
                    "prompt dispatch barrier could not be persisted",
                    false,
                )
                .await;
        }
        if let Err(error) = self
            .instance
            .forward_rpc(&chat.instance_id, &request.chat_id, &message)
            .await
        {
            warn!(
                chat_id = request.chat_id,
                ?error,
                "prompt forward outcome unknown after barrier"
            );
            self.relay.cancel_rpc(&rpc_id).await;
            return self
                .delivery_unknown(
                    &request,
                    &store,
                    &entry_id,
                    "prompt may have executed; retry is blocked",
                )
                .await;
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_dispatched(request.command_id, Utc::now())
        {
            warn!(chat_id = request.chat_id, ?error, "mark_dispatched failed");
            self.relay.cancel_rpc(&rpc_id).await;
            return self
                .delivery_unknown(
                    &request,
                    &store,
                    &entry_id,
                    "prompt was accepted by the instance but its delivery state could not be persisted",
                )
                .await;
        }
        self.chats
            .set_active_turn(&request.chat_id, &turn_id.to_string())
            .await;
        drop(runtime_guard);
        if let Some(projects) = self.projects.read().await.clone() {
            if let Err(error) = projects
                .seed_prompt_title(&acp_session_id, &request.payload.message)
                .await
            {
                warn!(
                    chat_id = request.chat_id,
                    ?error,
                    "prompt title projection failed"
                );
            }
        }

        self.await_terminal(&request, &store, &entry_id, turn_id, &rpc_id, &mut response)
            .await
    }
}

fn unknown(message: &str) -> PromptDeliveryFailure {
    PromptDeliveryFailure {
        code: ErrorCode::DeliveryUnknown,
        message: message.to_string(),
        retryable: false,
    }
}

#[path = "prompt_delivery_finalize.rs"]
mod prompt_delivery_finalize;
