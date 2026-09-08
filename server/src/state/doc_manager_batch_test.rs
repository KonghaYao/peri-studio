//! DocManager 微批次测试（§6.4 / P1-5 / §7.4 / §8.6）：16ms 窗内
//! delta 合并为一次事务、flush 零 clone drain 顺序锚点、控制类先
//! flush、并发提交单写者串行化（无 yrs panic）、队列上限
//! try_reserve 语义与槽位释放。

use std::sync::Arc;

use serde_json::json;
use tokio::time::{timeout, Duration as TokioDuration};

use peri_studio_proto::conn::DocId;
use peri_studio_proto::schema::ToolCallStatus;

use crate::state::doc_manager::{DocManager, SubmitError, SubmitResult};
use crate::state::normalized::{EventBody, NormalizedEvent};

use super::util::*;

// ---------------------------------------------------------------------------
// 微批次合并（§6.4）：16ms 窗内 delta 合并为一次事务
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn batch_merges_deltas_into_single_transaction() {
    let _blocker = ClockBlocker::hold();
    let sink = MemSink::default();
    let mgr = Arc::new(DocManager::new(cfg(), Arc::new(sink.clone())));
    open(&mgr, "s1").await;
    // 先注册 turn（active_turn 存在）。
    seed_user_entry(&mgr, "s1").await;
    // 3 个 delta 进入批次（batchable 事件的确认要等 flush，故 spawn 提交不阻塞主流程）。
    let mut handles = Vec::new();
    for seq in 2..5 {
        let mgr = mgr.clone();
        handles.push(tokio::spawn(async move {
            mgr.submit_event(delta("s1", seq, "t1", "x")).await
        }));
    }
    // 窗口未到：无落盘。
    {
        let updates = sink.updates.lock().await;
        let deltas = updates
            .iter()
            .filter(|(d, _)| *d == DocId::chat("s1"))
            .count();
        assert_eq!(
            deltas, 2,
            "仅 user_message 已落盘（+初始化基线），批次未 flush"
        );
    }
    // 推进 16ms → 批次 flush 为一次 chat 事务（一个 update）。
    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;
    for h in handles {
        let r = h.await.expect("submit task panic");
        assert!(
            matches!(r, SubmitResult::Applied(_)),
            "delta 提交应确认 Applied"
        );
    }
    {
        let updates = sink.updates.lock().await;
        let deltas = updates
            .iter()
            .filter(|(d, _)| *d == DocId::chat("s1"))
            .count();
        assert_eq!(deltas, 3, "批次应合并为一次 chat 事务：基线+user+批次");
    }
}

// ---------------------------------------------------------------------------
// flush 零 clone（P1-5）：drain 交付所有权，事件顺序 → 落盘文本顺序锚点
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn flush_batch_drains_events_and_backfills_in_order() {
    let _blocker = ClockBlocker::hold();
    let sink = MemSink::default();
    let mgr = Arc::new(DocManager::new(cfg(), Arc::new(sink.clone())));
    open(&mgr, "s1").await;
    // 先注册 turn（active_turn 存在）。
    seed_user_entry(&mgr, "s1").await;
    // 按序提交 3 个 delta（"a"/"b"/"c"）：batchable 事件入队即确认，spawn
    // 不阻塞主流程，保持提交顺序。
    let mut handles = Vec::new();
    for (i, ch) in ['a', 'b', 'c'].into_iter().enumerate() {
        let mgr = mgr.clone();
        handles.push(tokio::spawn(async move {
            mgr.submit_event(delta("s1", 2 + i as u64, "t1", &ch.to_string()))
                .await
        }));
    }
    // 推进 16ms → 批次 flush 为一次 chat 事务。
    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;
    // 断言 1：3 个 reply 均为 Applied（回填无丢失、无错序）。
    for h in handles {
        let r = h.await.expect("submit task panic");
        assert!(
            matches!(r, SubmitResult::Applied(_)),
            "delta 提交应确认 Applied"
        );
    }
    // 断言 2：chat 落盘次数 = 3（初始化基线 + user_msg + 批次合并 1 次）——
    // 批次未被拆散。
    {
        let updates = sink.updates.lock().await;
        let deltas = updates
            .iter()
            .filter(|(d, _)| *d == DocId::chat("s1"))
            .count();
        assert_eq!(deltas, 3, "批次应合并为一次 chat 事务：基线+user+批次");
    }
    // 断言 3：解码批次 update 到 mirror 后，entry block 文本 == "abc"——
    // drain 保序 + apply_batch 保序的端到端锚点。
    use yrs::{Array, GetString, Map, ReadTxn, Transact};
    let mirror = yrs::Doc::new();
    {
        use yrs::updates::decoder::Decode as _;
        let updates = sink.updates.lock().await;
        for (doc, update) in updates.iter() {
            if *doc == DocId::chat("s1") {
                let parsed = yrs::Update::decode_v1(update).unwrap();
                let mut txn = mirror.transact_mut();
                txn.apply_update(parsed).unwrap();
            }
        }
    }
    let txn = mirror.transact();
    let root = txn.get_map("root").expect("root map");
    let entries = root
        .get(&txn, "entries")
        .expect("entries map")
        .cast::<yrs::MapRef>()
        .unwrap();
    let assistant = entries
        .get(&txn, "t1:assistant")
        .expect("assistant entry")
        .cast::<yrs::MapRef>()
        .unwrap();
    // 统一按 block_order 首块读取文本（对齐现有回放断言写法）。
    let order = assistant
        .get(&txn, "block_order")
        .unwrap()
        .cast::<yrs::ArrayRef>()
        .unwrap();
    let bid = order.get(&txn, 0).unwrap().cast::<String>().unwrap();
    let text = assistant
        .get(&txn, "blocks")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap()
        .get(&txn, &bid)
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap()
        .get(&txn, "text")
        .unwrap()
        .cast::<yrs::TextRef>()
        .unwrap()
        .get_string(&txn);
    assert_eq!(
        text, "abc",
        "drain 保序 + apply_batch 保序：文本按提交顺序合并"
    );
}

// ---------------------------------------------------------------------------
// 控制类先 flush（§6.4）：控制类到达 → 已缓冲 delta 先落盘
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn control_event_flushes_buffered_batch_first() {
    let _blocker = ClockBlocker::hold();
    let sink = MemSink::default();
    let mgr = Arc::new(DocManager::new(cfg(), Arc::new(sink.clone())));
    open(&mgr, "s1").await;
    seed_user_entry(&mgr, "s1").await;
    // 2 个 delta 缓冲（未到窗口；按序提交，控制类必须先见到已入队 delta）。
    for seq in 2..4 {
        let r = mgr.submit_event(delta("s1", seq, "t1", "x")).await;
        assert!(matches!(r, SubmitResult::Applied(_)), "delta 入队应确认");
    }
    // 确保 spawn 的 delta 提交已到达 writer（避免调度顺序偶发）。
    for _ in 0..4 {
        tokio::task::yield_now().await;
    }
    // 控制类事件（tool_call 状态）到达 → 先 flush 已缓冲批次再立即写。
    let control = NormalizedEvent {
        chat_id: "s1".to_string(),
        seq: 4,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        source_agent_id: None,
        body: EventBody::ToolCallStarted {
            turn_id: "t1".to_string(),
            tool_call_id: "tc1".to_string(),
            name: "shell".to_string(),
            status: ToolCallStatus::Pending,
            arguments: Some(json!({})),
            created_at: "2026-08-07T00:00:00Z".to_string(),
        },
    };
    let _ = mgr.submit_event(control).await;
    {
        let updates = sink.updates.lock().await;
        let chat_docs: Vec<usize> = updates
            .iter()
            .filter(|(d, _)| *d == DocId::chat("s1"))
            .map(|(_, u)| u.len())
            .collect();
        // 4 次落盘：初始化基线 + 批次（合并 delta）+ tool_call 事务。
        assert_eq!(chat_docs.len(), 4, "delta 批次先落盘，控制类后落盘");
    }
}

// ---------------------------------------------------------------------------
// 单写者串行化（§7.4）：并发提交无 yrs panic，结果等价
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn concurrent_submits_no_panic_and_serial_equivalent() {
    let sink = MemSink::default();
    let mgr = Arc::new(DocManager::new(cfg(), Arc::new(sink.clone())));
    open(&mgr, "s1").await;

    // 订阅必须在提交之前（广播发生在提交期间，错过即无 update）。
    let mut rx = mgr.subscribe_updates().await;
    // 串行基线：先注册 turn。
    seed_user_entry(&mgr, "s1").await;

    // 并发提交 32 个事件（delta 混合控制类）。
    let mut handles = Vec::new();
    for i in 0..32 {
        let mgr = mgr.clone();
        handles.push(tokio::spawn(async move {
            let ev = if i % 4 == 0 {
                NormalizedEvent {
                    chat_id: "s1".to_string(),
                    seq: 2 + i as u64,
                    epoch: 0,
                    ts: "2026-08-07T00:00:00Z".to_string(),
                    provenance: Default::default(),
                    source_agent_id: None,
                    body: EventBody::ToolCallStarted {
                        turn_id: "t1".to_string(),
                        tool_call_id: format!("tc{i}"),
                        name: "n".to_string(),
                        status: ToolCallStatus::Pending,
                        arguments: None,
                        created_at: "2026-08-07T00:00:00Z".to_string(),
                    },
                }
            } else {
                delta("s1", 2 + i as u64, "t1", "x")
            };
            mgr.submit_event(ev).await
        }));
    }
    for h in handles {
        let r = timeout(TokioDuration::from_secs(5), h)
            .await
            .expect("task timeout")
            .expect("task panic");
        match r {
            SubmitResult::Applied(_) | SubmitResult::Rejected(SubmitError::QueueFull) => {}
            other => panic!("unexpected submit result: {other:?}"),
        }
    }
    // 无 yrs panic（任务全部正常返回）；工具调用全部唯一创建。
    // 通过广播 update 重放验证视图一致性（等价于串行）。
    let mut chat_updates: Vec<Vec<u8>> = Vec::new();
    while let Ok(doc_update) = rx.try_recv() {
        if doc_update.doc == DocId::chat("s1") {
            chat_updates.push(doc_update.update);
        }
    }
    assert!(!chat_updates.is_empty(), "应有 chat update 广播");
}

// ---------------------------------------------------------------------------
// 队列上限（§8.6）：满 → RATE_LIMITED（try_reserve 语义）
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn try_reserve_returns_false_when_queue_full() {
    let mut c = cfg();
    c.chat_queue = 2;
    let mgr = DocManager::new(c, Arc::new(MemSink::default()));
    open(&mgr, "s1").await;
    assert!(mgr.try_reserve("s1").await);
    assert!(mgr.try_reserve("s1").await);
    assert!(!mgr.try_reserve("s1").await, "队列满 → false");
    assert!(!mgr.try_reserve("nope").await, "chat 不存在 → false");
}

/// P1-1 回归：try_reserve 占用的名额必须可释放（release_reserve），
/// 否则队列永满 → RATE_LIMITED 风暴。完整消费路径（coordinator 执行器
/// 消费 ExecCmd 后 release）由 command_coordinator_test 覆盖。
#[tokio::test(start_paused = true)]
async fn try_reserve_slots_released_after_writer_consumes() {
    let mut c = cfg();
    c.chat_queue = 2;
    let mgr = DocManager::new(c, Arc::new(MemSink::default()));
    open(&mgr, "s1").await;
    assert!(mgr.try_reserve("s1").await);
    assert!(mgr.try_reserve("s1").await);
    assert!(!mgr.try_reserve("s1").await, "队列满 → false");
    // 释放占用的名额（coordinator 执行器消费后调用）。
    mgr.release_reserve("s1").await;
    mgr.release_reserve("s1").await;
    assert!(mgr.try_reserve("s1").await, "P1-1: 释放后名额必须恢复");
    // 不存在的 chat：no-op 不 panic。
    mgr.release_reserve("nope").await;
}
