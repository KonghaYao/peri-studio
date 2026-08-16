use serde_json::json;

use super::{OAuthControl, OAuthControlError};
use peri_studio_proto::oauth::{McpOAuthEventStatus, McpOAuthFailureClass};

fn authorization_needed(url: &str) -> serde_json::Value {
    json!({
        "jsonrpc": "2.0",
        "method": "peri/oauth",
        "params": {
            "schemaVersion": 1,
            "flowId": "flow-1",
            "serverName": "github",
            "status": "authorization_needed",
            "authorizationUrl": url
        }
    })
}

#[tokio::test]
async fn capability_and_schema_fail_closed() {
    let control = OAuthControl::new();
    assert_eq!(
        control
            .observe(
                "chat-1",
                &authorization_needed("https://example.test/oauth?secret=redacted"),
                false,
            )
            .await,
        Err(OAuthControlError::CapabilityNotNegotiated)
    );

    let mut unknown = authorization_needed("https://example.test/oauth");
    unknown["params"]["callbackCode"] = json!("must-not-cross-acp");
    assert_eq!(
        control.observe("chat-1", &unknown, true).await,
        Err(OAuthControlError::InvalidEnvelope)
    );
}

#[tokio::test]
async fn authorization_url_is_exact_transient_and_cleared_on_terminal() {
    let control = OAuthControl::new();
    let url = "https://example.test/oauth?state=opaque";
    let status = control
        .observe("chat-1", &authorization_needed(url), true)
        .await
        .expect("safe status");
    assert_eq!(status.status, McpOAuthEventStatus::AuthorizationNeeded);
    let authorization = control
        .authorization("command-1", "chat-1", "flow-1")
        .await
        .expect("authorization");
    assert_eq!(authorization.authorization_url.as_str(), url);

    control
        .observe(
            "chat-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "peri/oauth",
                "params": {
                    "schemaVersion": 1,
                    "flowId": "flow-1",
                    "serverName": "github",
                    "status": "completed"
                }
            }),
            true,
        )
        .await
        .expect("terminal status");
    assert_eq!(
        control.authorization("command-2", "chat-1", "flow-1").await,
        Err(OAuthControlError::AuthorizationUnavailable)
    );
}

#[tokio::test]
async fn url_policy_and_status_shape_are_strict() {
    let control = OAuthControl::new();
    for url in [
        "http://example.test/oauth",
        "https://user@example.test/oauth",
        "https://example.test/oauth#fragment",
        "file:///tmp/secret",
    ] {
        assert_eq!(
            control
                .observe("chat-1", &authorization_needed(url), true)
                .await,
            Err(OAuthControlError::InvalidAuthorizationUrl)
        );
    }
    for url in [
        "https://example.test/oauth",
        "http://localhost:9000/callback",
        "http://127.0.0.1:9000/callback",
        "http://[::1]:9000/callback",
    ] {
        control
            .observe("chat-1", &authorization_needed(url), true)
            .await
            .expect("allowed URL");
    }

    let failed = control
        .observe(
            "chat-2",
            &json!({
                "jsonrpc": "2.0",
                "method": "peri/oauth",
                "params": {
                    "schemaVersion": 1,
                    "flowId": "flow-2",
                    "serverName": "github",
                    "status": "failed",
                    "failureClass": "provider_rejected"
                }
            }),
            true,
        )
        .await
        .expect("safe failure");
    assert_eq!(
        failed.failure_class,
        Some(McpOAuthFailureClass::ProviderRejected)
    );
}

#[test]
fn errors_and_safe_frames_do_not_expose_authorization_data_in_debug() {
    let value = format!("{:?}", OAuthControlError::InvalidAuthorizationUrl);
    assert!(!value.contains("state="));
}
