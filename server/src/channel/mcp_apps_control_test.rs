use peri_studio_proto::ack::ErrorCode;

use crate::channel::mcp_apps_control::{apps_error, gate_mcp_app_open, silent_apps_error};
use crate::protocol::parse_mcp_tool_name;
use peri_studio_proto::schema::{ToolCallProjection, ToolCallStatus};

fn tool_projection(name: &str, status: ToolCallStatus) -> ToolCallProjection {
    ToolCallProjection {
        tool_call_id: "t1".into(),
        turn_id: "turn".into(),
        name: name.into(),
        kind: Default::default(),
        status,
        arguments: None,
        arguments_omitted: None,
        arguments_bytes: None,
        content: None,
        content_omitted: None,
        content_bytes: None,
        locations: None,
        locations_omitted: None,
        locations_bytes: None,
        result: None,
        result_omitted: None,
        result_bytes: None,
        public_error: None,
        permission_id: None,
        started_at: None,
        completed_at: None,
        mcp_server_id: None,
        mcp_tool_name: None,
        mcp_resource_uri: None,
        mcp_app_session_id: None,
    }
}

#[test]
fn silent_apps_error_uses_message_code() {
    let err = silent_apps_error("cmd-1", "policy_denied");
    assert_eq!(err.code, ErrorCode::InvalidState);
    assert_eq!(err.message, "policy_denied");
}

#[test]
fn parse_mcp_name_for_open_gate() {
    let parsed = parse_mcp_tool_name("mcp__fixture__get_dashboard").unwrap();
    assert_eq!(parsed.server_id, "fixture");
    assert_eq!(parsed.tool_name, "get_dashboard");
}

#[test]
fn apps_error_maps_agent_unavailable() {
    let err = apps_error("cmd", ErrorCode::AgentUnavailable, "agent_unavailable");
    assert_eq!(err.message, "agent_unavailable");
}

#[test]
fn gate_open_rejects_non_completed_and_non_mcp_tools() {
    let completed = tool_projection("mcp__fixture__tool", ToolCallStatus::Completed);
    assert!(gate_mcp_app_open("cmd", &completed).is_ok());

    let running = tool_projection("mcp__fixture__tool", ToolCallStatus::Running);
    assert_eq!(
        gate_mcp_app_open("cmd", &running).unwrap_err().message,
        "policy_denied"
    );

    let plain = tool_projection("compact", ToolCallStatus::Completed);
    assert_eq!(
        gate_mcp_app_open("cmd", &plain).unwrap_err().message,
        "unsupported"
    );
}

#[test]
fn as_mcp_app_call_tool_result_wraps_output_schema() {
    use crate::channel::relay_event_handler::{
        as_mcp_app_call_tool_result, merge_mcp_app_tool_result,
    };
    use serde_json::json;

    let output =
        json!({"canvasId": "c1", "source": "export default function App() { return null }"});
    let wrapped = as_mcp_app_call_tool_result(output.clone());
    assert_eq!(wrapped["structuredContent"], output);
    assert!(wrapped["content"].as_array().is_some());

    let already = json!({
        "content": [{"type": "text", "text": "ok"}],
        "structuredContent": {"source": "tsx"}
    });
    assert_eq!(as_mcp_app_call_tool_result(already.clone()), already);

    let content_only = json!({"content": [{"type": "text", "text": "Canvas ready"}]});
    let input =
        json!({"canvasId": "c1", "source": "export default function App() { return null }"});
    let merged = merge_mcp_app_tool_result(Some(content_only), Some(input.clone())).unwrap();
    assert_eq!(merged["structuredContent"], input);
    assert_eq!(merged["content"][0]["text"], "Canvas ready");
}
