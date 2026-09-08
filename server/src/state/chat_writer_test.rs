//! user entry 索引与 source_command 回填测试（原 `chat_writer.rs` 内联
//! `source_command_tests` 移出，§6.5/§P1-6）：幂等创建/关联/冲突判定与
//! 索引完备性（含缺失/陈旧索引回落扫描、写路径自愈回填）。

use peri_studio_proto::schema::{ActiveTurnProjection, TurnStatus};
use yrs::{Array, Map, Transact, WriteTxn};

use crate::state::chat_writer::{
    create_pending_prompt_entry, create_user_entry, set_active_turn, set_active_turn_status_if,
    set_prompt_entry_delivery, user_entry_for_turn, UserEntryRegistration, USER_ENTRY_INDEX,
};
use crate::state::factory::ROOT;

#[test]
fn active_turn_projects_chat_loading_from_server_state() {
    let doc = yrs::Doc::new();
    let mut txn = doc.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    let active = ActiveTurnProjection {
        turn_id: "t1".into(),
        turn_status: TurnStatus::Accepting,
        updated_at: "now".into(),
    };

    assert!(set_active_turn(&mut txn, &root, Some(&active)));
    let session = root
        .get(&txn, "session")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        session.get(&txn, "loading").unwrap().cast::<bool>(),
        Ok(true)
    );

    assert!(set_active_turn_status_if(
        &mut txn,
        &root,
        "accepting",
        "running"
    ));
    assert_eq!(
        session.get(&txn, "loading").unwrap().cast::<bool>(),
        Ok(true)
    );

    let terminal = ActiveTurnProjection {
        turn_id: "t1".into(),
        turn_status: TurnStatus::Completed,
        updated_at: "later".into(),
    };
    assert!(set_active_turn(&mut txn, &root, Some(&terminal)));
    assert_eq!(
        session.get(&txn, "loading").unwrap().cast::<bool>(),
        Ok(false)
    );

    assert!(set_active_turn(&mut txn, &root, None));
    assert_eq!(
        session.get(&txn, "loading").unwrap().cast::<bool>(),
        Ok(false)
    );
}

#[test]
fn user_entry_source_command_backfill_is_exact_and_conflict_safe() {
    let doc = yrs::Doc::new();
    let mut txn = doc.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    assert_eq!(
        create_user_entry(&mut txn, &root, "t", "t:user", "same", None, None, "now"),
        UserEntryRegistration::Created
    );
    assert_eq!(
        create_user_entry(
            &mut txn,
            &root,
            "t",
            "t:user",
            "same",
            None,
            Some("cmd-1"),
            "now"
        ),
        UserEntryRegistration::Correlated
    );
    assert_eq!(
        create_user_entry(
            &mut txn,
            &root,
            "t",
            "t:user",
            "same",
            None,
            Some("cmd-1"),
            "now"
        ),
        UserEntryRegistration::Duplicate
    );
    assert_eq!(
        create_user_entry(
            &mut txn,
            &root,
            "t",
            "t:user",
            "same",
            None,
            Some("cmd-2"),
            "now"
        ),
        UserEntryRegistration::SourceCommandConflict
    );
    let entries = root
        .get(&txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let entry = entries
        .get(&txn, "t:user")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        entry
            .get(&txn, "source_command_id")
            .unwrap()
            .cast::<String>()
            .unwrap(),
        "cmd-1"
    );
}

#[test]
fn user_entry_records_each_content_block_once() {
    let doc = yrs::Doc::new();
    let mut txn = doc.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    assert_eq!(
        create_user_entry(
            &mut txn,
            &root,
            "t",
            "t:user",
            "你的 pwd 在哪里",
            None,
            Some("cmd-1"),
            "now"
        ),
        UserEntryRegistration::Created
    );

    let entry = root
        .get(&txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap()
        .get(&txn, "t:user")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let block_order = entry
        .get(&txn, "block_order")
        .unwrap()
        .cast::<yrs::ArrayRef>()
        .unwrap();
    assert_eq!(block_order.len(&txn), 1);
}

#[test]
fn user_entry_index_tracks_first_created_entry() {
    let doc = yrs::Doc::new();
    let mut txn = doc.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    assert_eq!(
        create_user_entry(&mut txn, &root, "t1", "t1:user", "a", None, None, "now"),
        UserEntryRegistration::Created
    );
    // 索引落值：t1 -> t1:user。
    let index = root
        .get(&txn, USER_ENTRY_INDEX)
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        index.get(&txn, "t1").unwrap().cast::<String>().unwrap(),
        "t1:user"
    );
    // 同 turn 不同 entry_id（legacy/Hub 混合）：命中分支判定照旧，
    // 索引仍指向首个 entry（不覆盖）。
    assert_eq!(
        create_user_entry(&mut txn, &root, "t1", "legacy:user", "b", None, None, "now"),
        UserEntryRegistration::Duplicate
    );
    assert_eq!(
        index.get(&txn, "t1").unwrap().cast::<String>().unwrap(),
        "t1:user"
    );
}

#[test]
fn user_entry_index_completeness_sentinel() {
    let doc = yrs::Doc::new();
    let mut txn = doc.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    // 正例锚点:正常写路径(create_user_entry)索引随 entry 同事务写入,
    // 查询走 O(1) 索引命中。
    assert_eq!(
        create_user_entry(&mut txn, &root, "t1", "t1:user", "a", None, None, "now"),
        UserEntryRegistration::Created
    );
    let (entry_id, _) = user_entry_for_turn(&txn, "t1").expect("索引命中");
    assert_eq!(entry_id, "t1:user");
    // 索引完备性哨兵:绕过 create_user_entry 直接 entries.insert 一个
    // 手工 user entry(不写索引)→ 热路径「索引 map 存在 + 无键」断言
    // 不存在、不扫描 → 返回 None。若未来新增绕过索引的写入路径
    // (如直接 entries.insert),本测试暴露该误判(重复创建 user entry、
    // 幂等失效)——完备性假设「所有 user entry 写入点必写索引」的直接
    // 执行点。
    let entries = root
        .get(&txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    entries.insert(
        &mut txn,
        "t2:user",
        yrs::MapPrelim::from([("role", "user"), ("turn_id", "t2")]),
    );
    assert!(
        user_entry_for_turn(&txn, "t2").is_none(),
        "绕过索引的 user entry 写入必须被热路径断言为不存在"
    );
    // 对照:索引 map 缺失时回落扫描能发现该手工 entry(异常 doc 兜底语义,
    // 与索引存在路径行为分界明确)。
    root.remove(&mut txn, USER_ENTRY_INDEX);
    let (entry_id, _) = user_entry_for_turn(&txn, "t2").expect("索引缺失回落扫描命中");
    assert_eq!(entry_id, "t2:user");
}

#[test]
fn user_entry_index_falls_back_to_scan_when_index_missing() {
    let doc = yrs::Doc::new();
    let mut txn = doc.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    assert_eq!(
        create_user_entry(
            &mut txn,
            &root,
            "t1",
            "t1:user",
            "a",
            None,
            Some("cmd-1"),
            "now"
        ),
        UserEntryRegistration::Created
    );
    // 模拟索引 map 缺失的异常 doc。
    root.remove(&mut txn, USER_ENTRY_INDEX);
    // 查询回落全量扫描，语义等价。
    let (entry_id, entry) = user_entry_for_turn(&txn, "t1").expect("扫描兜底命中");
    assert_eq!(entry_id, "t1:user");
    assert_eq!(
        entry
            .get(&txn, "source_command_id")
            .unwrap()
            .cast::<String>()
            .unwrap(),
        "cmd-1"
    );
    // 写路径自愈：命中分支回填索引。
    assert_eq!(
        create_user_entry(
            &mut txn,
            &root,
            "t1",
            "t1:user",
            "a",
            None,
            Some("cmd-1"),
            "now"
        ),
        UserEntryRegistration::Duplicate
    );
    let index = root
        .get(&txn, USER_ENTRY_INDEX)
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        index.get(&txn, "t1").unwrap().cast::<String>().unwrap(),
        "t1:user"
    );
}

#[test]
fn user_entry_index_stale_entry_falls_back_to_scan() {
    let doc = yrs::Doc::new();
    let mut txn = doc.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    assert_eq!(
        create_user_entry(
            &mut txn,
            &root,
            "t1",
            "t1:user",
            "a",
            None,
            Some("cmd-1"),
            "now"
        ),
        UserEntryRegistration::Created
    );
    // 模拟 stale 索引：改写为不存在的 entry_id。
    let index = root
        .get(&txn, USER_ENTRY_INDEX)
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    index.insert(&mut txn, "t1", "ghost:user");
    // 防御校验 miss → 回落扫描兜底命中真实 entry。
    let (entry_id, entry) = user_entry_for_turn(&txn, "t1").expect("stale 索引回落扫描命中");
    assert_eq!(entry_id, "t1:user");
    assert_eq!(
        entry
            .get(&txn, "source_command_id")
            .unwrap()
            .cast::<String>()
            .unwrap(),
        "cmd-1"
    );
    // 写路径回填修正索引。
    assert_eq!(
        create_user_entry(
            &mut txn,
            &root,
            "t1",
            "t1:user",
            "a",
            None,
            Some("cmd-1"),
            "now"
        ),
        UserEntryRegistration::Duplicate
    );
    assert_eq!(
        index.get(&txn, "t1").unwrap().cast::<String>().unwrap(),
        "t1:user"
    );
}

#[test]
fn prompt_delivery_unknown_refuses_after_assistant_already_terminal() {
    let doc = yrs::Doc::new();
    let mut txn = doc.transact_mut();
    let root = txn.get_or_insert_map(ROOT);
    assert_eq!(
        create_pending_prompt_entry(
            &mut txn,
            &root,
            "t1",
            "t1:user",
            "already ran",
            None,
            "11111111-1111-1111-1111-111111111111",
            "fingerprint",
            "now",
        ),
        UserEntryRegistration::Created
    );
    let entries = root
        .get(&txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    entries.insert(
        &mut txn,
        "t1:assistant",
        yrs::MapPrelim::from([
            ("role", "assistant"),
            ("turn_id", "t1"),
            ("status", "completed"),
        ]),
    );

    assert!(
        !set_prompt_entry_delivery(
            &mut txn,
            &root,
            "t1:user",
            "delivery_unknown",
            Some("DELIVERY_UNKNOWN"),
            None,
        ),
        "同回合 assistant 已终态时不得再盖 delivery_unknown"
    );
    let user = entries
        .get(&txn, "t1:user")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        user.get(&txn, "delivery_state")
            .unwrap()
            .cast::<String>()
            .unwrap(),
        "pending"
    );
}
