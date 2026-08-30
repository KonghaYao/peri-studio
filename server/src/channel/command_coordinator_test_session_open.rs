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
    seed_catalog_session(&env.projects, "p1", "acp-1", "Active").await;
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

    let (tx, mut rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionOpen {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: PersistedSessionOpenPayload {
                    session_id: "acp-1".into(),
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

/// session/open：无进程存活证据（confirmed=false）→ 走 spawn + `session/load`。
#[tokio::test]
async fn session_open_without_confirmed_runtime_spawns_and_loads() {
    let mut env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    seed_catalog_session(&env.projects, "p1", "acp-1", "Saved").await;
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

    let (tx, _rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionOpen {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: PersistedSessionOpenPayload {
                    session_id: "acp-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled), "{result:?}");
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
}

/// session/open：catalog 中已有 ACP id 的会话重新打开 → 走 spawn + `session/load` 恢复。
#[tokio::test]
async fn session_open_reconciliation_required_spawns_recovery() {
    let mut env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    seed_catalog_session(&env.projects, "p1", "acp-1", "Saved").await;

    let (tx, _rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionOpen {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: PersistedSessionOpenPayload {
                    session_id: "acp-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled), "{result:?}");
    let frame = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("catalog session open must spawn")
        .expect("rx alive");
    match frame {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => {
            assert_eq!(spawn.cwd, env._tmp.path().to_str().unwrap());
        }
        other => panic!("expected instance spawn, got {other:?}"),
    }
}

/// 恢复 open 撞上视图重建残留的 stale binding（runtime_confirmed=false）：
/// pre-bind 必须接管而不是 BindingConflict。
#[tokio::test]
async fn recovery_open_takes_over_stale_unconfirmed_binding() {
    let mut env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    seed_catalog_session(&env.projects, "p1", "acp-1", "Saved").await;
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
    env.chats.reconcile_alive("local", &[]).await.unwrap();
    assert!(!env.chats.entry("old-chat").await.unwrap().runtime_confirmed);
    assert_eq!(
        env.chats.resolve("acp-1").await.as_deref(),
        Some("old-chat")
    );
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
                    session_id: "acp-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled), "{result:?}");
    let spawn = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("recovery open must spawn")
        .expect("rx alive");
    let new_chat = match &spawn {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => spawn.chat_id.clone(),
        other => panic!("expected instance spawn, got {other:?}"),
    };
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

    assert_eq!(
        env.chats.resolve("acp-1").await.as_deref(),
        Some(new_chat.as_str())
    );
    assert_eq!(env.chats.session_id("old-chat").await.as_deref(), None);
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
    match terminal {
        OutboundMsg::Frame(Frame::ActionAck(ack)) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
            assert_eq!(ack.session_id.as_deref(), Some("acp-import-1"));
        }
        other => panic!("expected committed import ack, got {other:?}"),
    }
    let imported = env.projects.catalog().get("acp-import-1").await.unwrap();
    assert_eq!(imported.acp_session_id, "acp-import-1");
}
