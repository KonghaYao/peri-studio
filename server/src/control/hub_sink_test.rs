//! Hub / StoreSink 单测（设计稿 §16 测试 31 的 fake instance 辅助 + 镜像
//! 快照/落盘语义；全链路 e2e 在 gateway_test）。
//!
//! 本文件覆盖 StoreSink 实现段（`hub_sink.rs`）：镜像快照/广播、启动期
//! prompt 投递修复、未知 doc 拒绝。Hub 装配与视图重建测试在 `hub_test.rs`。

use std::sync::Arc;

use tokio::sync::mpsc;

use peri_studio_proto::conn::DocId;

use crate::control::StoreSink;
use crate::persist::{PersistConfig, Store};
use crate::state::doc_manager::{BatchConfig, DocManager, UpdateSink};

async fn env() -> (tempfile::TempDir, Arc<Store>, Arc<StoreSink>, DocManager) {
    let tmp = tempfile::tempdir().unwrap();
    let persist_cfg = PersistConfig {
        data_dir: tmp.path().to_path_buf(),
    };
    let store = Arc::new(Store::open(&persist_cfg).unwrap());
    let sink = Arc::new(StoreSink::new());
    let doc = DocManager::new(BatchConfig::default(), sink.clone());
    (tmp, store, sink, doc)
}

async fn recovered_active_turn_status(sink: &StoreSink, sid: &str) -> Option<String> {
    use yrs::updates::decoder::Decode;
    use yrs::{Map, ReadTxn, Transact};

    let (update, _) = sink.snapshot(&DocId::session(sid)).await?;
    let recovered = yrs::Doc::new();
    recovered
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(&update).ok()?)
        .ok()?;
    let txn = recovered.transact();
    txn.get_map("root")
        .and_then(|root| root.get(&txn, "session"))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .and_then(|session| session.get(&txn, "active_turn_status"))
        .and_then(|value| value.cast::<String>().ok())
}

#[tokio::test]
async fn startup_reconciliation_persists_prompt_delivery_into_recovered_mirror() {
    use yrs::updates::decoder::Decode;
    use yrs::{Map, ReadTxn, Transact};

    let (_tmp, store, sink, doc) = env().await;
    let sid = "12121212-1212-1212-1212-121212121212";
    store
        .create_chat(uuid::Uuid::parse_str(sid).unwrap())
        .unwrap();
    doc.open_chat(sid, "m1", Some("t"), None, None)
        .await
        .unwrap();
    let result = doc
        .submit_command(
            sid,
            crate::state::doc_manager::DocCommand::RegisterPendingPromptEntry {
                turn_id: "turn-1".into(),
                entry_id: "turn-1:user".into(),
                text: "durable prompt".into(),
                author_user_id: None,
                source_command_id: uuid::Uuid::new_v4().to_string(),
                payload_fingerprint: "fingerprint".into(),
                created_at: chrono::Utc::now().to_rfc3339(),
            },
        )
        .await;
    assert!(matches!(
        result,
        crate::state::doc_manager::SubmitResult::Applied(_)
    ));

    assert!(sink
        .reconcile_prompt_entry_delivery(
            sid,
            "turn-1:user",
            "delivery_unknown",
            Some("DELIVERY_UNKNOWN"),
        )
        .await
        .unwrap());
    let (update, _) = sink.snapshot(&DocId::chat(sid)).await.unwrap();
    let recovered = yrs::Doc::new();
    recovered
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(&update).unwrap())
        .unwrap();
    let txn = recovered.transact();
    let root = txn.get_map("root").unwrap();
    let entries = root
        .get(&txn, "entries")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .unwrap();
    let entry = entries
        .get(&txn, "turn-1:user")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .unwrap();
    assert_eq!(
        entry
            .get(&txn, "delivery_state")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("delivery_unknown")
    );
    assert_eq!(
        recovered_active_turn_status(&sink, sid).await.as_deref(),
        Some("accepting"),
        "uncertain delivery must not claim the ACP turn stopped"
    );
}

#[tokio::test]
async fn startup_prompt_repair_heals_a_chat_control_half_commit() {
    use yrs::{ReadTxn, Transact};

    let (_tmp, store, sink, doc) = env().await;
    let sid = "13131313-1313-1313-1313-131313131313";
    store
        .create_chat(uuid::Uuid::parse_str(sid).unwrap())
        .unwrap();
    doc.open_chat(sid, "m1", Some("t"), None, None)
        .await
        .unwrap();
    let _ = doc
        .submit_command(
            sid,
            crate::state::doc_manager::DocCommand::RegisterPendingPromptEntry {
                turn_id: "turn-1".into(),
                entry_id: "turn-1:user".into(),
                text: "durable prompt".into(),
                author_user_id: None,
                source_command_id: uuid::Uuid::new_v4().to_string(),
                payload_fingerprint: "fingerprint".into(),
                created_at: chrono::Utc::now().to_rfc3339(),
            },
        )
        .await;

    // Crash window: Chat Doc terminal evidence persisted, but the matching
    // Session Doc control update did not. Startup replay must not let the
    // duplicate Chat state short-circuit control repair.
    {
        let mut docs = sink.docs.write().await;
        let chat = docs.get_mut(&DocId::chat(sid)).unwrap();
        let mut txn = chat.transact_mut();
        let root = txn.get_map(crate::state::factory::ROOT).unwrap();
        assert!(crate::state::chat_writer::set_prompt_entry_delivery(
            &mut txn,
            &root,
            "turn-1:user",
            "failed_not_delivered",
            Some("AGENT_UNAVAILABLE"),
            Some("2026-08-14T00:00:01Z"),
        ));
    }
    assert_eq!(
        recovered_active_turn_status(&sink, sid).await.as_deref(),
        Some("accepting")
    );

    assert!(sink
        .reconcile_prompt_entry_delivery(
            sid,
            "turn-1:user",
            "failed_not_delivered",
            Some("AGENT_UNAVAILABLE"),
        )
        .await
        .unwrap());
    assert_eq!(
        recovered_active_turn_status(&sink, sid).await.as_deref(),
        Some("failed")
    );
    assert!(!sink
        .reconcile_prompt_entry_delivery(
            sid,
            "turn-1:user",
            "failed_not_delivered",
            Some("AGENT_UNAVAILABLE"),
        )
        .await
        .unwrap());
}

#[tokio::test]
async fn mirror_snapshot_accumulates_live_updates() {
    let (tmp, store, sink, doc) = env().await;
    let sid = "11111111-1111-1111-1111-111111111111";
    // 打开 session 并写入一条事件（聚合器投影 → 内存镜像）。
    store
        .create_chat(uuid::Uuid::parse_str(sid).unwrap())
        .unwrap();
    doc.open_chat(sid, "m1", Some("t"), None, None)
        .await
        .unwrap();
    // 先建立 active turn（§6.5 服务端单写）：MessageDelta 受终态守卫约束
    // （§6.3 无活动 turn → UnknownTurn 拒绝）。
    let reg = doc
        .submit_command(
            sid,
            crate::state::doc_manager::DocCommand::RegisterUserEntry {
                turn_id: "t1".into(),
                entry_id: "t1:user".into(),
                text: "prompt".into(),
                author_user_id: None,
                source_command_id: "hub-test-command".into(),
                created_at: chrono::Utc::now().to_rfc3339(),
            },
        )
        .await;
    assert!(matches!(
        reg,
        crate::state::doc_manager::SubmitResult::Applied(_)
    ));
    let ev = crate::state::normalized::NormalizedEvent {
        chat_id: sid.into(),
        seq: 1,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        body: crate::state::normalized::EventBody::MessageDelta {
            turn_id: "t1".into(),
            entry_id: "t1:assistant".into(),
            block_id: "b1".into(),
            text: "mirror me".into(),
        },
    };
    let r = doc.submit_event(ev).await;
    assert!(matches!(
        r,
        crate::state::doc_manager::SubmitResult::Applied(_)
    ));
    // delta 类事件入队即返（§8.2 微批次不逐事件应答）：轮询快照等待
    // flush（16ms 窗口 + 镜像应用）——Factory 初始化 update（pv=0）与事件
    // update 同批入广播流，以 projection_version >= 1 判定事件已镜像（非
    // 初始化结构）。
    let (state, version) = {
        let mut got = None;
        for _ in 0..50 {
            let snap = sink
                .snapshot(&DocId::chat(sid))
                .await
                .expect("snapshot exists");
            if snap.1 >= 1 {
                got = Some(snap);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        got.expect("chat doc projection_version >= 1 after flush")
    };
    assert!(!state.is_empty());
    assert!(version >= 1);
    let _ = tmp;
}

#[tokio::test]
async fn persist_update_unknown_doc_rejected() {
    let (_tmp, _store, sink, _doc) = env().await;
    let r = sink
        .persist_update(DocId::chat("not-a-uuid"), vec![1, 2, 3])
        .await;
    assert!(r.is_err(), "未知 session doc 应拒绝");
}

#[tokio::test]
async fn broadcast_stream_delivers_updates() {
    let (_tmp, _store, sink, doc) = env().await;
    let sid = "22222222-2222-2222-2222-222222222222";
    let mut rx = sink.subscribe().await;
    doc.open_chat(sid, "m1", None, None, None).await.unwrap();
    // open_chat 会先写 hub:registry 活跃摘要（§5.2 单写）；随后的事件
    // 投影才写该 chat 的 chat/session doc。跳 registry 帧，断言 doc 到达。
    let ev = crate::state::normalized::NormalizedEvent {
        chat_id: sid.into(),
        seq: 1,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        body: crate::state::normalized::EventBody::AgentStatus {
            status: "idle".into(),
            public_error: None,
            model: None,
            context_window: None,
            context_used: None,
        },
    };
    let _ = doc.submit_event(ev).await;
    let update = loop {
        let u = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("broadcast update")
            .expect("channel alive");
        if u.doc != DocId::REGISTRY {
            break u;
        }
    };
    assert!(update.doc == DocId::session(sid) || update.doc == DocId::chat(sid));
    let _ = mpsc::unbounded_channel::<()>();
}

#[tokio::test]
async fn broadcast_stream_delivers_to_multiple_subscribers() {
    // 两个订阅者（§P1-1 改动点 5 else 分支）：persist_update 逐份 clone，
    // 各订阅者收到内容一致的 DocUpdate（广播语义要求每订阅者独立载荷）。
    let (_tmp, _store, sink, _doc) = env().await;
    let sid = "55555555-5555-5555-5555-555555555555";
    let doc = DocId::chat(sid);
    let mut rx1 = sink.subscribe().await;
    let mut rx2 = sink.subscribe().await;
    let update = {
        use yrs::{Map, ReadTxn, Transact, WriteTxn};
        let d = yrs::Doc::new();
        let mut txn = d.transact_mut();
        txn.get_or_insert_map("root").insert(&mut txn, "k", "v");
        drop(txn);
        let txn = d.transact();
        txn.encode_state_as_update_v1(&yrs::StateVector::default())
    };
    sink.persist_update(doc.clone(), update.clone())
        .await
        .unwrap();
    for rx in [&mut rx1, &mut rx2] {
        let msg = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("each subscriber should receive")
            .expect("channel alive");
        assert_eq!(msg.doc, doc, "两订阅者 doc 一致");
        assert_eq!(msg.update, update, "两订阅者 update 内容一致");
    }
}
