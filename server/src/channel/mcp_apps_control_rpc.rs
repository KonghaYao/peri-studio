//! McpAppsControl 的 Peri RPC 执行与响应分类。

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::action::{McpAppCallPayload, McpAppOpenPayload, McpAppResourcePayload};
use peri_studio_proto::frame::Frame;
use peri_studio_proto::mcp_apps::{McpAppCallResultFrame, McpAppResourceFrame, McpAppSessionFrame};
use serde::Deserialize;

use super::{
    apps_error, delivery_unknown, silent_apps_error, LiveAppSession, McpAppsControl,
    OpenCommandState,
};

pub(super) struct Target {
    pub chat_id: String,
    pub instance_id: String,
}

pub(super) const ENVELOPE_VERSION: &str = "1";
pub(super) const APPS_PROTOCOL_VERSION: &str = "2026-01-26";
pub(super) const HTML_MAX_BYTES: usize = 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenResult {
    app_session_id: String,
    resource_uri: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceResult {
    resources: Vec<ResourceItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceItem {
    uri: String,
    mime_type: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    blob: Option<String>,
    #[serde(rename = "_meta", default)]
    meta: Option<serde_json::Value>,
}

impl McpAppsControl {
    pub(super) async fn execute_open(
        &self,
        target: &Target,
        command_id: &str,
        payload: &McpAppOpenPayload,
        owner_session_id: &str,
        server_id: &str,
        tool_name: &str,
    ) -> Frame {
        let params = serde_json::json!({
            "envelopeVersion": ENVELOPE_VERSION,
            "appsProtocolVersion": APPS_PROTOCOL_VERSION,
            "serverId": server_id,
            "toolName": tool_name,
            "ownerSessionId": owner_session_id,
            "invocationToken": payload.tool_call_id,
        });
        let dispatch_result = self
            .rpc(target, "peri/mcp/open", params)
            .await;
        let frame = match dispatch_result {
            Ok(value) => match serde_json::from_value::<OpenResult>(value) {
                Ok(result)
                    if !result.app_session_id.is_empty()
                        && result.resource_uri.starts_with("ui://") =>
                {
                    let session_frame = McpAppSessionFrame {
                        command_id: command_id.to_string(),
                        chat_id: payload.chat_id.clone(),
                        tool_call_id: payload.tool_call_id.clone(),
                        app_session_id: result.app_session_id.clone(),
                        server_id: server_id.to_string(),
                        resource_uri: result.resource_uri.clone(),
                    };
                    self.sessions.write().await.insert(
                        result.app_session_id.clone(),
                        LiveAppSession {
                            chat_id: payload.chat_id.clone(),
                            tool_call_id: payload.tool_call_id.clone(),
                            server_id: server_id.to_string(),
                            resource_uri: result.resource_uri.clone(),
                        },
                    );
                    self.open_commands.write().await.insert(
                        command_id.to_string(),
                        OpenCommandState::Completed(session_frame.clone()),
                    );
                    Frame::McpAppSession(session_frame)
                }
                _ => {
                    self.open_commands.write().await.insert(
                        command_id.to_string(),
                        OpenCommandState::Failed(apps_error(
                            command_id,
                            ErrorCode::AgentUnavailable,
                            "agent_unavailable",
                        )),
                    );
                    Frame::ActionError(apps_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        "agent_unavailable",
                    ))
                }
            },
            Err(AppsRpcFailure::Rejected(kind)) => {
                let error = map_apps_kind(command_id, kind);
                let silent = matches!(
                    kind,
                    "capability_disabled" | "policy_denied" | "tool_not_app_visible"
                );
                self.open_commands.write().await.insert(
                    command_id.to_string(),
                    if silent {
                        OpenCommandState::Failed(error.clone())
                    } else {
                        OpenCommandState::Failed(error.clone())
                    },
                );
                Frame::ActionError(error)
            }
            Err(AppsRpcFailure::DeliveryUnknown) => {
                self.open_commands
                    .write()
                    .await
                    .insert(command_id.to_string(), OpenCommandState::DeliveryUnknown);
                Frame::ActionError(delivery_unknown(command_id))
            }
            Err(AppsRpcFailure::Unavailable) => {
                self.open_commands.write().await.insert(
                    command_id.to_string(),
                    OpenCommandState::Failed(apps_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        "agent_unavailable",
                    )),
                );
                Frame::ActionError(apps_error(
                    command_id,
                    ErrorCode::AgentUnavailable,
                    "agent_unavailable",
                ))
            }
        };
        frame
    }

    pub(super) async fn execute_resource(
        &self,
        target: &Target,
        command_id: &str,
        payload: &McpAppResourcePayload,
    ) -> Frame {
        let session = {
            let sessions = self.sessions.read().await;
            sessions.get(&payload.app_session_id).cloned()
        };
        let Some(session) = session else {
            return Frame::ActionError(apps_error(
                command_id,
                ErrorCode::InvalidState,
                "stale_session",
            ));
        };
        let params = serde_json::json!({
            "envelopeVersion": ENVELOPE_VERSION,
            "appsProtocolVersion": APPS_PROTOCOL_VERSION,
            "appSessionId": payload.app_session_id,
            "serverId": session.server_id,
            "resourceUri": session.resource_uri,
        });
        match self.rpc(target, "peri/mcp/resource", params).await {
            Ok(value) => match serde_json::from_value::<ResourceResult>(value) {
                Ok(result) => match pick_html_resource(result.resources, &session.resource_uri) {
                    Ok((html, mime_type, csp)) => Frame::McpAppResource(McpAppResourceFrame {
                        command_id: command_id.to_string(),
                        chat_id: payload.chat_id.clone(),
                        app_session_id: payload.app_session_id.clone(),
                        html,
                        mime_type,
                        csp,
                    }),
                    Err(message) => Frame::ActionError(apps_error(
                        command_id,
                        ErrorCode::PayloadTooLarge,
                        message,
                    )),
                },
                _ => Frame::ActionError(apps_error(
                    command_id,
                    ErrorCode::AgentUnavailable,
                    "agent_unavailable",
                )),
            },
            Err(AppsRpcFailure::Rejected(kind)) => {
                Frame::ActionError(map_apps_kind(command_id, kind))
            }
            Err(AppsRpcFailure::DeliveryUnknown | AppsRpcFailure::Unavailable) => {
                Frame::ActionError(apps_error(
                    command_id,
                    ErrorCode::AgentUnavailable,
                    "agent_unavailable",
                ))
            }
        }
    }

    pub(super) async fn execute_call(
        &self,
        target: &Target,
        command_id: &str,
        payload: &McpAppCallPayload,
    ) -> Frame {
        let session = {
            let sessions = self.sessions.read().await;
            sessions.get(&payload.app_session_id).cloned()
        };
        let Some(session) = session else {
            return Frame::ActionError(apps_error(
                command_id,
                ErrorCode::InvalidState,
                "stale_session",
            ));
        };
        let params = serde_json::json!({
            "envelopeVersion": ENVELOPE_VERSION,
            "appsProtocolVersion": APPS_PROTOCOL_VERSION,
            "appSessionId": payload.app_session_id,
            "serverId": session.server_id,
            "resourceUri": session.resource_uri,
            "payload": payload.payload,
        });
        match self.rpc(target, "peri/mcp/app", params).await {
            Ok(value) => match value.get("payload").cloned() {
                Some(rpc_payload) => Frame::McpAppCallResult(McpAppCallResultFrame {
                    command_id: command_id.to_string(),
                    chat_id: payload.chat_id.clone(),
                    app_session_id: payload.app_session_id.clone(),
                    result: rpc_payload,
                }),
                None => Frame::ActionError(apps_error(
                    command_id,
                    ErrorCode::AgentUnavailable,
                    "agent_unavailable",
                )),
            },
            Err(AppsRpcFailure::Rejected(kind)) => {
                Frame::ActionError(map_apps_kind(command_id, kind))
            }
            Err(AppsRpcFailure::DeliveryUnknown | AppsRpcFailure::Unavailable) => {
                Frame::ActionError(apps_error(
                    command_id,
                    ErrorCode::AgentUnavailable,
                    "agent_unavailable",
                ))
            }
        }
    }

    async fn rpc(
        &self,
        target: &Target,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, AppsRpcFailure> {
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
            return Err(AppsRpcFailure::DeliveryUnknown);
        }
        match tokio::time::timeout(self.timeout, response).await {
            Ok(Ok(value)) => {
                if let Some(kind) = apps_error_kind(&value) {
                    return Err(AppsRpcFailure::Rejected(kind));
                }
                value
                    .get("result")
                    .cloned()
                    .ok_or(AppsRpcFailure::Unavailable)
            }
            Ok(Err(_)) => {
                self.relay.cancel_rpc(&rpc_id).await;
                Err(AppsRpcFailure::Rejected("agent_unavailable"))
            }
            Err(_) => {
                self.relay.cancel_rpc(&rpc_id).await;
                Err(AppsRpcFailure::DeliveryUnknown)
            }
        }
    }
}

enum AppsRpcFailure {
    Rejected(&'static str),
    DeliveryUnknown,
    Unavailable,
}

fn apps_error_kind(value: &serde_json::Value) -> Option<&'static str> {
    let kind = value
        .get("error")
        .and_then(|error| error.get("data"))
        .and_then(|data| data.get("kind"))
        .and_then(serde_json::Value::as_str)?;
    Some(match kind {
        "capability_disabled" => "capability_disabled",
        "policy_denied" | "tool_not_app_visible" | "forbidden" | "cancelled" => "policy_denied",
        "stale_server_generation"
        | "invalid_session"
        | "stale_session"
        | "unknown_server"
        | "server_disconnected" => "stale_session",
        "unsupported_method" | "unsupported_envelope_version" | "unsupported_apps_version" => {
            "unsupported"
        }
        _ => "agent_unavailable",
    })
}

fn map_apps_kind(command_id: &str, kind: &str) -> ActionError {
    let message = match kind {
        "capability_disabled" => "capability_disabled",
        "policy_denied" => "policy_denied",
        "stale_session" => "stale_session",
        "unsupported" => "unsupported",
        _ => "agent_unavailable",
    };
    if matches!(message, "capability_disabled" | "policy_denied" | "stale_session" | "unsupported") {
        silent_apps_error(command_id, message)
    } else {
        apps_error(command_id, ErrorCode::AgentUnavailable, message)
    }
}

fn pick_html_resource(
    resources: Vec<ResourceItem>,
    expected_uri: &str,
) -> Result<(String, String, Option<String>), &'static str> {
    let item = resources
        .into_iter()
        .find(|resource| resource.uri == expected_uri)
        .ok_or("agent_unavailable")?;
    if item.mime_type != "text/html;profile=mcp-app" {
        return Err("agent_unavailable");
    }
    let html = item
        .text
        .or(item.blob)
        .ok_or("agent_unavailable")?;
    if html.len() > HTML_MAX_BYTES {
        return Err("agent_unavailable");
    }
    let csp = csp_from_resource_meta(item.meta.as_ref());
    Ok((html, item.mime_type, csp))
}

fn csp_from_resource_meta(meta: Option<&serde_json::Value>) -> Option<String> {
    let csp = meta?.get("ui")?.get("csp")?;
    if let Some(text) = csp.as_str() {
        return Some(text.to_string());
    }
    let object = csp.as_object()?;
    let connect_domains = string_array(object.get("connectDomains"));
    let resource_domains = string_array(object.get("resourceDomains"));
    if connect_domains.is_empty() && resource_domains.is_empty() {
        return None;
    }
    Some(synthesize_csp(&connect_domains, &resource_domains))
}

fn string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn synthesize_csp(connect_domains: &[String], resource_domains: &[String]) -> String {
    let img_media = if resource_domains.is_empty() {
        "'self' data:".to_string()
    } else {
        format!("'self' data: {}", resource_domains.join(" "))
    };
    let connect_src = if connect_domains.is_empty() {
        "'none'".to_string()
    } else {
        format!("'self' {}", connect_domains.join(" "))
    };
    [
        "default-src 'none'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        &format!("img-src {img_media}"),
        &format!("media-src {img_media}"),
        &format!("connect-src {connect_src}"),
    ]
    .join("; ")
}

#[cfg(test)]
#[path = "mcp_apps_control_rpc_test.rs"]
mod tests;
