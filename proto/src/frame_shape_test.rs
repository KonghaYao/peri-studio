//! 帧序列化形态测试：嵌套 tag、ysync.update 投影版本、oauth/rewind 契约。

use crate::ack::ErrorCode;
use crate::action::{ActionEnvelope, PromptChatPayload};
use crate::conn::DocId;
use crate::frame::Frame;
use crate::rewind::{RewindFileChange, RewindFileChangeKind, RewindPreviewFrame};
use crate::ysync::YsyncUpdate;

use super::util::all_frames;

/// 双层 internally tagged 序列化形态：`{"t":"action","commandId":…,"type":…,"payload":…}`（§4.3）。
#[test]
fn action_envelope_nested_tag_shape() {
    let frame = Frame::Action(ActionEnvelope::Prompt {
        command_id: "c4".into(),
        payload: PromptChatPayload {
            chat_id: "s1".into(),
            message: "hi".into(),
            effort: None,
        },
    });
    let value: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&frame).unwrap()).unwrap();
    assert_eq!(value["t"], "action");
    assert_eq!(value["commandId"], "c4");
    assert_eq!(value["type"], "chat/prompt");
    assert_eq!(value["payload"]["chatId"], "s1");
    assert_eq!(value["payload"]["message"], "hi");
}

#[test]
fn mcp_oauth_actions_use_exact_camel_case_contract() {
    let cases = [
        (
            r#"{"t":"action","commandId":"q1","type":"mcp/list","payload":{"chatId":"chat-1"}}"#,
            "mcp/list",
        ),
        (
            r#"{"t":"action","commandId":"q2","type":"mcp/oauth-start","payload":{"chatId":"chat-1","serverName":"docs"}}"#,
            "mcp/oauth-start",
        ),
        (
            r#"{"t":"action","commandId":"q3","type":"mcp/oauth-authorization","payload":{"chatId":"chat-1","flowId":"flow-1"}}"#,
            "mcp/oauth-authorization",
        ),
        (
            r#"{"t":"action","commandId":"q4","type":"mcp/oauth-cancel","payload":{"chatId":"chat-1","flowId":"flow-1"}}"#,
            "mcp/oauth-cancel",
        ),
    ];
    for (raw, expected_type) in cases {
        let frame = Frame::parse(raw).unwrap();
        let Frame::Action(action) = &frame else {
            panic!("expected action");
        };
        assert_eq!(action.type_str(), expected_type);
        let encoded = serde_json::to_value(frame).unwrap();
        assert_eq!(encoded["type"], expected_type);
        assert!(encoded["payload"].get("chatId").is_some());
    }
}

#[test]
fn rewind_query_contract_is_exact_and_body_bounded_by_shape() {
    let candidates = Frame::parse(
        r#"{"t":"action","commandId":"q1","type":"chat/rewind-candidates","payload":{"chatId":"chat-1"}}"#,
    )
    .unwrap();
    assert!(matches!(
        candidates,
        Frame::Action(ActionEnvelope::RewindCandidates { .. })
    ));

    let preview = Frame::parse(
        r#"{"t":"action","commandId":"q2","type":"chat/rewind-preview","payload":{"chatId":"chat-1","targetMessageId":"message-1"}}"#,
    )
    .unwrap();
    assert!(matches!(
        preview,
        Frame::Action(ActionEnvelope::RewindPreview { .. })
    ));

    let execute = Frame::parse(
        &format!(
            r#"{{"t":"action","commandId":"q3","type":"chat/rewind","payload":{{"chatId":"chat-1","targetMessageId":"message-1","previewFingerprint":"{}","revertFiles":true}}}}"#,
            "f".repeat(64)
        ),
    )
    .unwrap();
    assert!(matches!(
        execute,
        Frame::Action(ActionEnvelope::Rewind { .. })
    ));

    let response = Frame::RewindPreview(RewindPreviewFrame {
        command_id: "q2".into(),
        chat_id: "chat-1".into(),
        target_message_id: "message-1".into(),
        preview_fingerprint: "f".repeat(64),
        file_changes: vec![RewindFileChange {
            path: "src/lib.rs".into(),
            kind: RewindFileChangeKind::Edit,
        }],
    });
    let encoded = serde_json::to_value(response).unwrap();
    assert_eq!(encoded["t"], "rewind_preview");
    assert_eq!(encoded["targetMessageId"], "message-1");
    assert_eq!(encoded["previewFingerprint"], "f".repeat(64));
    assert_eq!(encoded["fileChanges"][0]["kind"], "edit");
}

/// 安全的 oauth 状态/列表帧绝不携带授权 URL、raw error 或 callback 材料
/// （ARC-SECRET-001 在共享协议边界强制）。
#[test]
fn safe_oauth_status_and_list_frames_never_contain_authorization_url() {
    for frame in all_frames() {
        if matches!(frame, Frame::McpServers(_) | Frame::McpOAuth(_)) {
            let encoded = serde_json::to_string(&frame).unwrap();
            assert!(!encoded.contains("authorizationUrl"));
            assert!(!encoded.contains("rawError"));
            assert!(!encoded.contains("callback"));
        }
    }
}

/// `ysync.update` 快照/增量投影版本（§4.6 步骤 3）：快照必带
/// `projection_version`，增量不携带；序列化形态为可选字段。
#[test]
fn ysync_update_projection_version_shape() {
    // 快照：携带投影版本
    let snapshot = Frame::YsyncUpdate(YsyncUpdate {
        doc: DocId::chat("s1"),
        update: "AAAA".into(),
        projection_version: Some(7),
    });
    let v: serde_json::Value = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(v["t"], "ysync.update");
    assert_eq!(v["doc"], "chat:s1");
    assert_eq!(v["update"], "AAAA");
    assert_eq!(v["projectionVersion"], 7);
    assert_eq!(
        Frame::parse(&serde_json::to_string(&snapshot).unwrap()).unwrap(),
        snapshot
    );

    // 增量：不携带投影版本
    let delta = Frame::YsyncUpdate(YsyncUpdate {
        doc: DocId::chat("s1"),
        update: "AAAA".into(),
        projection_version: None,
    });
    let v: serde_json::Value = serde_json::to_value(&delta).unwrap();
    assert!(v.get("projectionVersion").is_none(), "增量不携带投影版本");
}

/// `DELIVERY_UNKNOWN` 是独立稳定码：线格式固定为 SCREAMING_SNAKE_CASE，且
/// 非幂等命令的未知交付状态绝不可自动重试。
#[test]
fn delivery_unknown_error_code_roundtrip_and_retryability() {
    let value = serde_json::to_value(ErrorCode::DeliveryUnknown).unwrap();
    assert_eq!(value, "DELIVERY_UNKNOWN");
    assert_eq!(
        serde_json::from_value::<ErrorCode>(value).unwrap(),
        ErrorCode::DeliveryUnknown
    );
    assert!(!ErrorCode::DeliveryUnknown.default_retryable());
}
