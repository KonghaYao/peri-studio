//! ACP session catalog query and background synchronization.
//!
//! This module owns the shared `session/list` transport semantics used by the
//! interactive compatibility action and the legacy Registry projection poller.
//! Logical project-session ownership remains in [`ProjectService`]; this layer
//! only reads ACP catalog facts and refreshes exact durable identities.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, RwLock};
use tracing::{debug, warn};

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::action::SessionListPayload;
use peri_studio_proto::frame::Frame;
use peri_studio_proto::schema::SessionSummaryProjection;
use peri_studio_proto::session::SessionListFrame;

use crate::auth::audit::audit;
use crate::auth::ConnectionCtx;
use crate::channel::broadcaster::OutboundMsg;
use crate::channel::relay_event_handler::RelayEventHandler;
use crate::control::{ChatRecord, ChatRegistry, InstanceRegistry, ProjectService};
use crate::protocol::Translator;

#[derive(Debug, Clone, Copy)]
pub(super) struct SessionCatalogConfig {
    pub poll_interval: Duration,
    pub request_timeout: Duration,
}

#[derive(Clone)]
pub(super) struct SessionCatalogSync {
    chats: ChatRegistry,
    instance: Arc<InstanceRegistry>,
    relay: Arc<RelayEventHandler>,
    translator: Arc<Translator>,
    projects: Arc<RwLock<Option<ProjectService>>>,
    config: SessionCatalogConfig,
}

struct InteractiveQuery {
    command_id: String,
    token_id: String,
    chat_id: String,
    instance_id: String,
    cwd: String,
    current_active: Option<String>,
    tx: mpsc::Sender<OutboundMsg>,
}

impl SessionCatalogSync {
    pub fn new(
        chats: ChatRegistry,
        instance: Arc<InstanceRegistry>,
        relay: Arc<RelayEventHandler>,
        translator: Arc<Translator>,
        projects: Arc<RwLock<Option<ProjectService>>>,
        config: SessionCatalogConfig,
    ) -> Self {
        Self {
            chats,
            instance,
            relay,
            translator,
            projects,
            config,
        }
    }

    /// Validate the target synchronously, then start one read-only ACP query.
    /// `Ok(())` means the caller may emit Accepted; the terminal list/error
    /// frame is delivered through `tx` by the spawned task.
    pub async fn query(
        &self,
        ctx: &ConnectionCtx,
        payload: &SessionListPayload,
        tx: mpsc::Sender<OutboundMsg>,
        command_id: &str,
    ) -> Result<(), ActionError> {
        let Some(record) = self.chats.entry(&payload.chat_id).await else {
            return Err(action_error(
                command_id,
                ErrorCode::ChatNotFound,
                "chat not found",
                false,
            ));
        };
        if record.state.is_terminal() || record.session_id.is_none() {
            return Err(action_error(
                command_id,
                ErrorCode::InvalidState,
                "chat has no active ACP process",
                false,
            ));
        }

        let task = self.clone();
        let query = InteractiveQuery {
            command_id: command_id.to_string(),
            token_id: ctx.token_id.clone(),
            chat_id: payload.chat_id.clone(),
            instance_id: record.instance_id,
            cwd: record.cwd,
            current_active: record.session_id,
            tx,
        };
        tokio::spawn(async move {
            task.run_interactive_query(query).await;
        });
        Ok(())
    }

    async fn run_interactive_query(&self, query: InteractiveQuery) {
        let started = std::time::Instant::now();
        let result = self
            .request(&query.instance_id, &query.chat_id, &query.cwd)
            .await;
        match result {
            Ok(mut entries) => {
                for entry in &mut entries {
                    entry.bound_chat_id = (Some(entry.session_id.as_str())
                        == query.current_active.as_deref())
                    .then(|| query.chat_id.clone());
                }
                self.refresh_catalog_entries(&query.cwd, &entries).await;
                audit(
                    "session.list",
                    Some(&query.command_id),
                    Some(&query.token_id),
                    "ok",
                    started.elapsed(),
                    None,
                );
                let _ = query
                    .tx
                    .send(OutboundMsg::Frame(Frame::SessionList(SessionListFrame {
                        command_id: query.command_id,
                        chat_id: query.chat_id,
                        sessions: entries,
                    })))
                    .await;
            }
            Err(QueryFailure::Forward(error)) => {
                audit(
                    "session.list",
                    Some(&query.command_id),
                    Some(&query.token_id),
                    "forward_failed",
                    started.elapsed(),
                    None,
                );
                let _ = query
                    .tx
                    .send(OutboundMsg::Frame(Frame::ActionError(action_error(
                        &query.command_id,
                        ErrorCode::InstanceOffline,
                        &format!("session list forward failed: {error}"),
                        true,
                    ))))
                    .await;
            }
            Err(QueryFailure::Response) => {
                audit(
                    "session.list",
                    Some(&query.command_id),
                    Some(&query.token_id),
                    "timeout",
                    started.elapsed(),
                    None,
                );
                let _ = query
                    .tx
                    .send(OutboundMsg::Frame(Frame::ActionError(action_error(
                        &query.command_id,
                        ErrorCode::AgentUnavailable,
                        "session list query timeout",
                        true,
                    ))))
                    .await;
            }
        }
    }

    pub fn spawn_poller(&self) {
        let task = self.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(task.config.poll_interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            ticker.tick().await;
            loop {
                ticker.tick().await;
                task.poll_once().await;
            }
        });
    }

    async fn poll_once(&self) {
        for ((instance_id, cwd), chat_id) in select_poll_targets(self.chats.all_chats().await) {
            let task = self.clone();
            tokio::spawn(async move {
                task.poll_target(&instance_id, &chat_id, &cwd).await;
            });
        }
    }

    async fn poll_target(&self, instance_id: &str, chat_id: &str, cwd: &str) {
        match self.request(instance_id, chat_id, cwd).await {
            Ok(entries) => {
                self.refresh_catalog_entries(cwd, &entries).await;
                if let Err(error) = self.chats.registry().apply_sessions(entries).await {
                    warn!(chat_id, instance_id, ?error, "session poll apply failed");
                }
            }
            Err(QueryFailure::Forward(error)) => {
                debug!(chat_id, instance_id, ?error, "session poll forward failed");
            }
            Err(QueryFailure::Response) => {
                debug!(chat_id, "session poll timeout");
            }
        }
    }

    async fn request(
        &self,
        instance_id: &str,
        chat_id: &str,
        cwd: &str,
    ) -> Result<Vec<SessionSummaryProjection>, QueryFailure> {
        let rpc_id = self.translator.alloc_rpc_id();
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": "session/list",
            "params": { "cwd": cwd },
        });
        let response = self
            .relay
            .register_rpc(&rpc_id, "session_list".to_string())
            .await;
        if let Err(error) = self
            .instance
            .forward_rpc(instance_id, chat_id, &message)
            .await
        {
            self.relay.cancel_rpc(&rpc_id).await;
            return Err(QueryFailure::Forward(error.to_string()));
        }
        match tokio::time::timeout(self.config.request_timeout, response).await {
            Ok(Ok(value)) if value.get("error").is_none() => {
                let mut entries = parse_session_list_response(&value);
                for entry in &mut entries {
                    entry.cwd = cwd.to_string();
                }
                Ok(entries)
            }
            _ => {
                self.relay.cancel_rpc(&rpc_id).await;
                Err(QueryFailure::Response)
            }
        }
    }

    async fn refresh_catalog_entries(&self, cwd: &str, entries: &[SessionSummaryProjection]) {
        let Some(projects) = self.projects.read().await.clone() else {
            return;
        };
        let Ok(project_list) = projects.metadata().list_projects().await else {
            return;
        };
        let Some(project) = project_list.into_iter().find(|p| p.cwd == cwd) else {
            return;
        };
        if let Err(error) = projects
            .refresh_project_catalog(&project.id, entries)
            .await
        {
            warn!(?error, "ACP session catalog refresh failed");
        }
    }
}

enum QueryFailure {
    Forward(String),
    Response,
}

/// Parse `result.sessions[]` from ACP session/list. Callers attach runtime cwd
/// and binding facts because those are query-context properties.
pub(super) fn parse_session_list_response(
    response: &serde_json::Value,
) -> Vec<SessionSummaryProjection> {
    let mut out = Vec::new();
    let Some(entries) = response
        .get("result")
        .and_then(|result| result.get("sessions"))
        .and_then(serde_json::Value::as_array)
    else {
        return out;
    };
    for entry in entries {
        let string_or = |camel: &str, snake: &str| -> String {
            entry
                .get(camel)
                .or_else(|| entry.get(snake))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let session_id = string_or("sessionId", "session_id");
        if session_id.is_empty() {
            continue;
        }
        out.push(SessionSummaryProjection {
            session_id,
            title: string_or("title", "title"),
            status: string_or("status", "status"),
            updated_at: string_or("updatedAt", "updated_at"),
            cwd: String::new(),
            bound_chat_id: None,
        });
    }
    out
}

fn select_poll_targets(chats: Vec<(String, ChatRecord)>) -> HashMap<(String, String), String> {
    let mut targets = HashMap::new();
    for (chat_id, record) in chats {
        // 轮询通道必须是「有存活证据的绑定 runtime」：未确认的 chat（如
        // server 重启重建、进程已退出）查询必然失败，跳过以免每轮向
        // instance 空发 session/list。
        if record.state.is_terminal() || record.session_id.is_none() || !record.runtime_confirmed {
            continue;
        }
        targets
            .entry((record.instance_id, record.cwd))
            .or_insert(chat_id);
    }
    targets
}

fn action_error(command_id: &str, code: ErrorCode, message: &str, retryable: bool) -> ActionError {
    ActionError {
        command_id: command_id.to_string(),
        code,
        message: message.to_string(),
        retryable,
        retry_after_ms: None,
    }
}

#[cfg(test)]
#[path = "session_catalog_sync_test.rs"]
mod session_catalog_sync_test;
