//! 事件映射：消息/推理/回合 + 工具调用（主题 2a/2b）
//!
//! 拆分动机：原 acp_channel_test.rs 1365 行超阈值（≤500 行要求），按
//! 「解析主题」拆出本文件；测试代码仅移动 + 文件级 use 调整，断言语义零改动。

use serde_json::json;

use super::*;
#[test]
fn extract_missing_session_id() {
    let f = json!({"type": "agent_message_chunk", "payload": {}});
    assert_eq!(extract_session_id(&f), None);
    assert!(matches!(
        norm(f),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}

// ---------------------------------------------------------------------------
// 2. 事件映射全表（§6.1 14 行 + RpcResponse）
// ---------------------------------------------------------------------------

#[test]
fn map_message_delta() {
    let f = json!({
        "type": "agent_message_chunk",
        "payload": {"turnId": "t1", "entryId": "t1:assistant", "blockId": "b1", "text": "hi"}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => {
            assert_eq!(ev.chat_id, "hub-s1");
            assert_eq!(ev.seq, 7);
            assert_eq!(ev.epoch, 1);
            assert_eq!(
                ev.body,
                EventBody::MessageDelta {
                    turn_id: "t1".into(),
                    entry_id: "t1:assistant".into(),
                    block_id: "b1".into(),
                    text: "hi".into(),
                }
            );
        }
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_reasoning_delta_visibility() {
    let f = json!({
        "type": "agent_thought_chunk",
        "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "think", "visibility": "hidden"}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => {
            assert_eq!(ev.body.kind(), "reasoning_delta");
            match ev.body {
                EventBody::ReasoningDelta { visibility, .. } => {
                    assert_eq!(visibility, BlockVisibility::Hidden)
                }
                _ => panic!("expected reasoning delta"),
            }
        }
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_reasoning_alias() {
    // 任务描述 agent_reasoning_chunk 别名 → 同一 ReasoningDelta（§3.2 冲突裁决）。
    let f = json!({
        "type": "agent_reasoning_chunk",
        "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "x"}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => assert_eq!(ev.body.kind(), "reasoning_delta"),
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn unknown_reasoning_visibility_fails_closed() {
    let f = json!({
        "type": "agent_thought_chunk",
        "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "private", "visibility": "internal"}
    });
    assert!(matches!(
        norm(f),
        NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
    ));
}

#[test]
fn map_user_message() {
    let f = json!({
        "type": "user_message_chunk",
        "payload": {"turnId": "t1", "entryId": "t1:user", "text": "hello", "authorUserId": "me"}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::UserMessage {
                turn_id,
                entry_id,
                text,
                author_user_id,
                created_at,
            } => {
                assert_eq!(turn_id, "t1");
                assert_eq!(entry_id, "t1:user");
                assert_eq!(text, "hello");
                assert_eq!(author_user_id.as_deref(), Some("me"));
                assert_eq!(created_at, "2026-08-07T00:00:00Z");
            }
            _ => panic!("expected user message"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_turn_terminal_completed() {
    for kind in ["prompt_complete", "agent_message_complete"] {
        let f = json!({"type": kind, "payload": {"turnId": "t1"}});
        match norm(f) {
            NormalizeOutcome::Event(ev) => match ev.body {
                EventBody::TurnTerminal { status, .. } => {
                    assert_eq!(status, TurnStatus::Completed)
                }
                _ => panic!("expected turn terminal"),
            },
            other => panic!("expected event, got {other:?}"),
        }
    }
}

#[test]
fn map_session_error_failed() {
    let f = json!({
        "type": "session_error",
        "payload": {"turnId": "t1", "publicError": {"code": "AGENT_UNAVAILABLE", "message": "boom"}}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::TurnTerminal {
                status,
                public_error,
                ..
            } => {
                assert_eq!(status, TurnStatus::Failed);
                let pe = public_error.unwrap();
                assert_eq!(pe.code, "AGENT_UNAVAILABLE");
                assert_eq!(pe.message, "boom");
            }
            _ => panic!("expected turn terminal"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_tool_call_started() {
    let f = json!({
        "type": "tool_call",
        "payload": {"turnId": "t1", "toolCallId": "tc1", "name": "bash", "arguments": {"cmd": "ls"}}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::ToolCallPatched {
                tool_call_id,
                patch,
                ..
            } => {
                assert_eq!(tool_call_id, "tc1");
                assert_eq!(patch.name.as_deref(), Some("bash"));
                assert_eq!(
                    patch.arguments,
                    ToolJsonPatch::Set {
                        value: json!({"cmd": "ls"})
                    }
                );
            }
            _ => panic!("expected tool call started"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_tool_call_update_running() {
    let f = json!({
        "type": "tool_call_update",
        "payload": {"turnId": "t1", "toolCallId": "tc1", "status": "running", "arguments": {"x": 1}}
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::ToolCallPatched { patch, .. } => {
                assert_eq!(
                    patch.arguments,
                    ToolJsonPatch::Set {
                        value: json!({"x": 1})
                    }
                );
                assert_eq!(patch.status, Some(ToolCallStatus::Running));
            }
            _ => panic!("expected tool call updated"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_official_tool_call_update_in_progress_is_update_not_duplicate_start() {
    let f = json!({
        "jsonrpc": "2.0", "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc1",
                "status": "in_progress",
                "rawInput": {"cmd": "pwd"}
            }
        }
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::ToolCallPatched { patch, .. } => {
                assert_eq!(patch.status, Some(ToolCallStatus::Running));
                assert_eq!(
                    patch.arguments,
                    ToolJsonPatch::Set {
                        value: json!({"cmd": "pwd"})
                    }
                );
            }
            other => panic!("expected tool call update, got {other:?}"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn official_tool_patch_preserves_kind_content_locations_and_failed_output() {
    let frame = json!({
        "jsonrpc": "2.0", "method": "session/update",
        "params": {"sessionId": "acp-1", "update": {
            "sessionUpdate": "tool_call_update", "toolCallId": "tc-rich",
            "title": "Run tests", "kind": "execute", "status": "failed",
            "rawInput": {"cmd": "cargo test"},
            "content": [{"type": "terminal", "terminalId": "term-1"}],
            "locations": [{"path": "server/src/lib.rs", "line": 7}],
            "rawOutput": {"exitCode": 1, "stderr": "failed assertion"}
        }}
    });
    let NormalizeOutcome::Event(event) = norm(frame) else {
        panic!("expected normalized event");
    };
    let EventBody::ToolCallPatched {
        tool_call_id,
        patch,
        ..
    } = event.body
    else {
        panic!("expected tool patch");
    };
    assert_eq!(tool_call_id, "tc-rich");
    assert_eq!(
        patch.kind,
        Some(peri_studio_proto::schema::ToolCallKind::Execute)
    );
    assert_eq!(patch.status, Some(ToolCallStatus::Error));
    assert!(matches!(patch.arguments, ToolJsonPatch::Set { .. }));
    assert!(matches!(patch.content, ToolJsonPatch::Set { .. }));
    assert!(matches!(patch.locations, ToolJsonPatch::Set { .. }));
    assert_eq!(
        patch.result,
        ToolJsonPatch::Set {
            value: json!({"exitCode": 1, "stderr": "failed assertion"})
        }
    );
    assert_eq!(patch.public_error.unwrap().code, "agent_error");
}

#[test]
fn official_tool_content_chunk_is_an_append_patch() {
    let frame = json!({
        "jsonrpc": "2.0", "method": "session/update",
        "params": {"sessionId": "acp-1", "update": {
            "sessionUpdate": "tool_call_content_chunk", "toolCallId": "tc-stream",
            "content": {"type": "content", "content": {"type": "text", "text": "part"}}
        }}
    });
    let NormalizeOutcome::Event(event) = norm(frame) else {
        panic!("expected normalized event");
    };
    let EventBody::ToolCallPatched { patch, .. } = event.body else {
        panic!("expected tool patch");
    };
    assert!(patch.append_content);
    assert!(matches!(patch.content, ToolJsonPatch::Set { .. }));
}

#[test]
fn oversized_official_arguments_are_explicitly_omitted_with_bytes() {
    let huge = "x".repeat(5000);
    let frame = json!({
        "jsonrpc": "2.0", "method": "session/update",
        "params": {"sessionId": "acp-1", "update": {
            "sessionUpdate": "tool_call_update", "toolCallId": "tc-large",
            "rawInput": {"text": huge}
        }}
    });
    let NormalizeOutcome::Event(event) = norm(frame) else {
        panic!("expected normalized event");
    };
    let EventBody::ToolCallPatched { patch, .. } = event.body else {
        panic!("expected tool patch");
    };
    assert!(matches!(patch.arguments, ToolJsonPatch::Omitted { bytes } if bytes > 4096));
}

#[test]
fn oversized_mcp_app_arguments_with_source_stay_set_for_first_paint() {
    let huge = "x".repeat(5000);
    let frame = json!({
        "jsonrpc": "2.0", "method": "session/update",
        "params": {"sessionId": "acp-1", "update": {
            "sessionUpdate": "tool_call_update",
            "toolCallId": "tc-canvas",
            "title": "mcp__cursor-canvas__show_canvas",
            "rawInput": {"source": huge, "canvasId": "c1"}
        }}
    });
    let NormalizeOutcome::Event(event) = norm(frame) else {
        panic!("expected normalized event");
    };
    let EventBody::ToolCallPatched { patch, .. } = event.body else {
        panic!("expected tool patch");
    };
    match patch.arguments {
        ToolJsonPatch::Set { value } => {
            assert_eq!(value["source"].as_str().unwrap().len(), 5000);
        }
        other => panic!("expected Set arguments, got {other:?}"),
    }
}

#[test]
fn raw_terminal_aliases_map_to_exact_terminal_statuses() {
    for (wire, expected) in [
        ("complete", ToolCallStatus::Completed),
        ("done", ToolCallStatus::Completed),
        ("cancelled", ToolCallStatus::Cancelled),
    ] {
        let frame = json!({
            "type": "tool_call_update",
            "payload": {"turnId": "t1", "toolCallId": format!("tc-{wire}"), "status": wire}
        });
        let NormalizeOutcome::Event(event) = norm(frame) else {
            panic!("expected normalized event");
        };
        let EventBody::ToolCallPatched { patch, .. } = event.body else {
            panic!("expected tool patch");
        };
        assert_eq!(patch.status, Some(expected));
        assert!(patch.completed_at.is_some());
    }
}

#[test]
fn request_permission_missing_fields_dropped() {
    // 缺 options / toolCallId / sessionId / option.optionId / id →
    // MissingField（§6.3 同源拒绝；无 id 无法回响应，非 notification）。
    let no_options = json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/request_permission",
        "params": {"sessionId": "acp-1", "toolCall": {"toolCallId": "tc1"}}
    });
    assert!(matches!(
        norm(no_options),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
    let no_tool_call_id = json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/request_permission",
        "params": {"sessionId": "acp-1", "toolCall": {"title": "x"},
                   "options": [{"optionId": "o1", "name": "n", "kind": "allow_once"}]}
    });
    assert!(matches!(
        norm(no_tool_call_id),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
    let no_session = json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/request_permission",
        "params": {"toolCall": {"toolCallId": "tc1"},
                   "options": [{"optionId": "o1", "name": "n", "kind": "allow_once"}]}
    });
    assert!(matches!(
        norm(no_session),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
    let bad_option = json!({
        "jsonrpc": "2.0", "id": 1, "method": "session/request_permission",
        "params": {"sessionId": "acp-1", "toolCall": {"toolCallId": "tc1"},
                   "options": [{"name": "n", "kind": "allow_once"}]}
    });
    assert!(matches!(
        norm(bad_option),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
    let no_id = json!({
        "jsonrpc": "2.0", "method": "session/request_permission",
        "params": {"sessionId": "acp-1", "toolCall": {"toolCallId": "tc1"},
                   "options": [{"optionId": "o1", "name": "n", "kind": "allow_once"}]}
    });
    assert!(matches!(
        norm(no_id),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}

#[test]
fn overlong_authoritative_tool_ids_are_rejected_instead_of_truncated() {
    let shared = "x".repeat(256);
    for suffix in ["a", "b"] {
        let frame = json!({
            "jsonrpc": "2.0", "method": "session/update",
            "params": {"sessionId": "acp-1", "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": format!("{shared}{suffix}"),
                "status": "running"
            }}
        });
        assert!(matches!(
            norm(frame),
            NormalizeOutcome::Dropped(DropReason::MissingField)
        ));
    }
}
