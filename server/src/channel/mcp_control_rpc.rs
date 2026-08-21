//! McpControl 的内部 RPC 执行（拆分自 mcp_control.rs，原文件 708 行）。
//!
//! 拆分动机：原文件按"入口/执行/终结"三主题超限，本文件收敛 OAuth 变更命令的
//! ledger 预留（prepare_mutation）、dispatch 执行（execute_start/execute_cancel）、
//! 运行时/能力目标解析（target）、JSON-RPC 转发（rpc）以及响应分类
//! （classify_* / RpcFailure）。入口方法（list/authorization/start/cancel）与
//! 终结判定、frame 构造保留在父模块，本文件经 `super::` 引用；方法可见性由
//! 模块私有提升为 `pub(super)`（等价于拆分前父模块内的私有可见域），
//! 不改变任何分支语义。

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::frame::Frame;
use serde::{Deserialize, Serialize};

use crate::channel::oauth_command_ledger::{OAuthClaim, OAuthCommandIdentity};
use crate::persist::metadata::{payload_hash, BeginOAuthCommand};
use crate::protocol::PERI_OAUTH_EXTENSION;

use super::{
    error, finish_after_dispatch, finish_not_delivered, ledger_prepare_error, ledger_unavailable,
    replay_terminal, McpControl, MutationVerdict, Target,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartResult {
    success: bool,
    status: String,
    flow_id: String,
    active_flow_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelResult {
    success: bool,
    cancelled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthPayloadFingerprint<'a> {
    schema: u8,
    command_type: &'static str,
    chat_id: &'a str,
    target: &'a str,
}

impl McpControl {
    pub(super) async fn prepare_mutation(
        &self,
        command_id: &str,
        command_type: &'static str,
        chat_id: &str,
        target: &str,
    ) -> Result<OAuthCommandIdentity, ActionError> {
        let payload_fingerprint = payload_hash(&OAuthPayloadFingerprint {
            schema: 1,
            command_type,
            chat_id,
            target,
        })
        .map_err(|_| {
            error(
                command_id,
                ErrorCode::InvalidState,
                "invalid OAuth command payload",
                false,
            )
        })?;
        let identity = OAuthCommandIdentity {
            command_id: command_id.to_string(),
            command_type,
            chat_id: chat_id.to_string(),
            payload_fingerprint,
        };
        let exists = self
            .ledger
            .exists(&identity)
            .await
            .map_err(|failure| ledger_prepare_error(command_id, failure))?;
        if !exists {
            // New identities must prove a live, capability-negotiated runtime
            // before they can consume durable command space. Existing terminal
            // identities deliberately bypass this check for restart replay.
            self.target(command_id, chat_id).await?;
        }
        match self.ledger.reserve(&identity).await {
            Ok(BeginOAuthCommand::New | BeginOAuthCommand::Existing) => Ok(identity),
            Err(failure) => Err(ledger_prepare_error(command_id, failure)),
        }
    }

    pub(super) async fn execute_start(
        &self,
        identity: OAuthCommandIdentity,
        server_name: String,
    ) -> Frame {
        let command_id = identity.command_id.clone();
        let claim = match self.ledger.claim(identity.clone()).await {
            Ok(claim) => claim,
            Err(_) => return ledger_unavailable(&command_id),
        };
        let OAuthClaim::Execute(mut permit) = claim else {
            return replay_terminal(&command_id, claim);
        };
        let target = match self.target(&command_id, &identity.chat_id).await {
            Ok(target) => target,
            Err(error) => return finish_not_delivered(permit, error).await,
        };
        if permit.mark_dispatching().await.is_err() {
            return ledger_unavailable(&command_id);
        }
        let verdict = match self
            .rpc(
                &target,
                "mcp/oauth_start",
                serde_json::json!({
                    "server_name": server_name,
                    "flow_id": command_id,
                }),
            )
            .await
        {
            Ok(value) => classify_start_result(value, &command_id),
            Err(RpcFailure::Rejected) => {
                MutationVerdict::DeliveryUnknown("start_rpc_rejected_after_dispatch")
            }
            Err(_) => MutationVerdict::DeliveryUnknown("start_transport_unknown"),
        };
        finish_after_dispatch(permit, &command_id, verdict).await
    }

    pub(super) async fn execute_cancel(
        &self,
        identity: OAuthCommandIdentity,
        flow_id: String,
    ) -> Frame {
        let command_id = identity.command_id.clone();
        let claim = match self.ledger.claim(identity.clone()).await {
            Ok(claim) => claim,
            Err(_) => return ledger_unavailable(&command_id),
        };
        let OAuthClaim::Execute(mut permit) = claim else {
            return replay_terminal(&command_id, claim);
        };
        let target = match self.target(&command_id, &identity.chat_id).await {
            Ok(target) => target,
            Err(error) => return finish_not_delivered(permit, error).await,
        };
        if permit.mark_dispatching().await.is_err() {
            return ledger_unavailable(&command_id);
        }
        let verdict = match self
            .rpc(
                &target,
                "mcp/oauth_cancel",
                serde_json::json!({ "flow_id": flow_id }),
            )
            .await
        {
            Ok(value) => classify_cancel_result(value),
            Err(RpcFailure::Rejected) => {
                MutationVerdict::DeliveryUnknown("cancel_rpc_rejected_after_dispatch")
            }
            Err(_) => MutationVerdict::DeliveryUnknown("cancel_transport_unknown"),
        };
        finish_after_dispatch(permit, &command_id, verdict).await
    }

    pub(super) async fn target(
        &self,
        command_id: &str,
        chat_id: &str,
    ) -> Result<Target, ActionError> {
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
                "chat has no active ACP process",
                false,
            ));
        }
        if !self
            .chats
            .supports_extension(chat_id, PERI_OAUTH_EXTENSION)
            .await
        {
            return Err(error(
                command_id,
                ErrorCode::UnsupportedFrame,
                "Peri OAuth capability was not negotiated",
                false,
            ));
        }
        Ok(Target {
            chat_id: chat_id.to_string(),
            instance_id: record.instance_id,
        })
    }

    pub(super) async fn rpc(
        &self,
        target: &Target,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, RpcFailure> {
        let rpc_id = self.translator.alloc_rpc_id();
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": method,
            "params": params,
        });
        let response = self.relay.register_rpc(&rpc_id, method.to_string()).await;
        if self
            .instance
            .forward_rpc(&target.instance_id, &target.chat_id, &message)
            .await
            .is_err()
        {
            self.relay.cancel_rpc(&rpc_id).await;
            return Err(RpcFailure::ForwardUnknown);
        }
        match tokio::time::timeout(self.timeout, response).await {
            Ok(Ok(value)) if value.get("error").is_none() => value
                .get("result")
                .cloned()
                .ok_or(RpcFailure::InvalidResponse),
            Ok(Ok(_)) => Err(RpcFailure::Rejected),
            _ => {
                self.relay.cancel_rpc(&rpc_id).await;
                Err(RpcFailure::ResponseUnknown)
            }
        }
    }
}

pub(super) fn classify_start_result(value: serde_json::Value, command_id: &str) -> MutationVerdict {
    match serde_json::from_value::<StartResult>(value) {
        Ok(result)
            if result.success
                && result.flow_id == command_id
                && result.active_flow_id == command_id
                && matches!(result.status.as_str(), "started" | "already_active") =>
        {
            MutationVerdict::Committed
        }
        Ok(result)
            if !result.success
                && result.status == "conflict"
                && result.flow_id == command_id
                && !result.active_flow_id.is_empty()
                && result.active_flow_id != command_id =>
        {
            MutationVerdict::Rejected("INVALID_STATE")
        }
        _ => MutationVerdict::DeliveryUnknown("invalid_start_response"),
    }
}

pub(super) fn classify_cancel_result(value: serde_json::Value) -> MutationVerdict {
    match serde_json::from_value::<CancelResult>(value) {
        Ok(result) if result.success => {
            let _ = result.cancelled;
            MutationVerdict::Committed
        }
        _ => MutationVerdict::DeliveryUnknown("invalid_cancel_response"),
    }
}

pub(super) enum RpcFailure {
    ForwardUnknown,
    ResponseUnknown,
    InvalidResponse,
    Rejected,
}

impl RpcFailure {
    pub(super) fn into_error(self, command_id: &str, mutation: bool) -> ActionError {
        if mutation {
            error(
                command_id,
                ErrorCode::DeliveryUnknown,
                "OAuth command delivery is unknown; do not retry with a new command",
                false,
            )
        } else {
            error(
                command_id,
                ErrorCode::AgentUnavailable,
                "MCP query unavailable",
                true,
            )
        }
    }
}
