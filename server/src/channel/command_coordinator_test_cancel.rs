//! CommandCoordinator cancel 主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 cancel 通知注入 cancelled 并清理活动 turn、forward
//! ack 丢失 unknown 不重投、writer 拒绝 retryable 同命令重试、投影失败
//! unknown（§7.4 取消语义）。公共 helper bound_session/setup_active_turn 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;

/// cancel（notification：无 id 帧，发送成功即 L3 等价确认）→ 注入 Cancelled
/// 终态 + 活动 turn 表项清理（§7.2；表项滞留会阻塞后续 load）。
#[tokio::test]
async fn cancel_notification_injects_cancelled_and_clears_active_turn() {
    let mut env = env().await;
    bound_session(&env, S5, "acp-5").await;
    // 投影活动 turn（§6.5 服务端单写注入：RegisterUserEntry → user entry +
    // active_turn(accepting)；非回放 user_message 回声已被聚合器拒绝）。
    setup_active_turn(&env, S5).await;
    // cancel（notification 路径）。
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Cancel {
        command_id: cid.clone(),
        payload: peri_studio_proto::action::CancelChatPayload { chat_id: S5.into() },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    // forward notification 帧 + ack（L1+L2；notification 无 L3 响应）。
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("forward received")
        .expect("rx alive");
    match &fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            assert_eq!(f.command_id, cid, "instance envelope owns the ack identity");
            assert_eq!(
                f.frame["id"],
                serde_json::Value::Null,
                "cancel 为 notification（无 id）"
            );
            assert!(
                tokio::time::timeout(Duration::from_millis(50), rx.recv())
                    .await
                    .is_err(),
                "channel enqueue alone must not commit before instance writer ack"
            );
            let (snapshot, _) = env
                .sink
                .snapshot(&peri_studio_proto::conn::DocId::session(S5))
                .await
                .expect("session 镜像快照");
            use yrs::updates::decoder::Decode as _;
            use yrs::{Map as _, ReadTxn as _, Transact as _};
            let mirror = yrs::Doc::new();
            let parsed = yrs::Update::decode_v1(&snapshot).unwrap();
            mirror.transact_mut().apply_update(parsed).unwrap();
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
                "cancelling",
                "等待 writer ack 时 Yjs 必须投影 cancelling"
            );
            assert!(
                sm.get(&txn, "loading").unwrap().cast::<bool>().unwrap(),
                "Agent 尚未确认停止时仍保持 loading"
            );
            drop(txn);
            env.instance
                .on_ack(
                    "local",
                    &f.command_id,
                    InstanceAck::Forward(InstanceForwardAck {
                        command_id: f.command_id.clone(),
                        chat_id: f.chat_id.clone(),
                        ok: true,
                        error: None,
                    }),
                )
                .await;
        }
        other => panic!("expected forward frame, got {other:?}"),
    }
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected committed ack, got {other:?}"),
    }
    // 终态注入：session doc active_turn_status = cancelled + 表项清理。
    assert!(
        env.chats.active_turn(S5).await.is_none(),
        "cancel 终态后活动 turn 表项清理"
    );
    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S5))
        .await
        .expect("session 镜像快照");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    let parsed = yrs::Update::decode_v1(&snapshot).unwrap();
    mirror.transact_mut().apply_update(parsed).unwrap();
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
        "cancel 发送成功 → turn 终态 Cancelled（§7.2）"
    );
    assert!(
        !sm.get(&txn, "loading").unwrap().cast::<bool>().unwrap(),
        "cancel 终态必须清除 loading"
    );
}

#[tokio::test]
async fn cancel_forward_ack_loss_is_unknown_and_never_redelivers() {
    let mut env = env().await;
    bound_session(&env, S5, "acp-cancel-ack-loss").await;
    setup_active_turn(&env, S5).await;
    let command_id = uuid::Uuid::new_v4();
    let action = ActionEnvelope::Cancel {
        command_id: command_id.to_string(),
        payload: peri_studio_proto::action::CancelChatPayload { chat_id: S5.into() },
    };
    let (tx, mut rx) = mpsc::channel(16);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("cancel-ack-loss"), action.clone(), tx.clone())
            .await,
        SubmitAck::Accepted { .. }
    ));
    let forward = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected cancel forward, got {other:?}"),
    };
    assert_eq!(forward.command_id, command_id.to_string());
    assert!(forward.frame.get("id").is_none());
    // Intentionally omit forward_ack. The instance may already have written
    // the notification to ACP stdin.
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected cancel DELIVERY_UNKNOWN, got {other:?}"),
    }
    let chat_store = env.store.chat(uuid::Uuid::parse_str(S5).unwrap()).unwrap();
    let record = chat_store.outbox_get(command_id).await.unwrap();
    assert_eq!(
        record.status,
        crate::persist::outbox::OutboxStatus::DeliveryUnknown
    );
    assert!(record.dispatch_barrier_at.is_some());

    match env
        .coordinator
        .submit(&ctx("cancel-retry"), action, tx)
        .await
    {
        SubmitAck::Failed(error) => {
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected same-command cancel to fail closed, got {other:?}"),
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(300), env.instance_rx.recv())
            .await
            .is_err(),
        "ambiguous cancel must never emit a second notification"
    );
}

#[tokio::test]
async fn cancel_writer_rejection_is_retryable_with_same_command() {
    let mut env = env().await;
    bound_session(&env, S5, "acp-cancel-rejected").await;
    setup_active_turn(&env, S5).await;
    let command_id = uuid::Uuid::new_v4();
    let action = ActionEnvelope::Cancel {
        command_id: command_id.to_string(),
        payload: peri_studio_proto::action::CancelChatPayload { chat_id: S5.into() },
    };
    let (tx, mut rx) = mpsc::channel(16);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("cancel-rejected"), action.clone(), tx)
            .await,
        SubmitAck::Accepted { .. }
    ));
    let first = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected cancel forward, got {other:?}"),
    };
    env.instance
        .on_ack(
            "local",
            &first.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: first.command_id.clone(),
                chat_id: S5.into(),
                ok: false,
                error: Some("stdin unavailable".into()),
            }),
        )
        .await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), rx.recv()).await,
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(ref error))))
            if error.code == ErrorCode::AgentUnavailable && error.retryable
    ));
    let chat_store = env.store.chat(uuid::Uuid::parse_str(S5).unwrap()).unwrap();
    assert!(chat_store.outbox_get(command_id).await.is_none());

    let (retry_tx, mut retry_rx) = mpsc::channel(16);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("cancel-retry"), action, retry_tx)
            .await,
        SubmitAck::Accepted { .. }
    ));
    let second = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected retry cancel forward, got {other:?}"),
    };
    assert_eq!(second.command_id, command_id.to_string());
    env.instance
        .on_ack(
            "local",
            &second.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: second.command_id.clone(),
                chat_id: S5.into(),
                ok: true,
                error: None,
            }),
        )
        .await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), retry_rx.recv()).await,
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))))
            if ack.status == AckStatus::Committed
    ));
}

#[tokio::test]
async fn cancel_projection_failure_after_writer_ack_is_unknown() {
    let mut env = env().await;
    bound_session(&env, S5, "acp-cancel-projection-failure").await;
    setup_active_turn(&env, S5).await;
    let command_id = uuid::Uuid::new_v4();
    let action = ActionEnvelope::Cancel {
        command_id: command_id.to_string(),
        payload: peri_studio_proto::action::CancelChatPayload { chat_id: S5.into() },
    };
    let (tx, mut rx) = mpsc::channel(16);
    assert!(matches!(
        env.coordinator
            .submit(
                &ctx("cancel-projection-failure"),
                action.clone(),
                tx.clone()
            )
            .await,
        SubmitAck::Accepted { .. }
    ));
    let forward = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected cancel forward, got {other:?}"),
    };
    env.sink_fail.store(true, Ordering::SeqCst);
    env.instance
        .on_ack(
            "local",
            &forward.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: forward.command_id.clone(),
                chat_id: S5.into(),
                ok: true,
                error: None,
            }),
        )
        .await;
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected projection DELIVERY_UNKNOWN, got {other:?}"),
    }
    let chat_store = env.store.chat(uuid::Uuid::parse_str(S5).unwrap()).unwrap();
    assert_eq!(
        chat_store.outbox_get(command_id).await.unwrap().status,
        crate::persist::outbox::OutboxStatus::DeliveryUnknown
    );
    assert!(env.chats.active_turn(S5).await.is_none());
    match env
        .coordinator
        .submit(&ctx("cancel-retry"), action, tx)
        .await
    {
        SubmitAck::Failed(error) => assert_eq!(error.code, ErrorCode::DeliveryUnknown),
        other => panic!("expected projection-unknown replay block, got {other:?}"),
    }
}
