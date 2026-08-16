//! 聚合器权限 → turn 状态机测试（§7.2 accepting → running ⇄
//! awaitingPermission；对应 `aggregator_write_control.rs` 权限侧写入）：
//! permission requested/resolved 推进 turn 状态、tool 生命周期与证据
//! 单调（sparse/late 帧）、公共错误投影 round-trip。

use super::util::*;

use serde_json::json;

use peri_studio_proto::action::PermissionDecision;
use peri_studio_proto::schema::{PermissionOptions, ToolCallStatus, TurnStatus};

use crate::state::aggregator::{Aggregator, ApplyReason};
use crate::state::normalized::EventBody;

// ---------------------------------------------------------------------------
// 15. 权限 → turn 状态推进（§7.2 状态机：accepting → running ⇄
//     awaitingPermission → terminal；对齐参考实现 resolve/expire 语义）
// ---------------------------------------------------------------------------

#[test]
fn permission_requested_advances_turn_to_awaiting_permission() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Accepting));
    // 权限请求发出 → 宿主等待决议（accepting → awaitingPermission）。
    assert!(
        agg.apply(&mut p, &ev("s1", 2, permission_requested("p1", "t1")))
            .applied
    );
    assert_eq!(active_turn_status(&p), Some(TurnStatus::AwaitingPermission));
    // 无关 turn 的权限请求被拒绝（防御：judge 终态守卫按 active_turn 校验），
    // 状态不受影响。
    let r = agg.apply(&mut p, &ev("s1", 3, permission_requested("p9", "t9")));
    assert!(!r.applied, "无关 turn 的权限请求应拒绝");
    assert_eq!(active_turn_status(&p), Some(TurnStatus::AwaitingPermission));
}

#[test]
fn permission_resolved_last_pending_advances_turn_to_running() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, permission_requested("p1", "t1")))
            .applied
    );
    assert!(
        agg.apply(&mut p, &ev("s1", 3, permission_requested("p2", "t1")))
            .applied
    );
    assert_eq!(permission_count(&p), 2);
    // 决议 p1：仍有 p2 pending → 保持 awaitingPermission。
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
    assert!(r.applied);
    assert_eq!(active_turn_status(&p), Some(TurnStatus::AwaitingPermission));
    // 决议 p2：无 pending → awaitingPermission → running（参考实现
    // resolve(allow) 语义）。
    let r = agg.apply(
        &mut p,
        &ev(
            "s1",
            5,
            EventBody::PermissionResolved {
                permission_id: "p2".into(),
                decision: PermissionDecision::Allow,
            },
        ),
    );
    assert!(r.applied);
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Running));
    assert_eq!(permission_count(&p), 2, "已决议条目保留（幂等面）");
}

#[test]
fn linked_tool_lifecycle_is_monotonic_across_updates_and_permission() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc1")))
            .applied
    );
    assert_eq!(tool_call(&p, "tc1").status, ToolCallStatus::Pending);
    assert!(entry_has_tool_block(&p, "t1:assistant", "tc1"));

    let running = EventBody::ToolCallUpdated {
        turn_id: "t1".into(),
        tool_call_id: "tc1".into(),
        status: Some(ToolCallStatus::Running),
        arguments: Some(json!({"cmd": "pwd"})),
    };
    assert!(agg.apply(&mut p, &ev("s1", 3, running)).applied);
    assert_eq!(tool_call(&p, "tc1").status, ToolCallStatus::Running);

    let stale_pending = EventBody::ToolCallUpdated {
        turn_id: "t1".into(),
        tool_call_id: "tc1".into(),
        status: Some(ToolCallStatus::Pending),
        arguments: None,
    };
    assert!(agg.apply(&mut p, &ev("s1", 4, stale_pending)).applied);
    assert_eq!(tool_call(&p, "tc1").status, ToolCallStatus::Running);

    let permission = EventBody::PermissionRequested {
        permission_id: "p1".into(),
        turn_id: "t1".into(),
        tool_call_id: Some("tc1".into()),
        tool: None,
        title: "允许执行".into(),
        description: None,
        options: vec![PermissionOptions::AllowOnce],
        expires_at: "2026-08-07T00:05:00Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 5, permission)).applied);
    let waiting = tool_call(&p, "tc1");
    assert_eq!(waiting.status, ToolCallStatus::AwaitingPermission);
    assert_eq!(waiting.permission_id.as_deref(), Some("p1"));

    let late_running = EventBody::ToolCallUpdated {
        turn_id: "t1".into(),
        tool_call_id: "tc1".into(),
        status: Some(ToolCallStatus::Running),
        arguments: Some(json!({"cmd": "pwd", "late": true})),
    };
    assert!(agg.apply(&mut p, &ev("s1", 6, late_running)).applied);
    assert_eq!(
        tool_call(&p, "tc1").status,
        ToolCallStatus::AwaitingPermission
    );

    let allow = EventBody::PermissionResolved {
        permission_id: "p1".into(),
        decision: PermissionDecision::Allow,
    };
    assert!(agg.apply(&mut p, &ev("s1", 7, allow)).applied);
    assert_eq!(tool_call(&p, "tc1").status, ToolCallStatus::Running);

    let completed = EventBody::ToolCallCompleted {
        turn_id: "t1".into(),
        tool_call_id: "tc1".into(),
        result: Some(json!({"ok": true})),
        public_error: None,
        completed_at: "2026-08-07T00:00:02Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 8, completed)).applied);
    assert_eq!(tool_call(&p, "tc1").status, ToolCallStatus::Completed);
}

#[test]
fn tool_evidence_is_monotonic_across_sparse_and_late_frames() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc1")))
            .applied
    );

    let sparse = EventBody::ToolCallUpdated {
        turn_id: "t1".into(),
        tool_call_id: "tc1".into(),
        status: Some(ToolCallStatus::Running),
        arguments: None,
    };
    assert!(agg.apply(&mut p, &ev("s1", 3, sparse)).applied);
    assert_eq!(tool_call(&p, "tc1").arguments, Some(json!({"cmd": "ls"})));

    let permission = EventBody::PermissionRequested {
        permission_id: "p1".into(),
        turn_id: "t1".into(),
        tool_call_id: Some("tc1".into()),
        tool: None,
        title: "允许执行".into(),
        description: None,
        options: vec![PermissionOptions::AllowOnce],
        expires_at: "2026-08-07T00:05:00Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 4, permission)).applied);

    let premature = EventBody::ToolCallCompleted {
        turn_id: "t1".into(),
        tool_call_id: "tc1".into(),
        result: Some(json!({"should_not_exist": true})),
        public_error: None,
        completed_at: "2026-08-07T00:00:02Z".into(),
    };
    let premature_result = agg.apply(&mut p, &ev("s1", 5, premature));
    assert!(!premature_result.applied);
    assert_eq!(
        premature_result.reason,
        Some(ApplyReason::AwaitingPermissionGuard)
    );
    let waiting = tool_call(&p, "tc1");
    assert_eq!(waiting.status, ToolCallStatus::AwaitingPermission);
    assert_eq!(waiting.result, None);
    assert_eq!(waiting.completed_at, None);

    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                6,
                EventBody::PermissionResolved {
                    permission_id: "p1".into(),
                    decision: PermissionDecision::Allow,
                },
            ),
        )
        .applied
    );
    let completed = EventBody::ToolCallCompleted {
        turn_id: "t1".into(),
        tool_call_id: "tc1".into(),
        result: Some(json!({"ok": true})),
        public_error: None,
        completed_at: "2026-08-07T00:00:03Z".into(),
    };
    assert!(agg.apply(&mut p, &ev("s1", 7, completed)).applied);
    let first_terminal = tool_call(&p, "tc1");
    assert_eq!(first_terminal.status, ToolCallStatus::Completed);
    assert_eq!(first_terminal.result, Some(json!({"ok": true})));

    let late_error = EventBody::ToolCallCompleted {
        turn_id: "t1".into(),
        tool_call_id: "tc1".into(),
        result: None,
        public_error: Some(peri_studio_proto::schema::PublicError {
            code: "late".into(),
            message: "must not overwrite".into(),
        }),
        completed_at: "2026-08-07T00:00:04Z".into(),
    };
    let late = agg.apply(&mut p, &ev("s1", 8, late_error));
    assert!(!late.applied);
    assert_eq!(late.reason, Some(ApplyReason::DuplicateIdempotent));
    assert_eq!(tool_call(&p, "tc1"), first_terminal);
}

