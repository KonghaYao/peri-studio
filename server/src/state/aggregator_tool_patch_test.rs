//! ACP 1.6 工具 patch、update-first 与晚到终态证据回归。

use super::util::*;

use peri_studio_proto::schema::{PermissionOptions, ToolCallKind, ToolCallStatus, TurnStatus};
use serde_json::json;
use yrs::{Map, Transact};

use crate::state::{
    aggregator::{Aggregator, ApplyReason},
    normalized::{EventBody, ToolCallPatch, ToolJsonPatch},
};

#[test]
fn permission_first_after_text_uses_one_ordered_tool_segment() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, msg_delta("", "", "", "before")))
            .applied
    );
    let permission = EventBody::PermissionRequested {
        permission_id: "perm".into(),
        turn_id: "t1".into(),
        tool_call_id: Some("tc-perm".into()),
        tool: Some(crate::state::normalized::PermissionToolSnapshot {
            tool_call_id: "tc-perm".into(),
            name: "Run".into(),
            arguments: Some(json!({"cmd": "pwd"})),
            arguments_omitted: Some(false),
            arguments_bytes: Some(13),
            kind: Some(ToolCallKind::Execute),
            content: None,
            content_omitted: None,
            content_bytes: None,
            locations: None,
            locations_omitted: None,
            locations_bytes: None,
            result: None,
            result_omitted: None,
            result_bytes: None,
        }),
        title: "Allow".into(),
        description: None,
        options: vec![PermissionOptions::AllowOnce],
        option_ids: None,
        expires_at: "2026-08-07T00:05:00Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 3, permission)).applied);
    let official = EventBody::ToolCallPatched {
        turn_id: String::new(),
        tool_call_id: "tc-perm".into(),
        patch: ToolCallPatch {
            name: Some("Run resolved".into()),
            kind: Some(ToolCallKind::Execute),
            status: Some(ToolCallStatus::Running),
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 4, official)).applied);
    assert!(!entry_has_tool_block(&p, "t1:assistant", "tc-perm"));
    assert!(entry_has_tool_block(&p, "t1:assistant:2", "tc-perm"));
    assert_eq!(tool_call_count(&p), 1);
}

#[test]
fn turn_terminal_finalizes_every_assistant_segment() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, msg_delta("", "", "", "before")))
            .applied
    );
    assert!(
        agg.apply(&mut p, &ev("s1", 3, tool_started("t1", "tc-segment")))
            .applied
    );
    assert!(
        agg.apply(&mut p, &ev("s1", 4, msg_delta("", "", "", "after")))
            .applied
    );
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 5, turn_terminal("t1", TurnStatus::Completed)),
        )
        .applied
    );

    let txn = p.chat.transact();
    let root = crate::state::chat_writer::root_map_read(&txn).unwrap();
    let entries = root
        .get(&txn, "entries")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .unwrap();
    let statuses: Vec<String> = entries
        .iter(&txn)
        .filter_map(|(_, value)| value.cast::<yrs::MapRef>().ok())
        .filter(|entry| {
            entry
                .get(&txn, "turn_id")
                .and_then(|value| value.cast::<String>().ok())
                .as_deref()
                == Some("t1")
                && entry
                    .get(&txn, "role")
                    .and_then(|value| value.cast::<String>().ok())
                    .as_deref()
                    == Some("assistant")
        })
        .filter_map(|entry| {
            entry
                .get(&txn, "status")
                .and_then(|value| value.cast::<String>().ok())
        })
        .collect();
    assert_eq!(statuses.len(), 3);
    assert!(statuses.iter().all(|status| status == "completed"));
}

#[test]
fn update_first_tool_patch_creates_authoritative_projection_and_appends_content() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    let initial = EventBody::ToolCallPatched {
        turn_id: String::new(),
        tool_call_id: "tc-update-first".into(),
        patch: ToolCallPatch {
            name: Some("Run tests".into()),
            kind: Some(ToolCallKind::Execute),
            status: Some(ToolCallStatus::Running),
            arguments: ToolJsonPatch::Set {
                value: json!({"cmd": "cargo test"}),
            },
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 2, initial)).applied);
    let chunk = EventBody::ToolCallPatched {
        turn_id: String::new(),
        tool_call_id: "tc-update-first".into(),
        patch: ToolCallPatch {
            content: ToolJsonPatch::Set {
                value: json!({"type": "content", "text": "one"}),
            },
            append_content: true,
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 3, chunk)).applied);
    let tool = tool_call(&p, "tc-update-first");
    assert_eq!(tool.kind, ToolCallKind::Execute);
    assert_eq!(tool.arguments, Some(json!({"cmd": "cargo test"})));
    assert_eq!(
        tool.content,
        Some(json!([{"type": "content", "text": "one"}]))
    );
    assert!(entry_has_tool_block(&p, "t1:assistant", "tc-update-first"));
}

#[test]
fn omitted_arguments_and_failed_output_remain_explicit_in_projection() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    let failed = EventBody::ToolCallPatched {
        turn_id: String::new(),
        tool_call_id: "tc-failed".into(),
        patch: ToolCallPatch {
            kind: Some(ToolCallKind::Execute),
            status: Some(ToolCallStatus::Error),
            arguments: ToolJsonPatch::Omitted { bytes: 5001 },
            result: ToolJsonPatch::Set {
                value: json!({"stderr": "boom", "exitCode": 1}),
            },
            public_error: Some(peri_studio_proto::schema::PublicError {
                code: "agent_error".into(),
                message: "Tool call failed".into(),
            }),
            completed_at: Some("2026-08-07T00:00:02Z".into()),
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 2, failed)).applied);
    let tool = tool_call(&p, "tc-failed");
    assert_eq!(tool.status, ToolCallStatus::Error);
    assert_eq!(tool.arguments, None);
    assert_eq!(tool.arguments_omitted, Some(true));
    assert_eq!(tool.arguments_bytes, Some(5001));
    assert_eq!(tool.result, Some(json!({"stderr": "boom", "exitCode": 1})));
}

#[test]
fn oversized_argument_set_is_omitted_from_chat_doc() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    let patched = EventBody::ToolCallPatched {
        turn_id: String::new(),
        tool_call_id: "tc-canvas-args".into(),
        patch: ToolCallPatch {
            status: Some(ToolCallStatus::Completed),
            arguments: ToolJsonPatch::Set {
                value: json!({"source": "x".repeat(5000)}),
            },
            completed_at: Some("2026-08-07T00:00:02Z".into()),
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 2, patched)).applied);
    let tool = tool_call(&p, "tc-canvas-args");
    assert_eq!(tool.arguments, None);
    assert_eq!(tool.arguments_omitted, Some(true));
    assert!(tool.arguments_bytes.unwrap() > 4096);
}

#[test]
fn terminal_turn_settles_running_tool_and_late_terminal_can_fill_missing_output_once() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc-late")))
            .applied
    );
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 3, turn_terminal("t1", TurnStatus::Completed)),
        )
        .applied
    );
    assert_eq!(tool_call(&p, "tc-late").status, ToolCallStatus::Completed);

    let late = EventBody::ToolCallPatched {
        turn_id: String::new(),
        tool_call_id: "tc-late".into(),
        patch: ToolCallPatch {
            status: Some(ToolCallStatus::Completed),
            result: ToolJsonPatch::Set {
                value: json!({"stdout": "ok"}),
            },
            completed_at: Some("2026-08-07T00:00:02Z".into()),
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 4, late.clone())).applied);
    assert_eq!(
        tool_call(&p, "tc-late").result,
        Some(json!({"stdout": "ok"}))
    );
    let duplicate = agg.apply(&mut p, &ev("s1", 5, late));
    assert!(!duplicate.applied);
    assert_eq!(duplicate.reason, Some(ApplyReason::DuplicateIdempotent));
}

#[test]
fn streamed_content_budget_is_cumulative_and_overflow_is_sticky() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    let chunk = |text: String| EventBody::ToolCallPatched {
        turn_id: String::new(),
        tool_call_id: "tc-stream-budget".into(),
        patch: ToolCallPatch {
            content: ToolJsonPatch::Set { value: json!(text) },
            append_content: true,
            ..Default::default()
        },
    };

    assert!(
        agg.apply(&mut p, &ev("s1", 2, chunk("a".repeat(3000))))
            .applied
    );
    assert!(
        agg.apply(&mut p, &ev("s1", 3, chunk("b".repeat(2000))))
            .applied
    );
    let overflowed = tool_call(&p, "tc-stream-budget");
    assert_eq!(overflowed.content, None);
    assert_eq!(overflowed.content_omitted, Some(true));
    let observed = overflowed.content_bytes.expect("observed bytes");
    assert!(observed > 4096);

    assert!(agg.apply(&mut p, &ev("s1", 4, chunk("ok".into()))).applied);
    let later = tool_call(&p, "tc-stream-budget");
    assert_eq!(later.content, None);
    assert_eq!(later.content_omitted, Some(true));
    assert!(later.content_bytes.expect("observed bytes") > observed);
}

#[test]
fn late_patch_for_existing_tool_does_not_create_another_tool_segment() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc-late-segment")))
            .applied
    );
    assert!(
        agg.apply(&mut p, &ev("s1", 3, msg_delta("", "", "", "after")))
            .applied
    );
    let before = entry_count(&p);
    let late = EventBody::ToolCallPatched {
        turn_id: "t1".into(),
        tool_call_id: "tc-late-segment".into(),
        patch: ToolCallPatch {
            content: ToolJsonPatch::Set {
                value: json!({"text": "late"}),
            },
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 4, late)).applied);
    assert_eq!(entry_count(&p), before);
    assert!(entry_has_tool_block(&p, "t1:assistant", "tc-late-segment"));
}

#[test]
fn interrupted_turn_and_awaiting_permission_accept_late_evidence_without_illegal_status_jump() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc-interrupted")))
            .applied
    );
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 3, turn_terminal("t1", TurnStatus::Interrupted))
        )
        .applied
    );
    let late = EventBody::ToolCallPatched {
        turn_id: "t1".into(),
        tool_call_id: "tc-interrupted".into(),
        patch: ToolCallPatch {
            result: ToolJsonPatch::Set {
                value: json!({"stdout": "late"}),
            },
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 4, late)).applied);
    assert_eq!(
        tool_call(&p, "tc-interrupted").result,
        Some(json!({"stdout": "late"}))
    );

    let permission = EventBody::PermissionRequested {
        permission_id: "perm-guard".into(),
        turn_id: "t2".into(),
        tool_call_id: Some("tc-permission".into()),
        tool: Some(crate::state::normalized::PermissionToolSnapshot {
            tool_call_id: "tc-permission".into(),
            name: "Run".into(),
            kind: Some(ToolCallKind::Execute),
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
        }),
        title: "Allow".into(),
        description: None,
        options: vec![PermissionOptions::AllowOnce],
        option_ids: None,
        expires_at: "2026-08-07T00:05:00Z".into(),
    };
    seed_user_msg(&mut p, "t2", "t2:user", "b");
    assert!(agg.apply(&mut p, &ev("s1", 5, permission)).applied);
    let denied_terminal = EventBody::ToolCallPatched {
        turn_id: "t2".into(),
        tool_call_id: "tc-permission".into(),
        patch: ToolCallPatch {
            status: Some(ToolCallStatus::Completed),
            result: ToolJsonPatch::Set {
                value: json!({"stdout": "evidence"}),
            },
            ..Default::default()
        },
    };
    assert!(agg.apply(&mut p, &ev("s1", 6, denied_terminal)).applied);
    let guarded = tool_call(&p, "tc-permission");
    assert_eq!(guarded.status, ToolCallStatus::AwaitingPermission);
    assert_eq!(guarded.result, Some(json!({"stdout": "evidence"})));
}
