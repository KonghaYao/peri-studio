//! CommandCoordinator project/session discover 主题测试（command_coordinator_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 discover 引导 + 私有 runtime 清理、复用匹配的 live
//! runtime 不重复 spawn、失败时清理 runtime 并释放 project 租约（§4.4）。
//! 公共 helper bound_session 见 command_coordinator_test_util（经父模块
//! re-export，经 `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn project_session_discover_bootstraps_and_cleans_private_runtime() {
    let mut env = env().await;
    let cwd = env._tmp.path().to_string_lossy().into_owned();
    env.metadata
        .create_project("project-1", "Demo", &cwd, "local")
        .await
        .unwrap();
    let command_id = uuid::Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::channel(16);
    let result = env
        .coordinator
        .submit(
            &ctx("discover"),
            ActionEnvelope::PersistedSessionDiscover {
                command_id: command_id.clone(),
                payload: ProjectArchivePayload {
                    project_id: "project-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled));
    assert!(
        matches!(rx.recv().await, Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))) if ack.status == AckStatus::Accepted)
    );

    let (second_tx, _second_rx) = mpsc::channel(4);
    let duplicate_flight = env
        .coordinator
        .submit(
            &ctx("discover-again"),
            ActionEnvelope::PersistedSessionDiscover {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: ProjectArchivePayload {
                    project_id: "project-1".into(),
                },
            },
            second_tx,
        )
        .await;
    assert!(matches!(duplicate_flight, SubmitAck::Failed(ref error) if error.retryable));

    let spawn = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => spawn,
        other => panic!("expected private discovery spawn, got {other:?}"),
    };
    assert_eq!(spawn.cwd, cwd);
    let private_chat = spawn.chat_id.clone();
    let reconciliation = env
        .chats
        .reconcile_alive("local", std::slice::from_ref(&private_chat))
        .await
        .unwrap();
    assert!(
        reconciliation.to_kill.is_empty(),
        "heartbeat must not race-kill a managed discovery runtime"
    );
    env.instance
        .on_ack(
            "local",
            &spawn.command_id,
            InstanceAck::Spawn(peri_studio_proto::instance::InstanceSpawnAck {
                command_id: spawn.command_id.clone(),
                chat_id: private_chat.clone(),
                ok: true,
                error: None,
            }),
        )
        .await;

    for expected_method in ["initialize", "session/list"] {
        let forward = match env.instance_rx.recv().await.unwrap() {
            OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
            other => panic!("expected {expected_method} forward, got {other:?}"),
        };
        assert_eq!(forward.chat_id, private_chat);
        assert_eq!(forward.frame["method"], expected_method);
        env.instance
            .on_ack(
                "local",
                &forward.command_id,
                InstanceAck::Forward(InstanceForwardAck {
                    command_id: forward.command_id.clone(),
                    chat_id: private_chat.clone(),
                    ok: true,
                    error: None,
                }),
            )
            .await;
        let id = forward.frame["id"].as_str().unwrap().to_string();
        let result = if expected_method == "session/list" {
            serde_json::json!({ "sessions": [{ "sessionId": "acp-old", "title": "Existing", "updatedAt": "2026-08-14T00:00:00Z" }] })
        } else {
            serde_json::json!({})
        };
        let response = peri_studio_proto::instance::InstanceEvent {
            chat_id: private_chat.clone(),
            epoch: 0,
            seq: if expected_method == "initialize" {
                1
            } else {
                2
            },
            frame: serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        };
        assert!(matches!(
            env.relay.on_instance_event("local", &response).await,
            crate::channel::ConsumeResult::RpcConfirmed { .. }
        ));
    }

    let kill = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceKill(kill)) => kill,
        other => panic!("expected discovery cleanup kill, got {other:?}"),
    };
    assert_eq!(kill.chat_id, private_chat);
    env.instance
        .on_ack(
            "local",
            &kill.command_id,
            InstanceAck::Kill(peri_studio_proto::instance::InstanceKillAck {
                command_id: kill.command_id.clone(),
                chat_id: private_chat,
                ok: true,
            }),
        )
        .await;
    assert!(
        matches!(rx.recv().await, Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))) if ack.status == AckStatus::Committed)
    );
    assert!(
        env.chats.all_chats().await.is_empty(),
        "private discovery must not create a sidebar/runtime chat"
    );
    let candidates = env.chats.registry().list_legacy_sessions().await.unwrap();
    assert!(candidates
        .iter()
        .any(|session| session.session_id == "acp-old" && session.cwd == cwd));
}

#[tokio::test]
async fn project_session_discover_reuses_matching_live_runtime_without_spawn() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-live").await;
    env.metadata
        .create_project("project-1", "Demo", "/", "local")
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::channel(8);
    let result = env
        .coordinator
        .submit(
            &ctx("discover"),
            ActionEnvelope::PersistedSessionDiscover {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: ProjectArchivePayload {
                    project_id: "project-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled));
    assert!(
        matches!(rx.recv().await, Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))) if ack.status == AckStatus::Accepted)
    );
    let forward = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => {
            panic!("matching live runtime should receive session/list directly, got {other:?}")
        }
    };
    assert_eq!(forward.chat_id, S1);
    assert_eq!(forward.frame["method"], "session/list");
    env.instance
        .on_ack(
            "local",
            &forward.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: forward.command_id.clone(),
                chat_id: S1.into(),
                ok: true,
                error: None,
            }),
        )
        .await;
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": forward.frame["id"],
            "result": { "sessions": [] }
        }),
    };
    env.relay.on_instance_event("local", &response).await;
    assert!(
        matches!(rx.recv().await, Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))) if ack.status == AckStatus::Committed)
    );
    assert!(
        env.instance_rx.try_recv().is_err(),
        "reuse path must not spawn or kill another process"
    );
}

#[tokio::test]
async fn project_session_discover_failure_cleans_runtime_and_releases_project_lease() {
    let mut env = env().await;
    let cwd = env._tmp.path().to_string_lossy().into_owned();
    env.metadata
        .create_project("project-1", "Demo", &cwd, "local")
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(12);
    let result = env
        .coordinator
        .submit(
            &ctx("discover-failure"),
            ActionEnvelope::PersistedSessionDiscover {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: ProjectArchivePayload {
                    project_id: "project-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled));
    assert!(matches!(
        rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Accepted
    ));

    let spawn = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => spawn,
        other => panic!("expected discovery spawn, got {other:?}"),
    };
    let private_chat = spawn.chat_id.clone();
    env.instance
        .on_ack(
            "local",
            &spawn.command_id,
            InstanceAck::Spawn(peri_studio_proto::instance::InstanceSpawnAck {
                command_id: spawn.command_id.clone(),
                chat_id: private_chat.clone(),
                ok: true,
                error: None,
            }),
        )
        .await;
    let initialize = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected initialize forward, got {other:?}"),
    };
    env.instance
        .on_ack(
            "local",
            &initialize.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: initialize.command_id.clone(),
                chat_id: private_chat.clone(),
                ok: true,
                error: None,
            }),
        )
        .await;
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: private_chat.clone(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": initialize.frame["id"],
            "error": { "code": -32603, "message": "initialize rejected" }
        }),
    };
    assert!(matches!(
        env.relay.on_instance_event("local", &response).await,
        crate::channel::ConsumeResult::RpcConfirmed { .. }
    ));
    let kill = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceKill(kill)) => kill,
        other => panic!("failed discovery must clean private runtime, got {other:?}"),
    };
    assert_eq!(kill.chat_id, private_chat);
    env.instance
        .on_ack(
            "local",
            &kill.command_id,
            InstanceAck::Kill(peri_studio_proto::instance::InstanceKillAck {
                command_id: kill.command_id.clone(),
                chat_id: private_chat,
                ok: true,
            }),
        )
        .await;
    assert!(matches!(
        rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionError(ref error))) if error.retryable
    ));
    assert!(env.chats.all_chats().await.is_empty());

    // The failed run's RAII lease must be gone before its terminal error is
    // observed, so a new command is accepted rather than stuck in-flight.
    let (retry_tx, mut retry_rx) = mpsc::channel(8);
    let retry = env
        .coordinator
        .submit(
            &ctx("discover-after-failure"),
            ActionEnvelope::PersistedSessionDiscover {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: ProjectArchivePayload {
                    project_id: "project-1".into(),
                },
            },
            retry_tx,
        )
        .await;
    assert!(matches!(retry, SubmitAck::Handled));
    assert!(matches!(
        retry_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Accepted
    ));
    let retry_spawn = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => spawn,
        other => panic!("released lease should permit another spawn, got {other:?}"),
    };
    env.instance
        .on_ack(
            "local",
            &retry_spawn.command_id,
            InstanceAck::Spawn(peri_studio_proto::instance::InstanceSpawnAck {
                command_id: retry_spawn.command_id.clone(),
                chat_id: retry_spawn.chat_id.clone(),
                ok: false,
                error: Some("fixture stop".into()),
            }),
        )
        .await;
    let retry_kill = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceKill(kill)) => kill,
        other => panic!("retry failure must still clean ownership, got {other:?}"),
    };
    env.instance
        .on_ack(
            "local",
            &retry_kill.command_id,
            InstanceAck::Kill(peri_studio_proto::instance::InstanceKillAck {
                command_id: retry_kill.command_id.clone(),
                chat_id: retry_kill.chat_id,
                ok: true,
            }),
        )
        .await;
    assert!(matches!(
        retry_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionError(_)))
    ));
}
