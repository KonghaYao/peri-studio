//! DocManager 命令路由测试（§8.5 / §6.5 / §6.3）：RegisterUserEntry
//! 幂等与 source_command 冲突、PermissionResolve CAS、标题/终态命令、
//! RegistryApplySessions 全量同步投影（幂等 diff + 自愈删除 + 孤儿键
//! 清理）。

use std::sync::Arc;

use yrs::{Map, ReadTxn, Transact};

use peri_studio_proto::conn::DocId;
use peri_studio_proto::schema::ToolCallStatus;

use crate::state::doc_manager::{DocCommand, DocManager, SubmitResult};
use crate::state::normalized::{EventBody, NormalizedEvent};

use super::util::*;

// ---------------------------------------------------------------------------
// 命令路径（§8.5）：user entry 注册 / 权限 CAS / 标题 / 终态
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn command_register_user_entry_then_submit_duplicate() {
    let mgr = DocManager::new(cfg(), Arc::new(MemSink::default()));
    open(&mgr, "s1").await;
    let cmd = DocCommand::RegisterUserEntry {
        turn_id: "t1".to_string(),
        entry_id: "t1:user".to_string(),
        text: "hi".to_string(),
        author_user_id: None,
        source_command_id: "command-1".to_string(),
        created_at: "2026-08-07T00:00:00Z".to_string(),
    };
    let r = mgr.submit_command("s1", cmd.clone()).await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
    // 重复注册 → 幂等拒绝。
    let r = mgr.submit_command("s1", cmd).await;
    assert!(matches!(r, SubmitResult::Applied(a) if !a.applied));
}

#[tokio::test(start_paused = true)]
async fn command_register_user_entry_rejects_a_different_source_command() {
    let mgr = DocManager::new(cfg(), Arc::new(MemSink::default()));
    open(&mgr, "s1").await;
    let command = |source: &str| DocCommand::RegisterUserEntry {
        turn_id: "t1".into(),
        entry_id: "t1:user".into(),
        text: "same".into(),
        author_user_id: None,
        source_command_id: source.into(),
        created_at: "now".into(),
    };
    assert!(
        matches!(mgr.submit_command("s1", command("cmd-1")).await, SubmitResult::Applied(a) if a.applied)
    );
    assert!(
        matches!(mgr.submit_command("s1", command("cmd-2")).await, SubmitResult::Applied(a) if a.reason == Some(crate::state::aggregator::ApplyReason::SourceCommandConflict))
    );
}

#[tokio::test(start_paused = true)]
async fn command_permission_resolve_cas() {
    let mgr = DocManager::new(cfg(), Arc::new(MemSink::default()));
    open(&mgr, "s1").await;
    // 先注册 turn（active_turn 存在；PermissionRequested 关联检查要求 turn 已知）。
    seed_user_entry(&mgr, "s1").await;
    // 再投影 permission request（事件路径）。
    let ev = NormalizedEvent {
        chat_id: "s1".to_string(),
        seq: 2,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".to_string(),
        provenance: Default::default(),
        body: EventBody::PermissionRequested {
            permission_id: "p1".to_string(),
            turn_id: "t1".to_string(),
            tool_call_id: None,
            tool: None,
            title: "允许".to_string(),
            description: None,
            options: vec![],
            expires_at: "2026-08-07T00:05:00Z".to_string(),
        },
    };
    let r = mgr.submit_event(ev).await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::ResolvePermission {
                permission_id: "p1".to_string(),
                decision: peri_studio_proto::action::PermissionDecision::Allow,
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
    // 重复 resolve → 幂等。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::ResolvePermission {
                permission_id: "p1".to_string(),
                decision: peri_studio_proto::action::PermissionDecision::Deny,
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if !a.applied));
}

#[tokio::test(start_paused = true)]
async fn command_permission_resolution_updates_linked_tool_projection() {
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;
    seed_user_entry(&mgr, "s1").await;
    let started = NormalizedEvent {
        chat_id: "s1".into(),
        seq: 2,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".into(),
        provenance: Default::default(),
        body: EventBody::ToolCallStarted {
            turn_id: "t1".into(),
            tool_call_id: "tc1".into(),
            name: "shell".into(),
            status: ToolCallStatus::Running,
            arguments: None,
            created_at: "2026-08-07T00:00:00Z".into(),
        },
    };
    assert!(matches!(mgr.submit_event(started).await, SubmitResult::Applied(a) if a.applied));
    let requested = NormalizedEvent {
        chat_id: "s1".into(),
        seq: 3,
        epoch: 0,
        ts: "2026-08-07T00:00:00Z".into(),
        provenance: Default::default(),
        body: EventBody::PermissionRequested {
            permission_id: "p1".into(),
            turn_id: "t1".into(),
            tool_call_id: Some("tc1".into()),
            tool: None,
            title: "允许".into(),
            description: None,
            options: vec![],
            expires_at: "2026-08-07T00:05:00Z".into(),
        },
    };
    assert!(matches!(mgr.submit_event(requested).await, SubmitResult::Applied(a) if a.applied));
    assert!(matches!(
        mgr.submit_command(
            "s1",
            DocCommand::ResolvePermission {
                permission_id: "p1".into(),
                decision: peri_studio_proto::action::PermissionDecision::Deny,
            },
        )
        .await,
        SubmitResult::Applied(a) if a.applied
    ));

    tokio::task::yield_now().await;
    use yrs::updates::decoder::Decode as _;
    let mirror = yrs::Doc::new();
    for (doc, update) in sink.updates.lock().await.iter() {
        if *doc == DocId::chat("s1") {
            let mut txn = mirror.transact_mut();
            txn.apply_update(yrs::Update::decode_v1(update).unwrap())
                .unwrap();
        }
    }
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let calls = root
        .get(&txn, "tool_calls")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let tool = calls
        .get(&txn, "tc1")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        tool.get(&txn, "status").unwrap().cast::<String>().unwrap(),
        "cancelled"
    );
}

#[tokio::test(start_paused = true)]
async fn command_update_title_and_chat_terminal() {
    let mgr = DocManager::new(cfg(), Arc::new(MemSink::default()));
    open(&mgr, "s1").await;
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::UpdateTitle {
                title: "新标题".into(),
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::SetChatTerminal {
                status: peri_studio_proto::schema::ChatStatus::Closed,
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));
}

// ---------------------------------------------------------------------------
// RegistryApplySessions（§6.3）：instance 级 session 列表全量同步投影到
// Registry Doc（幂等 diff + 自愈删除；不随 chat 销毁/重建）
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn command_apply_session_list_projects_idempotent_and_self_heals() {
    use peri_studio_proto::schema::SessionSummaryProjection;
    use yrs::{Map, MapRef, ReadTxn, Transact};

    // 镜像从 MemSink 落盘记录重放（含 writer 启动基线——基线只走 sink，
    // 不经广播通道；真实客户端经 gateway 快照获得同源基线）。
    let sink = MemSink::default();
    let mgr = DocManager::new(cfg(), Arc::new(sink.clone()));
    open(&mgr, "s1").await;

    let sum = |id: &str, title: &str, updated: &str| SessionSummaryProjection {
        session_id: id.to_string(),
        title: title.to_string(),
        status: String::new(), // peri SessionInfo 无 status 字段 → 空串
        updated_at: updated.to_string(),
        cwd: String::new(),
        bound_chat_id: None,
    };

    // 初始列表：两个条目。
    let entries = vec![sum("a", "会话A", "t0"), sum("b", "会话B", "t1")];
    let r = mgr
        .submit_command("s1", DocCommand::RegistryApplySessions { entries })
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));

    // 重放 control 更新（累积镜像）→ 校验 sessions Map。
    let mirror = yrs::Doc::new();
    async fn drain(sink: &MemSink, mirror: &yrs::Doc) {
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
    drain(&sink, &mirror).await;
    {
        let txn = mirror.transact();
        let root = txn.get_map("root").expect("root map");
        let sessions = root
            .get(&txn, "sessions")
            .expect("sessions map")
            .cast::<MapRef>()
            .unwrap();
        assert_eq!(sessions.iter(&txn).count(), 2);
        let a = sessions.get(&txn, "a").unwrap().cast::<MapRef>().unwrap();
        assert_eq!(
            a.get(&txn, "title").unwrap().cast::<String>().unwrap(),
            "会话A"
        );
    }

    // 幂等：同列表再提交 → 仍 Applied（diff 无变化，无额外写入）。
    let r = mgr
        .submit_command(
            "s1",
            DocCommand::RegistryApplySessions {
                entries: vec![sum("a", "会话A", "t0"), sum("b", "会话B", "t1")],
            },
        )
        .await;
    assert!(matches!(r, SubmitResult::Applied(a) if a.applied));

    // 全量同步：b 更新字段、a 不在响应中 → 旧条目删除（§6.3 自愈）。
    let _ = mgr
        .submit_command(
            "s1",
            DocCommand::RegistryApplySessions {
                entries: vec![sum("b", "会话B-改", "t2")],
            },
        )
        .await;
    drain(&sink, &mirror).await;
    {
        let txn = mirror.transact();
        let root = txn.get_map("root").expect("root map");
        let sessions = root
            .get(&txn, "sessions")
            .expect("sessions map")
            .cast::<MapRef>()
            .unwrap();
        assert_eq!(sessions.iter(&txn).count(), 1, "响应中不存在的旧条目应删除");
        assert!(sessions.get(&txn, "a").is_none());
        let b = sessions.get(&txn, "b").unwrap().cast::<MapRef>().unwrap();
        assert_eq!(
            b.get(&txn, "title").unwrap().cast::<String>().unwrap(),
            "会话B-改"
        );
    }
}

/// 孤儿 key 自愈（§6.3 全量同步）：历史遗留条目（map key ≠ 内部 session_id）
/// 必须随一次全量同步删除——read_current 以真实 key 进投影，diff 按真实 key
/// 收集 remove；否则孤儿 key 永存、渲染层按 key 逐条渲染 → 重复条目。
#[test]
fn session_list_orphan_key_removed_by_full_sync() {
    use crate::state::session_list;
    use peri_studio_proto::schema::SessionSummaryProjection;
    use yrs::{Map, ReadTxn, Transact, WriteTxn};

    let doc = yrs::Doc::new();
    let sum = |id: &str, title: &str, updated: &str| SessionSummaryProjection {
        session_id: id.to_string(),
        title: title.to_string(),
        status: String::new(),
        updated_at: updated.to_string(),
        cwd: String::new(),
        bound_chat_id: None,
    };

    // 构造孤儿条目：map key = "old-key"，内部 session_id = "b"（与 incoming
    // 相同的 id——最严场景：既需重建正常 key 条目，又需删除孤儿 key）。
    {
        let mut txn = doc.transact_mut();
        let root = txn.get_or_insert_map("root");
        let sessions = root.get_or_init::<_, yrs::MapRef>(&mut txn, "sessions");
        let m = sessions.get_or_init::<_, yrs::MapRef>(&mut txn, "old-key");
        m.insert(&mut txn, "session_id", "b");
        m.insert(&mut txn, "title", "旧条目");
        m.insert(&mut txn, "updated_at", "t0");
    }

    // 全量同步：响应只有 b（正常条目）。
    let current = {
        let txn = doc.transact();
        let root = txn.get_map("root").unwrap();
        session_list::read_current(&txn, &root)
    };
    assert_eq!(current.len(), 1);
    assert!(
        current.contains_key("old-key"),
        "投影以 map 真实 key 为键（孤儿也进投影）"
    );
    let d = session_list::diff(&current, &[sum("b", "B", "t1")]);
    assert!(
        d.remove.contains(&"old-key".to_string()),
        "孤儿 key 应被 remove 收集（真实 key）"
    );
    assert!(d.upsert.iter().any(|e| e.session_id == "b"));

    // 应用 diff。
    {
        let mut txn = doc.transact_mut();
        let root = txn.get_or_insert_map("root");
        session_list::apply_diff(&mut txn, &root, &d);
    }

    // 结果：孤儿删除，正常条目写入（key = b，内容来自 incoming）。
    let txn = doc.transact();
    let root = txn.get_map("root").unwrap();
    let sessions = root
        .get(&txn, "sessions")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(sessions.iter(&txn).count(), 1, "孤儿删除后只剩 1 条");
    assert!(sessions.get(&txn, "old-key").is_none(), "孤儿 key 已删除");
    let b = sessions
        .get(&txn, "b")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(b.get(&txn, "title").unwrap().cast::<String>().unwrap(), "B");
}
