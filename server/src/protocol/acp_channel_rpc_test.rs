//! RpcResponse/agent activity/预测/elicitation（主题 5）
//!
//! 拆分动机：原 acp_channel_test.rs 1365 行超阈值（≤500 行要求），按
//! 「解析主题」拆出本文件；测试代码仅移动 + 文件级 use 调整，断言语义零改动。

use serde_json::json;

use super::*;
#[test]
fn official_plan_rejects_unknown_status_and_overlong_active_form() {
    for entry in [
        json!({"content": "x", "status": "blocked"}),
        json!({"content": "x", "status": "pending", "_meta": {"activeForm": "x".repeat(257)}}),
    ] {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {"sessionId": "acp-1", "update": {"sessionUpdate": "plan", "entries": [entry]}}
        });
        assert!(matches!(
            norm(frame),
            NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
        ));
    }
}

// ---------------------------------------------------------------------------
// 5. RpcResponse（L3 输入）
// ---------------------------------------------------------------------------

#[test]
fn rpc_response_ok() {
    let f = json!({"jsonrpc": "2.0", "id": "hub-3", "result": {"ok": true}});
    match norm(f) {
        NormalizeOutcome::RpcResponse { id, is_error } => {
            assert_eq!(id, "hub-3");
            assert!(!is_error);
        }
        other => panic!("expected rpc response, got {other:?}"),
    }
}

#[test]
fn rpc_response_accepts_numeric_id() {
    // 官方 ACP Prompt Turn 示例：`"id": 2` + `result.stopReason`。
    // 数字 id 不得当 Malformed 丢掉，否则 session/prompt 终态到不了 L3。
    let f = json!({"jsonrpc": "2.0", "id": 2, "result": {"stopReason": "end_turn"}});
    match norm(f) {
        NormalizeOutcome::RpcResponse { id, is_error } => {
            assert_eq!(id, "2");
            assert!(!is_error);
        }
        other => panic!("expected numeric-id rpc response, got {other:?}"),
    }
}

#[test]
fn rpc_response_accepts_prompt_result_without_jsonrpc_member() {
    // 部分 ACP 实现省略 jsonrpc 键，只回 {id, result:{stopReason}}。
    // 这仍是 session/prompt 的官方终态，不得当 {type,payload} 丢掉。
    let f = json!({"id": "hub-9", "result": {"stopReason": "end_turn"}});
    match norm(f) {
        NormalizeOutcome::RpcResponse { id, is_error } => {
            assert_eq!(id, "hub-9");
            assert!(!is_error);
        }
        other => panic!("expected prompt-result rpc response, got {other:?}"),
    }
}

#[test]
fn rpc_response_error() {
    let f =
        json!({"jsonrpc": "2.0", "id": "hub-4", "error": {"code": -32601, "message": "unknown"}});
    match norm(f) {
        NormalizeOutcome::RpcResponse { id, is_error } => {
            assert_eq!(id, "hub-4");
            assert!(is_error);
        }
        other => panic!("expected rpc response, got {other:?}"),
    }
}

#[test]
fn peri_agent_activity_maps_only_allowlisted_projection() {
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "peri/agent_activity",
        "params": {
            "sessionId": "acp-1",
            "activity": {
                "schemaVersion": 1,
                "kind": "subagent",
                "status": "running",
                "correlationId": "0123456789abcdef01234567",
                "label": "  research\nagent  ",
                "isBackground": true,
                "metrics": {"tool_count": 3, "duration_ms": 1200},
                "attributes": {"task_kind": "agent"}
            }
        }
    });
    match norm(frame) {
        NormalizeOutcome::Event(event) => assert_eq!(
            event.body,
            EventBody::AgentActivity {
                kind: peri_studio_proto::schema::AgentActivityKind::Subagent,
                status: peri_studio_proto::schema::AgentActivityStatus::Running,
                correlation_id: Some("0123456789abcdef01234567".into()),
                label: Some("research agent".into()),
                is_background: Some(true),
                metrics: BTreeMap::from([("duration_ms".into(), 1200), ("tool_count".into(), 3),]),
                attributes: BTreeMap::from([("task_kind".into(), "agent".into())]),
            }
        ),
        other => panic!("expected activity, got {other:?}"),
    }
}

#[test]
fn peri_agent_activity_rejects_unknown_schema_fields_and_values() {
    for activity in [
        json!({"schemaVersion": 2, "kind": "subagent", "status": "running"}),
        json!({"schemaVersion": 1, "kind": "secret_event", "status": "running"}),
        json!({"schemaVersion": 1, "kind": "subagent", "status": "mystery"}),
        json!({"schemaVersion": 1, "kind": "subagent", "status": "running", "rawOutput": "secret"}),
        json!({"schemaVersion": 1, "kind": "subagent", "status": "running", "metrics": {"secret_count": 1}}),
        json!({"schemaVersion": 1, "kind": "subagent", "status": "running", "metrics": {"tool_count": u64::MAX}}),
        json!({"schemaVersion": 1, "kind": "compact", "status": "completed", "attributes": {"strategy": "custom"}}),
    ] {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": "peri/agent_activity",
            "params": {"sessionId": "acp-1", "activity": activity}
        });
        assert!(matches!(
            norm(frame),
            NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
        ));
    }
}

#[test]
fn peri_agent_activity_rejects_raw_or_invalid_identity_shapes() {
    for correlation in [
        json!("UPPERCASE"),
        json!("contains space"),
        json!("a".repeat(65)),
        json!(42),
    ] {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": "peri/agent_activity",
            "params": {"sessionId": "acp-1", "activity": {
                "schemaVersion": 1,
                "kind": "workflow",
                "status": "running",
                "correlationId": correlation
            }}
        });
        assert!(matches!(
            norm(frame),
            NormalizeOutcome::Dropped(DropReason::MissingField)
        ));
    }
}

#[test]
fn peri_prediction_normalizes_safe_text_and_discards_actions() {
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "peri/prediction_ready",
        "params": {
            "sessionId": "acp-1",
            "text": "  检查\n失败测试  ",
            "actions": [
                {"kind": "placeholder", "text": "检查失败测试"},
                {"kind": "set_title", "title": "可靠投递"}
            ]
        }
    });
    match norm(frame) {
        NormalizeOutcome::Event(event) => assert_eq!(
            event.body,
            EventBody::InputPrediction {
                text: Some("检查 失败测试".into())
            }
        ),
        other => panic!("expected prediction, got {other:?}"),
    }
}

#[test]
fn empty_peri_prediction_is_a_sequenced_clear() {
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "peri/prediction_ready",
        "params": {"sessionId": "acp-1", "text": " \n ", "actions": []}
    });
    match norm(frame) {
        NormalizeOutcome::Event(event) => {
            assert_eq!(event.body, EventBody::InputPrediction { text: None })
        }
        other => panic!("expected prediction clear, got {other:?}"),
    }
}

#[test]
fn peri_prediction_rejects_unsafe_or_unbounded_shapes() {
    for params in [
        json!({"sessionId": "acp-1", "text": "x", "secret": "no"}),
        json!({"sessionId": "acp-1", "text": "x".repeat(201)}),
        json!({"sessionId": "acp-1", "text": "x", "actions": {}}),
        json!({"sessionId": "acp-1", "text": "x", "actions": [{"kind": "shell", "text": "rm"}]}),
        json!({"sessionId": "acp-1", "text": "x", "actions": [{"kind": "placeholder", "text": "ok", "raw": "secret"}]}),
        json!({"sessionId": "acp-1", "text": "x", "actions": (0..5).map(|_| json!({"kind": "summary", "text": "x"})).collect::<Vec<_>>() }),
    ] {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": "peri/prediction_ready",
            "params": params
        });
        assert!(matches!(
            norm(frame),
            NormalizeOutcome::Dropped(DropReason::UnsupportedFrame | DropReason::MissingField)
        ));
    }
}

#[test]
fn form_elicitation_is_strictly_projected() {
    let frame = json!({
        "jsonrpc": "2.0",
        "id": 41,
        "method": "elicitation/create",
        "params": {
            "sessionId": "acp-1",
            "mode": "form",
            "message": "How should Peri continue?",
            "requestedSchema": {
                "type": "object",
                "properties": {
                    "detail": { "type": "string", "title": "Detail", "description": "Explain the goal" },
                    "mode": { "type": "string", "title": "Mode", "enum": ["safe", "fast"] },
                    "checks": { "type": "array", "title": "Checks", "items": { "type": "string", "enum": ["tests", "lint"] } }
                },
                "required": ["detail", "mode"]
            }
        }
    });
    match norm(frame) {
        NormalizeOutcome::ElicitationRequest(request) => {
            assert_eq!(request.request_id, json!(41));
            assert_eq!(request.session_id, "acp-1");
            assert_eq!(request.fields.len(), 3);
            assert_eq!(request.fields[0].id, "checks");
            assert_eq!(request.fields[1].id, "detail");
            assert!(request.fields[1].required);
            assert_eq!(request.fields[2].options.len(), 2);
        }
        other => panic!("expected form elicitation, got {other:?}"),
    }
}
