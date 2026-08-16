//! CommandCoordinator rewind 主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 rewind/candidates（cap 校验 + 字段消毒）、rewind/
//! preview（不安全 agent 路径拒绝且不泄露）、rewind 执行一次 + 投影重载 +
//! 重复终态重放、confirmed 后投影失败为 unknown 且绝不重执行。公共 helper
//! bound_session 见 command_coordinator_test_util（经父模块 re-export，经
//! `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn rewind_candidates_requires_exact_cap_and_returns_sanitized_frame() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    let without_cap = ActionEnvelope::RewindCandidates {
        command_id: uuid::Uuid::new_v4().to_string(),
        payload: RewindCandidatesPayload { chat_id: S1.into() },
    };
    let (tx, _rx) = mpsc::channel(8);
    let rejected = env
        .coordinator
        .submit(&ctx("rewind-no-cap"), without_cap, tx)
        .await;
    assert!(matches!(
        rejected,
        SubmitAck::Failed(ActionError {
            code: ErrorCode::UnsupportedFrame,
            ..
        })
    ));
    assert!(env.instance_rx.try_recv().is_err());

    env.chats
        .set_extensions(S1, &[crate::protocol::PERI_REWIND_EXTENSION.to_string()])
        .await;
    let command_id = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::RewindCandidates {
        command_id: command_id.clone(),
        payload: RewindCandidatesPayload { chat_id: S1.into() },
    };
    let (tx, mut rx) = mpsc::channel(8);
    assert!(matches!(
        env.coordinator.submit(&ctx("rewind-cap"), action, tx).await,
        SubmitAck::Accepted { .. }
    ));
    let forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap();
    let rpc_id = match forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
            assert_eq!(forward.frame["method"], "session/rewind-candidates");
            assert_eq!(forward.frame["params"]["sessionId"], "acp-1");
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
        other => panic!("expected rewind candidates forward, got {other:?}"),
    };
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": { "messages": [{
                "id": "message-1",
                "preview": "  fix\n  the parser "
            }] }
        }),
    };
    assert!(matches!(
        env.relay.on_instance_event("local", &response).await,
        crate::channel::ConsumeResult::RpcConfirmed { .. }
    ));
    let frame = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    match frame {
        OutboundMsg::Frame(Frame::RewindCandidates(frame)) => {
            assert_eq!(frame.command_id, command_id);
            assert_eq!(frame.candidates[0].message_id, "message-1");
            assert_eq!(frame.candidates[0].preview, "fix the parser");
        }
        other => panic!("expected rewind candidates response, got {other:?}"),
    }
}

#[tokio::test]
async fn rewind_preview_rejects_unsafe_agent_path_without_leaking_it() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    env.chats
        .set_extensions(S1, &[crate::protocol::PERI_REWIND_EXTENSION.to_string()])
        .await;
    let command_id = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::RewindPreview {
        command_id: command_id.clone(),
        payload: RewindPreviewPayload {
            chat_id: S1.into(),
            target_message_id: "message-1".into(),
        },
    };
    let (tx, mut rx) = mpsc::channel(8);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("rewind-preview"), action, tx)
            .await,
        SubmitAck::Accepted { .. }
    ));
    let forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap();
    let rpc_id = match forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
            assert_eq!(forward.frame["method"], "session/rewind-preview");
            assert_eq!(forward.frame["params"]["target_message_id"], "message-1");
            assert_eq!(forward.frame["params"]["revert_files"], true);
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
        other => panic!("expected rewind preview forward, got {other:?}"),
    };
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "preview_fingerprint": "f".repeat(64),
                "file_changes": [{"path": "/private/secret", "kind": "edit"}]
            }
        }),
    };
    env.relay.on_instance_event("local", &response).await;
    let frame = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    match frame {
        OutboundMsg::Frame(Frame::ActionError(error)) => {
            assert_eq!(error.command_id, command_id);
            assert_eq!(error.code, ErrorCode::AgentUnavailable);
            assert!(!error.message.contains("/private/secret"));
        }
        other => panic!("expected sanitized rewind error, got {other:?}"),
    }
}

#[tokio::test]
async fn rewind_executes_once_reloads_projection_then_replays_duplicate_terminal() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    env.chats
        .set_extensions(
            S1,
            &[
                crate::protocol::PERI_REWIND_EXTENSION.to_string(),
                crate::protocol::PERI_REPLAY_EXTENSION.to_string(),
            ],
        )
        .await;
    let command_id = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Rewind {
        command_id: command_id.clone(),
        payload: RewindPayload {
            chat_id: S1.into(),
            target_message_id: "message-1".into(),
            preview_fingerprint: "a".repeat(64),
            revert_files: true,
        },
    };
    let (tx, mut rx) = mpsc::channel(8);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("rewind-execute"), action.clone(), tx)
            .await,
        SubmitAck::Handled
    ));
    assert!(matches!(
        rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Accepted
    ));

    let rewind_forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap();
    let rewind_rpc_id = match rewind_forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
            assert_eq!(forward.frame["method"], "session/rewind");
            assert_eq!(forward.frame["params"]["sessionId"], "acp-1");
            assert_eq!(forward.frame["params"]["target_message_id"], "message-1");
            assert_eq!(
                forward.frame["params"]["preview_fingerprint"],
                "a".repeat(64)
            );
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
        other => panic!("expected rewind forward, got {other:?}"),
    };
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rewind_rpc_id,
            "result": {"status": "executed"}
        }),
    };
    env.relay.on_instance_event("local", &response).await;

    let load_forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap();
    let load_rpc_id = match load_forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
            assert_eq!(forward.frame["method"], "session/load");
            assert_eq!(forward.frame["params"]["sessionId"], "acp-1");
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
        other => panic!("expected session/load replay, got {other:?}"),
    };
    let load_response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 2,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": load_rpc_id,
            "result": {}
        }),
    };
    env.relay.on_instance_event("local", &load_response).await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .unwrap(),
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Committed
    ));
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
            .submit(&ctx("rewind-retry"), action, retry_tx)
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
        "duplicate commandId must never execute a second rewind"
    );
}

#[tokio::test]
async fn rewind_confirmed_then_reload_failure_is_unknown_and_never_reexecutes() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    env.chats
        .set_extensions(
            S1,
            &[
                crate::protocol::PERI_REWIND_EXTENSION.to_string(),
                crate::protocol::PERI_REPLAY_EXTENSION.to_string(),
            ],
        )
        .await;
    let command_id = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Rewind {
        command_id: command_id.clone(),
        payload: RewindPayload {
            chat_id: S1.into(),
            target_message_id: "message-1".into(),
            preview_fingerprint: "b".repeat(64),
            revert_files: true,
        },
    };
    let (tx, mut rx) = mpsc::channel(8);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("rewind-reload-failure"), action.clone(), tx)
            .await,
        SubmitAck::Handled
    ));
    assert!(matches!(
        rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Accepted
    ));

    let rewind_rpc_id = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
            assert_eq!(forward.frame["method"], "session/rewind");
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
        other => panic!("expected rewind forward, got {other:?}"),
    };
    env.relay
        .on_instance_event(
            "local",
            &peri_studio_proto::instance::InstanceEvent {
                chat_id: S1.into(),
                epoch: 0,
                seq: 1,
                frame: serde_json::json!({
                    "jsonrpc": "2.0", "id": rewind_rpc_id,
                    "result": {"status": "executed"}
                }),
            },
        )
        .await;

    let load_rpc_id = match env.instance_rx.recv().await.unwrap() {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
            assert_eq!(forward.frame["method"], "session/load");
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
        other => panic!("expected load forward, got {other:?}"),
    };
    env.relay
        .on_instance_event(
            "local",
            &peri_studio_proto::instance::InstanceEvent {
                chat_id: S1.into(),
                epoch: 0,
                seq: 2,
                frame: serde_json::json!({
                    "jsonrpc": "2.0", "id": load_rpc_id,
                    "error": {"code": -32603, "message": "injected reload failure"}
                }),
            },
        )
        .await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .unwrap(),
        Some(OutboundMsg::Frame(Frame::ActionError(ref error)))
            if error.code == ErrorCode::DeliveryUnknown
    ));
    assert_eq!(
        env.metadata
            .command(&command_id)
            .await
            .unwrap()
            .unwrap()
            .phase,
        "delivery_unknown"
    );

    let (retry_tx, mut retry_rx) = mpsc::channel(8);
    assert!(matches!(
        env.coordinator
            .submit(&ctx("rewind-reload-retry"), action, retry_tx)
            .await,
        SubmitAck::Handled
    ));
    assert!(matches!(
        retry_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Accepted
    ));
    assert!(matches!(
        retry_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionError(ref error)))
            if error.code == ErrorCode::DeliveryUnknown
    ));
    assert!(
        env.instance_rx.try_recv().is_err(),
        "confirmed rewind must never be sent again after reload failure"
    );
}
