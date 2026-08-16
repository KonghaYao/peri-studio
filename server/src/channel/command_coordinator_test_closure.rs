//! CommandCoordinator close 主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 close 路径的缺失 session 拒绝、离线 pending close、
//! kill + 投影 + 终态屏障有序提交、delivery unknown 重放判定不重复准入/不
//! 重复 kill、投影失败终态后同命令可修复。公共 helper bound_session 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn missing_session_rejected() {
    let env = env().await;
    let (tx, _rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(
            &ctx("c"),
            prompt_action(&cid, "ffffffff-ffff-ffff-ffff-ffffffffffff"),
            tx,
        )
        .await;
    match r {
        SubmitAck::Failed(e) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::ChatNotFound)
        }
        other => panic!("expected session not found, got {other:?}"),
    }
}

#[tokio::test]
async fn close_offline_pending_close() {
    let env = env().await;
    bound_session(&env, S5, "acp-5").await;
    // 机器断开 → OFFLINE。
    env.instance
        .on_disconnect(
            "local",
            &InstanceConn {
                tx: env.instance_tx.clone(),
            },
        )
        .await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Close {
        command_id: cid.clone(),
        payload: peri_studio_proto::action::CloseChatPayload { chat_id: S5.into() },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }));
    // §7.6：offline close → MACHINE_OFFLINE(retryable) + pending_close 标记。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(e)))) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::InstanceOffline);
            assert!(e.retryable);
        }
        other => panic!("expected action_error, got {other:?}"),
    }
    assert!(env
        .chats
        .pending_close_chats()
        .await
        .contains(&S5.to_string()));
}

#[tokio::test]
async fn close_kill_projection_and_terminal_barriers_commit_in_order() {
    let mut env = env().await;
    bound_session(&env, S5, "acp-close-success").await;
    let command_id = uuid::Uuid::new_v4();
    let action = ActionEnvelope::Close {
        command_id: command_id.to_string(),
        payload: peri_studio_proto::action::CloseChatPayload { chat_id: S5.into() },
    };
    let (tx, mut rx) = mpsc::channel(16);
    assert!(matches!(
        env.coordinator.submit(&ctx("close"), action, tx).await,
        SubmitAck::Accepted { .. }
    ));

    let kill = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceKill(kill)) => kill,
        other => panic!("expected close kill, got {other:?}"),
    };
    assert_eq!(kill.chat_id, S5);
    env.instance
        .on_ack(
            "local",
            &kill.command_id,
            InstanceAck::Kill(peri_studio_proto::instance::InstanceKillAck {
                command_id: kill.command_id.clone(),
                chat_id: S5.into(),
                ok: true,
            }),
        )
        .await;

    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), rx.recv()).await,
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))))
            if ack.status == AckStatus::Committed
    ));
    let chat_store = env.store.chat(uuid::Uuid::parse_str(S5).unwrap()).unwrap();
    assert_eq!(
        chat_store.outbox_get(command_id).await.unwrap().status,
        crate::persist::outbox::OutboxStatus::Completed
    );
    assert_eq!(env.chats.entry(S5).await.unwrap().state, ChatState::Closed);
}

#[tokio::test]
async fn close_delivery_unknown_replays_verdict_without_new_admission_or_kill() {
    let mut env = env().await;
    bound_session(&env, S5, "acp-close-unknown").await;
    let chat_id = uuid::Uuid::parse_str(S5).unwrap();
    let command_id = uuid::Uuid::new_v4();
    let chat_store = env.store.chat(chat_id).unwrap();
    {
        let mut outbox = chat_store.outbox().lock().await;
        outbox
            .insert(NewOutboxRecord {
                command_id,
                chat_id,
                command_type: CommandType::Close,
                turn_id: None,
                retryable_class: RetryableClass::SafeToRedeliver,
            })
            .unwrap();
        outbox.mark_accepted(command_id).unwrap();
        outbox.mark_intent_durable(command_id).unwrap();
        outbox
            .mark_dispatched(command_id, chrono::Utc::now())
            .unwrap();
        outbox.mark_delivery_unknown(command_id).unwrap();
    }
    let before = chat_store.outbox_get(command_id).await.unwrap();
    let action = ActionEnvelope::Close {
        command_id: command_id.to_string(),
        payload: peri_studio_proto::action::CloseChatPayload { chat_id: S5.into() },
    };
    let (tx, mut rx) = mpsc::channel(4);

    match env
        .coordinator
        .submit(&ctx("close-unknown"), action, tx)
        .await
    {
        SubmitAck::Failed(error) => {
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected existing unknown verdict, got {other:?}"),
    }
    assert_eq!(chat_store.outbox_get(command_id).await.unwrap(), before);
    assert!(
        rx.recv().await.is_none(),
        "existing terminal replay is synchronous and must not enqueue accepted"
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(20), env.instance_rx.recv())
            .await
            .is_err(),
        "an extant unknown record must never spawn a replacement close executor"
    );
}

#[tokio::test]
async fn close_projection_failure_is_terminal_and_same_command_repairs() {
    let mut env = env().await;
    bound_session(&env, S5, "acp-close-repair").await;
    let command_id = uuid::Uuid::new_v4();
    let action = ActionEnvelope::Close {
        command_id: command_id.to_string(),
        payload: peri_studio_proto::action::CloseChatPayload { chat_id: S5.into() },
    };
    env.sink_fail.store(true, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::channel(16);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("close-failure"), action.clone(), tx)
            .await,
        SubmitAck::Accepted { .. }
    ));
    let first_kill = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceKill(kill)) => kill,
        other => panic!("expected first close kill, got {other:?}"),
    };
    env.instance
        .on_ack(
            "local",
            &first_kill.command_id,
            InstanceAck::Kill(peri_studio_proto::instance::InstanceKillAck {
                command_id: first_kill.command_id.clone(),
                chat_id: S5.into(),
                ok: true,
            }),
        )
        .await;
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.code, ErrorCode::AgentUnavailable);
            assert!(error.retryable);
        }
        other => panic!("expected durable close projection error, got {other:?}"),
    }
    let chat_store = env.store.chat(uuid::Uuid::parse_str(S5).unwrap()).unwrap();
    assert!(
        chat_store.outbox_get(command_id).await.is_none(),
        "a retryable idempotent close must not leave an orphan observer record"
    );
    assert_ne!(env.chats.entry(S5).await.unwrap().state, ChatState::Closed);

    env.sink_fail.store(false, Ordering::SeqCst);
    let (retry_tx, mut retry_rx) = mpsc::channel(16);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("close-repair"), action, retry_tx)
            .await,
        SubmitAck::Accepted { .. }
    ));
    let second_kill = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceKill(kill)) => kill,
        other => panic!("expected idempotent repair kill, got {other:?}"),
    };
    assert_eq!(second_kill.command_id, command_id.to_string());
    env.instance
        .on_ack(
            "local",
            &second_kill.command_id,
            InstanceAck::Kill(peri_studio_proto::instance::InstanceKillAck {
                command_id: second_kill.command_id.clone(),
                chat_id: S5.into(),
                ok: true,
            }),
        )
        .await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), retry_rx.recv()).await,
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))))
            if ack.status == AckStatus::Committed
    ));
    assert_eq!(
        chat_store.outbox_get(command_id).await.unwrap().status,
        crate::persist::outbox::OutboxStatus::Completed
    );
}

// ── workspace 管理命令（独立于 chat 的上层概念）────────────────────────
