use peri_studio_proto::schema::{ToolCallKind, ToolCallStatus};
use peri_studio_server::{
    protocol::{AcpChannel, NormalizeOutcome},
    state::normalized::{EventBody, ToolJsonPatch},
};
use serde_json::{json, Value};

fn normalize(update: Value) -> EventBody {
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": { "sessionId": "acp-acceptance", "update": update }
    });
    match AcpChannel::default().normalize("chat-acceptance", 3, 41, "2026-08-27T03:00:00Z", &frame)
    {
        NormalizeOutcome::Event(event) => event.body,
        other => panic!("expected normalized event, got {other:?}"),
    }
}

fn patch(update: Value) -> peri_studio_server::state::normalized::ToolCallPatch {
    match normalize(update) {
        EventBody::ToolCallPatched { patch, .. } => patch,
        other => panic!("expected tool-call patch, got {other:?}"),
    }
}

#[test]
fn official_snapshot_keeps_kind_content_locations_and_raw_io() {
    let patch = patch(json!({
        "sessionUpdate": "tool_call",
        "toolCallId": "official-execute",
        "title": "Run checks",
        "kind": "execute",
        "status": "in_progress",
        "rawInput": { "command": "cargo test -p peri-studio-server" },
        "rawOutput": { "stdout": "running" },
        "content": [{ "type": "content", "content": { "type": "text", "text": "initial evidence" } }],
        "locations": [{ "path": "server/src/protocol/acp_channel.rs", "line": 182 }]
    }));

    assert_eq!(patch.kind, Some(ToolCallKind::Execute));
    assert_eq!(patch.status, Some(ToolCallStatus::Running));
    assert!(
        matches!(patch.arguments, ToolJsonPatch::Set { value } if value["command"] == "cargo test -p peri-studio-server")
    );
    assert!(matches!(patch.result, ToolJsonPatch::Set { value } if value["stdout"] == "running"));
    assert!(
        matches!(patch.content, ToolJsonPatch::Set { value } if value[0]["content"]["text"] == "initial evidence")
    );
    assert!(
        matches!(patch.locations, ToolJsonPatch::Set { value } if value[0]["path"] == "server/src/protocol/acp_channel.rs")
    );
}

#[test]
fn update_first_and_late_evidence_are_normalized_without_a_start_dependency() {
    let update_first = patch(json!({
        "sessionUpdate": "tool_call_update",
        "toolCallId": "update-first",
        "kind": "read",
        "status": "in_progress",
        "rawInput": { "file_path": "README.md" }
    }));
    assert_eq!(update_first.kind, Some(ToolCallKind::Read));
    assert_eq!(update_first.status, Some(ToolCallStatus::Running));
    assert!(
        matches!(update_first.arguments, ToolJsonPatch::Set { value } if value["file_path"] == "README.md")
    );

    let terminal = patch(json!({
        "sessionUpdate": "tool_call_update",
        "toolCallId": "update-first",
        "status": "completed"
    }));
    assert_eq!(terminal.status, Some(ToolCallStatus::Completed));
    assert!(terminal.completed_at.is_some());

    // 有些 Agent 在终态之后补交证据；聚合层仍需收到追加 patch。
    let late_chunk = patch(json!({
        "sessionUpdate": "tool_call_content_chunk",
        "toolCallId": "update-first",
        "content": { "type": "text", "text": "late evidence sentinel" }
    }));
    assert!(late_chunk.append_content);
    assert!(
        matches!(late_chunk.content, ToolJsonPatch::Set { value } if value["text"] == "late evidence sentinel")
    );
}

#[test]
fn terminal_aliases_and_failed_stderr_keep_authoritative_state() {
    for status in ["completed", "complete", "done"] {
        let patch = patch(json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": format!("terminal-{status}"),
            "status": status,
            "rawOutput": { "stdout": "ok", "exitCode": 0 }
        }));
        assert_eq!(
            patch.status,
            Some(ToolCallStatus::Completed),
            "alias {status}"
        );
        assert!(patch.completed_at.is_some(), "alias {status}");
    }

    for status in ["cancelled", "canceled"] {
        assert_eq!(
            patch(json!({ "sessionUpdate": "tool_call_update", "toolCallId": status, "status": status })).status,
            Some(ToolCallStatus::Cancelled),
        );
    }

    let failed = patch(json!({
        "sessionUpdate": "tool_call_update",
        "toolCallId": "failed-stderr",
        "title": "Build failed",
        "status": "failed",
        "rawOutput": { "stdout": "", "stderr": "compiler stderr sentinel", "exitCode": 101 }
    }));
    assert_eq!(failed.status, Some(ToolCallStatus::Error));
    assert!(failed.public_error.is_some());
    assert!(
        matches!(failed.result, ToolJsonPatch::Set { value } if value["stderr"] == "compiler stderr sentinel" && value["exitCode"] == 101)
    );
}

#[test]
fn oversized_arguments_are_explicitly_omitted_instead_of_silently_empty() {
    let patch = patch(json!({
        "sessionUpdate": "tool_call",
        "toolCallId": "large-input",
        "kind": "edit",
        "rawInput": { "content": "x".repeat(8_192) }
    }));
    assert!(matches!(patch.arguments, ToolJsonPatch::Omitted { bytes } if bytes > 4_096));
}

#[test]
fn raw_output_without_status_stays_non_terminal() {
    let running = patch(json!({
        "sessionUpdate": "tool_call_update",
        "toolCallId": "result-only",
        "status": "in_progress",
        "rawOutput": { "stdout": "partial" }
    }));
    assert_eq!(running.status, Some(ToolCallStatus::Running));

    let result_only = patch(json!({
        "sessionUpdate": "tool_call_update",
        "toolCallId": "result-only",
        "rawOutput": { "stdout": "done", "exitCode": 0 }
    }));
    assert_eq!(result_only.status, None, "ACP: rawOutput alone must not imply completed");
    assert!(result_only.completed_at.is_none());
    assert!(
        matches!(result_only.result, ToolJsonPatch::Set { value } if value["stdout"] == "done")
    );
}

#[test]
fn status_aliases_and_case_insensitive_terminal_values() {
    for status in ["success", "Succeeded", "FINISHED", "OK"] {
        let patch = patch(json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": format!("alias-{status}"),
            "status": status
        }));
        assert_eq!(
            patch.status,
            Some(ToolCallStatus::Completed),
            "alias {status}"
        );
    }

    assert_eq!(
        patch(json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "pending-explicit",
            "status": "pending"
        }))
        .status,
        Some(ToolCallStatus::Pending)
    );
}
