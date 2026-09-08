//! NormalizedEvent/EventBody 序列化契约测试（原 `normalized.rs` 内联 tests
//! 移出，§6.1）。断言：serde tag/信封字段名、全变体 roundtrip、legacy 缺省
//! 语义（tool status 默认 pending / permission tool snapshot 可缺）。

use std::collections::BTreeMap;

use serde_json::json;

use peri_studio_proto::action::PermissionDecision;
use peri_studio_proto::schema::{
    BlockVisibility, PermissionOptions, PeriTaskDetailAvailability, PeriTaskKind,
    SessionSummaryProjection, ToolCallStatus, TurnStatus,
};

use crate::state::normalized::{EventBody, EventProvenance, NormalizedEvent};

#[test]
fn serde_tag_and_envelope_shape() {
    let ev = NormalizedEvent {
        chat_id: "s1".into(),
        seq: 3,
        epoch: 1,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: EventProvenance::Unspecified,
        source_agent_id: None,
        callback_entry_id: None,
        body: EventBody::MessageDelta {
            turn_id: "t1".into(),
            entry_id: "t1:assistant".into(),
            block_id: "b1".into(),
            text: "hi".into(),
        },
    };
    let v = serde_json::to_value(&ev).unwrap();
    assert_eq!(v["sessionId"], json!("s1"));
    assert_eq!(v["seq"], json!(3));
    assert_eq!(v["epoch"], json!(1));
    assert_eq!(v["body"]["type"], json!("message_delta"));
    assert_eq!(v["body"]["turn_id"], json!("t1"));
    assert_eq!(v["body"]["block_id"], json!("b1"));
}

#[test]
fn serde_roundtrip_all_variants() {
    let bodies = vec![
        EventBody::MessageDelta {
            turn_id: "t".into(),
            entry_id: "e".into(),
            block_id: "b".into(),
            text: "x".into(),
        },
        EventBody::ReasoningDelta {
            turn_id: "t".into(),
            entry_id: "e".into(),
            block_id: "b".into(),
            text: "x".into(),
            visibility: BlockVisibility::Hidden,
        },
        EventBody::UserMessage {
            turn_id: "t".into(),
            entry_id: "t:user".into(),
            text: "x".into(),
            author_user_id: None,
            created_at: "2026-08-07T00:00:00Z".into(),
        },
        EventBody::ToolCallStarted {
            turn_id: "t".into(),
            tool_call_id: "tc1".into(),
            name: "n".into(),
            status: ToolCallStatus::Pending,
            arguments: Some(json!({"a": 1})),
            created_at: "2026-08-07T00:00:00Z".into(),
        },
        EventBody::ToolCallUpdated {
            turn_id: "t".into(),
            tool_call_id: "tc1".into(),
            status: None,
            arguments: None,
        },
        EventBody::ToolCallCompleted {
            turn_id: "t".into(),
            tool_call_id: "tc1".into(),
            result: None,
            public_error: None,
            completed_at: "2026-08-07T00:00:01Z".into(),
        },
        EventBody::PermissionRequested {
            permission_id: "p1".into(),
            turn_id: "t".into(),
            tool_call_id: None,
            tool: None,
            title: "x".into(),
            description: None,
            options: vec![PermissionOptions::AllowOnce],
            option_ids: Default::default(),
            expires_at: "2026-08-07T00:00:00Z".into(),
        },
        EventBody::PermissionResolved {
            permission_id: "p1".into(),
            decision: PermissionDecision::Allow,
        },
        EventBody::PermissionExpired {
            permission_id: "p1".into(),
        },
        EventBody::AgentStatus {
            status: "running".into(),
            public_error: None,
            model: Some("claude-sonnet-4-5".into()),
            context_window: Some(200_000),
            context_used: Some(42_000),
        },
        EventBody::AgentConfig {
            model: Some("claude-sonnet-4-5".into()),
            effort: Some("high".into()),
            config_options: None,
        },
        EventBody::AgentUsage {
            context_window: 200_000,
            context_used: 42_000,
            input_tokens: None,
            output_tokens: None,
            cache_creation_tokens: None,
            cache_read_tokens: None,
            request_id: None,
            model: None,
            stop_reason: None,
        },
        EventBody::Capabilities {
            capabilities: vec!["ls".into()],
            descriptions: BTreeMap::new(),
            skill_names: Vec::new(),
            mcp_skill_names: Vec::new(),
        },
        EventBody::InputPrediction {
            text: Some("检查失败测试".into()),
        },
        EventBody::SessionInfo {
            title: None,
            status: None,
            active_turn_id: None,
        },
        EventBody::SessionListResponse {
            entries: vec![SessionSummaryProjection {
                session_id: "s".into(),
                title: "x".into(),
                status: "completed".into(),
                updated_at: "2026-08-07T00:00:00Z".into(),
                cwd: String::new(),
                bound_chat_id: None,
            }],
        },
        EventBody::TurnTerminal {
            turn_id: "t".into(),
            status: TurnStatus::Completed,
            completed_at: "2026-08-07T00:00:00Z".into(),
            public_error: None,
        },
        EventBody::PeriTaskStarted {
            task_id: "task-1".into(),
            kind: PeriTaskKind::Subagent,
            task_subtype: None,
            title: "Task".into(),
            summary: None,
            source_started_at: None,
            is_background: false,
            detail_availability: PeriTaskDetailAvailability::Unavailable,
        },
        EventBody::PeriTaskCompleted {
            task_id: "task-1".into(),
            kind: PeriTaskKind::Background,
            success: true,
            summary: Some("ok".into()),
            duration_ms: Some(100),
            detail_availability: PeriTaskDetailAvailability::Preview,
        },
        EventBody::PeriTaskCancelled {
            task_id: "task-2".into(),
            kind: PeriTaskKind::Background,
            reason_code: Some("cancelled".into()),
        },
    ];
    for body in bodies {
        let s = serde_json::to_string(&body).unwrap();
        let back: EventBody = serde_json::from_str(&s).unwrap();
        assert_eq!(body, back, "roundtrip failed for {s}");
    }
}

#[test]
fn legacy_tool_events_default_missing_status_without_losing_arguments() {
    let started: EventBody = serde_json::from_value(json!({
        "type": "tool_call_started",
        "turn_id": "t1",
        "tool_call_id": "tc1",
        "name": "shell",
        "arguments": {"cmd": "pwd"},
        "created_at": "2026-08-07T00:00:00Z"
    }))
    .unwrap();
    assert!(matches!(
        started,
        EventBody::ToolCallStarted {
            status: ToolCallStatus::Pending,
            ..
        }
    ));

    let updated: EventBody = serde_json::from_value(json!({
        "type": "tool_call_updated",
        "turn_id": "t1",
        "tool_call_id": "tc1",
        "arguments": {"cmd": "pwd", "legacy": true}
    }))
    .unwrap();
    assert!(matches!(
        updated,
        EventBody::ToolCallUpdated { status: None, .. }
    ));
}

#[test]
fn legacy_permission_event_defaults_missing_tool_snapshot() {
    let event: EventBody = serde_json::from_value(json!({
        "type": "permission_requested",
        "permission_id": "p1",
        "turn_id": "t1",
        "tool_call_id": "tc1",
        "title": "允许执行",
        "description": null,
        "options": ["allowOnce"],
        "expires_at": "2026-08-07T00:05:00Z"
    }))
    .unwrap();
    assert!(matches!(
        event,
        EventBody::PermissionRequested {
            tool: None,
            tool_call_id: Some(ref id),
            ..
        } if id == "tc1"
    ));
}

#[test]
fn legacy_normalized_event_defaults_missing_source_agent_id() {
    let v = json!({
        "sessionId": "s1",
        "seq": 1,
        "epoch": 0,
        "body": { "type": "message_delta", "turn_id": "t", "entry_id": "e", "block_id": "b", "text": "x" }
    });
    let ev: NormalizedEvent = serde_json::from_value(v).unwrap();
    assert!(ev.source_agent_id.is_none());
}
