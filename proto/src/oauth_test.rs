//! OAuth DTO 测试：授权 URL 的 Debug 脱敏与线序列化精确性（ARC-SECRET-001）。

use crate::oauth::{EphemeralAuthorizationUrl, McpOAuthAuthorizationFrame};

#[test]
fn authorization_url_debug_is_redacted_but_wire_is_exact() {
    let secret = "https://auth.example.test/?state=SECRET_SENTINEL";
    let frame = McpOAuthAuthorizationFrame {
        command_id: "command-1".into(),
        chat_id: "chat-1".into(),
        flow_id: "flow-1".into(),
        authorization_url: EphemeralAuthorizationUrl::new(secret.into()),
        expires_at: "2026-08-15T00:00:30Z".into(),
    };
    assert!(!format!("{frame:?}").contains("SECRET_SENTINEL"));
    assert_eq!(
        serde_json::to_value(&frame).unwrap()["authorizationUrl"],
        secret
    );
}
