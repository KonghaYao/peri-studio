//! CommandCoordinator permission resolve 主题测试（command_coordinator_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 resolve 的重复/未知命令判定、official permission
//! 响应投递与 ack 丢失 unknown 不重投（§7.3）。permission 铺设 helper
//! （official_permission_frame/mirror_pending_permissions/setup_active_turn/
//! register_official_permission）见 command_coordinator_test_util（经父模块
//! re-export，经 `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn resolve_duplicate_and_unknown() {
    let mut env = env().await;
    bound_session(&env, S4, "acp-4").await;
    let (tx, mut rx) = mpsc::channel(16);
    // 先建立 active turn（§6.5 服务端单写：RegisterUserEntry 注册 accepting
    // turn——聚合器终态守卫要求 permission 归属的活动 turn，§6.3）。
    let turn = env
        .doc
        .submit_command(
            S4,
            crate::state::doc_manager::DocCommand::RegisterUserEntry {
                turn_id: "t1".into(),
                entry_id: "t1:user".into(),
                text: "hi".into(),
                author_user_id: None,
                source_command_id: "permission-command".into(),
                created_at: chrono::Utc::now().to_rfc3339(),
            },
        )
        .await;
    assert!(matches!(
        turn,
        crate::state::doc_manager::SubmitResult::Applied(_)
    ));
    // 先投影一个 permission_request（epoch=0，聚合器接受）。信封 chat_id
    // = 进程归属（hub id）；帧内 sessionId = acp id（binding 校验键）。
    let ev = peri_studio_proto::instance::InstanceEvent {
        chat_id: S4.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "type": "permission_request",
            "sessionId": "acp-4",
            "payload": {"permissionId": "p1", "turnId": "t1", "title": "run", "options": ["allow"]}
        }),
    };
    let r = env.relay.on_instance_event("local", &ev).await;
    assert!(matches!(
        r,
        crate::channel::ConsumeResult::Delivered { applied: true, .. }
    ));
    // 等待聚合器投递（控制类事件挂 oneshot，已投递）。
    let resolve = |cid: &str| ActionEnvelope::ResolvePermission {
        command_id: cid.into(),
        payload: peri_studio_proto::action::ResolvePermissionPayload {
            chat_id: S4.into(),
            permission_id: "p1".into(),
            decision: peri_studio_proto::action::PermissionDecision::Allow,
            option_id: None,
        },
    };
    // 第一次 resolve：CAS Migrated → forward（instance 在线收 InstanceForward）。
    let cid1 = uuid::Uuid::new_v4().to_string();
    let r1 = env
        .coordinator
        .submit(&ctx("c"), resolve(&cid1), tx.clone())
        .await;
    assert!(matches!(r1, SubmitAck::Accepted { .. }), "r1 = {r1:?}");
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("forward received")
        .expect("rx alive");
    let rpc_id = match &fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            // 回 forward_ack（L1+L2 确认；否则 forward_rpc 200ms 超时）。
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
            f.frame["id"].as_str().unwrap().to_string()
        }
        other => panic!("expected forward frame, got {other:?}"),
    };
    // L3：instance 回 JSON-RPC response（pending_rpc 匹配 → delivery_confirmed）。
    let resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S4.into(),
        epoch: 0,
        seq: 2,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {}
        }),
    };
    let r = env.relay.on_instance_event("local", &resp).await;
    assert!(matches!(
        r,
        crate::channel::ConsumeResult::RpcConfirmed { .. }
    ));
    // 第一次 committed ack（L3 后）。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected committed ack, got {other:?}"),
    }

    // 第二次（新 commandId）答同一 permission：CAS Duplicate → duplicate ack。
    let cid2 = uuid::Uuid::new_v4().to_string();
    let r2 = env
        .coordinator
        .submit(&ctx("c"), resolve(&cid2), tx.clone())
        .await;
    assert!(matches!(r2, SubmitAck::Accepted { .. }));
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Duplicate);
        }
        other => panic!("expected duplicate ack, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// #1 官方 session/request_permission resolve 双轨：官方轨（take 命中）→
// 官方响应帧（无 L3，forward_ack 即确认点）；原始轨回归见
// resolve_duplicate_and_unknown（保留原样）。
// ---------------------------------------------------------------------------

/// 官方 request_permission 帧（sessionId 命中 binding；id=5 number——

#[tokio::test]
async fn resolve_official_permission_sends_response() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    setup_active_turn(&env, S1).await;
    let pid = register_official_permission(&env, S1, "acp-1", 1).await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let resolve = ActionEnvelope::ResolvePermission {
        command_id: cid.clone(),
        payload: ResolvePermissionPayload {
            chat_id: S1.into(),
            permission_id: pid.clone(),
            decision: peri_studio_proto::action::PermissionDecision::Allow,
            option_id: Some("allow-once".into()),
        },
    };
    let r = env.coordinator.submit(&ctx("c"), resolve, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    // 官方轨：forward 官方响应帧。
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("forward received")
        .expect("rx alive");
    match &fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            assert_eq!(
                f.frame["id"],
                serde_json::json!(5),
                "agent request id 原样回显"
            );
            assert_eq!(
                f.frame["result"]["outcome"]["outcome"],
                serde_json::json!("selected")
            );
            assert_eq!(
                f.frame["result"]["outcome"]["optionId"],
                serde_json::json!("allow-once")
            );
            assert!(f.frame.get("method").is_none(), "响应帧无 method");
            // 回 forward_ack（L1+L2；官方轨以 forward_ack 为确认点，无 L3）。
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
    // Committed ack（无 L3 响应帧路径）。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected committed ack, got {other:?}"),
    }
}

#[tokio::test]
async fn resolve_official_permission_rejects_tampered_option_scope() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    setup_active_turn(&env, S1).await;
    let permission_id = register_official_permission(&env, S1, "acp-1", 1).await;
    let (tx, mut rx) = mpsc::channel(16);
    let action = ActionEnvelope::ResolvePermission {
        command_id: uuid::Uuid::new_v4().to_string(),
        payload: ResolvePermissionPayload {
            chat_id: S1.into(),
            permission_id: permission_id.clone(),
            decision: peri_studio_proto::action::PermissionDecision::Deny,
            option_id: Some("allow-once".into()),
        },
    };

    assert!(matches!(
        env.coordinator.submit(&ctx("c"), action, tx).await,
        SubmitAck::Accepted { .. }
    ));
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.code, ErrorCode::InvalidState);
            assert!(!error.retryable);
        }
        other => panic!("expected invalid option error, got {other:?}"),
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(300), env.instance_rx.recv())
            .await
            .is_err(),
        "篡改的 optionId 不得发送到 ACP"
    );
    assert!(
        env.relay.pending_permission(&permission_id).await.is_some(),
        "拒绝篡改不得消费待处理权限"
    );
}

#[tokio::test]
async fn resolve_official_permission_rejects_cross_chat_identity() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    bound_session(&env, S2, "acp-2").await;
    setup_active_turn(&env, S2).await;
    let permission_id = register_official_permission(&env, S2, "acp-2", 1).await;
    let (tx, mut rx) = mpsc::channel(16);
    let action = ActionEnvelope::ResolvePermission {
        command_id: uuid::Uuid::new_v4().to_string(),
        payload: ResolvePermissionPayload {
            chat_id: S1.into(),
            permission_id: permission_id.clone(),
            decision: peri_studio_proto::action::PermissionDecision::Allow,
            option_id: Some("allow-once".into()),
        },
    };

    assert!(matches!(
        env.coordinator.submit(&ctx("c"), action, tx).await,
        SubmitAck::Accepted { .. }
    ));
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.code, ErrorCode::InvalidState);
            assert!(!error.retryable);
        }
        other => panic!("expected cross-chat rejection, got {other:?}"),
    }
    let pending = env
        .relay
        .pending_permission(&permission_id)
        .await
        .expect("目标 chat 的权限仍待处理");
    assert!(
        pending.resolving_command_id.is_none(),
        "跨 chat 请求不得抢占裁决权"
    );
    assert!(
        env.instance_rx.try_recv().is_err(),
        "跨 chat 请求不得发送到 ACP"
    );
}

/// [回归测试] 官方 permission response 已进入 instance writer、但
/// forward_ack 丢失时，server 无法证明 ACP 未消费裁决。必须持久化
/// DELIVERY_UNKNOWN，且同一 commandId 重试不得产生第二个 forward。
#[tokio::test]
async fn resolve_official_ack_loss_is_unknown_and_never_redelivers() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    setup_active_turn(&env, S1).await;
    let permission_id = register_official_permission(&env, S1, "acp-1", 1).await;
    let (tx, mut rx) = mpsc::channel(16);
    let command_id = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::ResolvePermission {
        command_id: command_id.clone(),
        payload: ResolvePermissionPayload {
            chat_id: S1.into(),
            permission_id,
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
    let first = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("permission response must enter the instance writer")
        .expect("instance channel alive");
    assert!(matches!(
        first,
        OutboundMsg::Frame(Frame::InstanceForward(_))
    ));
    // Intentionally omit forward_ack: the instance may already have written
    // the response to ACP stdin, so timeout is not proof of non-delivery.
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected DELIVERY_UNKNOWN, got {other:?}"),
    }
    let record = env
        .store
        .chat(uuid::Uuid::parse_str(S1).unwrap())
        .unwrap()
        .outbox_get(uuid::Uuid::parse_str(&command_id).unwrap())
        .await
        .expect("unknown verdict must be durable");
    assert_eq!(
        record.status,
        crate::persist::outbox::OutboxStatus::DeliveryUnknown
    );
    assert!(record.dispatch_barrier_at.is_some());

    match env.coordinator.submit(&ctx("c"), action, tx).await {
        SubmitAck::Failed(error) => {
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected same-command retry to fail closed, got {other:?}"),
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(300), env.instance_rx.recv())
            .await
            .is_err(),
        "same commandId must not emit a second ACP response"
    );
}
