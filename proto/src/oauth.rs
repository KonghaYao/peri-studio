//! 面向浏览器的 MCP OAuth 协议 DTO。
//!
//! 安全状态帧与唯一一个瞬时授权响应帧分离：URL 包装类型在 `Debug` 中脱敏，
//! 通用帧诊断输出无法泄露授权 URL（ARC-SECRET-001 在共享协议边界强制）。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpConnectionStatus {
    Connected,
    Failed,
    Disconnected,
    Disabled,
    Uninitialized,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpOAuthStatus {
    None,
    Authorized,
    NeedsAuthorization,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub name: String,
    pub transport: String,
    pub connection_status: McpConnectionStatus,
    pub oauth_status: McpOAuthStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_flow_id: Option<String>,
    pub tools_count: usize,
    pub resources_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServersFrame {
    pub command_id: String,
    pub chat_id: String,
    pub servers: Vec<McpServerInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpOAuthEventStatus {
    AuthorizationNeeded,
    Completed,
    Failed,
    Cancelled,
    Restored,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpOAuthFailureClass {
    CallbackUnavailable,
    CallbackTimeout,
    ProviderRejected,
    ConnectionFailed,
    Internal,
}

/// 安全广播状态帧。可安全记日志与广播：不含 URL、callback 材料、
/// 凭据或原始 provider 错误。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthFrame {
    pub chat_id: String,
    pub flow_id: String,
    pub server_name: String,
    pub status: McpOAuthEventStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_class: Option<McpOAuthFailureClass>,
    pub updated_at: String,
}

/// 携带秘密的 URL 值。线序列化必须精确输出，但通用 `Debug` 一律脱敏
/// （ARC-SECRET-001 在共享协议边界强制执行）。
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EphemeralAuthorizationUrl(String);

impl EphemeralAuthorizationUrl {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl std::fmt::Debug for EphemeralAuthorizationUrl {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("EphemeralAuthorizationUrl([REDACTED])")
    }
}

/// full-role、exact-command 响应。这是唯一可携带授权 URL 的浏览器线类型；
/// 绝不可持久化或广播。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthAuthorizationFrame {
    pub command_id: String,
    pub chat_id: String,
    pub flow_id: String,
    pub authorization_url: EphemeralAuthorizationUrl,
    pub expires_at: String,
}

#[cfg(test)]
#[path = "oauth_test.rs"]
mod oauth_test;
