//! Peri Task 通道规范化测试。

use serde_json::json;

use peri_studio_proto::schema::{PeriTaskDetailAvailability, PeriTaskKind, PeriTaskSubtype};

use crate::protocol::acp_channel::{AcpChannel, DropReason, NormalizeOutcome};
use crate::state::normalized::EventBody;

use super::{bounded_summary, extract_source_agent_id, PERI_AGENT_EVENT_METHOD};

#[test]
fn extract_source_agent_id_from_params_meta() {
    let params = json!({
        "_meta": { "peri": { "sourceAgentId": "child_agent_1" } },
        "update": { "sessionUpdate": "agent_message_chunk" }
    })
    .as_object()
    .unwrap()
    .clone();
    assert_eq!(
        extract_source_agent_id(&params).as_deref(),
        Some("child_agent_1")
    );
}

#[test]
fn extract_source_agent_id_empty_is_none() {
    let params = json!({ "_meta": { "peri": { "sourceAgentId": "" } } })
        .as_object()
        .unwrap()
        .clone();
    assert!(extract_source_agent_id(&params).is_none());
}

#[test]
fn bounded_summary_redacts_and_truncates() {
    let long = "a".repeat(300);
    let out = bounded_summary(&json!(format!("https://secret.test/x {long}"))).unwrap();
    assert!(out.contains("[REDACTED_URL]"));
    assert!(out.chars().count() <= 240);
}

#[test]
fn normalize_peri_agent_event_subagent_started() {
    let ch = AcpChannel::default();
    let frame = json!({
        "jsonrpc": "2.0",
        "method": PERI_AGENT_EVENT_METHOD,
        "params": {
            "event_json": r#"{"type":"subagent_started","value":{"instance_id":"inst-1","agent_name":"Reviewer","is_background":true}}"#
        }
    });
    let out = ch.normalize("chat-1", 0, 1, "2026-08-07T00:00:00Z", &frame);
    let NormalizeOutcome::Event(ev) = out else {
        panic!("expected event");
    };
    assert!(ev.source_agent_id.is_none());
    assert!(matches!(
        ev.body,
        EventBody::PeriTaskStarted {
            task_id,
            kind: PeriTaskKind::Subagent,
            task_subtype: None,
            is_background: true,
            detail_availability: PeriTaskDetailAvailability::Unavailable,
            ..
        } if task_id == "inst-1"
    ));
}

#[test]
fn normalize_peri_agent_event_subagent_stopped_summary() {
    let ch = AcpChannel::default();
    let frame = json!({
        "jsonrpc": "2.0",
        "method": PERI_AGENT_EVENT_METHOD,
        "params": {
            "event_json": r#"{"type":"subagent_stopped","value":{"instance_id":"inst-1","is_error":false,"result":"done ok"}}"#
        }
    });
    let out = ch.normalize("chat-1", 0, 2, "2026-08-07T00:00:00Z", &frame);
    let NormalizeOutcome::Event(ev) = out else {
        panic!("expected event");
    };
    assert!(matches!(
        ev.body,
        EventBody::PeriTaskCompleted {
            success: true,
            detail_availability: PeriTaskDetailAvailability::Preview,
            summary: Some(_),
            ..
        }
    ));
}

#[test]
fn normalize_session_update_carries_source_agent_id() {
    let ch = AcpChannel::default();
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "_meta": { "peri": { "sourceAgentId": "child_agent_1" } },
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "hi" }
            }
        }
    });
    let out = ch.normalize("chat-1", 0, 3, "2026-08-07T00:00:00Z", &frame);
    let NormalizeOutcome::Event(ev) = out else {
        panic!("expected event, got {out:?}");
    };
    assert_eq!(ev.source_agent_id.as_deref(), Some("child_agent_1"));
}

#[test]
fn normalize_unstable_bg_task_started() {
    let ch = AcpChannel::default();
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "peri/unstable_event",
        "params": {
            "event": "bg-task-started",
            "data": {
                "task_id": "bg-1",
                "kind": "shell",
                "summary": "run tests",
                "started_at": "2026-08-07T00:00:00Z"
            }
        }
    });
    let out = ch.normalize("chat-1", 0, 4, "2026-08-07T00:00:00Z", &frame);
    let NormalizeOutcome::Event(ev) = out else {
        panic!("expected event");
    };
    assert!(matches!(
        ev.body,
        EventBody::PeriTaskStarted {
            kind: PeriTaskKind::Background,
            task_subtype: Some(PeriTaskSubtype::Shell),
            is_background: true,
            ..
        }
    ));
}

#[test]
fn normalize_rejects_invalid_agent_event_json() {
    let ch = AcpChannel::default();
    let frame = json!({
        "jsonrpc": "2.0",
        "method": PERI_AGENT_EVENT_METHOD,
        "params": { "event_json": "not-json" }
    });
    assert!(matches!(
        ch.normalize("c", 0, 1, "2026-08-07T00:00:00Z", &frame),
        NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
    ));
}

#[test]
fn normalize_rejects_missing_instance_id() {
    let ch = AcpChannel::default();
    let frame = json!({
        "jsonrpc": "2.0",
        "method": PERI_AGENT_EVENT_METHOD,
        "params": {
            "event_json": r#"{"type":"subagent_started","value":{"agent_name":"x"}}"#
        }
    });
    assert!(matches!(
        ch.normalize("c", 0, 1, "2026-08-07T00:00:00Z", &frame),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}
