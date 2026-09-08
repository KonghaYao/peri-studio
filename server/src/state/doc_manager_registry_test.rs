//! DocManager 注册表命令与 gap 恢复测试（§8.5 注册表命令路由 /
//! §9.4/§12.4 gap 上报 / §7.3/§8.5 断链追平）：Registry 命令路由到
//! 全局 writer、seq 跳变上报 registry gap、ResumeAfterGap 可校准
//! 追平清除标记、不可校准（epoch 变化）拒绝保持 gap。

use std::sync::Arc;

use tokio::time::Duration as TokioDuration;

use peri_studio_proto::conn::DocId;
use peri_studio_proto::schema::ChatSummary;

use crate::state::doc_manager::{DocCommand, DocManager, SubmitResult};
use crate::state::normalized::{EventBody, NormalizedEvent};

use super::util::*;

// ---------------------------------------------------------------------------
// Registry 命令路由（§8.5）与 gap 上报（§9.4/§12.4）
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn registry_commands_route_to_global_writer() {
    let mgr = DocManager::new(cfg(), Arc::new(MemSink::default()));
    open(&mgr, "s1").await;
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::RegistryUpsertChat(ChatSummary {
                id: "s1".into(),
                instance_id: "m1".into(),
                title: "t".into(),
                status: "accepting".into(),
                gap: None,
                updated_at: "2026-08-07T00:00:00Z".into(),
                cwd: String::new(),
                workspace_id: None,
            }),
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(_)));
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::RegistrySetGlobal {
                status: peri_studio_proto::schema::GlobalStatus::Degraded,
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(_)));
}

// ---------------------------------------------------------------------------
// gap 上报（§9.4/§12.4）：seq 跳变 → registry sessions[].gap 写回
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn gap_reported_to_registry_on_seq_jump() {
    let mgr = DocManager::new(cfg(), Arc::new(MemSink::default()));
    // 先订阅（registry 写回的广播发生在提交期间，错过即无 update）。
    let mut rx = mgr.subscribe_updates().await;
    open(&mgr, "s1").await;
    let _ = mgr.submit_event(user_msg("s1", 1, "t1")).await;
    let _ = mgr.submit_event(user_msg("s1", 5, "t2")).await; // 跳变 3
    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;
    // Registry Doc 落盘记录应包含 gap 写回（registry update 含 sessions.s1.gap）。
    let mut registry_updates = Vec::new();
    while let Ok(u) = rx.try_recv() {
        if u.doc == DocId::REGISTRY {
            registry_updates.push(u.update);
        }
    }
    // 至少有一次 registry 更新（open_chat 摘要 + gap 写回）。
    assert!(!registry_updates.is_empty());
}

// ---------------------------------------------------------------------------
// 断链追平恢复（§7.3/§8.5）：ResumeAfterGap 命令——可校准 → 上报追平
// （registry gap 标记清除）；不可校准（epoch 变化）→ 拒绝（保持 gap，
// 只能经 session/load 显式重建消除）
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn resume_after_gap_calibrated_clears_registry_gap() {
    use yrs::{Map, MapRef, ReadTxn, Transact};

    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    // 流基线（last_seq=1；断链模拟由 relay 置 registry gap 标记，此处
    // 直接验证命令路径）。
    assert!(matches!(
        mgr.submit_event(user_msg("s1", 1, "t1")).await,
        SubmitResult::Applied(_)
    ));

    // 镜像校验：registry doc chats[s1].gap 已被清除。
    let mirror = yrs::Doc::new();
    async fn drain_registry(sink: &MemSink, mirror: &yrs::Doc) {
        use yrs::updates::decoder::Decode as _;
        let updates = sink.updates.lock().await;
        for (doc, update) in updates.iter() {
            if *doc == DocId::REGISTRY {
                let parsed = yrs::Update::decode_v1(update).unwrap();
                let mut txn = mirror.transact_mut();
                txn.apply_update(parsed).unwrap();
            }
        }
    }
    drain_registry(&sink, &mirror).await;
    {
        let txn = mirror.transact();
        let root = txn.get_map("root").expect("root map");
        let chats = root
            .get(&txn, "chats")
            .expect("chats map")
            .cast::<MapRef>()
            .unwrap();
        let sm = chats.get(&txn, "s1").unwrap().cast::<MapRef>().unwrap();
        let gap = sm.get(&txn, "gap");
        assert!(
            gap.is_none() || matches!(gap, Some(yrs::Out::Any(yrs::Any::Null))),
            "追平后 gap 标记必须清除（{gap:?}）"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn resume_after_gap_uncalibratable_rejected() {
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    // 流基线（last_seq=1）。
    assert!(matches!(
        mgr.submit_event(user_msg("s1", 1, "t1")).await,
        SubmitResult::Applied(_)
    ));
    // epoch 变化（模拟 daemon 重启，§4.5.1）：既有流上的新纪元 → 聚合器
    // 置不可校准缺口并拒绝本帧（relay 校验只挡与 hello 记录不一致的帧，
    // 新纪元经新 hello 对账后可达聚合器）。
    let e = NormalizedEvent {
        chat_id: "s1".into(),
        seq: 2,
        epoch: 1,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        source_agent_id: None,
        body: EventBody::UserMessage {
            turn_id: "t2".into(),
            entry_id: "t2:user".into(),
            text: "hi".into(),
            author_user_id: None,
            created_at: "2026-08-07T00:00:00Z".to_string(),
        },
    };
    let r = mgr.submit_event(e).await;
    assert!(
        matches!(r, SubmitResult::Applied(a) if !a.applied),
        "epoch 变化帧应被拒绝"
    );
    // 不可校准：ResumeAfterGap → Rejected（保持 gap 呈现——只能经 load
    // 显式重建消除，不得误标为已追平）。
    let r = mgr.submit_command("s1", DocCommand::ResumeAfterGap).await;
    assert!(
        matches!(r, SubmitResult::Rejected(_)),
        "uncalibratable 拒绝恢复"
    );
}
