//! 聚合器写入族测试（对应 `aggregator_write.rs` 的 chat 侧写入）：
//! 工具结果截断（§9.5 上限与投影事实）、双 Doc 事务顺序（§7.4 chat
//! 先于 control）与微批次合并（§6.4 单事务 + 回放 provenance 保留）。

use super::util::*;

use serde_json::json;
use yrs::{Array, GetString, Map, Transact};

use crate::state::aggregator::Aggregator;
use crate::state::chat_writer;
use crate::state::normalized::{EventBody, EventProvenance, NormalizedEvent};

// ---------------------------------------------------------------------------
// 8. 工具结果截断（§9.5）
// ---------------------------------------------------------------------------

#[test]
fn oversized_tool_result_truncated() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "tc1")))
            .applied
    );
    let big = json!({"data": "x".repeat(5000)});
    let big_bytes = serde_json::to_vec(&big).unwrap().len() as f64;
    let r = agg.apply(
        &mut p,
        &ev(
            "s1",
            3,
            EventBody::ToolCallCompleted {
                turn_id: "t1".into(),
                tool_call_id: "tc1".into(),
                result: Some(big),
                public_error: None,
                completed_at: "2026-08-07T00:00:01Z".into(),
            },
        ),
    );
    assert!(r.applied);
    // result 超阈值 → 不写（None）。
    let txn = p.chat.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let calls = root
        .get(&txn, "tool_calls")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let cm = calls
        .get(&txn, "tc1")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(cm.get(&txn, "result"), Some(yrs::Out::Any(yrs::Any::Null)));
    assert_eq!(
        cm.get(&txn, "result_omitted")
            .and_then(|value| value.cast::<bool>().ok()),
        Some(true)
    );
    assert_eq!(
        cm.get(&txn, "result_bytes")
            .and_then(|value| value.cast::<f64>().ok()),
        Some(big_bytes)
    );
    assert_eq!(
        cm.get(&txn, "started_at")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("2026-08-07T00:00:00Z")
    );
    assert_eq!(
        cm.get(&txn, "completed_at")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("2026-08-07T00:00:01Z")
    );
    let _ = root;
}

#[test]
fn retained_and_absent_tool_results_have_distinct_projection_facts() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert!(
        agg.apply(&mut p, &ev("s1", 2, tool_started("t1", "kept")))
            .applied
    );
    let kept = json!({"ok": true});
    let kept_bytes = serde_json::to_vec(&kept).unwrap().len() as f64;
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                3,
                EventBody::ToolCallCompleted {
                    turn_id: "t1".into(),
                    tool_call_id: "kept".into(),
                    result: Some(kept),
                    public_error: None,
                    completed_at: "2026-08-07T00:00:01Z".into(),
                }
            )
        )
        .applied
    );
    assert!(
        agg.apply(&mut p, &ev("s1", 4, tool_started("t1", "empty")))
            .applied
    );
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                5,
                EventBody::ToolCallCompleted {
                    turn_id: "t1".into(),
                    tool_call_id: "empty".into(),
                    result: None,
                    public_error: None,
                    completed_at: "2026-08-07T00:00:02Z".into(),
                }
            )
        )
        .applied
    );

    let txn = p.chat.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let calls = root
        .get(&txn, "tool_calls")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let kept = calls
        .get(&txn, "kept")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        kept.get(&txn, "result_omitted")
            .and_then(|v| v.cast::<bool>().ok()),
        Some(false)
    );
    assert_eq!(
        kept.get(&txn, "result_bytes")
            .and_then(|v| v.cast::<f64>().ok()),
        Some(kept_bytes)
    );
    assert_ne!(
        kept.get(&txn, "result"),
        Some(yrs::Out::Any(yrs::Any::Null))
    );
    let empty = calls
        .get(&txn, "empty")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        empty
            .get(&txn, "result_omitted")
            .and_then(|v| v.cast::<bool>().ok()),
        Some(false)
    );
    assert_eq!(
        empty.get(&txn, "result_bytes"),
        Some(yrs::Out::Any(yrs::Any::Null))
    );
    assert_eq!(
        empty.get(&txn, "result"),
        Some(yrs::Out::Any(yrs::Any::Null))
    );
}

// ---------------------------------------------------------------------------
// 9. 双 Doc 事务顺序（§7.4）：chat 先于 control
// ---------------------------------------------------------------------------

#[test]
fn chat_transaction_precedes_control() {
    let mut p = pair();
    // 注册观察：记录 update 提交顺序（经观察回调，与 DocManager 同路径）。
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let doc_chat = p.chat.clone();
    let doc_session = p.session.clone();
    let tx_chat = tx.clone();
    let tx_session = tx;
    let _sub1 = doc_chat
        .observe_update_v1(move |_, e| {
            let _ = tx_chat.send(format!("chat:{}", e.update.len()));
        })
        .unwrap();
    let _sub2 = doc_session
        .observe_update_v1(move |_, e| {
            let _ = tx_session.send(format!("session:{}", e.update.len()));
        })
        .unwrap();

    // 注入模拟同时写 chat（entry）+ session（active_turn），事务顺序
    // chat 先于 control（§7.4）。
    seed_user_msg(&mut p, "t1", "t1:user", "hi");
    // 顺序断言：chat update 先于 session update。
    let mut seqs = Vec::new();
    while let Ok(s) = rx.try_recv() {
        seqs.push(s);
    }
    let chat_idx = seqs.iter().position(|s| s.starts_with("chat:")).unwrap();
    let control_idx = seqs.iter().position(|s| s.starts_with("session:")).unwrap();
    assert!(
        chat_idx < control_idx,
        "chat 事务必须先于 session 事务，got {seqs:?}"
    );
}

// ---------------------------------------------------------------------------
// 10. 微批次：apply_batch 合并为一次 chat 事务
// ---------------------------------------------------------------------------

#[test]
fn batch_merges_deltas_into_single_transaction() {
    let mut p = pair();
    // 先注册 turn（active_turn 存在，避免 UnknownTurn）。
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "hi");
    // 观察回调计数（每次事务提交 +1）。
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let doc = p.chat.clone();
    let _sub = doc
        .observe_update_v1(move |_, _| {
            let _ = tx.send(());
        })
        .unwrap();
    let evs: Vec<NormalizedEvent> = (2..6)
        .map(|seq| ev("s1", seq, msg_delta("t1", "t1:assistant", "b1", "x")))
        .collect();
    let results = agg.apply_batch(&mut p, &evs);
    assert!(results.iter().all(|r| r.applied));
    // 批次 = 一次 chat 事务 → 恰好 1 个 update。
    let mut updates = 0;
    while rx.try_recv().is_ok() {
        updates += 1;
    }
    assert_eq!(updates, 1, "批次必须合并为一次事务");
    // 文本已追加。
    let txn = p.chat.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let entries = root
        .get(&txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let em = entries
        .get(&txn, "t1:assistant")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let blocks = em
        .get(&txn, "blocks")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let bm = blocks
        .get(&txn, "b1")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let text = bm
        .get(&txn, "text")
        .unwrap()
        .cast::<yrs::TextRef>()
        .unwrap();
    assert_eq!(text.get_string(&txn), "xxxx");
    let _ = root;
}

#[test]
fn idless_agent_output_is_split_by_tool_group_within_one_turn() {
    let mut pair = pair();
    seed_user_msg(&mut pair, "t1", "t1:user", "hi");
    let events = vec![
        ev("s1", 2, msg_delta("", "", "", "before ")),
        ev("s1", 3, msg_delta("", "", "", "tool")),
        ev("s1", 4, tool_started("", "tc1")),
        ev("s1", 5, msg_delta("", "", "", "after ")),
        ev("s1", 6, msg_delta("", "", "", "tool")),
    ];

    let results = Aggregator.apply_batch(&mut pair, &events);

    assert!(results.iter().all(|result| result.applied));
    let txn = pair.chat.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let order = root
        .get(&txn, "entry_order")
        .unwrap()
        .cast::<yrs::ArrayRef>()
        .unwrap();
    let entry_ids = order
        .iter(&txn)
        .map(|value| value.cast::<String>().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        entry_ids.len(),
        4,
        "user、AI、tools、AI 必须是四个独立 entry"
    );

    let entries = root
        .get(&txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let read_text = |entry_id: &str| {
        let entry = entries
            .get(&txn, entry_id)
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        let blocks = entry
            .get(&txn, "blocks")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        blocks
            .iter(&txn)
            .find_map(|(_, value)| {
                let block = value.cast::<yrs::MapRef>().ok()?;
                (block.get(&txn, "kind")?.cast::<String>().ok()?.as_str() == "text").then(|| {
                    block
                        .get(&txn, "text")
                        .unwrap()
                        .cast::<yrs::TextRef>()
                        .unwrap()
                        .get_string(&txn)
                })
            })
            .unwrap_or_default()
    };
    assert_eq!(read_text(&entry_ids[1]), "before tool");
    assert_eq!(read_text(&entry_ids[3]), "after tool");
    assert_ne!(
        entry_ids[1], entry_ids[3],
        "tool 前后的两个 AI 输出不得合并"
    );
}

#[test]
fn replay_delta_batch_retains_negotiated_producer_provenance() {
    let mut pair = pair();
    pair.stream.replay_active = true;
    enable_replay(&mut pair);
    let mut event = ev("s1", 1, msg_delta("", "", "", "restored answer"));
    event.provenance = EventProvenance::PeriReplay;

    let results = Aggregator.apply_batch(&mut pair, &[event]);

    assert!(results[0].applied);
    assert_eq!(
        entry_origin(&pair, "load:1:assistant"),
        (Some("session_replay".into()), Some(true))
    );
    assert_eq!(
        entry_origin(&pair, "load:1:user"),
        (Some("session_replay".into()), Some(false)),
        "synthetic placeholder is inferred rather than producer-authored"
    );
}

