//! CommandCoordinator runtime creation 主题测试（command_coordinator_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 create 路径的 spawn 失败、超时 kill 清理、
//! spawn/kill ack 丢失 unknown 不重来、session/new forward ack 丢失不双开
//! 线程（§4.4 串行创建队列）。公共 helper bound_session 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn spawn_failure_agent_unavailable() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Create {
        command_id: cid.clone(),
        payload: CreateChatPayload {
            instance_id: Some("local".into()),
            cwd: None,
            title: Some("t".into()),
            acp_session_id: None,
            workspace_id: None,
        },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    // instance 收 spawn → 回 spawn_ack{ok:false}。
    let spawn_frame = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("instance should receive spawn")
        .expect("rx alive");
    let (spawn_cid, chat_id) = match spawn_frame {
        OutboundMsg::Frame(Frame::InstanceSpawn(s)) => (s.command_id, s.chat_id),
        other => panic!("expected spawn, got {other:?}"),
    };
    assert_eq!(spawn_cid, cid);
    env.instance
        .on_ack(
            "local",
            &cid,
            crate::control::InstanceAck::Spawn(peri_studio_proto::instance::InstanceSpawnAck {
                command_id: cid.clone(),
                chat_id: chat_id.clone(),
                ok: false,
                error: Some("spawn failed".into()),
            }),
        )
        .await;
    // client 收 action_error AGENT_UNAVAILABLE（retryable）。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(e)))) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::AgentUnavailable);
            assert!(e.retryable);
        }
        other => panic!("expected action_error, got {other:?}"),
    }
    // 半创建清理：无幽灵视图（session 已移除；轮询等待异步清理完成）。
    let sid_uuid = chat_id.parse().unwrap();
    let mut removed = false;
    for _ in 0..40 {
        if env.store.chat(sid_uuid).is_none() {
            removed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(removed, "半创建 session 应被清理（§6.2）");
}

#[tokio::test]
async fn create_timeout_cleanup_with_kill() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Create {
        command_id: cid.clone(),
        payload: CreateChatPayload::default(),
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }));
    // instance 收 spawn（不回 ack）→ spawn 超时（500ms）→ 清理 + 补发 kill。
    let _spawn = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("spawn received");
    let mut saw_kill = false;
    for _ in 0..4 {
        match tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv()).await {
            Ok(Some(OutboundMsg::Frame(Frame::InstanceKill(k)))) => {
                saw_kill = true;
                // 回 kill_ack（幂等清理路径）。
                env.instance
                    .on_ack(
                        "local",
                        &k.command_id,
                        crate::control::InstanceAck::Kill(
                            peri_studio_proto::instance::InstanceKillAck {
                                command_id: k.command_id.clone(),
                                chat_id: k.chat_id.clone(),
                                ok: true,
                            },
                        ),
                    )
                    .await;
                break;
            }
            Ok(Some(_)) => continue,
            other => panic!("expected kill, got {other:?}"),
        }
    }
    assert!(saw_kill, "cleanup kill should be sent (§6.2)");
    // client 收 action_error AGENT_UNAVAILABLE(retryable)。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(e)))) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::AgentUnavailable);
            assert!(e.retryable);
        }
        other => panic!("expected action_error, got {other:?}"),
    }
}

#[tokio::test]
async fn create_spawn_and_kill_ack_loss_is_unknown_and_never_respawns() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Create {
        command_id: cid.clone(),
        payload: CreateChatPayload::default(),
    };
    assert!(matches!(
        env.coordinator
            .submit(&ctx("create-unknown"), action.clone(), tx.clone())
            .await,
        SubmitAck::Accepted { .. }
    ));

    let spawn = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(spawn, OutboundMsg::Frame(Frame::InstanceSpawn(_))));
    let kill = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(kill, OutboundMsg::Frame(Frame::InstanceKill(_))));
    // Deliberately lose both acknowledgements. The same command identity must
    // become terminal-unknown rather than authorizing a new chat id/spawn.
    let error = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    match error {
        OutboundMsg::Frame(Frame::ActionError(error)) => {
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected delivery unknown, got {other:?}"),
    }

    match env
        .coordinator
        .submit(&ctx("create-unknown-retry"), action, tx)
        .await
    {
        SubmitAck::Failed(error) => assert_eq!(error.code, ErrorCode::DeliveryUnknown),
        other => panic!("same command must remain blocked, got {other:?}"),
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(300), env.instance_rx.recv())
            .await
            .is_err(),
        "same command retry must not send a second spawn"
    );
}

#[tokio::test]
async fn create_session_new_forward_ack_loss_never_creates_a_second_thread() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Create {
        command_id: cid.clone(),
        payload: CreateChatPayload::default(),
    };
    assert!(matches!(
        env.coordinator
            .submit(&ctx("new-unknown"), action.clone(), tx.clone())
            .await,
        SubmitAck::Accepted { .. }
    ));

    let spawn = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => spawn,
        other => panic!("expected spawn, got {other:?}"),
    };
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

    let initialize = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected initialize, got {other:?}"),
    };
    assert_eq!(initialize.frame["method"], "initialize");
    assert_eq!(
        initialize.frame["params"]["clientCapabilities"]["_meta"]["peri.tokenStats"],
        true
    );
    assert_eq!(
        initialize.frame["params"]["clientCapabilities"]["_meta"]["peri.skillNames"],
        true
    );
    assert_eq!(
        initialize.frame["params"]["clientCapabilities"]["_meta"]["peri.agentActivity"],
        true
    );
    assert_eq!(
        initialize.frame["params"]["clientCapabilities"]["_meta"]["peri.prediction"],
        true
    );
    assert_eq!(
        initialize.frame["params"]["clientCapabilities"]["_meta"]["peri.replay"],
        true
    );
    env.instance
        .on_ack(
            "local",
            &initialize.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: initialize.command_id.clone(),
                chat_id: initialize.chat_id.clone(),
                ok: true,
                error: None,
            }),
        )
        .await;
    let init_response = peri_studio_proto::instance::InstanceEvent {
        chat_id: spawn.chat_id.clone(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": initialize.frame["id"],
            "result": {"agentCapabilities": {"_meta": {
                "peri.tokenStats": true,
                "peri.skillNames": true,
                "peri.agentActivity": true,
                "peri.prediction": true,
                "peri.replay": true
            }}}
        }),
    };
    let _ = env.relay.on_instance_event("local", &init_response).await;

    let session_new = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected session/new, got {other:?}"),
    };
    assert_eq!(session_new.frame["method"], "session/new");
    // session/new is sent only after the initialize result has crossed the
    // durable Control Doc projection barrier.
    let (state, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(&spawn.chat_id))
        .await
        .expect("session doc snapshot");
    let projected = yrs::Doc::new();
    {
        let update = yrs::Update::decode_v1(&state).expect("decode session state");
        projected.transact_mut().apply_update(update).unwrap();
    }
    let txn = projected.transact();
    let root = txn.get_map(crate::state::factory::ROOT).expect("root");
    let agent = root
        .get(&txn, "agent")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .expect("agent map");
    let extensions = agent
        .get(&txn, "extensions")
        .and_then(|value| value.cast::<yrs::ArrayRef>().ok())
        .expect("extensions array");
    assert_eq!(extensions.get(&txn, 0), Some("peri.tokenStats".into()));
    assert_eq!(extensions.get(&txn, 1), Some("peri.skillNames".into()));
    assert_eq!(extensions.get(&txn, 2), Some("peri.agentActivity".into()));
    assert_eq!(extensions.get(&txn, 3), Some("peri.prediction".into()));
    assert_eq!(extensions.get(&txn, 4), Some("peri.replay".into()));
    drop(txn);
    // Lose the writer acknowledgement. ACP may already have created a durable
    // thread, so a confirmed child kill still cannot make this replayable.
    let kill = match tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap()
    {
        OutboundMsg::Frame(Frame::InstanceKill(kill)) => kill,
        other => panic!("expected cleanup kill, got {other:?}"),
    };
    env.instance
        .on_ack(
            "local",
            &kill.command_id,
            InstanceAck::Kill(peri_studio_proto::instance::InstanceKillAck {
                command_id: kill.command_id.clone(),
                chat_id: kill.chat_id.clone(),
                ok: true,
            }),
        )
        .await;

    match tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap()
    {
        OutboundMsg::Frame(Frame::ActionError(error)) => {
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected delivery unknown, got {other:?}"),
    }
    match env
        .coordinator
        .submit(&ctx("new-unknown-retry"), action, tx)
        .await
    {
        SubmitAck::Failed(error) => assert_eq!(error.code, ErrorCode::DeliveryUnknown),
        other => panic!("same command must remain blocked, got {other:?}"),
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(300), env.instance_rx.recv())
            .await
            .is_err(),
        "retry must not spawn a second runtime or send session/new again"
    );
}
