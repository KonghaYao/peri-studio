//! CommandCoordinator permission 故障/恢复主题测试（command_coordinator_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 resolve official forward 失败 retryable、无 runtime
//! 时持久化 permission 恢复 fail-closed（§7.3）。permission 铺设 helper 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
/// 官方轨 forward 失败（instance 离线）→ fail_retryable + 无 committed。
#[tokio::test]
async fn resolve_official_forward_failure_retryable() {
    let mut env = env().await;
    bound_session(&env, S2, "acp-2").await;
    setup_active_turn(&env, S2).await;
    let pid = register_official_permission(&env, S2, "acp-2", 1).await;
    // instance 离线 → 官方轨 forward_rpc 返回 Offline。
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
    let resolve = ActionEnvelope::ResolvePermission {
        command_id: cid.clone(),
        payload: ResolvePermissionPayload {
            chat_id: S2.into(),
            permission_id: pid.clone(),
            decision: peri_studio_proto::action::PermissionDecision::Allow,
            option_id: Some("allow-once".into()),
        },
    };
    let r = env.coordinator.submit(&ctx("c"), resolve, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    // ActionError（InstanceOffline，retryable）+ 无 committed。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(e)))) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::InstanceOffline);
            assert!(e.retryable);
        }
        other => panic!("expected action_error, got {other:?}"),
    }
    assert!(env.instance_rx.try_recv().is_err(), "无 forward 帧（离线）");
    let persisted = env
        .store
        .chat(uuid::Uuid::parse_str(S2).unwrap())
        .unwrap()
        .outbox_get(uuid::Uuid::parse_str(&cid).unwrap())
        .await
        .expect("恢复命令已投递");
    assert_eq!(
        persisted.status,
        crate::persist::outbox::OutboxStatus::IntentDurable
    );
    assert!(persisted.recovery.is_some(), "ACP response 材料必须持久化");

    // 相反 decision 即使使用新 commandId，也只能得到 duplicate；不得消费
    // 首次 Allow 所需的官方 request 回投材料。
    let opposite_id = uuid::Uuid::new_v4().to_string();
    let opposite = ActionEnvelope::ResolvePermission {
        command_id: opposite_id.clone(),
        payload: ResolvePermissionPayload {
            chat_id: S2.into(),
            permission_id: pid.clone(),
            decision: peri_studio_proto::action::PermissionDecision::Deny,
            option_id: None,
        },
    };
    let r = env
        .coordinator
        .submit(&ctx("c"), opposite, tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Duplicate);
            assert_eq!(ack.command_id, opposite_id);
        }
        other => panic!("expected opposite duplicate ack, got {other:?}"),
    }
    assert!(
        env.relay.pending_permission(&pid).await.is_some(),
        "相反 decision 不得消费首次裁决的恢复材料"
    );

    // 即使 decision 相同，新 commandId 也不能冒充原命令重放
    // 安全副作用。
    let same_decision_id = uuid::Uuid::new_v4().to_string();
    let same_decision = ActionEnvelope::ResolvePermission {
        command_id: same_decision_id.clone(),
        payload: ResolvePermissionPayload {
            chat_id: S2.into(),
            permission_id: pid.clone(),
            decision: peri_studio_proto::action::PermissionDecision::Allow,
            option_id: Some("allow-once".into()),
        },
    };
    let r = env
        .coordinator
        .submit(&ctx("c"), same_decision, tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Duplicate);
            assert_eq!(ack.command_id, same_decision_id);
        }
        other => panic!("expected same-decision duplicate ack, got {other:?}"),
    }
    assert!(
        env.relay.pending_permission(&pid).await.is_some(),
        "新 commandId 不得消费原命令的恢复材料"
    );

    // 同一 commandId + 同一 decision 在 instance 恢复后必须真正重发官方
    // response，不能因本地 CAS 已 resolved 而只返回虚假的 duplicate。
    env.instance
        .on_hello(
            "local",
            "tok-m",
            InstanceConn {
                tx: env.instance_tx.clone(),
            },
            &peri_studio_proto::instance::InstanceHello {
                protocol_version: peri_studio_proto::version::PROTOCOL_VERSION,
                token: "tok".into(),
                hostname: "local".into(),
                caps: serde_json::json!({}),
                buffered: None,
                buffer_lost: None,
                stream_epochs: None,
                nonce: "AAAA".into(),
            },
        )
        .await;
    let retry = ActionEnvelope::ResolvePermission {
        command_id: cid.clone(),
        payload: ResolvePermissionPayload {
            chat_id: S2.into(),
            permission_id: pid.clone(),
            decision: peri_studio_proto::action::PermissionDecision::Allow,
            option_id: Some("allow-once".into()),
        },
    };
    let r = env.coordinator.submit(&ctx("c"), retry, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("recovery forward received")
        .expect("rx alive");
    match fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            let command_id = f.command_id.clone();
            env.instance
                .on_ack(
                    "local",
                    &command_id,
                    InstanceAck::Forward(InstanceForwardAck {
                        command_id: command_id.clone(),
                        chat_id: f.chat_id,
                        ok: true,
                        error: None,
                    }),
                )
                .await;
        }
        other => panic!("expected recovery forward, got {other:?}"),
    }
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
            assert_eq!(ack.command_id, cid);
        }
        other => panic!("expected recovery committed ack, got {other:?}"),
    }
}

#[tokio::test]
async fn persisted_permission_recovery_without_runtime_fails_closed() {
    let env = env().await;
    bound_session(&env, S2, "acp-2").await;
    setup_active_turn(&env, S2).await;
    let pid = register_official_permission(&env, S2, "acp-2", 1).await;
    env.instance
        .on_disconnect(
            "local",
            &InstanceConn {
                tx: env.instance_tx.clone(),
            },
        )
        .await;
    let (tx, mut rx) = mpsc::channel(8);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::ResolvePermission {
        command_id: cid.clone(),
        payload: ResolvePermissionPayload {
            chat_id: S2.into(),
            permission_id: pid,
            decision: peri_studio_proto::action::PermissionDecision::Allow,
            option_id: Some("allow-once".into()),
        },
    };
    assert!(matches!(
        env.coordinator
            .submit(&ctx("c"), action.clone(), tx.clone())
            .await,
        SubmitAck::Accepted { .. }
    ));
    let _ = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("offline error")
        .expect("channel alive");

    let chat_store = env.store.chat(uuid::Uuid::parse_str(S2).unwrap()).unwrap();
    let command_id = uuid::Uuid::parse_str(&cid).unwrap();
    chat_store
        .outbox()
        .lock()
        .await
        .mark_dispatched(command_id, chrono::Utc::now())
        .unwrap();
    match env
        .coordinator
        .submit(&ctx("c"), action.clone(), tx.clone())
        .await
    {
        SubmitAck::Failed(error) => {
            assert_eq!(
                error.code,
                peri_studio_proto::ack::ErrorCode::DeliveryUnknown
            );
            assert!(!error.retryable);
            assert!(error.message.contains("delivery result is unknown"));
        }
        other => panic!("expected delivery-unknown rejection, got {other:?}"),
    }
    chat_store
        .outbox()
        .lock()
        .await
        .mark_failed(
            command_id,
            crate::persist::outbox::LastError::from_error_code(
                peri_studio_proto::ack::ErrorCode::InstanceOffline,
            ),
        )
        .unwrap();
    env.chats.transition(S2, ChatState::Ended).await.unwrap();
    match env.coordinator.submit(&ctx("c"), action, tx).await {
        SubmitAck::Failed(error) => {
            assert_eq!(
                error.code,
                peri_studio_proto::ack::ErrorCode::DeliveryUnknown
            );
            assert!(!error.retryable);
            assert!(error.message.contains("operator reconciliation"));
        }
        other => panic!("expected fail-closed restart result, got {other:?}"),
    }
}
