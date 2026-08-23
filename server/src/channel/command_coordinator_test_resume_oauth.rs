//! CommandCoordinator resume/oauth/config 主题测试（command_coordinator_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 instance hello 后 resume_instance_chats 的
//! session/resume 批量发起（终态/未绑定 chat 跳过）、oauth start ack 丢失
//! 重放幂等、config/set 走 agent catalog 且 ack 丢失不重复派发。公共 helper
//! bound_session 见 command_coordinator_test_util（经父模块 re-export，经
//! `use super::*` 可见）。
use super::*;

/// P0 回归：hello 不能用伪空列表开门；首个 heartbeat 先确认 restored runtime，
/// 再等待 session/resume RPC 终态，最后才完成 Restarting barrier。
#[tokio::test]
async fn recovery_heartbeat_confirms_resumes_then_opens_gate_once() {
    let mut env = env().await;
    let uuid = uuid::Uuid::parse_str(S1).unwrap();
    env.store.create_chat(uuid).unwrap();
    env.doc
        .open_chat(S1, "local", None, None, None)
        .await
        .unwrap();
    env.chats
        .register(S1, "local", None, "/", None)
        .await
        .unwrap();
    env.chats.bind(S1, "acp-restored", false).await.unwrap();
    assert!(!env.chats.entry(S1).await.unwrap().runtime_confirmed);

    let registry = env.doc.registry();
    registry.set_restarting().await.unwrap();
    let recovery = crate::channel::instance_recovery::RecoveryCoordinator::new(
        std::collections::HashSet::from(["local".to_string()]),
        env.instance.clone(),
        env.coordinator.clone(),
        registry.clone(),
    );
    recovery.on_connection_registered("local", 1).await;
    recovery
        .on_heartbeat_snapshot("local", 1, vec![S1.to_string()], true, true)
        .await;

    let rpc_id = drive_rpc(&env.instance, &mut env.instance_rx, "session/resume").await;
    assert!(env.chats.entry(S1).await.unwrap().runtime_confirmed);
    assert_eq!(
        registry.global_status(),
        peri_studio_proto::schema::GlobalStatus::Restarting,
        "RPC 未确认前不得开门"
    );
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({"jsonrpc":"2.0","id":rpc_id,"result":{}}),
    };
    let _ = env.relay.on_instance_event("local", &response).await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while registry.global_status() != peri_studio_proto::schema::GlobalStatus::Healthy {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("恢复终态后应开门");
    assert_eq!(
        registry.global_status(),
        peri_studio_proto::schema::GlobalStatus::Healthy
    );

    recovery
        .on_heartbeat_snapshot("local", 1, vec![S1.to_string()], false, false)
        .await;
    assert!(
        env.instance_rx.try_recv().is_err(),
        "重复快照不得重复 resume"
    );
}

/// server 重启恢复（无状态投影 §4 恢复路径 live chat）：instance hello 后
/// 对其非终态且已绑定会话的 chat 批量发起 session/resume；终态/未绑定
/// chat 跳过。
#[tokio::test]
async fn resume_instance_chats_forwards_session_resume_to_live_chats() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    bound_session(&env, S2, "acp-2").await;
    // 终态 chat：绑定后转 ended → resume 跳过。
    env.chats
        .register(S3, "local", None, "/", None)
        .await
        .unwrap();
    env.chats.bind(S3, "acp-3", true).await.unwrap();
    env.chats.transition(S3, ChatState::Ended).await.unwrap();

    let launched = env.coordinator.resume_instance_chats("local").await;
    assert_eq!(launched, 2, "终态 chat 不发起 resume");

    let mut rpc_ids = Vec::new();
    let mut resumed: Vec<String> = Vec::new();
    for _ in 0..2 {
        let forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
            .await
            .expect("resume must reach the instance")
            .expect("instance channel alive");
        match forward {
            OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
                assert_eq!(forward.frame["method"], "session/resume");
                assert_eq!(forward.frame["params"]["cwd"], "/");
                resumed.push(
                    forward.frame["params"]["sessionId"]
                        .as_str()
                        .unwrap()
                        .to_string(),
                );
                rpc_ids.push(forward.frame["id"].as_str().unwrap().to_string());
            }
            other => panic!("expected session/resume forward, got {other:?}"),
        }
    }
    resumed.sort();
    assert_eq!(resumed, vec!["acp-1".to_string(), "acp-2".to_string()]);

    // resume 响应匹配（模拟 ACP 回 result → RpcConfirmed，无悬挂 pending_rpc）。
    for rpc_id in rpc_ids {
        let response = peri_studio_proto::instance::InstanceEvent {
            chat_id: S1.into(),
            epoch: 0,
            seq: 1,
            frame: serde_json::json!({
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": {}
            }),
        };
        let _ = env.relay.on_instance_event("local", &response).await;
    }

    // 无更多转发（只有 2 个候选）。
    assert!(
        tokio::time::timeout(Duration::from_millis(300), env.instance_rx.recv())
            .await
            .is_err(),
        "no extra resume forwards expected"
    );
}

/// 未绑定会话的 chat（register 但无 session_id）→ resume 跳过。
#[tokio::test]
async fn resume_instance_chats_skips_unbound_chats() {
    let mut env = env().await;
    env.chats
        .register(S1, "local", None, "/", None)
        .await
        .unwrap();

    let launched = env.coordinator.resume_instance_chats("local").await;
    assert_eq!(launched, 0, "未绑定 chat 不发起 resume");
    assert!(
        tokio::time::timeout(Duration::from_millis(300), env.instance_rx.recv())
            .await
            .is_err(),
        "no resume forwards expected for unbound chat"
    );
}

#[tokio::test]
async fn oauth_start_ack_loss_retry_replays_terminal_without_a_second_acp_call() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    env.chats
        .set_extensions(S1, &[crate::protocol::PERI_OAUTH_EXTENSION.to_string()])
        .await;
    let command_id = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::McpOAuthStart {
        command_id: command_id.clone(),
        payload: McpOAuthStartPayload {
            chat_id: S1.into(),
            server_name: "github".into(),
        },
    };
    let (first_tx, mut first_rx) = mpsc::channel(8);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("oauth-first"), action.clone(), first_tx)
            .await,
        SubmitAck::Handled
    ));
    assert!(matches!(
        first_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Accepted
    ));

    let forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("OAuth start must reach the instance once")
        .expect("instance channel alive");
    let rpc_id = match forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
            assert_eq!(forward.frame["method"], "mcp/oauth_start");
            assert_eq!(forward.frame["params"]["flow_id"], command_id);
            env.instance
                .on_ack(
                    "local",
                    &forward.command_id,
                    InstanceAck::Forward(InstanceForwardAck {
                        command_id: forward.command_id.clone(),
                        chat_id: forward.chat_id,
                        ok: true,
                        error: None,
                    }),
                )
                .await;
            forward.frame["id"].as_str().unwrap().to_string()
        }
        other => panic!("expected OAuth instance forward, got {other:?}"),
    };
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "success": true,
                "status": "started",
                "flowId": command_id,
                "activeFlowId": command_id
            }
        }),
    };
    let _ = env.relay.on_instance_event("local", &response).await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), first_rx.recv())
            .await
            .unwrap(),
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Committed
    ));
    assert_eq!(
        env.metadata
            .oauth_command(&command_id)
            .await
            .unwrap()
            .unwrap()
            .phase,
        "committed"
    );

    // Simulate the browser losing the committed Ack and retrying the exact
    // command on a replacement connection.
    let (retry_tx, mut retry_rx) = mpsc::channel(8);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("oauth-retry"), action, retry_tx)
            .await,
        SubmitAck::Handled
    ));
    assert!(matches!(
        retry_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Accepted
    ));
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), retry_rx.recv())
            .await
            .unwrap(),
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Duplicate
    ));
    assert!(
        env.instance_rx.try_recv().is_err(),
        "durable duplicate replay must not invoke ACP a second time"
    );
}

#[tokio::test]
async fn config_set_uses_agent_catalog_and_ack_loss_never_dispatches_twice() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    env.chats
        .set_config_catalog(
            S1,
            vec![peri_studio_proto::schema::SessionConfigOptionProjection {
                id: "thinking_effort".into(),
                name: "Thinking effort".into(),
                description: None,
                category: Some(peri_studio_proto::schema::SessionConfigCategory::ThoughtLevel),
                current_value: "medium".into(),
                options: vec![
                    peri_studio_proto::schema::SessionConfigChoiceProjection {
                        value: "medium".into(),
                        name: "Medium".into(),
                        description: None,
                    },
                    peri_studio_proto::schema::SessionConfigChoiceProjection {
                        value: "high".into(),
                        name: "High".into(),
                        description: None,
                    },
                ],
            }],
        )
        .await;
    let command_id = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::ConfigSet {
        command_id: command_id.clone(),
        payload: ConfigSetPayload {
            chat_id: S1.into(),
            config_id: "thinking_effort".into(),
            value: "high".into(),
        },
    };
    let (first_tx, mut first_rx) = mpsc::channel(8);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("config-first"), action.clone(), first_tx)
            .await,
        SubmitAck::Handled
    ));
    assert!(matches!(
        first_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Accepted
    ));

    let forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("config set must reach the instance once")
        .expect("instance channel alive");
    let rpc_id = match forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
            assert_eq!(forward.frame["method"], "session/set_config_option");
            assert_eq!(forward.frame["params"]["sessionId"], "acp-1");
            assert_eq!(forward.frame["params"]["configId"], "thinking_effort");
            assert_eq!(forward.frame["params"]["value"], "high");
            env.instance
                .on_ack(
                    "local",
                    &forward.command_id,
                    InstanceAck::Forward(InstanceForwardAck {
                        command_id: forward.command_id.clone(),
                        chat_id: forward.chat_id,
                        ok: true,
                        error: None,
                    }),
                )
                .await;
            forward.frame["id"].as_str().unwrap().to_string()
        }
        other => panic!("expected config instance forward, got {other:?}"),
    };
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {"configOptions": [{
                "id": "thinking_effort", "name": "Thinking effort", "type": "select",
                "currentValue": "high", "category": "thought_level",
                "options": [{"value":"medium","name":"Medium"},{"value":"high","name":"High"}]
            }]}
        }),
    };
    let _ = env.relay.on_instance_event("local", &response).await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), first_rx.recv())
            .await
            .unwrap(),
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Committed
    ));
    assert_eq!(
        env.chats.config_catalog(S1).await.unwrap()[0].current_value,
        "high"
    );
    assert_eq!(
        env.metadata
            .command(&command_id)
            .await
            .unwrap()
            .unwrap()
            .phase,
        "committed"
    );

    let (retry_tx, mut retry_rx) = mpsc::channel(8);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("config-retry"), action, retry_tx)
            .await,
        SubmitAck::Handled
    ));
    assert!(matches!(
        retry_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Accepted
    ));
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), retry_rx.recv())
            .await
            .unwrap(),
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Duplicate
    ));
    assert!(
        env.instance_rx.try_recv().is_err(),
        "durable config duplicate must not invoke ACP again"
    );
}
