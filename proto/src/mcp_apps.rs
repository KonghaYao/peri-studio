//! MCP Apps 瞬时下行帧与 action payload DTO（§4.3 / design/mcp-apps.md）。
//!
//! HTML 与 app session 不经 Yjs/SQLite；对标 OAuth 瞬时通道。

use serde::{Deserialize, Serialize};

/// `mcp/app-open` payload。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpAppOpenPayload {
    pub chat_id: String,
    pub tool_call_id: String,
}

/// `mcp/app-resource` payload。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpAppResourcePayload {
    pub chat_id: String,
    pub app_session_id: String,
}

/// `mcp/app-call` payload：`payload` 必须是 `tools/call` JSON-RPC。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpAppCallPayload {
    pub chat_id: String,
    pub app_session_id: String,
    pub payload: serde_json::Value,
}

/// `mcp_app_session` 下行帧。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAppSessionFrame {
    pub command_id: String,
    pub chat_id: String,
    pub tool_call_id: String,
    pub app_session_id: String,
    pub server_id: String,
    pub resource_uri: String,
}

/// `mcp_app_resource` 下行帧（瞬时 HTML，不落盘）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAppResourceFrame {
    pub command_id: String,
    pub chat_id: String,
    pub app_session_id: String,
    pub html: String,
    pub mime_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csp: Option<String>,
}

/// `mcp_app_call_result` 下行帧：`peri/mcp/app` 的 raw CallToolResult（瞬时）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAppCallResultFrame {
    pub command_id: String,
    pub chat_id: String,
    pub app_session_id: String,
    pub result: serde_json::Value,
}
