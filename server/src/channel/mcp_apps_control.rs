//! MCP Apps 控制面：转发 `peri/mcp/open|resource|app`，管理内存 app session
//! 与瞬时 HTML（对标 OAuth 瞬时通道，不写 Chat Doc HTML）。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::action::{McpAppCallPayload, McpAppOpenPayload, McpAppResourcePayload};
use peri_studio_proto::frame::Frame;
use peri_studio_proto::mcp_apps::McpAppSessionFrame;
use peri_studio_proto::schema::{ToolCallProjection, ToolCallStatus};
use tokio::sync::{mpsc, RwLock};

use crate::channel::broadcaster::OutboundMsg;
use crate::channel::relay_event_handler::RelayEventHandler;
use crate::control::{ChatRegistry, InstanceRegistry, StoreSink};
use crate::protocol::{parse_mcp_tool_name, Translator};

/// Hub 侧 app session 内存绑定（不落盘；刷新/新 turn 销毁）。
#[derive(Debug, Clone)]
pub(super) struct LiveAppSession {
    chat_id: String,
    tool_call_id: String,
    server_id: String,
    resource_uri: String,
}

/// open 命令去重：同 commandId 不得二次消费 lease。
#[derive(Debug, Clone)]
pub(super) enum OpenCommandState {
    InFlight,
    Completed(McpAppSessionFrame),
    Failed(ActionError),
    DeliveryUnknown,
}

#[derive(Clone)]
pub(super) struct McpAppsControl {
    chats: ChatRegistry,
    instance: Arc<InstanceRegistry>,
    relay: Arc<RelayEventHandler>,
    translator: Arc<Translator>,
    sink: Arc<StoreSink>,
    timeout: Duration,
    sessions: Arc<RwLock<HashMap<String, LiveAppSession>>>,
    open_commands: Arc<RwLock<HashMap<String, OpenCommandState>>>,
}

impl McpAppsControl {
    pub fn new(
        chats: ChatRegistry,
        instance: Arc<InstanceRegistry>,
        relay: Arc<RelayEventHandler>,
        translator: Arc<Translator>,
        sink: Arc<StoreSink>,
        timeout: Duration,
    ) -> Self {
        Self {
            chats,
            instance,
            relay,
            translator,
            sink,
            timeout,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            open_commands: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 新 turn / cancel / close / chat 切换：拆除 live session 与 Hub 内存。
    pub async fn tear_down_chat(&self, chat_id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.retain(|_, session| session.chat_id != chat_id);
        drop(sessions);
        self.relay.clear_mcp_app_tool_results(chat_id).await;
    }

    pub async fn open(
        &self,
        command_id: &str,
        payload: &McpAppOpenPayload,
        tx: mpsc::Sender<OutboundMsg>,
        read_only: bool,
    ) -> Result<(), ActionError> {
        if read_only {
            return Err(silent_apps_error(command_id, "policy_denied"));
        }
        if let Some(existing) = self.open_commands.read().await.get(command_id) {
            return match existing {
                OpenCommandState::Completed(frame) => {
                    let _ = tx
                        .send(OutboundMsg::Frame(Frame::McpAppSession(frame.clone())))
                        .await;
                    Ok(())
                }
                OpenCommandState::Failed(error) => Err(error.clone()),
                OpenCommandState::DeliveryUnknown => Err(delivery_unknown(command_id)),
                OpenCommandState::InFlight => Ok(()),
            };
        }
        {
            let mut commands = self.open_commands.write().await;
            commands.insert(command_id.to_string(), OpenCommandState::InFlight);
        }
        let target = self.target(command_id, &payload.chat_id).await?;
        let tool = self
            .read_tool_call(&payload.chat_id, &payload.tool_call_id)
            .await
            .ok_or_else(|| {
                apps_error(command_id, ErrorCode::InvalidState, "tool call not found")
            })?;
        self.gate_open(command_id, &tool)?;
        let parsed = tool
            .mcp_server_id
            .as_deref()
            .zip(tool.mcp_tool_name.as_deref())
            .map(|(server_id, tool_name)| (server_id.to_string(), tool_name.to_string()))
            .or_else(|| {
                parse_mcp_tool_name(&tool.name)
                    .map(|parsed| (parsed.server_id.clone(), parsed.tool_name.clone()))
            })
            .ok_or_else(|| silent_apps_error(command_id, "unsupported"))?;
        let owner_session_id = self
            .chats
            .session_id(&payload.chat_id)
            .await
            .ok_or_else(|| {
                apps_error(
                    command_id,
                    ErrorCode::InvalidState,
                    "chat has no ACP session",
                )
            })?;
        send_accepted(&tx, command_id).await?;
        let this = self.clone();
        let command_id_owned = command_id.to_string();
        let payload = payload.clone();
        let (server_id, tool_name) = parsed;
        tokio::spawn(async move {
            let frame = this
                .execute_open(
                    &target,
                    &command_id_owned,
                    &payload,
                    &owner_session_id,
                    &server_id,
                    &tool_name,
                )
                .await;
            let _ = tx.send(OutboundMsg::Frame(frame)).await;
        });
        Ok(())
    }

    pub async fn resource(
        &self,
        command_id: &str,
        payload: &McpAppResourcePayload,
        tx: mpsc::Sender<OutboundMsg>,
        read_only: bool,
    ) -> Result<(), ActionError> {
        if read_only {
            return Err(silent_apps_error(command_id, "policy_denied"));
        }
        self.ensure_session(command_id, &payload.chat_id, &payload.app_session_id)
            .await?;
        let target = self.target(command_id, &payload.chat_id).await?;
        send_accepted(&tx, command_id).await?;
        let this = self.clone();
        let command_id_owned = command_id.to_string();
        let payload = payload.clone();
        tokio::spawn(async move {
            let frame = this
                .execute_resource(&target, &command_id_owned, &payload)
                .await;
            let _ = tx.send(OutboundMsg::Frame(frame)).await;
        });
        Ok(())
    }

    pub async fn call(
        &self,
        command_id: &str,
        payload: &McpAppCallPayload,
        tx: mpsc::Sender<OutboundMsg>,
        read_only: bool,
    ) -> Result<(), ActionError> {
        if read_only {
            return Err(silent_apps_error(command_id, "policy_denied"));
        }
        if payload
            .payload
            .get("method")
            .and_then(serde_json::Value::as_str)
            != Some("tools/call")
        {
            return Err(apps_error(
                command_id,
                ErrorCode::InvalidState,
                "unsupported",
            ));
        }
        self.ensure_session(command_id, &payload.chat_id, &payload.app_session_id)
            .await?;
        let target = self.target(command_id, &payload.chat_id).await?;
        send_accepted(&tx, command_id).await?;
        let this = self.clone();
        let command_id_owned = command_id.to_string();
        let payload = payload.clone();
        tokio::spawn(async move {
            let frame = this
                .execute_call(&target, &command_id_owned, &payload)
                .await;
            let _ = tx.send(OutboundMsg::Frame(frame)).await;
        });
        Ok(())
    }

    async fn read_tool_call(
        &self,
        chat_id: &str,
        tool_call_id: &str,
    ) -> Option<ToolCallProjection> {
        self.sink.tool_call_projection(chat_id, tool_call_id).await
    }

    fn gate_open(&self, command_id: &str, tool: &ToolCallProjection) -> Result<(), ActionError> {
        gate_mcp_app_open(command_id, tool)
    }

    async fn ensure_session(
        &self,
        command_id: &str,
        chat_id: &str,
        app_session_id: &str,
    ) -> Result<(), ActionError> {
        let sessions = self.sessions.read().await;
        let Some(session) = sessions.get(app_session_id) else {
            return Err(apps_error(
                command_id,
                ErrorCode::InvalidState,
                "stale_session",
            ));
        };
        if session.chat_id != chat_id {
            return Err(apps_error(
                command_id,
                ErrorCode::InvalidState,
                "stale_session",
            ));
        }
        Ok(())
    }

    async fn target(
        &self,
        command_id: &str,
        chat_id: &str,
    ) -> Result<mcp_apps_control_rpc::Target, ActionError> {
        let Some(record) = self.chats.entry(chat_id).await else {
            return Err(apps_error(
                command_id,
                ErrorCode::ChatNotFound,
                "chat not found",
            ));
        };
        if record.state.is_terminal() || record.session_id.is_none() {
            return Err(apps_error(
                command_id,
                ErrorCode::InvalidState,
                "agent_unavailable",
            ));
        }
        Ok(mcp_apps_control_rpc::Target {
            chat_id: chat_id.to_string(),
            instance_id: record.instance_id,
        })
    }
}

pub(super) fn gate_mcp_app_open(
    command_id: &str,
    tool: &ToolCallProjection,
) -> Result<(), ActionError> {
    if tool.status != ToolCallStatus::Completed {
        return Err(silent_apps_error(command_id, "policy_denied"));
    }
    if tool.public_error.is_some() {
        return Err(silent_apps_error(command_id, "policy_denied"));
    }
    let mcp_ok = tool.mcp_server_id.is_some()
        || tool.mcp_tool_name.is_some()
        || parse_mcp_tool_name(&tool.name).is_some();
    if !mcp_ok {
        return Err(silent_apps_error(command_id, "unsupported"));
    }
    Ok(())
}

pub(super) fn apps_error(command_id: &str, code: ErrorCode, message: &'static str) -> ActionError {
    ActionError {
        command_id: command_id.to_string(),
        code,
        message: message.to_string(),
        retryable: false,
        retry_after_ms: None,
    }
}

pub(super) fn silent_apps_error(command_id: &str, message: &'static str) -> ActionError {
    apps_error(command_id, ErrorCode::InvalidState, message)
}

pub(super) fn delivery_unknown(command_id: &str) -> ActionError {
    ActionError {
        command_id: command_id.to_string(),
        code: ErrorCode::DeliveryUnknown,
        message: "MCP app open delivery is unknown; do not retry with a new command".into(),
        retryable: false,
        retry_after_ms: None,
    }
}

async fn send_accepted(
    tx: &mpsc::Sender<OutboundMsg>,
    command_id: &str,
) -> Result<(), ActionError> {
    use peri_studio_proto::ack::{AckStatus, ActionAck};
    tx.send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
        command_id: command_id.to_string(),
        status: AckStatus::Accepted,
        turn_id: None,
        chat_id: None,
        project_id: None,
        instance_id: None,
        session_id: None,
        acp_session_id: None,
        committed_projection_version: None,
    })))
    .await
    .map_err(|_| apps_error(command_id, ErrorCode::AgentUnavailable, "agent_unavailable"))
}

#[path = "mcp_apps_control_rpc.rs"]
mod mcp_apps_control_rpc;

#[cfg(test)]
#[path = "mcp_apps_control_test.rs"]
mod mcp_apps_control_test;
