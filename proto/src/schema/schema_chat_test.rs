//! Chat Doc 结构完整性测试（§12.1 可选）：additive 字段兼容 + camelCase 形态。

use crate::schema::{ChatEntry, EntryOrigin, ToolCallProjection};

use super::util::chat_root;

#[test]
fn chat_entry_replay_origin_is_additive_and_legacy_safe() {
    let mut root = chat_root();
    let entry = root.entries.get_mut("t1:assistant").unwrap();
    entry.origin = Some(EntryOrigin::SessionReplay);
    entry.replay_verified = Some(true);
    let value = serde_json::to_value(entry).unwrap();
    assert_eq!(value["origin"], "session_replay");
    assert_eq!(value["replayVerified"], true);

    let mut legacy = value.as_object().unwrap().clone();
    legacy.remove("origin");
    legacy.remove("replayVerified");
    let decoded: ChatEntry = serde_json::from_value(legacy.into()).unwrap();
    assert_eq!(decoded.origin, None);
    assert_eq!(decoded.replay_verified, None);
}

#[test]
fn chat_entry_source_command_id_is_an_additive_camel_case_field() {
    let mut root = chat_root();
    let entry = root.entries.get_mut("t1:assistant").unwrap();
    entry.source_command_id = Some("command-1".into());
    let value = serde_json::to_value(entry).unwrap();
    assert_eq!(value["sourceCommandId"], "command-1");

    let mut legacy = value.as_object().unwrap().clone();
    legacy.remove("sourceCommandId");
    let decoded: ChatEntry = serde_json::from_value(legacy.into()).unwrap();
    assert_eq!(decoded.source_command_id, None);
}

#[test]
fn tool_call_observation_times_are_additive_camel_case_fields() {
    let value = serde_json::to_value(chat_root().tool_calls.remove("tc1").unwrap()).unwrap();
    assert_eq!(value["startedAt"], "2026-08-07T00:00:00Z");
    assert_eq!(value["completedAt"], "2026-08-07T00:00:01Z");
    assert_eq!(value["resultOmitted"], false);
    assert_eq!(value["resultBytes"], 14);
    assert_eq!(value["kind"], "execute");
    assert_eq!(value["argumentsOmitted"], false);
    assert_eq!(value["argumentsBytes"], 12);

    let legacy = serde_json::json!({
        "toolCallId": "tc-old", "turnId": "t", "name": "shell", "status": "pending",
        "arguments": null, "result": null, "publicError": null, "permissionId": null
    });
    let decoded: ToolCallProjection = serde_json::from_value(legacy).unwrap();
    assert_eq!(decoded.started_at, None);
    assert_eq!(decoded.completed_at, None);
    assert_eq!(decoded.result_omitted, None);
    assert_eq!(decoded.result_bytes, None);
    assert_eq!(decoded.kind, crate::schema::ToolCallKind::Other);
    assert_eq!(decoded.arguments_omitted, None);
    assert_eq!(decoded.arguments_bytes, None);

    let reencoded = serde_json::to_value(decoded).unwrap();
    assert_eq!(reencoded["resultOmitted"], serde_json::Value::Null);
}
