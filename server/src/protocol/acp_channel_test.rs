//! ACPChannel 纯函数单测（设计稿 §16 测试 1–5）。

use std::collections::BTreeMap;

use serde_json::{json, Value};

use peri_studio_proto::schema::{BlockVisibility, ToolCallStatus, TurnStatus};

use super::*;

pub(super) fn ch() -> AcpChannel {
    AcpChannel::default()
}

pub(super) fn norm(frame: Value) -> NormalizeOutcome {
    ch().normalize("hub-s1", 1, 7, "2026-08-07T00:00:00Z", &frame)
}

// ---------------------------------------------------------------------------
// 1. 双格式 sessionId 提取
// ---------------------------------------------------------------------------

#[test]
fn extract_raw_payload_session_id() {
    let f = json!({"type": "agent_message_chunk", "payload": {"sessionId": "acp-1"}});
    assert_eq!(extract_session_id(&f).as_deref(), Some("acp-1"));
}

#[test]
fn extract_raw_payload_session_id_snake() {
    let f = json!({"type": "agent_message_chunk", "payload": {"session_id": "acp-2"}});
    assert_eq!(extract_session_id(&f).as_deref(), Some("acp-2"));
}

#[test]
fn extract_raw_top_level_session_id() {
    let f = json!({"type": "agent_message_chunk", "sessionId": "acp-3"});
    assert_eq!(extract_session_id(&f).as_deref(), Some("acp-3"));
}

#[test]
fn extract_jsonrpc_params_session_id() {
    let f = json!({
        "jsonrpc": "2.0", "method": "session/update",
        "params": {"sessionId": "acp-4", "type": "agent_message_chunk", "payload": {}}
    });
    assert_eq!(extract_session_id(&f).as_deref(), Some("acp-4"));
}

#[test]
fn extract_jsonrpc_params_session_id_snake() {
    let f = json!({
        "jsonrpc": "2.0", "method": "session/update",
        "params": {"session_id": "acp-5", "type": "agent_message_chunk", "payload": {}}
    });
    assert_eq!(extract_session_id(&f).as_deref(), Some("acp-5"));
}

#[test]
fn extract_jsonrpc_response_id_path() {
    let f = json!({"jsonrpc": "2.0", "id": "hub-1", "result": {"sessionId": "acp-6"}});
    // response 的 result.sessionId 不作为连接级 sessionId（§3.3 只规定
    // params 路径）；但 result 内 sessionId 供 create binding 解析。
    assert_eq!(extract_session_id(&f), None);
    let body = f["result"].as_object().unwrap();
    assert_eq!(super::field(body, &["sessionId"]).as_deref(), Some("acp-6"));
}

#[test]
fn unsupported_elicitation_gets_a_typed_request_rejection() {
    let frame = json!({
        "jsonrpc": "2.0",
        "id": "ask-1",
        "method": "elicitation/create",
        "params": {
            "sessionId": "acp-1",
            "mode": "form",
            "message": "Secret",
            "requestedSchema": {
                "type": "object",
                "properties": { "password": { "type": "string", "format": "password" } }
            }
        }
    });
    assert!(matches!(
        norm(frame),
        NormalizeOutcome::RejectedClientRequest {
            request_id,
            code: -32602,
            ..
        } if request_id == json!("ask-1")
    ));
}

// ---------------------------------------------------------------------------
// 4. 未知帧 / 畸形帧 / 缺失字段
// ---------------------------------------------------------------------------

#[test]
fn unknown_type_dropped() {
    let f = json!({"type": "unknown_frame", "payload": {}});
    assert!(matches!(
        norm(f),
        NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
    ));
}

#[test]
fn unknown_jsonrpc_method_dropped() {
    let f = json!({"jsonrpc": "2.0", "method": "unknown/method", "params": {}});
    assert!(matches!(
        norm(f),
        NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
    ));
}

#[test]
fn non_object_frame_malformed() {
    assert!(matches!(
        norm(json!("just a string")),
        NormalizeOutcome::Dropped(DropReason::Malformed)
    ));
    assert!(matches!(
        norm(json!(42)),
        NormalizeOutcome::Dropped(DropReason::Malformed)
    ));
}

#[test]
fn payload_non_object_malformed() {
    let f = json!({"type": "agent_message_chunk", "payload": "nope"});
    assert!(matches!(
        norm(f),
        NormalizeOutcome::Dropped(DropReason::Malformed)
    ));
}

#[test]
fn missing_required_field_dropped() {
    // 无 turn_id 的增量（§6.3 同源拒绝）。
    let f = json!({"type": "agent_message_chunk", "payload": {"entryId": "e", "blockId": "b", "text": "x"}});
    assert!(matches!(
        norm(f),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}

#[test]
fn truncated_text() {
    let long = "a".repeat(10_000);
    let f = json!({"type": "agent_message_chunk", "payload": {"turnId": "t", "entryId": "e", "blockId": "b", "text": long}});
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::MessageDelta { text, .. } => assert_eq!(text.len(), TEXT_MAX_BYTES),
            _ => panic!("expected message delta"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

// ── 主题拆分（#[path] 子模块，经 use super::* 共享 helper 与符号）─────
#[path = "acp_channel_config_test.rs"]
mod config;
#[path = "acp_channel_map_test.rs"]
mod map;
#[path = "acp_channel_permission_test.rs"]
mod permission;
#[path = "acp_channel_replay_test.rs"]
mod replay;
#[path = "acp_channel_rpc_test.rs"]
mod rpc;
