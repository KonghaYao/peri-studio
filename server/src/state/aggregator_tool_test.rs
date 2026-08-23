//! 聚合器 tool 卡片与回放合成测试（对应 `aggregator_write_tool.rs`/
//! `aggregator_write_control.rs`）：permission 先行的 tool card 原子
//! 合成、deny/expired 收敛、终态收敛不覆写已完成、running 启动推进
//! turn，以及回放合成占位（§8.5 REPLAY_NEEDS_TURN）。

use super::util::*;

use serde_json::json;
use yrs::{Map, Transact};

use peri_studio_proto::action::PermissionDecision;
use peri_studio_proto::schema::{BlockVisibility, PermissionOptions, ToolCallStatus, TurnStatus};

use crate::state::aggregator::Aggregator;
use crate::state::chat_writer;
use crate::state::normalized::EventBody;

#[test]
fn tool_error_projection_roundtrips_nested_public_error() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc-error")))
            .applied
    );
    let failed = EventBody::ToolCallCompleted {
        turn_id: "t1".into(),
        tool_call_id: "tc-error".into(),
        result: None,
        public_error: Some(peri_studio_proto::schema::PublicError {
            code: "exit_1".into(),
            message: "command failed".into(),
        }),
        completed_at: "2026-08-07T00:00:02Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 3, failed)).applied);
    assert_eq!(
        tool_call(&p, "tc-error").public_error,
        Some(peri_studio_proto::schema::PublicError {
            code: "exit_1".into(),
            message: "command failed".into(),
        })
    );
}

#[test]
fn permission_first_atomically_synthesizes_reachable_tool_card() {
    use crate::state::normalized::PermissionToolSnapshot;

    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");

    let permission = EventBody::PermissionRequested {
        permission_id: "p-first".into(),
        turn_id: "t1".into(),
        tool_call_id: Some("tc-first".into()),
        tool: Some(PermissionToolSnapshot {
            tool_call_id: "tc-first".into(),
            name: "run command".into(),
            arguments: Some(json!({"cmd": "cargo test"})),
        }),
        title: "允许执行".into(),
        description: None,
        options: vec![PermissionOptions::AllowOnce],
        expires_at: "2026-08-07T00:05:00Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 2, permission)).applied);

    let tool = tool_call(&p, "tc-first");
    assert_eq!(tool.turn_id, "t1");
    assert_eq!(tool.name, "run command");
    assert_eq!(tool.arguments, Some(json!({"cmd": "cargo test"})));
    assert_eq!(tool.status, ToolCallStatus::AwaitingPermission);
    assert_eq!(tool.permission_id.as_deref(), Some("p-first"));
    assert!(entry_has_tool_block(&p, "t1:assistant", "tc-first"));
    assert_eq!(active_turn_status(&p), Some(TurnStatus::AwaitingPermission));

    let official_start = EventBody::ToolCallStarted {
        turn_id: "t1".into(),
        tool_call_id: "tc-first".into(),
        name: "run command (resolved)".into(),
        status: ToolCallStatus::Running,
        arguments: Some(json!({"cmd": "cargo test", "all": true})),
        created_at: "2026-08-07T00:00:01Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 3, official_start)).applied);
    let enriched = tool_call(&p, "tc-first");
    assert_eq!(enriched.name, "run command (resolved)");
    assert_eq!(
        enriched.arguments,
        Some(json!({"cmd": "cargo test", "all": true}))
    );
    assert_eq!(enriched.status, ToolCallStatus::AwaitingPermission);
    assert_eq!(enriched.permission_id.as_deref(), Some("p-first"));
    assert!(entry_has_tool_block(&p, "t1:assistant", "tc-first"));
}

#[test]
fn running_tool_start_advances_accepting_turn_without_content_delta() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    let started = EventBody::ToolCallStarted {
        turn_id: "t1".into(),
        tool_call_id: "tc1".into(),
        name: "shell".into(),
        status: ToolCallStatus::Running,
        arguments: None,
        created_at: "2026-08-07T00:00:00Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 2, started)).applied);
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Running));
}

#[test]
fn replay_starting_with_tool_call_synthesizes_turn_and_reachable_block() {
    let mut p = pair();
    p.stream.replay_active = true;
    let mut agg = Aggregator;
    let started = EventBody::ToolCallStarted {
        turn_id: String::new(),
        tool_call_id: "replayed-tool".into(),
        name: "shell".into(),
        status: ToolCallStatus::Running,
        arguments: Some(json!({"cmd": "pwd"})),
        created_at: "2026-08-07T00:00:00Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 1, started)).applied);
    let tool = tool_call(&p, "replayed-tool");
    assert_eq!(tool.turn_id, "load:1");
    assert_eq!(tool.started_at, None, "回放通知时间不是原执行开始时间");
    assert!(entry_has_tool_block(
        &p,
        "load:1:assistant",
        "replayed-tool"
    ));

    let completed = EventBody::ToolCallCompleted {
        turn_id: String::new(),
        tool_call_id: "replayed-tool".into(),
        result: Some(json!({"ok": true})),
        public_error: None,
        completed_at: "2026-08-07T00:00:05Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 2, completed)).applied);
    let tool = tool_call(&p, "replayed-tool");
    assert_eq!(tool.status, ToolCallStatus::Completed);
    assert_eq!(tool.result, Some(json!({"ok": true})));
    assert_eq!(tool.completed_at, None, "回放通知时间不是原执行完成时间");
}

#[test]
fn linked_permission_deny_cancels_tool_and_turn() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc1")))
            .applied
    );
    let request = EventBody::PermissionRequested {
        permission_id: "p1".into(),
        turn_id: "t1".into(),
        tool_call_id: Some("tc1".into()),
        tool: None,
        title: "允许执行".into(),
        description: None,
        options: vec![PermissionOptions::AllowOnce],
        expires_at: "2026-08-07T00:05:00Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 3, request)).applied);
    let deny = EventBody::PermissionResolved {
        permission_id: "p1".into(),
        decision: PermissionDecision::Deny,
    };
    assert!(agg.apply(&mut p, &ev("s1", 4, deny)).applied);
    assert_eq!(tool_call(&p, "tc1").status, ToolCallStatus::Cancelled);
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Cancelled));
}

#[test]
fn tool_waits_until_its_last_linked_permission_is_allowed() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc1")))
            .applied
    );
    for (seq, id) in [(3, "p1"), (4, "p2")] {
        let request = EventBody::PermissionRequested {
            permission_id: id.into(),
            turn_id: "t1".into(),
            tool_call_id: Some("tc1".into()),
            tool: None,
            title: "允许执行".into(),
            description: None,
            options: vec![PermissionOptions::AllowOnce],
            expires_at: "2026-08-07T00:05:00Z".into(),
        };
        assert!(agg.apply(&mut p, &ev("s1", seq, request)).applied);
    }
    let allow = |id: &str| EventBody::PermissionResolved {
        permission_id: id.into(),
        decision: PermissionDecision::Allow,
    };
    assert!(agg.apply(&mut p, &ev("s1", 5, allow("p1"))).applied);
    assert_eq!(
        tool_call(&p, "tc1").status,
        ToolCallStatus::AwaitingPermission
    );
    assert!(agg.apply(&mut p, &ev("s1", 6, allow("p2"))).applied);
    assert_eq!(tool_call(&p, "tc1").status, ToolCallStatus::Running);
}

#[test]
fn cancelled_turn_converges_every_nonterminal_tool_without_overwriting_completed() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "running")))
            .applied
    );
    assert!(
        agg.apply(&mut p, &ev("s1", 3, tool_started("t1", "done")))
            .applied
    );
    let completed = EventBody::ToolCallCompleted {
        turn_id: "t1".into(),
        tool_call_id: "done".into(),
        result: None,
        public_error: None,
        completed_at: "2026-08-07T00:00:01Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 4, completed)).applied);
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 5, turn_terminal("t1", TurnStatus::Cancelled)),
        )
        .applied
    );
    assert_eq!(tool_call(&p, "running").status, ToolCallStatus::Cancelled);
    assert_eq!(tool_call(&p, "done").status, ToolCallStatus::Completed);
}

#[test]
fn permission_expired_last_pending_cancels_turn() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, permission_requested("p1", "t1")))
            .applied
    );
    assert_eq!(active_turn_status(&p), Some(TurnStatus::AwaitingPermission));
    // 未决议权限过期 → 该 turn 取消（参考实现 expire 语义）。
    let r = agg.apply(
        &mut p,
        &ev(
            "s1",
            3,
            EventBody::PermissionExpired {
                permission_id: "p1".into(),
            },
        ),
    );
    assert!(r.applied);
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Cancelled));
    // 终态后晚到决议不再推进（守卫；状态已 cancelled，set_active_turn_status_if
    // 条件不满足）。
    let r = agg.apply(
        &mut p,
        &ev(
            "s1",
            4,
            EventBody::PermissionResolved {
                permission_id: "p1".into(),
                decision: PermissionDecision::Allow,
            },
        ),
    );
    assert!(r.applied, "CAS 幂等：已 expired 的决议 applied（不迁移）");
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Cancelled));
}

#[test]
fn content_delta_advances_turn_from_accepting_to_running() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Accepting));
    // 首条内容增量 → accepting → running（参考实现：首条内容即 turn 开始
    // 运行）。
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 2, msg_delta("t1", "t1:assistant", "b1", "chunk"))
        )
        .applied
    );
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Running));
    // 后续增量不再迁移（已 running，条件不满足；状态保持）。
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 3, msg_delta("t1", "t1:assistant", "b1", "more"))
        )
        .applied
    );
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Running));
    // awaitingPermission 状态下增量到达不覆盖（等决议语义，§7.2）。
    assert!(
        agg.apply(&mut p, &ev("s1", 4, permission_requested("p1", "t1")))
            .applied
    );
    assert_eq!(active_turn_status(&p), Some(TurnStatus::AwaitingPermission));
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 5, msg_delta("t1", "t1:assistant", "b1", "after-perm"))
        )
        .applied
    );
    assert_eq!(
        active_turn_status(&p),
        Some(TurnStatus::AwaitingPermission),
        "等待决议期间增量不推进状态"
    );
}

// ---------------------------------------------------------------------------
// 16. 回放合成（§8.5 REPLAY_NEEDS_TURN）：历史首帧即为 agent 增量时合成
//     空文本 user 占位 turn，杜绝空 id 垃圾条目
// ---------------------------------------------------------------------------

#[test]
fn replay_first_delta_synthesizes_placeholder_turn() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 进入回放模式（BeginLoadReplay 命令路径的等价状态；聚合器测试直接
    // 操作内存 stream）。
    p.stream.replay_active = true;
    p.stream.replay_turn = None;
    p.stream.replay_turns.clear();
    // 首事件即 agent 增量（无 user 先行）——按参考 REPLAY_NEEDS_TURN
    // 合成空文本 user 占位 turn 后归位。
    let r = agg.apply(
        &mut p,
        &ev(
            "s1",
            1,
            EventBody::MessageDelta {
                turn_id: String::new(),
                entry_id: String::new(),
                block_id: String::new(),
                text: "chunk_1".into(),
            },
        ),
    );
    assert!(r.applied);
    // 占位 turn 已建立：user 占位 + assistant 增量两条 entry，无空 id。
    assert_eq!(entry_count(&p), 2);
    let txn = p.chat.transact();
    let entries = chat_writer::root_map_read(&txn)
        .unwrap()
        .get(&txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    for key in entries.keys(&txn) {
        assert!(!key.is_empty(), "回放增量不得产生空 id 条目");
    }
    assert!(p.stream.replay_turn.is_some());
    drop(txn);
    // 后续同 turn 增量归位到同一占位 turn（不重复合成）。
    let r = agg.apply(
        &mut p,
        &ev(
            "s1",
            2,
            EventBody::ReasoningDelta {
                turn_id: String::new(),
                entry_id: String::new(),
                block_id: String::new(),
                text: "thinking".into(),
                visibility: BlockVisibility::Summary,
            },
        ),
    );
    assert!(r.applied);
    assert_eq!(entry_count(&p), 2, "同 turn 增量不重复合成");
}
