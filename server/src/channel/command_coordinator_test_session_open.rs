//! CommandCoordinator session/open 主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 session/open 的复用/生成/对账/接管（§4.4 binding
//! 生命周期）与 session/import 精确 cwd 校验。公共 helper drive_rpc 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
/// session/open：ChatRegistry 中有存活证据的 runtime（confirmed）→ 复用，
/// 不 spawn 新进程（§8.5）。
#[tokio::test]
async fn session_open_reuses_confirmed_live_runtime_without_spawn() {
    let mut env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    env.metadata
        .import_session("logical-1", "p1", "acp-1", "Active", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    env.chats
        .register(
            "chat-live",
            "local",
            Some("Active"),
            env._tmp.path().to_str().unwrap(),
            Some("p1"),
        )
        .await
        .unwrap();
    env.chats.bind("chat-live", "acp-1", true).await.unwrap();
    env.metadata
        .touch_session_open("logical-1", "chat-live")
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionOpen {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: PersistedSessionOpenPayload {
                    session_id: "logical-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled), "{result:?}");
    // 异步执行：先 Accepted，再 Committed（复用路径直接 committed，
    // 不经过 spawn）。
    let mut committed = false;
    for _ in 0..2 {
        match rx.recv().await {
            Some(OutboundMsg::Frame(Frame::ActionAck(ack))) => {
                if ack.status == AckStatus::Committed {
                    committed = true;
                }
            }
            other => panic!("unexpected frame {other:?}"),
        }
    }
    assert!(committed, "confirmed runtime 直接 committed，不经过 spawn");
    // 复用路径绝不向 instance 下发 spawn/initialize。
    assert!(
        tokio::time::timeout(Duration::from_millis(200), env.instance_rx.recv())
            .await
            .is_err(),
        "live runtime 复用不得产生 instance 下行指令"
    );
}

/// session/open：重启恢复的 chat 无进程存活证据（confirmed=false）→ 走
/// spawn + `session/load`（acp_session_id 来自 sqlite），恢复 ACP thread。
#[tokio::test]
async fn session_open_without_confirmed_runtime_spawns_and_loads() {
    let mut env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    env.metadata
        .import_session("logical-1", "p1", "acp-1", "Saved", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    // 视图重建（§无状态投影 恢复路径）：register + bind 但不构成存活证据。
    env.chats
        .register(
            "chat-recovered",
            "local",
            Some("Saved"),
            env._tmp.path().to_str().unwrap(),
            Some("p1"),
        )
        .await
        .unwrap();
    env.chats
        .bind("chat-recovered", "acp-1", false)
        .await
        .unwrap();
    env.metadata
        .touch_session_open("logical-1", "chat-recovered")
        .await
        .unwrap();

    let (tx, _rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionOpen {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: PersistedSessionOpenPayload {
                    session_id: "logical-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled), "{result:?}");
    // spawn + load 路径：instance 侧必须收到 spawn 指令（重新激活进程）。
    // 打开的 runtime chat 是新生成的（未复用旧的 chat-recovered），
    // spawn 的 chat_id 是新 UUID；cwd 与持久化 project 一致。
    let frame = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("unconfirmed runtime 必须下发 spawn")
        .expect("rx alive");
    match frame {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => {
            assert_ne!(spawn.chat_id, "chat-recovered");
            assert_eq!(spawn.cwd, env._tmp.path().to_str().unwrap());
        }
        other => panic!("expected instance spawn, got {other:?}"),
    }
    // create 流程内部会继续 initialize + session/load RPC（acp_session_id
    // 来自 sqlite 的 acp-1）；无需在此完整驱动，spawn 已证明未走复用路径。
}

/// session/open：`reconciliation_required` 的会话（激活失败/重启中断残留，
/// acp session id 仍在 sqlite）重新打开 → 不得被 "not ready" 拒绝，必须走
/// spawn + `session/load` 恢复（§8.5），残留的终态激活记录被新一轮激活覆盖。
#[tokio::test]
async fn session_open_reconciliation_required_spawns_recovery() {
    let mut env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    env.metadata
        .import_session("logical-1", "p1", "acp-1", "Saved", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    // 上一轮激活失败：残留激活记录 + lifecycle=reconciliation_required。
    env.metadata
        .begin_command_with_activation(
            "old-open-cmd",
            "session/open",
            "h-old",
            None,
            Some("logical-1"),
            None,
            Some("logical-1"),
        )
        .await
        .unwrap();
    env.metadata
        .mark_reconciliation_required("logical-1", "activation_failed_or_unknown")
        .await
        .unwrap();
    assert_eq!(
        env.metadata
            .session("logical-1")
            .await
            .unwrap()
            .unwrap()
            .lifecycle,
        "reconciliation_required"
    );

    let (tx, _rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionOpen {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: PersistedSessionOpenPayload {
                    session_id: "logical-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled), "{result:?}");
    // 恢复路径：instance 必须收到 spawn（新 runtime chat，session/load 恢复）。
    let frame = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("reconciliation_required 会话重新打开必须下发 spawn")
        .expect("rx alive");
    match frame {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => {
            assert_eq!(spawn.cwd, env._tmp.path().to_str().unwrap());
        }
        other => panic!("expected instance spawn, got {other:?}"),
    }
}

/// 恢复 open 撞上视图重建残留的 stale binding（runtime_confirmed=false）：
/// pre-bind 必须接管而不是 BindingConflict——否则 create 失败 → instance/
/// kill 杀掉新 spawn 的进程（SIGTERM 根因端到端回归：视图重建
/// bind(confirmed=false) + 对账 missing 后 bindings 条目保留）。
#[tokio::test]
async fn recovery_open_takes_over_stale_unconfirmed_binding() {
    let mut env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    env.metadata
        .import_session("logical-1", "p1", "acp-1", "Saved", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    // 上一轮激活失败：残留激活记录 + lifecycle=reconciliation_required。
    env.metadata
        .begin_command_with_activation(
            "old-open-cmd",
            "session/open",
            "h-old",
            None,
            Some("logical-1"),
            None,
            Some("logical-1"),
        )
        .await
        .unwrap();
    env.metadata
        .mark_reconciliation_required("logical-1", "activation_failed_or_unknown")
        .await
        .unwrap();
    // 重启后的视图重建：旧 chat 登记 + 未确认 binding（hub.rs
    // rebuild_chat_views：bind(confirmed=false)）。
    env.chats
        .register(
            "old-chat",
            "local",
            Some("Saved"),
            env._tmp.path().to_str().unwrap(),
            Some("p1"),
        )
        .await
        .unwrap();
    env.chats.bind("old-chat", "acp-1", false).await.unwrap();
    // instance hello 对账：old-chat 无存活证据（missing），确认位保持
    // false，但 bindings 条目保留（§8.3 残留 stale binding）。
    env.chats.reconcile_alive("local", &[]).await.unwrap();
    assert!(!env.chats.entry("old-chat").await.unwrap().runtime_confirmed);
    assert_eq!(
        env.chats.resolve("acp-1").await.as_deref(),
        Some("old-chat")
    );
    // 无存活证据 → 状态迁移 Gap（不再呈现「运行中」，§8.3 对账）。
    assert_eq!(
        env.chats.entry("old-chat").await.unwrap().state,
        ChatState::Gap
    );

    let (tx, mut rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionOpen {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: PersistedSessionOpenPayload {
                    session_id: "logical-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled), "{result:?}");
    // 恢复路径：instance 必须收到 spawn（新 runtime chat，session/load 恢复）。
    let spawn = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("reconciliation_required 会话重新打开必须下发 spawn")
        .expect("rx alive");
    let new_chat = match &spawn {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => spawn.chat_id.clone(),
        other => panic!("expected instance spawn, got {other:?}"),
    };
    // instance 回 spawn ack（L1+L2，§4.5）。
    if let OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) = &spawn {
        env.instance
            .on_ack(
                "local",
                &spawn.command_id,
                InstanceAck::Spawn(peri_studio_proto::instance::InstanceSpawnAck {
                    command_id: spawn.command_id.clone(),
                    chat_id: spawn.chat_id.clone(),
                    ok: true,
                    error: None,
                }),
            )
            .await;
    }

    // 驱动 create 序列：initialize request → ack + 响应 → session/load
    // request → ack + 响应 → pre-bind（bind_recovering 接管 stale binding）
    // → committed。
    let initialize_id = drive_rpc(&env.instance, &mut env.instance_rx, "initialize").await;
    env.relay
        .on_instance_event(
            "local",
            &peri_studio_proto::instance::InstanceEvent {
                chat_id: new_chat.clone(),
                epoch: 0,
                seq: 1,
                frame: serde_json::json!({"jsonrpc": "2.0", "id": initialize_id, "result": {}}),
            },
        )
        .await;
    let load_id = drive_rpc(&env.instance, &mut env.instance_rx, "session/load").await;
    env.relay
        .on_instance_event(
            "local",
            &peri_studio_proto::instance::InstanceEvent {
                chat_id: new_chat.clone(),
                epoch: 0,
                seq: 2,
                frame: serde_json::json!({"jsonrpc": "2.0", "id": load_id, "result": {"ok": true}}),
            },
        )
        .await;

    // 成功路径：binding 已迁移到新 runtime chat（而不是 BindingConflict
    // 杀进程），旧 chat 不再拥有该会话。
    assert_eq!(
        env.chats.resolve("acp-1").await.as_deref(),
        Some(new_chat.as_str())
    );
    assert_eq!(env.chats.session_id("old-chat").await.as_deref(), None);
    // 新 runtime chat 恢复「运行中」呈现（create 成功路径显式恢复，
    // 防御 spawn 前被对账置 Gap 的窗口）；旧 chat 保持 Gap（进程未复活）。
    assert_eq!(
        env.chats.entry(&new_chat).await.unwrap().state,
        ChatState::Accepting
    );
    assert_eq!(
        env.chats.entry("old-chat").await.unwrap().state,
        ChatState::Gap
    );
    assert!(matches!(
        rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))) if ack.status == AckStatus::Accepted
    ));
    let terminal = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("create must commit")
        .expect("rx alive");
    match terminal {
        OutboundMsg::Frame(Frame::ActionAck(ack)) => {
            assert_eq!(ack.status, AckStatus::Committed);
        }
        OutboundMsg::Frame(Frame::ActionError(err)) => {
            panic!("recovery open must not fail, got {err:?}");
        }
        other => panic!("expected committed ack, got {other:?}"),
    }
}

#[tokio::test]
async fn session_import_requires_exact_project_cwd_and_commits_catalog_entry() {
    let env = env().await;
    let cwd = env._tmp.path().to_string_lossy().into_owned();
    env.metadata
        .create_project("p1", "Demo", &cwd, "local")
        .await
        .unwrap();
    env.doc
        .registry()
        .apply_sessions(vec![peri_studio_proto::schema::SessionSummaryProjection {
            session_id: "acp-import-1".into(),
            title: "External thread".into(),
            status: "ready".into(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            cwd,
            bound_chat_id: None,
        }])
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::channel(8);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionImport {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: PersistedSessionImportPayload {
                    project_id: "p1".into(),
                    acp_session_id: "acp-import-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled));
    assert!(
        matches!(rx.recv().await, Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))) if ack.status == peri_studio_proto::ack::AckStatus::Accepted)
    );
    let terminal = rx.recv().await.unwrap();
    let session_id = match terminal {
        OutboundMsg::Frame(Frame::ActionAck(ack)) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
            ack.session_id.unwrap()
        }
        other => panic!("expected committed import ack, got {other:?}"),
    };
    let imported = env.metadata.session(&session_id).await.unwrap().unwrap();
    assert_eq!(imported.origin, "imported");
    assert_eq!(imported.acp_session_id.as_deref(), Some("acp-import-1"));
}
