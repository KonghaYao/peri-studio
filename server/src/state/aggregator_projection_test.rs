//! 聚合器投影测试（视图层）：reasoning 可见性（§9.2 步骤 4 视图）、
//! yrs 快照重放薄封装（§5.6 ViewStore 已删——真实 `encode/apply`）、
//! SessionList 全量同步（§6.3/§5.2）与 projection_version 递增
//! （§5.3/§5.6）。

use super::util::*;

use yrs::{Map, Transact};

use peri_studio_proto::schema::{BlockVisibility, ChatStatus};

use crate::state::aggregator::Aggregator;
use crate::state::chat_writer;
use crate::state::doc_pair::DocPair;
use crate::state::normalized::EventBody;

// ---------------------------------------------------------------------------
// 11. 视图读取：reasoning 可见性
// ---------------------------------------------------------------------------

#[test]
fn reasoning_visibility_written() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "hi");
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                2,
                EventBody::ReasoningDelta {
                    turn_id: "t1".into(),
                    entry_id: "t1:assistant".into(),
                    block_id: "r1".into(),
                    text: "think".into(),
                    visibility: BlockVisibility::Hidden,
                }
            )
        )
        .applied
    );
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
        .get(&txn, "r1")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        bm.get(&txn, "visibility"),
        Some(yrs::Out::Any("hidden".into()))
    );
    let _ = root;
}

// ---------------------------------------------------------------------------
// 12. yrs 薄封装（§5.6）：快照 + 重放路径（ViewStore trait 已删除——真实
// 边界是 DocPair + chat_writer 原语，这里直接验证 free function 收敛点）
// ---------------------------------------------------------------------------

#[test]
fn view_store_roundtrip() {
    let mut p = pair();
    seed_user_msg(&mut p, "t1", "t1:user", "hi");

    let snapshot = crate::state::view_store::encode_state_as_update(&p.chat);
    assert!(!snapshot.is_empty());

    // 新 doc 重放快照 → 视图等价。
    let doc2 = yrs::Doc::new();
    crate::state::view_store::apply_update(&doc2, &snapshot).unwrap();
    let txn2 = doc2.transact();
    let root2 = chat_writer::root_map_read(&txn2).unwrap();
    let entries2 = root2
        .get(&txn2, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(entries2.len(&txn2), 1);
    let _ = root2;
}

// ---------------------------------------------------------------------------
// 13. SessionListResponse 全量同步（§6.3/§5.2）
// ---------------------------------------------------------------------------

#[test]
fn session_list_full_sync_removes_stale() {
    let mut p = pair();
    let mut agg = Aggregator;
    let sum = |id: &str, title: &str| peri_studio_proto::schema::SessionSummaryProjection {
        session_id: id.to_string(),
        title: title.to_string(),
        status: "completed".to_string(),
        updated_at: "2026-08-07T00:00:00Z".to_string(),
        cwd: String::new(),
        bound_chat_id: None,
    };
    // 第一轮：s1/s2。
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                1,
                EventBody::SessionListResponse {
                    entries: vec![sum("s1", "a"), sum("s2", "b")],
                }
            )
        )
        .applied
    );
    // 第二轮：s1 变化、s2 缺失（旧条目删除）、s3 新增。
    assert!(
        agg.apply(
            &mut p,
            &ev(
                "s1",
                2,
                EventBody::SessionListResponse {
                    entries: vec![sum("s1", "a2"), sum("s3", "c")],
                }
            )
        )
        .applied
    );
    let txn = p.session.transact();
    let root = chat_writer::root_map_read(&txn).unwrap();
    let sessions = root
        .get(&txn, "sessions")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let keys: std::collections::BTreeSet<&str> = sessions.iter(&txn).map(|(k, _)| k).collect();
    assert_eq!(keys, ["s1", "s3"].into_iter().collect());
    let _ = root;
}

// ---------------------------------------------------------------------------
// 14. projection_version 递增（§5.3/§5.6）
// ---------------------------------------------------------------------------

#[test]
fn projection_version_increments_per_apply() {
    let mut p = pair();
    let mut agg = Aggregator;
    let read = |pair: &DocPair| {
        let txn = pair.chat.transact();
        chat_writer::root_map_read(&txn)
            .and_then(|root| root.get(&txn, "projection_version"))
            .and_then(|v| v.cast::<u32>().ok())
            .unwrap_or(0)
    };
    assert_eq!(read(&p), 0);
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    assert_eq!(read(&p), 1);
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 2, msg_delta("t1", "t1:assistant", "b1", "x"))
        )
        .applied
    );
    assert_eq!(read(&p), 2);
    // 拒绝的事件不 bump。
    let r = agg.apply(&mut p, &ev("s1", 1, user_msg("t1", "t1:user", "a")));
    assert!(!r.applied);
    assert_eq!(read(&p), 2);
}

#[test]
fn empty_stream_delta_advances_sequence_without_yjs_update() {
    let mut p = pair();
    let mut agg = Aggregator;
    seed_user_msg(&mut p, "t1", "t1:user", "a");
    let read = |pair: &DocPair| {
        let txn = pair.chat.transact();
        chat_writer::root_map_read(&txn)
            .and_then(|root| root.get(&txn, "projection_version"))
            .and_then(|v| v.cast::<u32>().ok())
            .unwrap_or(0)
    };
    let before_version = read(&p);
    let before_entries = entry_count(&p);
    let read_session = |pair: &DocPair| {
        let txn = pair.session.transact();
        chat_writer::root_map_read(&txn)
            .and_then(|root| root.get(&txn, "projection_version"))
            .and_then(|v| v.cast::<u32>().ok())
            .unwrap_or(0)
    };
    let before_session_version = read_session(&p);

    // 空 chunk 是有效的传输顺序证据：必须消费 seq，但不应制造 Yjs 投影噪声。
    let results = agg.apply_batch(
        &mut p,
        &[ev("s1", 2, msg_delta("t1", "t1:assistant", "b1", ""))],
    );
    assert_eq!(results.len(), 1);
    assert!(results[0].applied);
    assert_eq!(read(&p), before_version);
    assert_eq!(read_session(&p), before_session_version);
    assert_eq!(entry_count(&p), before_entries);

    // 后续 seq 连续，证明空 chunk 已被消费，而非被当作丢帧。
    assert!(
        agg.apply(
            &mut p,
            &ev("s1", 3, msg_delta("t1", "t1:assistant", "b1", "out"))
        )
        .applied
    );
    assert_eq!(read(&p), before_version + 1);
}

#[test]
fn session_status_str_matches_schema() {
    assert_eq!(
        crate::state::aggregator::chat_status_str(ChatStatus::Active),
        "active"
    );
    assert_eq!(
        crate::state::aggregator::chat_status_str(ChatStatus::Crashed),
        "crashed"
    );
}
