//! Capability-gated, read-only Peri rewind queries.
//!
//! This module is intentionally narrower than rewind execution. It owns the
//! exact runtime/capability gate, the per-chat transition lease, ACP RPC
//! matching, and a second strict normalization boundary before any candidate
//! text or file path reaches a browser.
//!
//! 本文件按主题拆分（原 700 行 → 三个文件，均 ≤500 行）：查询侧
//! （SessionRewindQueries / SessionRewindQueryRun）与共享私有 helper
//! （validate_message_id、error）保留在本文件；执行侧
//! （SessionRewindExecution：submit/execute、ledger 终结、frame 构造）见
//! [`super::session_rewind_execution`]；响应归一化（candidates/preview/路径
//! 清洗）见 [`super::session_rewind_normalize`]。子模块项以 `pub(super)` 暴露
//! （等价于拆分前父模块内的私有可见域），不改变任何分支语义。

use std::sync::Arc;
use std::time::Duration;

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::action::{RewindCandidatesPayload, RewindPreviewPayload};
use peri_studio_proto::frame::Frame;
use serde::Serialize;
use tokio::sync::OwnedMutexGuard;

use crate::channel::relay_event_handler::RelayEventHandler;
use crate::channel::runtime_command_ledger::RuntimeCommandLedger;
use crate::channel::session_runtime_operations::SessionRuntimeOperations;
use crate::control::{ChatRecord, ChatRegistry, InstanceRegistry};
use crate::protocol::{Translator, PERI_REWIND_EXTENSION};

use session_rewind_normalize::{normalize_candidates, normalize_preview};

const MAX_CANDIDATES: usize = 64;
const MAX_PREVIEW_BYTES: usize = 1024;
const MAX_MESSAGE_ID_BYTES: usize = 128;
const MAX_FILE_CHANGES: usize = 64;
const MAX_PATH_BYTES: usize = 1024;
const REWIND_COMMAND_TYPE: &str = "chat/rewind";

#[derive(Clone)]
pub(super) struct SessionRewindQueries {
    chats: ChatRegistry,
    instance: Arc<InstanceRegistry>,
    relay: Arc<RelayEventHandler>,
    translator: Arc<Translator>,
    timeout: Duration,
}

#[derive(Clone)]
pub(super) struct SessionRewindExecution {
    queries: SessionRewindQueries,
    operations: SessionRuntimeOperations,
    ledger: RuntimeCommandLedger,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RewindFingerprint<'a> {
    schema: u8,
    command_type: &'static str,
    chat_id: &'a str,
    target_message_id: &'a str,
    preview_fingerprint: &'a str,
    revert_files: bool,
}

pub(super) struct SessionRewindQueryRun {
    queries: SessionRewindQueries,
    command_id: String,
    target: Target,
    kind: QueryKind,
    _guard: OwnedMutexGuard<()>,
}

struct Target {
    chat_id: String,
    instance_id: String,
    session_id: String,
}

enum QueryKind {
    Candidates,
    Preview { target_message_id: String },
}

impl SessionRewindQueries {
    pub fn new(
        chats: ChatRegistry,
        instance: Arc<InstanceRegistry>,
        relay: Arc<RelayEventHandler>,
        translator: Arc<Translator>,
        timeout: Duration,
    ) -> Self {
        Self {
            chats,
            instance,
            relay,
            translator,
            timeout,
        }
    }

    pub async fn start_candidates(
        &self,
        command_id: &str,
        payload: &RewindCandidatesPayload,
    ) -> Result<SessionRewindQueryRun, ActionError> {
        self.start(command_id, &payload.chat_id, QueryKind::Candidates)
            .await
    }

    pub async fn start_preview(
        &self,
        command_id: &str,
        payload: &RewindPreviewPayload,
    ) -> Result<SessionRewindQueryRun, ActionError> {
        validate_message_id(&payload.target_message_id)
            .map_err(|message| error(command_id, ErrorCode::InvalidState, message, false))?;
        self.start(
            command_id,
            &payload.chat_id,
            QueryKind::Preview {
                target_message_id: payload.target_message_id.clone(),
            },
        )
        .await
    }

    async fn start(
        &self,
        command_id: &str,
        chat_id: &str,
        kind: QueryKind,
    ) -> Result<SessionRewindQueryRun, ActionError> {
        // Acquire the same lease used by prompt/config/session transitions,
        // then re-read every runtime fact under it. Accepted is emitted only
        // after this method returns a run that owns the lease.
        let guard = self.chats.runtime_transition_guard(chat_id).await;
        let record = self.validate_target(command_id, chat_id).await?;
        Ok(SessionRewindQueryRun {
            queries: self.clone(),
            command_id: command_id.to_string(),
            target: Target {
                chat_id: chat_id.to_string(),
                instance_id: record.instance_id,
                session_id: record.session_id.expect("validated active ACP session"),
            },
            kind,
            _guard: guard,
        })
    }

    async fn validate_target(
        &self,
        command_id: &str,
        chat_id: &str,
    ) -> Result<ChatRecord, ActionError> {
        let Some(record) = self.chats.entry(chat_id).await else {
            return Err(error(
                command_id,
                ErrorCode::ChatNotFound,
                "chat not found",
                false,
            ));
        };
        if record.state.is_terminal() || record.session_id.is_none() {
            return Err(error(
                command_id,
                ErrorCode::InvalidState,
                "chat has no live ACP session",
                false,
            ));
        }
        if self.chats.active_turn(chat_id).await.is_some() {
            return Err(error(
                command_id,
                ErrorCode::InvalidState,
                "rewind preview is unavailable while Agent is running",
                false,
            ));
        }
        if !self
            .chats
            .supports_extension(chat_id, PERI_REWIND_EXTENSION)
            .await
        {
            return Err(error(
                command_id,
                ErrorCode::UnsupportedFrame,
                "Agent did not negotiate peri.rewind",
                false,
            ));
        }
        Ok(record)
    }
}

impl SessionRewindQueryRun {
    pub async fn execute(self) -> Result<Frame, ActionError> {
        let rpc_id = self.queries.translator.alloc_rpc_id();
        let (method, params) = match &self.kind {
            QueryKind::Candidates => (
                "session/rewind-candidates",
                serde_json::json!({ "sessionId": self.target.session_id }),
            ),
            QueryKind::Preview { target_message_id } => (
                "session/rewind-preview",
                serde_json::json!({
                    "sessionId": self.target.session_id,
                    "target_message_id": target_message_id,
                    "revert_files": true,
                }),
            ),
        };
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": method,
            "params": params,
        });
        let response = self
            .queries
            .relay
            .register_rpc(&rpc_id, self.command_id.clone())
            .await;
        if self
            .queries
            .instance
            .forward_rpc(&self.target.instance_id, &self.target.chat_id, &message)
            .await
            .is_err()
        {
            self.queries.relay.cancel_rpc(&rpc_id).await;
            return Err(error(
                &self.command_id,
                ErrorCode::AgentUnavailable,
                "rewind query could not reach Agent",
                true,
            ));
        }
        let response = match tokio::time::timeout(self.queries.timeout, response).await {
            Ok(Ok(response)) if response.get("error").is_none() => response,
            _ => {
                self.queries.relay.cancel_rpc(&rpc_id).await;
                return Err(error(
                    &self.command_id,
                    ErrorCode::AgentUnavailable,
                    "rewind query timed out or was rejected",
                    true,
                ));
            }
        };
        match self.kind {
            QueryKind::Candidates => {
                normalize_candidates(&self.command_id, &self.target.chat_id, &response)
            }
            QueryKind::Preview { target_message_id } => normalize_preview(
                &self.command_id,
                &self.target.chat_id,
                &target_message_id,
                &response,
            ),
        }
    }
}

fn validate_message_id(value: &str) -> Result<(), &'static str> {
    if value.is_empty()
        || value.len() > MAX_MESSAGE_ID_BYTES
        || value.chars().any(|character| character.is_control())
    {
        return Err("rewind target message id is invalid");
    }
    Ok(())
}

fn error(command_id: &str, code: ErrorCode, message: &str, retryable: bool) -> ActionError {
    ActionError {
        command_id: command_id.to_string(),
        code,
        message: message.to_string(),
        retryable,
        retry_after_ms: None,
    }
}

#[path = "session_rewind_execution.rs"]
mod session_rewind_execution;

#[path = "session_rewind_normalize.rs"]
mod session_rewind_normalize;

#[cfg(test)]
#[path = "session_rewind_test.rs"]
mod tests;
