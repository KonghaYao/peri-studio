//! 权限请求/响应投影（主题 2c）
//!
//! 拆分动机：原 acp_channel_test.rs 1365 行超阈值（≤500 行要求），按
//! 「解析主题」拆出本文件；测试代码仅移动 + 文件级 use 调整，断言语义零改动。

use serde_json::json;

use super::*;
#[test]
fn map_tool_call_update_completed() {
    let f = json!({
        "type": "tool_call_update",
        "payload": {"turnId": "t1", "toolCallId": "tc1", "status": "completed", "result": {"ok": true}}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::ToolCallCompleted {
                result,
                completed_at,
                ..
            } => {
                assert_eq!(result, Some(json!({"ok": true})));
                assert_eq!(completed_at, "2026-08-07T00:00:00Z");
            }
            _ => panic!("expected tool call completed"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_permission_request_expires_at_injected() {
    let f = json!({
        "type": "permission_request",
        "payload": {"permissionId": "p1", "turnId": "t1", "title": "run cmd", "options": ["allow_once", "deny"]}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::PermissionRequested {
                permission_id,
                options,
                expires_at,
                ..
            } => {
                assert_eq!(permission_id, "p1");
                assert_eq!(options.len(), 2);
                // 注入时钟 + 5min（§4.7/§16）。
                let t = chrono::DateTime::parse_from_rfc3339(&expires_at).unwrap();
                assert_eq!(
                    t,
                    chrono::DateTime::parse_from_rfc3339("2026-08-07T00:05:00Z").unwrap()
                );
            }
            _ => panic!("expected permission requested"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_permission_response_allow() {
    let f = json!({"type": "permission_response", "payload": {"permissionId": "p1", "decision": "allow"}});
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::PermissionResolved { decision, .. } => {
                assert_eq!(decision, peri_studio_proto::action::PermissionDecision::Allow)
            }
            _ => panic!("expected permission resolved"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// #1 官方 session/request_permission（权限机制官方化）
// ---------------------------------------------------------------------------

#[test]
fn map_request_permission_official() {
    // 官方帧（id=5 number + toolCall + options）→ PermissionRequest：
    // request_id 原样（number 不得丢弃）、permission_id server 生成、
    // tool_call_id/title/options 透传。
    let f = json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "session/request_permission",
        "params": {
            "sessionId": "acp-1",
            "toolCall": {
                "toolCallId": "tc1",
                "title": "run cmd",
                "rawInput": {"cmd": "cargo test"}
            },
            "options": [
                {"optionId": "allow-once", "name": "允许一次", "kind": "allow_once"},
                {"optionId": "reject-once", "name": "拒绝一次", "kind": "reject_once"}
            ]
        }
    });
    match norm(f) {
        NormalizeOutcome::PermissionRequest(req) => {
            assert_eq!(req.request_id, json!(5), "agent request id 原样（number）");
            assert!(
                !req.permission_id.is_empty(),
                "permission_id 由 server 生成"
            );
            assert_eq!(req.tool_call_id.as_deref(), Some("tc1"));
            assert_eq!(req.title, "run cmd");
            assert_eq!(req.tool.tool_call_id, "tc1");
            assert_eq!(req.tool.name, "run cmd");
            assert_eq!(req.tool.arguments, Some(json!({"cmd": "cargo test"})));
            assert_eq!(req.description, None, "官方无 description 字段");
            assert_eq!(req.options.len(), 2, "官方 options 原样保留");
            assert_eq!(req.session_id, "acp-1");
        }
        other => panic!("expected permission request, got {other:?}"),
    }
    // string id 同样原样保留；title 回退 toolCallId。
    let s = json!({
        "jsonrpc": "2.0",
        "id": "req-7",
        "method": "session/request_permission",
        "params": {
            "sessionId": "acp-1",
            "toolCall": {"toolCallId": "tc2"},
            "options": [{"optionId": "o1", "name": "x", "kind": "allow_once"}]
        }
    });
    match norm(s) {
        NormalizeOutcome::PermissionRequest(req) => {
            assert_eq!(req.request_id, json!("req-7"));
            assert_eq!(req.title, "tc2", "title 回退 toolCall.toolCallId");
            assert_eq!(req.tool_call_id.as_deref(), Some("tc2"));
        }
        other => panic!("expected permission request, got {other:?}"),
    }
}
