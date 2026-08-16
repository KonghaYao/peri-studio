//! Transient, capability-gated MCP OAuth state.
//!
//! Authorization URLs live only in this bounded in-memory registry. Secret-bearing
//! records implement neither `Debug` nor serde and are cleared on terminal state,
//! expiry, disconnect, or process exit.

use std::collections::HashMap;
use std::time::Duration;

use peri_studio_proto::oauth::{
    EphemeralAuthorizationUrl, McpOAuthAuthorizationFrame, McpOAuthEventStatus,
    McpOAuthFailureClass, McpOAuthFrame,
};
use chrono::Utc;
use serde::Deserialize;
use tokio::sync::RwLock;
use tokio::time::Instant;
use url::{Host, Url};

const OAUTH_SCHEMA_VERSION: u32 = 1;
const IDENTIFIER_MAX_BYTES: usize = 128;
const AUTHORIZATION_URL_MAX_BYTES: usize = 4096;
const MAX_FLOWS: usize = 128;
const DEFAULT_TTL: Duration = Duration::from_secs(120);

#[derive(Clone)]
struct SecretAuthorizationUrl(String);

struct StoredFlow {
    server_name: String,
    status: McpOAuthEventStatus,
    authorization_url: Option<SecretAuthorizationUrl>,
    expires_at: Instant,
}

#[derive(Default)]
pub(super) struct OAuthControl {
    flows: RwLock<HashMap<(String, String), StoredFlow>>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(super) enum OAuthControlError {
    #[error("OAuth capability not negotiated")]
    CapabilityNotNegotiated,
    #[error("invalid OAuth event envelope")]
    InvalidEnvelope,
    #[error("unsupported OAuth event schema")]
    UnsupportedSchema,
    #[error("invalid OAuth identifier")]
    InvalidIdentifier,
    #[error("invalid OAuth authorization URL")]
    InvalidAuthorizationUrl,
    #[error("invalid OAuth event status shape")]
    InvalidStatusShape,
    #[error("OAuth flow identity conflict")]
    IdentityConflict,
    #[error("OAuth flow is terminal")]
    TerminalFlow,
    #[error("OAuth transient registry full")]
    Capacity,
    #[error("OAuth authorization is unavailable")]
    AuthorizationUnavailable,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireOAuthEvent {
    schema_version: u32,
    flow_id: String,
    server_name: String,
    status: WireOAuthStatus,
    #[serde(default)]
    authorization_url: Option<String>,
    #[serde(default)]
    failure_class: Option<WireFailureClass>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WireOAuthStatus {
    AuthorizationNeeded,
    Completed,
    Failed,
    Cancelled,
    Restored,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WireFailureClass {
    CallbackUnavailable,
    CallbackTimeout,
    ProviderRejected,
    ConnectionFailed,
    Internal,
}

impl OAuthControl {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn observe(
        &self,
        chat_id: &str,
        frame: &serde_json::Value,
        capability_negotiated: bool,
    ) -> Result<McpOAuthFrame, OAuthControlError> {
        if !capability_negotiated {
            return Err(OAuthControlError::CapabilityNotNegotiated);
        }
        if frame.get("jsonrpc").and_then(serde_json::Value::as_str) != Some("2.0")
            || frame.get("method").and_then(serde_json::Value::as_str) != Some("peri/oauth")
        {
            return Err(OAuthControlError::InvalidEnvelope);
        }
        let wire: WireOAuthEvent = serde_json::from_value(
            frame
                .get("params")
                .cloned()
                .ok_or(OAuthControlError::InvalidEnvelope)?,
        )
        .map_err(|_| OAuthControlError::InvalidEnvelope)?;
        if wire.schema_version != OAUTH_SCHEMA_VERSION {
            return Err(OAuthControlError::UnsupportedSchema);
        }
        validate_identifier(&wire.flow_id)?;
        validate_server_name(&wire.server_name)?;

        let (status, failure_class, authorization_url) = normalize_wire_event(&wire)?;
        let now = Instant::now();
        let mut flows = self.flows.write().await;
        prune_locked(&mut flows, now);
        let key = (chat_id.to_string(), wire.flow_id.clone());
        if let Some(existing) = flows.get(&key) {
            if existing.server_name != wire.server_name {
                return Err(OAuthControlError::IdentityConflict);
            }
            if is_terminal(existing.status) && existing.status != status {
                return Err(OAuthControlError::TerminalFlow);
            }
        } else if flows.len() >= MAX_FLOWS {
            return Err(OAuthControlError::Capacity);
        }
        flows.insert(
            key,
            StoredFlow {
                server_name: wire.server_name.clone(),
                status,
                authorization_url,
                expires_at: now + DEFAULT_TTL,
            },
        );
        Ok(McpOAuthFrame {
            chat_id: chat_id.to_string(),
            flow_id: wire.flow_id,
            server_name: wire.server_name,
            status,
            failure_class,
            updated_at: Utc::now().to_rfc3339(),
        })
    }

    pub async fn authorization(
        &self,
        command_id: &str,
        chat_id: &str,
        flow_id: &str,
    ) -> Result<McpOAuthAuthorizationFrame, OAuthControlError> {
        let now = Instant::now();
        let mut flows = self.flows.write().await;
        prune_locked(&mut flows, now);
        let flow = flows
            .get(&(chat_id.to_string(), flow_id.to_string()))
            .ok_or(OAuthControlError::AuthorizationUnavailable)?;
        if flow.status != McpOAuthEventStatus::AuthorizationNeeded {
            return Err(OAuthControlError::AuthorizationUnavailable);
        }
        let url = flow
            .authorization_url
            .as_ref()
            .ok_or(OAuthControlError::AuthorizationUnavailable)?;
        let remaining = flow.expires_at.saturating_duration_since(now);
        Ok(McpOAuthAuthorizationFrame {
            command_id: command_id.to_string(),
            chat_id: chat_id.to_string(),
            flow_id: flow_id.to_string(),
            authorization_url: EphemeralAuthorizationUrl::new(url.0.clone()),
            expires_at: (Utc::now()
                + chrono::Duration::from_std(remaining)
                    .unwrap_or_else(|_| chrono::Duration::zero()))
            .to_rfc3339(),
        })
    }

    pub async fn clear_chat(&self, chat_id: &str) {
        self.flows
            .write()
            .await
            .retain(|(current_chat, _), _| current_chat != chat_id);
    }
}

fn normalize_wire_event(
    wire: &WireOAuthEvent,
) -> Result<
    (
        McpOAuthEventStatus,
        Option<McpOAuthFailureClass>,
        Option<SecretAuthorizationUrl>,
    ),
    OAuthControlError,
> {
    let failure_class = wire.failure_class.as_ref().map(|class| match class {
        WireFailureClass::CallbackUnavailable => McpOAuthFailureClass::CallbackUnavailable,
        WireFailureClass::CallbackTimeout => McpOAuthFailureClass::CallbackTimeout,
        WireFailureClass::ProviderRejected => McpOAuthFailureClass::ProviderRejected,
        WireFailureClass::ConnectionFailed => McpOAuthFailureClass::ConnectionFailed,
        WireFailureClass::Internal => McpOAuthFailureClass::Internal,
    });
    match wire.status {
        WireOAuthStatus::AuthorizationNeeded => {
            if failure_class.is_some() {
                return Err(OAuthControlError::InvalidStatusShape);
            }
            let url = wire
                .authorization_url
                .as_ref()
                .ok_or(OAuthControlError::InvalidStatusShape)?;
            validate_authorization_url(url)?;
            Ok((
                McpOAuthEventStatus::AuthorizationNeeded,
                None,
                Some(SecretAuthorizationUrl(url.clone())),
            ))
        }
        WireOAuthStatus::Failed => {
            if wire.authorization_url.is_some() || failure_class.is_none() {
                return Err(OAuthControlError::InvalidStatusShape);
            }
            Ok((McpOAuthEventStatus::Failed, failure_class, None))
        }
        WireOAuthStatus::Completed | WireOAuthStatus::Cancelled | WireOAuthStatus::Restored => {
            if wire.authorization_url.is_some() || failure_class.is_some() {
                return Err(OAuthControlError::InvalidStatusShape);
            }
            let status = match wire.status {
                WireOAuthStatus::Completed => McpOAuthEventStatus::Completed,
                WireOAuthStatus::Cancelled => McpOAuthEventStatus::Cancelled,
                WireOAuthStatus::Restored => McpOAuthEventStatus::Restored,
                _ => unreachable!(),
            };
            Ok((status, None, None))
        }
    }
}

fn validate_identifier(value: &str) -> Result<(), OAuthControlError> {
    if value.is_empty()
        || value.len() > IDENTIFIER_MAX_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(OAuthControlError::InvalidIdentifier);
    }
    Ok(())
}

fn validate_server_name(value: &str) -> Result<(), OAuthControlError> {
    if value.is_empty() || value.len() > IDENTIFIER_MAX_BYTES || value.chars().any(char::is_control)
    {
        return Err(OAuthControlError::InvalidIdentifier);
    }
    Ok(())
}

fn validate_authorization_url(value: &str) -> Result<(), OAuthControlError> {
    if value.is_empty() || value.len() > AUTHORIZATION_URL_MAX_BYTES {
        return Err(OAuthControlError::InvalidAuthorizationUrl);
    }
    let parsed = Url::parse(value).map_err(|_| OAuthControlError::InvalidAuthorizationUrl)?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err(OAuthControlError::InvalidAuthorizationUrl);
    }
    let allowed = match parsed.scheme() {
        "https" => parsed.host().is_some(),
        "http" => match parsed.host() {
            Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
            Some(Host::Ipv4(address)) => address.is_loopback(),
            Some(Host::Ipv6(address)) => address.is_loopback(),
            None => false,
        },
        _ => false,
    };
    allowed
        .then_some(())
        .ok_or(OAuthControlError::InvalidAuthorizationUrl)
}

fn is_terminal(status: McpOAuthEventStatus) -> bool {
    matches!(
        status,
        McpOAuthEventStatus::Completed
            | McpOAuthEventStatus::Failed
            | McpOAuthEventStatus::Cancelled
            | McpOAuthEventStatus::Expired
    )
}

fn prune_locked(flows: &mut HashMap<(String, String), StoredFlow>, now: Instant) {
    flows.retain(|_, flow| flow.expires_at > now);
}

#[cfg(test)]
#[path = "oauth_control_test.rs"]
mod oauth_control_test;
