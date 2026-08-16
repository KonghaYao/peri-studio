//! Capability-gated MCP/OAuth control plane.
//!
//! Safe snapshots and lifecycle results may cross the browser boundary. Provider
//! URLs are obtained only from [`RelayEventHandler`]'s transient exact-flow store.
//!
//! 本文件按主题拆分（原 708 行 → 三个文件，均 ≤500 行）：入口与查询
//! （list/authorization/start/cancel）保留在本文件；内部 RPC 执行
//! （prepare_mutation/execute_start/execute_cancel/target/rpc 及响应分类）见
//! [`super::mcp_control_rpc`]；终结判定与 frame 构造（ledger 错误转换、
//! finish_*、ack/error 帧）统一收敛在本文件底部——保持 private，仅子模块经
//! `super::` 引用，不扩大可见性、不改变任何分支语义。

use std::sync::Arc;
use std::time::Duration;

use peri_studio_proto::ack::{AckStatus, ActionAck, ActionError, ErrorCode};
use peri_studio_proto::action::{McpOAuthFlowPayload, McpOAuthStartPayload};
use peri_studio_proto::frame::Frame;
use peri_studio_proto::oauth::{McpConnectionStatus, McpOAuthStatus, McpServerInfo, McpServersFrame};
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::channel::broadcaster::OutboundMsg;
use crate::channel::oauth_command_ledger::{
    OAuthClaim, OAuthCommandLedger, OAuthExecutionPermit, OAuthLedgerError, OAuthTerminal,
};
use crate::channel::relay_event_handler::RelayEventHandler;
use crate::control::{ChatRegistry, InstanceRegistry};
use crate::persist::metadata::{MetadataError, MetadataStore};
use crate::protocol::Translator;

#[derive(Clone)]
pub(super) struct McpControl {
    chats: ChatRegistry,
    instance: Arc<InstanceRegistry>,
    relay: Arc<RelayEventHandler>,
    translator: Arc<Translator>,
    ledger: OAuthCommandLedger,
    timeout: Duration,
}

struct Target {
    chat_id: String,
    instance_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListResult {
    servers: Vec<WireServer>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireServer {
    name: String,
    transport: String,
    connection_status: McpConnectionStatus,
    oauth_status: McpOAuthStatus,
    #[serde(default)]
    active_flow_id: Option<String>,
    tools_count: usize,
    resources_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MutationVerdict {
    Committed,
    Rejected(&'static str),
    DeliveryUnknown(&'static str),
}

impl McpControl {
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
            ledger: OAuthCommandLedger::default(),
            timeout,
        }
    }

    pub async fn install_metadata(&self, metadata: Arc<MetadataStore>) {
        self.ledger.install(metadata).await;
    }

    pub async fn list(
        &self,
        command_id: &str,
        chat_id: &str,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> Result<(), ActionError> {
        let target = self.target(command_id, chat_id).await?;
        send_accepted(&tx, command_id).await?;
        let this = self.clone();
        let command_id = command_id.to_string();
        tokio::spawn(async move {
            let result = this.rpc(&target, "mcp/list", serde_json::json!({})).await;
            let frame = match result {
                Ok(value) => match serde_json::from_value::<ListResult>(value) {
                    Ok(result) if result.servers.len() <= 256 => {
                        Frame::McpServers(McpServersFrame {
                            command_id: command_id.clone(),
                            chat_id: target.chat_id,
                            servers: result.servers.into_iter().map(Into::into).collect(),
                        })
                    }
                    _ => Frame::ActionError(error(
                        &command_id,
                        ErrorCode::AgentUnavailable,
                        "invalid MCP list response",
                        false,
                    )),
                },
                Err(failure) => Frame::ActionError(failure.into_error(&command_id, false)),
            };
            let _ = tx.send(OutboundMsg::Frame(frame)).await;
        });
        Ok(())
    }

    pub async fn authorization(
        &self,
        command_id: &str,
        payload: &McpOAuthFlowPayload,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> Result<(), ActionError> {
        self.target(command_id, &payload.chat_id).await?;
        send_accepted(&tx, command_id).await?;
        let frame = self
            .relay
            .oauth_authorization(command_id, &payload.chat_id, &payload.flow_id)
            .await
            .map_err(|_| {
                error(
                    command_id,
                    ErrorCode::InvalidState,
                    "OAuth authorization is unavailable or expired",
                    false,
                )
            })?;
        tx.send(OutboundMsg::Frame(Frame::McpOAuthAuthorization(frame)))
            .await
            .map_err(|_| {
                error(
                    command_id,
                    ErrorCode::AgentUnavailable,
                    "client connection closed",
                    true,
                )
            })?;
        Ok(())
    }

    pub async fn start(
        &self,
        command_id: &str,
        payload: &McpOAuthStartPayload,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> Result<(), ActionError> {
        if payload.server_name.is_empty() || payload.server_name.len() > 128 {
            return Err(error(
                command_id,
                ErrorCode::InvalidState,
                "invalid MCP server name",
                false,
            ));
        }
        let identity = self
            .prepare_mutation(
                command_id,
                "mcp/oauth-start",
                &payload.chat_id,
                &payload.server_name,
            )
            .await?;
        let _ = send_accepted(&tx, command_id).await;
        let this = self.clone();
        let server_name = payload.server_name.clone();
        tokio::spawn(async move {
            let frame = this.execute_start(identity, server_name).await;
            let _ = tx.send(OutboundMsg::Frame(frame)).await;
        });
        Ok(())
    }

    pub async fn cancel(
        &self,
        command_id: &str,
        payload: &McpOAuthFlowPayload,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> Result<(), ActionError> {
        if payload.flow_id.is_empty() || payload.flow_id.len() > 128 {
            return Err(error(
                command_id,
                ErrorCode::InvalidState,
                "invalid OAuth flow identity",
                false,
            ));
        }
        let identity = self
            .prepare_mutation(
                command_id,
                "mcp/oauth-cancel",
                &payload.chat_id,
                &payload.flow_id,
            )
            .await?;
        let _ = send_accepted(&tx, command_id).await;
        let this = self.clone();
        let flow_id = payload.flow_id.clone();
        tokio::spawn(async move {
            let frame = this.execute_cancel(identity, flow_id).await;
            let _ = tx.send(OutboundMsg::Frame(frame)).await;
        });
        Ok(())
    }
}

impl From<WireServer> for McpServerInfo {
    fn from(value: WireServer) -> Self {
        Self {
            name: value.name,
            transport: value.transport,
            connection_status: value.connection_status,
            oauth_status: value.oauth_status,
            active_flow_id: value.active_flow_id,
            tools_count: value.tools_count,
            resources_count: value.resources_count,
        }
    }
}

fn ledger_prepare_error(command_id: &str, failure: OAuthLedgerError) -> ActionError {
    match failure {
        OAuthLedgerError::Metadata(MetadataError::Conflict(_)) => error(
            command_id,
            ErrorCode::InvalidState,
            "commandId reused with a different OAuth payload",
            false,
        ),
        _ => error(
            command_id,
            ErrorCode::AgentUnavailable,
            "OAuth command ledger is unavailable",
            true,
        ),
    }
}

fn ledger_unavailable(command_id: &str) -> Frame {
    Frame::ActionError(error(
        command_id,
        ErrorCode::AgentUnavailable,
        "OAuth command ledger is unavailable",
        true,
    ))
}

fn replay_terminal(command_id: &str, claim: OAuthClaim) -> Frame {
    let OAuthClaim::Terminal(terminal) = claim else {
        unreachable!("execute claims are handled by the caller");
    };
    match terminal {
        OAuthTerminal::Committed => acknowledged(command_id, AckStatus::Duplicate),
        OAuthTerminal::Rejected { error_code } => rejected_frame(command_id, error_code.as_deref()),
        OAuthTerminal::FailedNotDelivered { error_code } => {
            failed_not_delivered_frame(command_id, error_code.as_deref())
        }
        OAuthTerminal::DeliveryUnknown { error_code } => {
            let _ = error_code;
            delivery_unknown_frame(command_id)
        }
    }
}

async fn finish_not_delivered(permit: OAuthExecutionPermit, failure: ActionError) -> Frame {
    let command_id = failure.command_id.clone();
    if permit
        .fail_not_delivered(error_code_key(failure.code))
        .await
        .is_err()
    {
        return ledger_unavailable(&command_id);
    }
    Frame::ActionError(failure)
}

async fn finish_after_dispatch(
    permit: OAuthExecutionPermit,
    command_id: &str,
    verdict: MutationVerdict,
) -> Frame {
    match verdict {
        MutationVerdict::Committed => {
            if permit.commit().await.is_ok() {
                acknowledged(command_id, AckStatus::Committed)
            } else {
                delivery_unknown_frame(command_id)
            }
        }
        MutationVerdict::Rejected(error_code) => {
            if permit.reject(error_code).await.is_ok() {
                rejected_frame(command_id, Some(error_code))
            } else {
                delivery_unknown_frame(command_id)
            }
        }
        MutationVerdict::DeliveryUnknown(error_code) => {
            let _ = permit.delivery_unknown(error_code).await;
            delivery_unknown_frame(command_id)
        }
    }
}

fn error_code_key(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::ChatNotFound => "CHAT_NOT_FOUND",
        ErrorCode::InvalidState => "INVALID_STATE",
        ErrorCode::UnsupportedFrame => "UNSUPPORTED_FRAME",
        ErrorCode::InstanceOffline => "INSTANCE_OFFLINE",
        _ => "AGENT_UNAVAILABLE",
    }
}

fn rejected_frame(command_id: &str, error_code: Option<&str>) -> Frame {
    let (code, message, retryable) = match error_code {
        Some("INVALID_STATE") => (
            ErrorCode::InvalidState,
            "another OAuth flow is already active for this server",
            false,
        ),
        Some("CHAT_NOT_FOUND") => (ErrorCode::ChatNotFound, "chat not found", false),
        Some("UNSUPPORTED_FRAME") => (
            ErrorCode::UnsupportedFrame,
            "Peri OAuth capability was not negotiated",
            false,
        ),
        Some("INSTANCE_OFFLINE") => (ErrorCode::InstanceOffline, "ACP instance is offline", true),
        _ => (
            ErrorCode::AgentUnavailable,
            "Peri rejected the OAuth command",
            false,
        ),
    };
    Frame::ActionError(error(command_id, code, message, retryable))
}

fn failed_not_delivered_frame(command_id: &str, error_code: Option<&str>) -> Frame {
    match error_code {
        Some("CHAT_NOT_FOUND") => Frame::ActionError(error(
            command_id,
            ErrorCode::ChatNotFound,
            "chat ended before the OAuth command was delivered",
            false,
        )),
        Some("UNSUPPORTED_FRAME") => Frame::ActionError(error(
            command_id,
            ErrorCode::UnsupportedFrame,
            "Peri OAuth capability disappeared before dispatch",
            false,
        )),
        Some("INVALID_STATE") => Frame::ActionError(error(
            command_id,
            ErrorCode::InvalidState,
            "chat ended before the OAuth command crossed its dispatch barrier",
            false,
        )),
        _ => Frame::ActionError(error(
            command_id,
            ErrorCode::AgentUnavailable,
            "OAuth command was not delivered; a new explicit command is safe",
            true,
        )),
    }
}

fn delivery_unknown_frame(command_id: &str) -> Frame {
    Frame::ActionError(error(
        command_id,
        ErrorCode::DeliveryUnknown,
        "OAuth command delivery is unknown; do not retry with a new command",
        false,
    ))
}

fn acknowledged(command_id: &str, status: AckStatus) -> Frame {
    Frame::ActionAck(ActionAck {
        command_id: command_id.to_string(),
        status,
        turn_id: None,
        chat_id: None,
        project_id: None,
        session_id: None,
        acp_session_id: None,
        committed_projection_version: None,
    })
}

async fn send_accepted(
    tx: &mpsc::Sender<OutboundMsg>,
    command_id: &str,
) -> Result<(), ActionError> {
    tx.send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
        command_id: command_id.to_string(),
        status: AckStatus::Accepted,
        turn_id: None,
        chat_id: None,
        project_id: None,
        session_id: None,
        acp_session_id: None,
        committed_projection_version: None,
    })))
    .await
    .map_err(|_| {
        error(
            command_id,
            ErrorCode::AgentUnavailable,
            "client connection closed",
            true,
        )
    })
}

fn error(command_id: &str, code: ErrorCode, message: &'static str, retryable: bool) -> ActionError {
    ActionError {
        command_id: command_id.to_string(),
        code,
        message: message.to_string(),
        retryable,
        retry_after_ms: None,
    }
}

#[path = "mcp_control_rpc.rs"]
mod mcp_control_rpc;

// RPC 响应分类（拆分后位于 mcp_control_rpc）：原内联测试经 super:: 引用，
// 此处 cfg(test) use 保持符号在父模块命名空间内可见（可见域与拆分前等价）。
#[cfg(test)]
use mcp_control_rpc::{classify_cancel_result, classify_start_result};

#[cfg(test)]
#[path = "mcp_control_test.rs"]
mod mcp_control_test;
