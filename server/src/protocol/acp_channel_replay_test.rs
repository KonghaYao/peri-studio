//! 会话列表/JSON-RPC 包裹/回放标记/plan（主题 2e/2f）
//!
//! 拆分动机：原 acp_channel_test.rs 1365 行超阈值（≤500 行要求），按
//! 「解析主题」拆出本文件；测试代码仅移动 + 文件级 use 调整，断言语义零改动。

use serde_json::json;

use super::*;
#[test]
fn map_peri_token_stats_extension() {
    let f = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {
                "sessionUpdate": "usage_update",
                "used": 42000,
                "size": 200000,
                "_meta": {
                    "inputTokens": 1200,
                    "outputTokens": 345,
                    "cacheCreationTokens": 20,
                    "cacheReadTokens": 900,
                    "requestId": "req-123",
                    "model": "claude-opus-4-1",
                    "stopReason": "end_turn"
                }
            }
        }
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::AgentUsage {
                input_tokens,
                output_tokens,
                cache_creation_tokens,
                cache_read_tokens,
                request_id,
                model,
                stop_reason,
                ..
            } => {
                assert_eq!(input_tokens, Some(1200));
                assert_eq!(output_tokens, Some(345));
                assert_eq!(cache_creation_tokens, Some(20));
                assert_eq!(cache_read_tokens, Some(900));
                assert_eq!(request_id.as_deref(), Some("req-123"));
                assert_eq!(model.as_deref(), Some("claude-opus-4-1"));
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
            }
            _ => panic!("expected agent usage"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_session_list_response() {
    let f = json!({
        "type": "session_list",
        "payload": {"sessions": [{"sessionId": "s1", "title": "t", "status": "ended", "updatedAt": "x"}]}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::SessionListResponse { entries } => {
                assert_eq!(entries.len(), 1);
                assert_eq!(entries[0].session_id, "s1");
            }
            _ => panic!("expected session list"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_jsonrpc_wrapped_event() {
    let f = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "type": "agent_message_chunk",
            "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "x"}
        }
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => assert_eq!(ev.body.kind(), "message_delta"),
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn official_replay_marker_is_normalized_without_retaining_raw_meta() {
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "restored", "_meta": {"periReplay": true}}
            }
        }
    });
    let NormalizeOutcome::Event(event) = norm(frame) else {
        panic!("expected replay event")
    };
    assert_eq!(event.provenance, EventProvenance::PeriReplay);
    let encoded = serde_json::to_value(&*event).unwrap();
    assert!(encoded.to_string().find("periReplay").is_none());
}

#[test]
fn replay_marker_requires_exact_boolean_and_expected_location() {
    for marker in [json!(false), json!("true"), json!(1)] {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "acp-1",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "_meta": {"periReplay": true},
                    "content": {"type": "text", "text": "restored", "_meta": {"periReplay": marker}}
                }
            }
        });
        let NormalizeOutcome::Event(event) = norm(frame) else {
            panic!("expected content event")
        };
        assert_eq!(event.provenance, EventProvenance::Unspecified);
    }
}

#[test]
fn official_tool_replay_marker_lives_on_update_meta() {
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "tool-1",
                "title": "Read",
                "status": "in_progress",
                "_meta": {"periReplay": true}
            }
        }
    });
    let NormalizeOutcome::Event(event) = norm(frame) else {
        panic!("expected tool event")
    };
    assert_eq!(event.provenance, EventProvenance::PeriReplay);
}

#[test]
fn official_plan_normalizes_bounded_peri_active_form() {
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {
                "sessionUpdate": "plan",
                "entries": [{
                    "content": "Run tests",
                    "priority": "medium",
                    "status": "in_progress",
                    "_meta": {"activeForm": "Running   tests", "ignored": "private"}
                }]
            }
        }
    });
    let NormalizeOutcome::Event(event) = norm(frame) else {
        panic!("expected plan event")
    };
    let EventBody::AgentPlan { entries } = event.body else {
        panic!("expected normalized plan")
    };
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].content, "Run tests");
    assert_eq!(entries[0].active_form.as_deref(), Some("Running tests"));
    assert_eq!(entries[0].status.as_str(), "in_progress");
    assert!(!serde_json::to_string(&entries).unwrap().contains("ignored"));
}
