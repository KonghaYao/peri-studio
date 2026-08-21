//! 聚合器判定族测试·回放与幂等（对应 `aggregator_judge.rs` 的幂等键
//! 判定）：回放 provenance 归属（§8.5 REPLAY 窗口能力协商）、幂等重放
//! （§4.8 向量 3）与 user_message 幂等（§6.5 回声拒绝；服务端单写
//! 注入路径的索引一致性）。

use super::util::*;

use yrs::{Map, Transact, WriteTxn};

use crate::state::aggregator::{Aggregator, ApplyReason};
use crate::state::chat_writer;
use crate::state::factory::ROOT;
use crate::state::normalized::EventProvenance;

#[test]
fn replay_origin_requires_window_capability_and_exact_producer_marker() {
    let mut pair = pair();
    pair.stream.replay_active = true;
    enable_replay(&mut pair);
    let mut event = ev("s1", 1, user_msg("", "", "history"));
    event.provenance = EventProvenance::PeriReplay;
    assert!(Aggregator.apply(&mut pair, &event).applied);
    assert_eq!(
        entry_origin(&pair, "load:1:user"),
        (Some("session_replay".into()), Some(true))
    );

    let unmarked = ev("s1", 2, msg_delta("", "", "", "answer"));
    assert!(Aggregator.apply(&mut pair, &unmarked).applied);
    assert_eq!(
        entry_origin(&pair, "load:1:assistant"),
        (Some("session_replay".into()), Some(false))
    );
}

#[test]
fn producer_marker_outside_load_window_cannot_claim_replay_origin() {
    let mut pair = pair();
    enable_replay(&mut pair);
    // 注入路径建立 user entry（§6.5 服务端单写；无 origin 字段 = live 来源，
    // 无回放标记）。
    seed_user_msg(&mut pair, "t1", "t1:user", "live");
    assert_eq!(entry_origin(&pair, "t1:user"), (None, None));
    // 非回放回声携带 PeriReplay 生产者标记（load 窗口外）→ 聚合器拒绝
    // （§6.5），不得借标记覆写既有 entry 的 live 来源。
    let mut event = ev("s1", 1, user_msg("t1", "t1:user", "live"));
    event.provenance = EventProvenance::PeriReplay;
    let r = Aggregator.apply(&mut pair, &event);
    assert!(!r.applied);
    assert_eq!(
        entry_origin(&pair, "t1:user"),
        (None, None),
        "load 窗口外的回放标记不得改写 live 来源"
    );
}

#[test]
fn unnegotiated_replay_is_inferred_not_verified() {
    let mut pair = pair();
    pair.stream.replay_active = true;
    let mut event = ev("s1", 1, user_msg("", "", "history"));
    event.provenance = EventProvenance::PeriReplay;
    assert!(Aggregator.apply(&mut pair, &event).applied);
    assert_eq!(
        entry_origin(&pair, "load:1:user"),
        (Some("session_replay".into()), Some(false))
    );
}

// ---------------------------------------------------------------------------
// 1. 幂等重放（§4.8 向量 3）
// ---------------------------------------------------------------------------

#[test]
fn replay_same_event_is_seq_out_of_order_and_no_dup() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 注入路径建立 user turn（§6.5 服务端单写）。
    seed_user_msg(&mut p, "t1", "t1:user", "hello");
    let e = ev("s1", 1, user_msg("t1", "t1:user", "hello"));
    // 非回放回声被聚合器拒绝（§6.5），但 seq 水位已消费。
    let _ = agg.apply(&mut p, &e);
    // 同 seq 重放：水位拒绝（§9.2 步骤 2），不重复创建。
    let r = agg.apply(&mut p, &e);
    assert!(!r.applied);
    assert_eq!(r.reason, Some(ApplyReason::SeqOutOfOrder));
    assert_eq!(entry_count(&p), 1);
}

#[test]
fn replay_same_business_key_new_seq_is_duplicate_idempotent() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 注入路径建立 user turn（§6.5 服务端单写）；user 幂等由注入路径承担
    // （chat_writer 同 turn 幂等），聚合器层回声一律拒绝。
    seed_user_msg(&mut p, "t1", "t1:user", "hello");
    // 回声（不同 seq、同 business key）→ 拒绝，不重复创建。
    let r = agg.apply(&mut p, &ev("s1", 1, user_msg("t1", "t1:user", "hello")));
    assert!(!r.applied);
    assert_eq!(entry_count(&p), 1);

    // tool_call started 重放（不同 seq）：幂等键拒绝，不重复创建。
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc1")))
            .applied
    );
    let r = agg.apply(&mut p, &ev("s1", 3, tool_started("t1", "tc1")));
    assert_eq!(r.reason, Some(ApplyReason::DuplicateIdempotent));
    assert_eq!(tool_call_count(&p), 1);

    // permission requested 重放（不同 seq）：幂等键拒绝。
    assert!(
        agg.apply(&mut p, &ev("s1", 4, permission_requested("p1", "t1")))
            .applied
    );
    let r = agg.apply(&mut p, &ev("s1", 5, permission_requested("p1", "t1")));
    assert_eq!(r.reason, Some(ApplyReason::DuplicateIdempotent));
    assert_eq!(permission_count(&p), 1);
}

// ---------------------------------------------------------------------------
// 2. user_message 幂等（§6.5）
// ---------------------------------------------------------------------------

#[test]
fn non_replay_user_message_echo_rejected() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 非回放 UserMessage 事件（ACP 回声形态）一律拒绝（§6.5 服务端单写；
    // 回声绕过幂等键会双写同文本 user entry——"hello hello" 回归锚点）。
    let r = agg.apply(&mut p, &ev("s1", 1, user_msg("t1", "t1:user", "hello")));
    assert_eq!(r.reason, Some(ApplyReason::UnknownTurn));
    assert!(!r.applied);
    assert_eq!(entry_count(&p), 0);
}

/// "hello hello" 双写 bug 的回归锚点（§6.5）：注入路径建立 user turn 后，
/// ACP 回声 user 消息（agent 自造 turn_id/entry_id、同文本）必须被拒绝，
/// entry 数保持 1。
#[test]
fn echo_user_message_after_injection_rejected() {
    let mut p = pair();
    let mut agg = Aggregator;
    // 注入 pending entry（服务端单写，§6.5 RegisterPendingPromptEntry 等价
    // 效果：server 生成 turn id）。
    seed_user_msg(&mut p, "t-<uuid>", "<uuid>:user", "hello");
    assert_eq!(entry_count(&p), 1);
    // ACP 回声：自造 id、同文本 → 拒绝（UnknownTurn），不双写。
    let r = agg.apply(
        &mut p,
        &ev("s1", 1, user_msg("echo-turn", "echo-entry", "hello")),
    );
    assert_eq!(r.reason, Some(ApplyReason::UnknownTurn));
    assert!(!r.applied);
    assert_eq!(entry_count(&p), 1);
}

#[test]
fn user_entry_injection_same_turn_different_entry_id_is_duplicate() {
    let mut p = pair();
    // 注入路径建立 user turn（§6.5 服务端单写）。
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    // 同 turn 不同 entry_id（legacy/Hub 混合路径）二次注入：chat_writer
    // 经索引幂等（§P1-6 跨 entry_id 语义锚点），不创建第二个 user entry。
    let mut txn = p.chat_txn();
    let root = txn.get_or_insert_map(ROOT);
    let reg = chat_writer::create_user_entry(
        &mut txn,
        &root,
        "t1",
        "legacy:user",
        "b",
        None,
        None,
        "2026-08-07T00:00:00Z",
    );
    assert_eq!(reg, chat_writer::UserEntryRegistration::Duplicate);
    drop(txn);
    assert_eq!(entry_count(&p), 1);
}

#[test]
fn user_entry_index_consistent_after_apply() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    {
        let txn = p.chat.transact();
        let root = chat_writer::root_map_read(&txn).unwrap();
        let index = root
            .get(&txn, chat_writer::USER_ENTRY_INDEX)
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        assert_eq!(
            index.get(&txn, "t1").unwrap().cast::<String>().unwrap(),
            "t1:user"
        );
    }
    // 回放合成路径（§8.5）：`load:{seq}:user` 同样写索引。
    p.stream.replay_active = true;
    assert!(
        agg.apply(&mut p, &ev("s1", 1, user_msg("", "", "history")))
            .applied
    );
    {
        let txn = p.chat.transact();
        let root = chat_writer::root_map_read(&txn).unwrap();
        let index = root
            .get(&txn, chat_writer::USER_ENTRY_INDEX)
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        assert_eq!(
            index.get(&txn, "load:1").unwrap().cast::<String>().unwrap(),
            "load:1:user"
        );
    }
}
