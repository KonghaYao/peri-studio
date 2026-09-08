//! 聚合器判定族测试·流水位与终态（对应 `aggregator_judge.rs` 的 stream
//! 判定与终态守卫）：终态守卫（§4.8 向量 4）、interrupted 校准恰一次
//! （§6.3 例外）、gap/epoch/seq 水位判定（§8.5/§9.4）、chat 终态拒绝
//! （§8.2）与关联检查（§9.2 步骤 6）。

use super::util::*;

use serde_json::json;
use yrs::WriteTxn;

use peri_studio_proto::action::PermissionDecision;
use peri_studio_proto::schema::{ActiveTurnProjection, ChatStatus, TurnStatus};

use crate::state::aggregator::{Aggregator, ApplyReason};
use crate::state::chat_writer;
use crate::state::factory::ROOT;
use crate::state::normalized::{EventBody, NormalizedEvent};

// ---------------------------------------------------------------------------
// 3. 终态守卫：cancelled 后晚到增量丢弃（§4.8 向量 4）
// ---------------------------------------------------------------------------

#[test]
fn terminal_turn_drops_late_deltas() {
    let mut p = pair();
    let mut agg = Aggregator;
    // turn 注册 + 内容 + 终态。
    seed_user_msg(&mut p, "t1", "t1:user", "hi");
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 2, msg_delta("t1", "t1:assistant", "b1", "out"))
        )
        .applied
    );
    let r = agg.apply(
        &mut p,
        &ev("s1", 3, turn_terminal("t1", TurnStatus::Cancelled)),
    );
    assert!(r.applied);
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Cancelled));

    // 晚到 delta → TurnTerminalGuard，doc 不变。
    let before = entry_count(&p);
    for seq in 4..6 {
        let r = agg.apply(
            &mut p,
            &ev("s1", seq, msg_delta("t1", "t1:assistant", "b1", "late")),
        );
        assert_eq!(r.reason, Some(ApplyReason::TurnTerminalGuard));
        assert_eq!(entry_count(&p), before);
    }
    // 晚到 tool_call updated → TurnTerminalGuard。
    let r = agg.apply(
        &mut p,
        &ev(
            "s1",
            6,
            EventBody::ToolCallUpdated {
                turn_id: "t1".into(),
                tool_call_id: "tc1".into(),
                status: None,
                arguments: Some(json!({"x": 1})),
            },
        ),
    );
    assert_eq!(r.reason, Some(ApplyReason::TurnTerminalGuard));
}

#[test]
fn cancelling_turn_drops_late_deltas() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "hi");
    // 手动置 cancelling（命令路径通常如此；此处直接写 active_turn）。
    {
        let mut txn = p.session_txn();
        let root = txn.get_or_insert_map(ROOT);
        chat_writer::set_active_turn(
            &mut txn,
            &root,
            Some(&ActiveTurnProjection {
                turn_id: "t1".into(),
                turn_status: TurnStatus::Cancelling,
                updated_at: "2026-08-07T00:00:01Z".into(),
            }),
        );
    }
    let r = agg.apply(
        &mut p,
        &ev("s1", 2, msg_delta("t1", "t1:assistant", "b1", "x")),
    );
    assert_eq!(r.reason, Some(ApplyReason::TurnTerminalGuard));
    // cancelling → 终态事件应用（状态机迁移，§7.2）。
    let r = agg.apply(
        &mut p,
        &ev("s1", 3, turn_terminal("t1", TurnStatus::Cancelled)),
    );
    assert!(r.applied);
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Cancelled));
}

// ---------------------------------------------------------------------------
// 4. interrupted 校准恰一次（§6.3 例外 / §9.3 双条件）
// ---------------------------------------------------------------------------

#[test]
fn interrupted_calibration_exactly_once() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "hi");
    // 断链：turn 置 interrupted（命令路径语义，聚合器事件亦支持）。
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 2, turn_terminal("t1", TurnStatus::Interrupted))
        )
        .applied
    );
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Interrupted));

    // interrupted 状态下：非终态事件 → InterruptedGuard。
    let r = agg.apply(
        &mut p,
        &ev("s1", 3, msg_delta("t1", "t1:assistant", "b1", "x")),
    );
    assert_eq!(r.reason, Some(ApplyReason::InterruptedGuard));

    // 带重放序依据（seq 单调）的终态事件 → 恰一次校准。
    let r = agg.apply(
        &mut p,
        &ev("s1", 4, turn_terminal("t1", TurnStatus::Completed)),
    );
    assert!(r.applied);
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Completed));

    // 校准后：任何同 turn 终态事件（高序）→ CalibrationDone。
    let r = agg.apply(
        &mut p,
        &ev("s1", 5, turn_terminal("t1", TurnStatus::Completed)),
    );
    assert_eq!(r.reason, Some(ApplyReason::CalibrationDone));
    let r = agg.apply(
        &mut p,
        &ev("s1", 6, turn_terminal("t1", TurnStatus::Failed)),
    );
    assert_eq!(r.reason, Some(ApplyReason::CalibrationDone));

    // 校准后 delta → TurnTerminalGuard（状态位已非 interrupted）。
    let r = agg.apply(
        &mut p,
        &ev("s1", 7, msg_delta("t1", "t1:assistant", "b1", "x")),
    );
    assert_eq!(r.reason, Some(ApplyReason::TurnTerminalGuard));
}

#[test]
fn interrupted_low_seq_terminal_rejected() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "hi");
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 5, turn_terminal("t1", TurnStatus::Interrupted))
        )
        .applied
    );
    // 乱序补推（seq 回退）→ SeqOutOfOrder（步骤 2 水位拒绝，§9.2）。
    let r = agg.apply(
        &mut p,
        &ev("s1", 3, turn_terminal("t1", TurnStatus::Completed)),
    );
    assert_eq!(r.reason, Some(ApplyReason::SeqOutOfOrder));
    // active_turn 仍为 interrupted（未被迁移）。
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Interrupted));
}

// ---------------------------------------------------------------------------
// 5. gap 计数（§8.5 / §9.4）
// ---------------------------------------------------------------------------

#[test]
fn gap_count_increments_on_seq_jump_and_clears_on_catchup() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 注入建立活动 turn（§6.5）；非回放 user 事件已被聚合器拒绝，seq 序列
    // 成员用 delta（judge_turn_guard 按 active_turn=t1 校验）。
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    // seq 连续：无 gap。
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 1, msg_delta("t1", "t1:assistant", "b1", "b"))
        )
        .applied
    );
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 2, msg_delta("t1", "t1:assistant", "b1", "c"))
        )
        .applied
    );
    assert_eq!(p.stream.gap_count, 0);
    assert!(!p.stream.gap_dirty);
    // seq 跳变：gap_count += 跳变。
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 5, msg_delta("t1", "t1:assistant", "b1", "d"))
        )
        .applied
    );
    assert_eq!(p.stream.gap_count, 2); // 期望 3，到达 5 → +2
    assert!(p.stream.gap_dirty);
    assert_eq!(p.stream.last_seq, 5);
    // 连续追平：清零 + 上报标记。
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 6, msg_delta("t1", "t1:assistant", "b1", "e"))
        )
        .applied
    );
    assert_eq!(p.stream.gap_count, 0);
    assert!(p.stream.gap_dirty);
}

#[test]
fn epoch_mismatch_marks_uncalibratable_and_rejects() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 注入建立 user turn（§6.5）；基线事件消费 seq 1（非回放 user 回声
    // 已被聚合器拒绝，用无 turn 依赖的事件占位）。
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                1,
                EventBody::SessionInfo {
                    title: None,
                    status: None,
                    active_turn_id: None,
                }
            )
        )
        .applied
    );
    // 新纪元帧：EpochMismatch + uncalibratable。
    let e = NormalizedEvent {
        chat_id: "s1".into(),
        seq: 2,
        epoch: 1,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        source_agent_id: None,
        callback_entry_id: None,
        body: user_msg("t2", "t2:user", "b"),
    };
    let r = agg.apply(&mut p, &e);
    assert_eq!(r.reason, Some(ApplyReason::EpochMismatch));
    assert!(p.stream.uncalibratable);
    assert!(p.stream.gap_dirty);
    // 同新纪元后续事件 → UncalibratableGap（拒绝一切投影）。
    let r = agg.apply(
        &mut p,
        &NormalizedEvent {
            chat_id: "s1".into(),
            seq: 3,
            epoch: 1,
            ts: "2026-08-07T00:00:00Z".to_string(),
            provenance: Default::default(),
            source_agent_id: None,
            callback_entry_id: None,
            body: user_msg("t3", "t3:user", "c"),
        },
    );
    assert_eq!(r.reason, Some(ApplyReason::UncalibratableGap));
    assert_eq!(entry_count(&p), 1);
}

/// 新 chat 首事件（instance 新开 chat epoch=1，§4.5.1）为基线采纳：
/// 采纳 epoch、不置不可校准缺口、本帧正常应用；后续同 epoch 事件照常。
/// （回归：真实 instance 的 epoch=1 首事件曾触发 uncalibratable 缺口，
/// 导致 turn_terminal 等全部后续事件被永久拒绝——relay_event_handler_test
/// 已知缺口注释记录的缺陷。）
#[test]
fn fresh_chat_first_event_adopts_epoch_baseline() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 命令路径先注册 active_turn（prompt committed 时 register_user_entry
    // 置 accepting，§7.2）。
    {
        let mut txn = p.session_txn();
        let root = txn.get_or_insert_map(ROOT);
        chat_writer::set_active_turn(
            &mut txn,
            &root,
            Some(&ActiveTurnProjection {
                turn_id: "t1".into(),
                turn_status: TurnStatus::Accepting,
                updated_at: "2026-08-07T00:00:01Z".into(),
            }),
        );
    }
    // 首事件 epoch=1（instance 新开 chat 基线，流起点 epoch=0）→ 基线
    // 采纳并应用本帧，不置不可校准缺口。
    let r = agg.apply(
        &mut p,
        &NormalizedEvent {
            chat_id: "s1".into(),
            seq: 3,
            epoch: 1,
            ts: "2026-08-07T00:00:00Z".to_string(),
            provenance: Default::default(),
            source_agent_id: None,
            callback_entry_id: None,
            body: msg_delta("t1", "t1:assistant", "b1", "chunk_1"),
        },
    );
    assert!(
        r.applied,
        "首事件应基线采纳并应用，实际 reason={:?}",
        r.reason
    );
    assert_eq!(p.stream.epoch, 1);
    assert!(!p.stream.uncalibratable, "基线采纳不得置不可校准缺口");
    assert_eq!(p.stream.last_seq, 3);
    // 后续同 epoch 事件（含 turn_terminal）正常应用，不被 UncalibratableGap 拒绝。
    let r = agg.apply(
        &mut p,
        &NormalizedEvent {
            chat_id: "s1".into(),
            seq: 5,
            epoch: 1,
            ts: "2026-08-07T00:00:00Z".to_string(),
            provenance: Default::default(),
            source_agent_id: None,
            callback_entry_id: None,
            body: turn_terminal("t1", TurnStatus::Cancelled),
        },
    );
    assert!(
        r.applied,
        "turn_terminal 应正常应用，实际 reason={:?}",
        r.reason
    );
    assert_eq!(active_turn_status(&p), Some(TurnStatus::Cancelled));
}

#[test]
fn seq_out_of_order_rejected() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 注入建立活动 turn（§6.5）；基线事件消费 seq 3。
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                3,
                EventBody::SessionInfo {
                    title: None,
                    status: None,
                    active_turn_id: None,
                }
            )
        )
        .applied
    );
    let r = agg.apply(&mut p, &ev("s1", 2, user_msg("t2", "t2:user", "b")));
    assert_eq!(r.reason, Some(ApplyReason::SeqOutOfOrder));
}

// ---------------------------------------------------------------------------
// 6. chat 终态（§8.2）：ended/closed/crashed 拒绝新事件
// ---------------------------------------------------------------------------

#[test]
fn closed_chat_rejects_new_events() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    // SessionInfo 置 closed。
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                2,
                EventBody::SessionInfo {
                    title: None,
                    status: Some(ChatStatus::Closed),
                    active_turn_id: None,
                }
            )
        )
        .applied
    );
    // 终态后新事件 → ChatClosed（事件体无关，judge 步骤 4 前置拒绝）。
    let r = agg.apply(
        &mut p,
        &ev("s1", 3, msg_delta("t2", "t2:assistant", "b1", "x")),
    );
    assert_eq!(r.reason, Some(ApplyReason::ChatClosed));
}

// ---------------------------------------------------------------------------
// 7. 关联检查（§9.2 步骤 6）
// ---------------------------------------------------------------------------

#[test]
fn unknown_tool_call_and_permission_rejected() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    // tool_call updated 引用未知 tool_call_id → UnknownToolCall。
    let r = agg.apply(
        &mut p,
        &ev(
            "s1",
            2,
            EventBody::ToolCallUpdated {
                turn_id: "t1".into(),
                tool_call_id: "nope".into(),
                status: None,
                arguments: None,
            },
        ),
    );
    assert_eq!(r.reason, Some(ApplyReason::UnknownToolCall));
    // permission resolved 引用未知 permission_id → UnknownPermission。
    let r = agg.apply(
        &mut p,
        &ev(
            "s1",
            3,
            EventBody::PermissionResolved {
                permission_id: "nope".into(),
                decision: PermissionDecision::Allow,
            },
        ),
    );
    assert_eq!(r.reason, Some(ApplyReason::UnknownPermission));
}

#[test]
fn unknown_turn_rejected_for_delta() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 无 active_turn 时 delta 到达：turn 未知（§9.2 步骤 6）。
    let r = agg.apply(
        &mut p,
        &ev("s1", 1, msg_delta("t1", "t1:assistant", "b1", "x")),
    );
    assert_eq!(r.reason, Some(ApplyReason::UnknownTurn));
}
