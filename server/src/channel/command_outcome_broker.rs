//! Existing-command outcome replay and live terminal observation.
//!
//! This module owns the one process-local linearization point joining durable
//! outbox replay, missing-durable terminal fallback and replacement-connection
//! observers. Durable lifecycle transitions remain owned by the command
//! lifecycle modules.
//!
//! 拆分说明（纯结构拆分，行为语义不变）：
//! - `command_outcome_broker_terminal`：终态发布（`publish_terminal`）、终态
//!   响应构造与错误码映射（`terminal_response` / `action_error` 等）；
//! - `command_outcome_broker_recovery`：恢复证据轨道的判定（permission /
//!   elicitation 的 recovery disposition 与 payload 匹配）。
//!   本文件保留 `adjudicate_existing` 主流程（持锁重读线性化点）、观测者管理
//!   （`attach_observer`）、去重判定（`dedup_verdict`）与全部类型定义；
//!   测试模块声明保持在父文件，`use super::*` 的测试可见性不变。

#[path = "command_outcome_broker_recovery.rs"]
mod command_outcome_broker_recovery;
#[path = "command_outcome_broker_terminal.rs"]
mod command_outcome_broker_terminal;

use self::command_outcome_broker_terminal::{
    action_error, degraded_observer_error, initial_terminal_response, terminal_response,
};

use std::collections::HashMap;
use std::sync::Arc;

use peri_studio_proto::ack::{ActionAck, ActionError, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;
#[cfg(test)]
use tokio::sync::oneshot;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::channel::broadcaster::OutboundMsg;
use crate::channel::command_identity::prompt_payload_fingerprint;
use crate::control::ChatRegistry;
use crate::persist::outbox::{CommandRecovery, OutboxRecord, OutboxStatus};
use crate::persist::Store;

const MAX_OBSERVERS_PER_COMMAND: usize = 8;
const MAX_OBSERVERS_GLOBAL: usize = 256;
const MAX_TERMINAL_FALLBACKS: usize = 1_024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct OutcomeKey {
    chat_id: Uuid,
    command_id: Uuid,
}

#[derive(Default)]
struct OutcomeState {
    observers: HashMap<OutcomeKey, Vec<mpsc::Sender<OutboundMsg>>>,
    terminal_fallbacks: HashMap<OutcomeKey, ActionError>,
    terminal_fallback_overflow: bool,
}

#[derive(Clone)]
pub(super) struct CommandOutcomeBroker {
    store: Arc<Store>,
    chats: ChatRegistry,
    state: Arc<Mutex<OutcomeState>>,
    #[cfg(test)]
    pause_after_fallback_check: Arc<Mutex<Option<FallbackCheckPause>>>,
}

#[cfg(test)]
struct FallbackCheckPause {
    reached: oneshot::Sender<()>,
    resume: oneshot::Receiver<()>,
}

pub(super) struct ExistingCommandRequest<'a> {
    pub chat_id: Uuid,
    pub command_id: Uuid,
    pub command_id_text: &'a str,
    pub action: &'a ActionEnvelope,
    pub observer: mpsc::Sender<OutboundMsg>,
    pub duplicate_chat_id: Option<&'a str>,
}

#[derive(Debug)]
// `ActionAck` 可选携带资源写结果；保留响应值形态，避免改变既有恢复匹配语义。
#[allow(clippy::large_enum_variant)]
pub(super) enum ExistingCommandDisposition {
    Missing,
    ProceedNew,
    ResumePermission,
    ResumeElicitation,
    Respond(ExistingCommandResponse),
}

#[derive(Debug)]
// `ActionAck` 可携带 structural FS 结果；保持现有恢复响应形态。
#[allow(clippy::large_enum_variant)]
pub(super) enum ExistingCommandResponse {
    Accepted { command_id: String },
    Duplicate(ActionAck),
    Failed(ActionError),
}

pub(super) enum TerminalOutcome {
    Committed {
        turn_id: Option<String>,
        chat_id: Option<String>,
    },
    Error(ActionError),
}

pub(super) struct TerminalPublication<'a> {
    pub command_id_text: &'a str,
    pub chat_id: Option<Uuid>,
    pub original: &'a mpsc::Sender<OutboundMsg>,
    pub outcome: TerminalOutcome,
}

impl CommandOutcomeBroker {
    pub fn new(store: Arc<Store>, chats: ChatRegistry) -> Self {
        Self {
            store,
            chats,
            state: Arc::new(Mutex::new(OutcomeState::default())),
            #[cfg(test)]
            pause_after_fallback_check: Arc::new(Mutex::new(None)),
        }
    }

    /// Fail closed when admission cannot establish any terminal in the
    /// in-memory outbox state and no exact command-local fallback can be
    /// constructed.
    pub async fn mark_terminal_state_unavailable(&self) {
        self.state.lock().await.terminal_fallback_overflow = true;
    }

    pub async fn adjudicate_existing(
        &self,
        request: ExistingCommandRequest<'_>,
    ) -> ExistingCommandDisposition {
        let Some(store) = self.store.chat(request.chat_id) else {
            return ExistingCommandDisposition::Missing;
        };
        let Some(record) = store.outbox_get(request.command_id).await else {
            return ExistingCommandDisposition::Missing;
        };
        let key = OutcomeKey {
            chat_id: request.chat_id,
            command_id: request.command_id,
        };

        // Preserve immediate terminal/proceed behavior when no recovery
        // evidence exists. Recovery-bearing records must enter the locked
        // reread path because their evidence may be cleared by completion.
        if record.recovery.is_none() {
            match dedup_verdict(&record) {
                DedupVerdict::Duplicate
                | DedupVerdict::RedeliverFailed
                | DedupVerdict::RedeliverUnknown => {
                    return ExistingCommandDisposition::Respond(
                        initial_terminal_response(
                            request.command_id_text,
                            &record,
                            request.duplicate_chat_id,
                        )
                        .expect("terminal verdict has a terminal response"),
                    );
                }
                DedupVerdict::InProgress => {}
            }
        }

        let mut state = self.state.lock().await;
        if state.terminal_fallback_overflow {
            return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(
                degraded_observer_error(request.command_id_text),
            ));
        }
        if let Some(error) = state.terminal_fallbacks.get(&key).cloned() {
            return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(error));
        }
        #[cfg(test)]
        self.wait_at_fallback_check_barrier().await;

        // Intentionally await while holding the outcome-state mutex.
        // Publication uses this same mutex, so terminal reread versus recovery
        // or observer attachment has one linearization order.
        let Some(latest) = store.outbox_get(request.command_id).await else {
            // A definite pre-dispatch retryable failure may tombstone the
            // command between reads. No terminal publisher remains, so a new
            // execution may own the cleared id; attaching would strand it.
            return ExistingCommandDisposition::ProceedNew;
        };
        if latest.recovery.is_some() {
            return match latest.recovery.as_deref() {
                Some(CommandRecovery::PermissionResponse { .. }) => {
                    self.permission_recovery_disposition(&latest, &request)
                        .await
                }
                Some(CommandRecovery::ElicitationResponse { .. }) => {
                    self.elicitation_recovery_disposition(&latest, &request)
                        .await
                }
                None => unreachable!(),
            };
        }

        match dedup_verdict(&latest) {
            DedupVerdict::Duplicate
            | DedupVerdict::RedeliverFailed
            | DedupVerdict::RedeliverUnknown => ExistingCommandDisposition::Respond(
                terminal_response(request.command_id_text, &latest, request.duplicate_chat_id)
                    .expect("terminal verdict has a terminal response"),
            ),
            DedupVerdict::InProgress => {
                if let ActionEnvelope::Prompt { payload, .. } = request.action {
                    let incoming = match prompt_payload_fingerprint(payload) {
                        Ok(value) => value,
                        Err(error) => {
                            return ExistingCommandDisposition::Respond(
                                ExistingCommandResponse::Failed(action_error(
                                    request.command_id_text,
                                    ErrorCode::InvalidState,
                                    &format!("prompt fingerprint failed: {error}"),
                                    false,
                                )),
                            );
                        }
                    };
                    if latest.payload_fingerprint.as_deref() != Some(incoming.as_str()) {
                        return ExistingCommandDisposition::Respond(
                            ExistingCommandResponse::Failed(action_error(
                                request.command_id_text,
                                ErrorCode::InvalidState,
                                "commandId payload conflicts with durable prompt intent",
                                false,
                            )),
                        );
                    }
                }
                if !attach_observer(&mut state.observers, key, request.observer) {
                    return ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(
                        action_error(
                            request.command_id_text,
                            ErrorCode::RateLimited,
                            "too many command observers",
                            false,
                        ),
                    ));
                }
                ExistingCommandDisposition::Respond(ExistingCommandResponse::Accepted {
                    command_id: request.command_id_text.to_string(),
                })
            }
        }
    }

    #[cfg(test)]
    async fn install_fallback_check_barrier(&self) -> (oneshot::Receiver<()>, oneshot::Sender<()>) {
        let (reached_tx, reached_rx) = oneshot::channel();
        let (resume_tx, resume_rx) = oneshot::channel();
        *self.pause_after_fallback_check.lock().await = Some(FallbackCheckPause {
            reached: reached_tx,
            resume: resume_rx,
        });
        (reached_rx, resume_tx)
    }

    #[cfg(test)]
    async fn wait_at_fallback_check_barrier(&self) {
        let pause = self.pause_after_fallback_check.lock().await.take();
        if let Some(pause) = pause {
            let _ = pause.reached.send(());
            let _ = pause.resume.await;
        }
    }
}

fn attach_observer(
    observers: &mut HashMap<OutcomeKey, Vec<mpsc::Sender<OutboundMsg>>>,
    key: OutcomeKey,
    observer: mpsc::Sender<OutboundMsg>,
) -> bool {
    observers
        .values_mut()
        .for_each(|senders| senders.retain(|sender| !sender.is_closed()));
    let total = observers.values().map(Vec::len).sum::<usize>();
    let entry = observers.entry(key).or_default();
    if entry.iter().any(|sender| sender.same_channel(&observer)) {
        return true;
    }
    if entry.len() >= MAX_OBSERVERS_PER_COMMAND || total >= MAX_OBSERVERS_GLOBAL {
        return false;
    }
    entry.push(observer);
    true
}

fn dedup_verdict(record: &OutboxRecord) -> DedupVerdict {
    match record.status {
        OutboxStatus::Completed => DedupVerdict::Duplicate,
        OutboxStatus::Failed => DedupVerdict::RedeliverFailed,
        // Intrinsic idempotence does not transfer executor ownership. While an
        // unknown record exists, admitting the same command as new would
        // collide with that durable identity. Lifecycle/startup recovery must
        // first retire the old record before a safe command can be redelivered.
        OutboxStatus::DeliveryUnknown => DedupVerdict::RedeliverUnknown,
        OutboxStatus::Received
        | OutboxStatus::Accepted
        | OutboxStatus::IntentDurable
        | OutboxStatus::Dispatched
        | OutboxStatus::DeliveryConfirmed
        | OutboxStatus::ProjectionCommitted => DedupVerdict::InProgress,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DedupVerdict {
    Duplicate,
    RedeliverFailed,
    RedeliverUnknown,
    InProgress,
}

#[cfg(test)]
#[path = "command_outcome_broker_test.rs"]
mod command_outcome_broker_test;
