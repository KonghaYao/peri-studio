//! 帧 legacy 兼容性测试：缺字段解码、additive 字段、terminal 字段省略。

use std::collections::HashMap;

use crate::ack::{AckStatus, ActionAck, ActionError, ErrorCode};
use crate::conn::{DocId, Ready};
use crate::frame::Frame;
use crate::instance::InstanceHello;
use crate::session::{PromptDeliveryStatus, PromptStatusFrame, PromptStatusItem};
use crate::version::PROTOCOL_VERSION;
use crate::ysync::YsyncSubscribe;

/// server 直接下发的 terminal 帧省略缺省的可选字段；旧版本输出显式 `null`，
/// 解码端仍接受（滚动兼容，decode 兼容旧形态、encode 不上行空值）。
#[test]
fn terminal_optional_fields_omit_none_and_accept_legacy_null() {
    let ack = Frame::ActionAck(ActionAck {
        command_id: "project-create".into(),
        status: AckStatus::Committed,
        turn_id: None,
        chat_id: None,
        project_id: Some("project-1".into()),
        session_id: None,
        acp_session_id: None,
        instance_id: None,
        committed_projection_version: None,
    });
    let ack_json = serde_json::to_value(&ack).unwrap();
    for key in [
        "turnId",
        "chatId",
        "sessionId",
        "acpSessionId",
        "committedProjectionVersion",
    ] {
        assert!(ack_json.get(key).is_none(), "absent {key} must be omitted");
    }
    assert_eq!(ack_json["projectId"], "project-1");
    assert!(Frame::parse(
        r#"{"t":"action_ack","commandId":"legacy","status":"committed","turnId":null,"chatId":null,"acpSessionId":null,"committedProjectionVersion":null}"#,
    )
    .is_ok());

    let error = Frame::ActionError(ActionError {
        command_id: "project-create".into(),
        code: ErrorCode::InvalidState,
        message: "safe".into(),
        retryable: false,
        retry_after_ms: None,
    });
    let error_json = serde_json::to_value(&error).unwrap();
    assert!(error_json.get("retryAfterMs").is_none());
    assert!(Frame::parse(
        r#"{"t":"action_error","commandId":"legacy","code":"INVALID_STATE","message":"safe","retryable":false,"retryAfterMs":null}"#,
    )
    .is_ok());

    let prompt_status = Frame::PromptStatus(PromptStatusFrame {
        command_id: "query-1".into(),
        session_id: "session-1".into(),
        runtime_restored: false,
        truncated: false,
        evidence_incomplete: false,
        prompts: vec![PromptStatusItem {
            command_id: "prompt-1".into(),
            turn_id: None,
            status: PromptDeliveryStatus::Failed,
            created_at: "2026-08-14T00:00:00Z".into(),
            updated_at: "2026-08-14T00:00:01Z".into(),
            error_code: None,
        }],
    });
    let prompt_json = serde_json::to_value(&prompt_status).unwrap();
    assert!(prompt_json["prompts"][0].get("turnId").is_none());
    assert!(prompt_json["prompts"][0].get("errorCode").is_none());
}

/// 能力协商字段是 additive：旧 JSON 缺字段时解码为空且重编码不增加字段；新
/// JSON 使用 camelCase，并完整 round-trip。
#[test]
fn capability_negotiation_fields_are_backward_compatible() {
    let old_subscribe = Frame::parse(r#"{"t":"ysync.subscribe","docs":["chat:s1"]}"#).unwrap();
    let Frame::YsyncSubscribe(old_subscribe) = old_subscribe else {
        panic!("expected ysync.subscribe");
    };
    assert!(old_subscribe.client_capabilities.is_empty());
    let old_subscribe_json = serde_json::to_value(Frame::YsyncSubscribe(old_subscribe)).unwrap();
    assert!(old_subscribe_json.get("clientCapabilities").is_none());

    let old_ready = Frame::parse(r#"{"t":"ready","projectionVersions":{}}"#).unwrap();
    let Frame::Ready(old_ready) = old_ready else {
        panic!("expected ready");
    };
    assert!(old_ready.negotiated_capabilities.is_empty());
    assert_eq!(old_ready.max_prompt_bytes, None);
    let old_ready_json = serde_json::to_value(Frame::Ready(old_ready)).unwrap();
    assert!(old_ready_json.get("negotiatedCapabilities").is_none());

    let subscribe = Frame::YsyncSubscribe(YsyncSubscribe {
        docs: vec![DocId::chat("s1")],
        client_capabilities: vec!["prompt-status-v1".into()],
    });
    let subscribe_json = serde_json::to_value(&subscribe).unwrap();
    assert_eq!(subscribe_json["clientCapabilities"][0], "prompt-status-v1");
    assert_eq!(
        Frame::parse(&serde_json::to_string(&subscribe).unwrap()).unwrap(),
        subscribe
    );

    let ready = Frame::Ready(Ready {
        projection_versions: HashMap::new(),
        negotiated_capabilities: vec!["prompt-status-v1".into()],
        max_prompt_bytes: Some(65_536),
    });
    let ready_json = serde_json::to_value(&ready).unwrap();
    assert_eq!(ready_json["negotiatedCapabilities"][0], "prompt-status-v1");
    assert_eq!(ready_json["maxPromptBytes"], 65_536);
    assert_eq!(
        Frame::parse(&serde_json::to_string(&ready).unwrap()).unwrap(),
        ready
    );
}

/// 旧 instance hello 仍可解码，server 得以返回显式的协议不匹配错误，
/// 而非泛化的畸形帧失败。
#[test]
fn instance_hello_protocol_version_is_additive_and_explicit() {
    let legacy =
        Frame::parse(r#"{"t":"instance/hello","token":"x","hostname":"h","caps":{},"nonce":"n"}"#)
            .unwrap();
    let Frame::InstanceHello(legacy) = legacy else {
        panic!("expected instance hello");
    };
    assert_eq!(legacy.protocol_version, 0);

    let current = Frame::InstanceHello(InstanceHello {
        protocol_version: PROTOCOL_VERSION,
        token: "x".into(),
        hostname: "h".into(),
        caps: serde_json::json!({}),
        buffered: None,
        buffer_lost: None,
        stream_epochs: None,
        nonce: "n".into(),
    });
    let json = serde_json::to_value(&current).unwrap();
    assert_eq!(json["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(
        Frame::parse(&serde_json::to_string(&current).unwrap()).unwrap(),
        current
    );
}
