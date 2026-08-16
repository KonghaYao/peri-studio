use super::parse_session_list_response;

#[test]
fn parser_accepts_camel_case_and_defaults_status() {
    let response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "hub-1",
        "result": {
            "sessions": [
                { "sessionId": "sess-1", "title": "会话A", "updatedAt": "2026-08-09T00:00:00Z" },
                { "sessionId": "sess-2", "title": "会话B", "cwd": "/tmp" }
            ]
        }
    });
    let entries = parse_session_list_response(&response);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].session_id, "sess-1");
    assert_eq!(entries[0].title, "会话A");
    assert_eq!(entries[0].status, "");
    assert_eq!(entries[0].updated_at, "2026-08-09T00:00:00Z");
    assert_eq!(entries[1].updated_at, "");
}

#[test]
fn parser_handles_snake_case_and_drops_invalid_entries() {
    let response = serde_json::json!({
        "result": {
            "sessions": [
                { "session_id": "s1", "status": "completed" },
                { "sessionId": "" }
            ]
        }
    });
    let entries = parse_session_list_response(&response);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].session_id, "s1");
    assert_eq!(entries[0].status, "completed");
}

#[test]
fn parser_rejects_error_missing_and_non_array_results() {
    for response in [
        serde_json::json!({ "error": { "code": -32603, "message": "x" } }),
        serde_json::json!({ "result": {} }),
        serde_json::json!({ "result": { "sessions": null } }),
    ] {
        assert!(parse_session_list_response(&response).is_empty());
    }
}
