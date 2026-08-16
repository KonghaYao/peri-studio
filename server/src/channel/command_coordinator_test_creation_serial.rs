//! CommandCoordinator runtime creation 串行/回滚主题测试
//! （command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖并发 create 共享单条串行创建队列、prepare 回滚
//! 清理全部本地分配、投影失败 unknown 且绝不重 spawn。公共 helper 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn concurrent_creates_share_one_serial_runtime_creation_queue() {
    // This assertion controls the spawn terminal explicitly. Keep the
    // production timeout far outside the parallel test scheduler's horizon so
    // elapsed wall time cannot advance the queue on our behalf.
    let mut env = env_with_create_deadlines(Duration::from_secs(60), Duration::from_secs(60)).await;
    let first_id = uuid::Uuid::new_v4().to_string();
    let second_id = uuid::Uuid::new_v4().to_string();
    let first = ActionEnvelope::Create {
        command_id: first_id.clone(),
        payload: CreateChatPayload::default(),
    };
    let second = ActionEnvelope::Create {
        command_id: second_id.clone(),
        payload: CreateChatPayload::default(),
    };
    let (first_tx, _first_rx) = mpsc::channel(8);
    let (second_tx, _second_rx) = mpsc::channel(8);
    let first_ctx = ctx("create-serial-first");
    let second_ctx = ctx("create-serial-second");
    let (first_ack, second_ack) = tokio::join!(
        env.coordinator.submit(&first_ctx, first, first_tx),
        env.coordinator.submit(&second_ctx, second, second_tx),
    );
    assert!(matches!(first_ack, SubmitAck::Accepted { .. }));
    assert!(matches!(second_ack, SubmitAck::Accepted { .. }));

    let first_spawn = match tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap()
    {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => spawn,
        other => panic!("expected first spawn, got {other:?}"),
    };
    match env.instance_rx.try_recv() {
        Err(tokio::sync::mpsc::error::TryRecvError::Empty) => {}
        other => panic!("unexpected frame before first spawn terminal: {other:?}"),
    }
    env.instance
        .on_ack(
            "local",
            &first_spawn.command_id,
            InstanceAck::Spawn(peri_studio_proto::instance::InstanceSpawnAck {
                command_id: first_spawn.command_id.clone(),
                chat_id: first_spawn.chat_id,
                ok: false,
                error: Some("injected first completion".into()),
            }),
        )
        .await;

    let second_spawn = match tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap()
    {
        OutboundMsg::Frame(Frame::InstanceSpawn(spawn)) => spawn,
        other => panic!("expected second spawn, got {other:?}"),
    };
    assert_ne!(first_spawn.command_id, second_spawn.command_id);
    assert!(
        [first_id, second_id].contains(&second_spawn.command_id),
        "the second frame must belong to the other accepted create"
    );
    env.instance
        .on_ack(
            "local",
            &second_spawn.command_id,
            InstanceAck::Spawn(peri_studio_proto::instance::InstanceSpawnAck {
                command_id: second_spawn.command_id.clone(),
                chat_id: second_spawn.chat_id,
                ok: false,
                error: Some("injected second completion".into()),
            }),
        )
        .await;
}

#[tokio::test]
async fn runtime_creation_prepare_rollback_removes_every_local_allocation() {
    let mut env = env().await;
    let chat_id = env
        .coordinator
        .inner
        .runtime_creation
        .prepare(&CreateChatPayload::default())
        .await
        .expect("local preparation should succeed");
    assert!(env.store.chat(chat_id).is_some());
    assert_eq!(
        env.chats.entry(&chat_id.to_string()).await.unwrap().state,
        ChatState::Accepting
    );

    env.coordinator
        .inner
        .runtime_creation
        .rollback_prepared(&chat_id.to_string())
        .await;

    assert!(
        env.store.chat(chat_id).is_none(),
        "rollback must remove the local chat store"
    );
    assert_eq!(
        env.chats.entry(&chat_id.to_string()).await.unwrap().state,
        ChatState::Closed
    );
    assert!(
        env.instance_rx.try_recv().is_err(),
        "prepare rollback must never touch the instance boundary"
    );
}

#[tokio::test]
async fn create_session_projection_failure_is_unknown_and_never_respawns() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let command_id = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Create {
        command_id: command_id.clone(),
        payload: CreateChatPayload::default(),
    };
    assert!(matches!(
        env.coordinator
            .submit(
                &ctx("create-projection-failure"),
                action.clone(),
                tx.clone()
            )
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
            "result": {}
        }),
    };
    let _ = env.relay.on_instance_event("local", &init_response).await;

    let session_new = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected session/new, got {other:?}"),
    };
    env.instance
        .on_ack(
            "local",
            &session_new.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: session_new.command_id.clone(),
                chat_id: session_new.chat_id.clone(),
                ok: true,
                error: None,
            }),
        )
        .await;
    env.sink_fail.store(true, Ordering::SeqCst);
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: spawn.chat_id,
        epoch: 0,
        seq: 2,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": session_new.frame["id"],
            "result": { "sessionId": "acp-created-before-projection-failed" }
        }),
    };
    assert!(matches!(
        env.relay.on_instance_event("local", &response).await,
        crate::channel::ConsumeResult::RpcConfirmed { .. }
    ));

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
                chat_id: kill.chat_id,
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
        other => panic!("expected projection DELIVERY_UNKNOWN, got {other:?}"),
    }

    env.sink_fail.store(false, Ordering::SeqCst);
    match env
        .coordinator
        .submit(&ctx("create-projection-retry"), action, tx)
        .await
    {
        SubmitAck::Failed(error) => assert_eq!(error.code, ErrorCode::DeliveryUnknown),
        other => panic!("same command must remain blocked, got {other:?}"),
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(300), env.instance_rx.recv())
            .await
            .is_err(),
        "projection failure retry must not spawn or create another ACP session"
    );
}
