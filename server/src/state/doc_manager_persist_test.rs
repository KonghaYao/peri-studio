//! DocManager persist 提交测试（§7.1 断链清理 / §7.2 cancel 前置 /
//! §5.4 agent map / open-close 生命周期 / §7.4 双 Doc 事务顺序 /
//! 落盘失败 degraded 上报）：ExpirePendingPermissions 批量过期、
//! MarkTurnCancelling 守卫、SetAgentSessionId 写回、open 幂等与
//! close 拒绝提交、chat update 先于 control 落盘、PersistFailed
//! 上报，以及广播订阅（F7 broadcaster 经 subscribe_updates 接收）。

use std::sync::Arc;

use tokio::time::Duration as TokioDuration;
use yrs::{Map, ReadTxn, Transact};

use peri_studio_proto::conn::DocId;

use crate::state::doc_manager::{DocCommand, DocManager, SubmitError, SubmitResult};
use crate::state::normalized::{EventBody, NormalizedEvent};

use super::util::*;

// ---------------------------------------------------------------------------
// ExpirePendingPermissions（§7.1 断链清理）：全部 pending 批量过期，CAS 语义
// 与 expire 一致（resolved/expired 不动）
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn expire_pending_permissions_batch_expires_all() {
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    seed_user_entry(&mgr, "s1").await;
    // 两条 pending 权限（事件路径投影）。
    for (seq, pid) in [(2u64, "p1"), (3, "p2")] {
        let ev = NormalizedEvent {
            chat_id: "s1".to_string(),
            seq,
            epoch: 0,
            ts: "2026-08-07T00:00:00Z".to_string(),
            provenance: Default::default(),
            body: EventBody::PermissionRequested {
                permission_id: pid.to_string(),
                turn_id: "t1".to_string(),
                tool_call_id: None,
                tool: None,
                title: "允许".to_string(),
                description: None,
                options: vec![],
                expires_at: "2026-08-07T00:05:00Z".to_string(),
            },
        };
        assert!(matches!(mgr.submit_event(ev).await, SubmitResult::Applied(a) if a.applied));
    }
    // 批量过期命令（断链清理路径）。
    let r = mgr
        .submit_command("s1", DocCommand::ExpirePendingPermissions)
        .await;
    assert!(matches!(r, SubmitResult::Applied(_)));
    // 幂等重发（无 pending → 迁移 0 条）。
    let r = mgr
        .submit_command("s1", DocCommand::ExpirePendingPermissions)
        .await;
    assert!(matches!(r, SubmitResult::Applied(_)));

    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    // 落盘记录 → 镜像 session doc 验证（与 chat 验证同款 mirror 模式）。
    let mirror = yrs::Doc::new();
    let updates = sink.updates.lock().await;
    for (doc, update) in updates.iter() {
        if *doc == DocId::session("s1") {
            let parsed = yrs::Update::decode_v1(update).unwrap();
            let mut txn = mirror.transact_mut();
            txn.apply_update(parsed).unwrap();
        }
    }
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let perms = root
        .get(&txn, "pending_permissions")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(perms.iter(&txn).count(), 2, "条目保留（仅状态迁移）");
    for (_, v) in perms.iter(&txn) {
        let pm = v.cast::<yrs::MapRef>().unwrap();
        assert_eq!(
            pm.get(&txn, "status").unwrap().cast::<String>().unwrap(),
            "expired"
        );
        assert!(
            matches!(
                pm.get(&txn, "decision"),
                None | Some(yrs::Out::Any(yrs::Any::Null))
            ),
            "decision 保持 null"
        );
    }
}

// ---------------------------------------------------------------------------
// MarkTurnCancelling（§7.2 cancel 前置）：活动 turn 匹配且非终态 → 置
// cancelling；终态/不匹配 → TurnTerminalGuard 拒绝
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn mark_turn_cancelling_sets_cancelling_state() {
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    // 建立活动 turn（RegisterUserEntry → accepting）。
    assert!(matches!(
        mgr.submit_command(
            "s1",
            DocCommand::RegisterUserEntry {
                turn_id: "t1".into(),
                entry_id: "t1:user".into(),
                text: "hi".into(),
                author_user_id: None,
                source_command_id: "cancel-command".into(),
                created_at: "2026-08-10T00:00:00Z".into(),
            },
        )
        .await,
        SubmitResult::Applied(_)
    ));
    // cancel 前置：accepting → cancelling。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::MarkTurnCancelling {
                turn_id: "t1".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
    // 幂等重发（状态已是 cancelling，非终态仍可再置——幂等无副作用）。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::MarkTurnCancelling {
                turn_id: "t1".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(_)));
    // 终态后拒绝（SetTurnTerminal → cancelled → MarkTurnCancelling 守卫）。
    let _ = mgr
        .submit_command(
            "s1",
            DocCommand::SetTurnTerminal {
                turn_id: "t1".into(),
                status: peri_studio_proto::schema::TurnStatus::Cancelled,
                completed_at: "2026-08-10T00:00:01Z".into(),
            },
        )
        .await;
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::MarkTurnCancelling {
                turn_id: "t1".into(),
            },
        )
        .await;
    assert!(
        matches!(r, SubmitResult::Applied(a) if !a.applied),
        "终态后 cancel 前置拒绝"
    );

    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    let updates = sink.updates.lock().await;
    for (doc, update) in updates.iter() {
        if *doc == DocId::session("s1") {
            let parsed = yrs::Update::decode_v1(update).unwrap();
            let mut txn = mirror.transact_mut();
            txn.apply_update(parsed).unwrap();
        }
    }
    drop(updates);
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let sm = root
        .get(&txn, "session")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        sm.get(&txn, "active_turn_status")
            .unwrap()
            .cast::<String>()
            .unwrap(),
        "cancelled",
        "终态保持（cancel 前置不覆盖终态）"
    );
}

// ---------------------------------------------------------------------------
// SetAgentSessionId（§5.4 agent map）：binding 建立/load 恢复路径写回
// agent.acp_session_id；BeginLoadReplay 同步更新
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn set_agent_session_id_writes_agent_projection() {
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    // session/new 绑定建立路径（create 无 load_session）。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::SetAgentSessionId {
                acp_session_id: "acp-new".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
    // load 切换：BeginLoadReplay 同步更新 agent.acp_session_id。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::BeginLoadReplay {
                acp_session_id: "acp-loaded".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
    // load 失败恢复：SetAgentSessionId 写回旧值。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::SetAgentSessionId {
                acp_session_id: "acp-prev".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));

    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    let updates = sink.updates.lock().await;
    for (doc, update) in updates.iter() {
        if *doc == DocId::session("s1") {
            let parsed = yrs::Update::decode_v1(update).unwrap();
            let mut txn = mirror.transact_mut();
            txn.apply_update(parsed).unwrap();
        }
    }
    drop(updates);
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let am = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        am.get(&txn, "acp_session_id")
            .unwrap()
            .cast::<String>()
            .unwrap(),
        "acp-prev",
        "恢复路径写回旧值（镜像以最后写入为准）"
    );
}

// ---------------------------------------------------------------------------
// open/close 生命周期
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn open_chat_idempotent_and_close_rejects_submit() {
    let mgr = DocManager::new(cfg(), Arc::new(MemSink::default()));
    open(&mgr, "s1").await;
    // 重复打开幂等。
    open(&mgr, "s1").await;
    mgr.close_chat("s1").await.unwrap();
    // close 后提交 → ChatNotFound。
    let r = mgr.submit_event(user_msg("s1", 1, "t1")).await;
    assert!(matches!(
        r,
        SubmitResult::Rejected(SubmitError::ChatNotFound)
    ));
}

// ---------------------------------------------------------------------------
// 广播订阅
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn broadcast_delivers_updates_to_subscribers() {
    let mgr = DocManager::new(cfg(), Arc::new(MemSink::default()));
    let mut rx = mgr.subscribe_updates().await;
    open(&mgr, "s1").await;
    seed_user_entry(&mgr, "s1").await;
    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;
    let mut got = 0;
    while let Ok(u) = rx.try_recv() {
        if u.doc == DocId::chat("s1") || u.doc == DocId::session("s1") {
            got += 1;
        }
    }
    assert!(got >= 2, "chat + control update 应广播，got {got}");
}

// ---------------------------------------------------------------------------
// 双 Doc 事务顺序（§7.4）：chat update 先于 control update 落盘
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn chat_persists_before_control() {
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    let _ = mgr.submit_event(user_msg("s1", 1, "t1")).await;
    tokio::time::advance(TokioDuration::from_millis(20)).await;
    tokio::task::yield_now().await;
    let updates = sink.updates.lock().await;
    // user_message 同时写 chat（entry）与 control（active_turn）：chat 先落盘。
    let chat_idx = updates
        .iter()
        .position(|(d, _)| *d == DocId::chat("s1"))
        .expect("chat update");
    let control_idx = updates
        .iter()
        .position(|(d, _)| *d == DocId::session("s1"))
        .expect("control update");
    assert!(chat_idx < control_idx, "chat 必须先于 control 落盘");
}

// ---------------------------------------------------------------------------
// 落盘失败 → PersistFailed + degraded 上报
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn persist_failure_returns_persist_failed() {
    let sink = MemSink::default();
    sink.fail.store(true, std::sync::atomic::Ordering::SeqCst);
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    // 先订阅（广播发生在提交期间，错过即无 update）。
    let mut rx = mgr.subscribe_updates().await;
    // 注入命令（§6.5 服务端单写）产生 chat 增量 → 落盘失败 → PersistFailed。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::RegisterUserEntry {
                turn_id: "t1".into(),
                entry_id: "t1:user".into(),
                text: "hi".into(),
                author_user_id: None,
                source_command_id: "test-command".into(),
                created_at: "2026-08-07T00:00:00Z".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::PersistFailed));
    // §8.4 故障面：失败 update 不广播（客户端不得先于镜像看到未持久化
    // 状态），也不丢弃（进重试缓冲）。
    assert!(
        rx.try_recv().is_err(),
        "落盘失败时不得广播未持久化的 update"
    );
    // 恢复 sink 后下一条命令触发重投：先前失败的 update 补投 + 广播，
    // 镜像（MemSink）补全（基线 + chat + session 增量）。
    sink.fail.store(false, std::sync::atomic::Ordering::SeqCst);
    let r2 = mgr
        .submit_command(
            "s1",
            DocCommand::UpdateTitle {
                title: "after recovery".into(),
            },
        )
        .await;
    assert!(matches!(r2, SubmitResult::Applied(a) if a.applied));
    let mut got = 0;
    while rx.try_recv().is_ok() {
        got += 1;
    }
    assert!(got >= 3, "恢复后失败 update 应补投并广播（got={got}）");
    // 镜像可回放：chat doc 的增量（含重投的 user entry）全部落盘。
    use yrs::updates::decoder::Decode as _;
    let mirror = yrs::Doc::new();
    for (doc, update) in sink.updates.lock().await.iter() {
        if *doc != DocId::chat("s1") {
            continue;
        }
        mirror
            .transact_mut()
            .apply_update(yrs::Update::decode_v1(update).unwrap())
            .unwrap();
    }
    let txn = mirror.transact();
    let root = txn
        .get_map("root")
        .and_then(|root| root.get(&txn, "entries"))
        .and_then(|value| value.cast::<yrs::MapRef>().ok());
    assert!(
        root.is_some_and(|entries| entries.get(&txn, "t1:user").is_some()),
        "重投后镜像应包含 user entry"
    );
}

