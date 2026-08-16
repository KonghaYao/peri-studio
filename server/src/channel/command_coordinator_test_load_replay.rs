//! CommandCoordinator chat/load 重放主题测试（command_coordinator_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 in-flight load 期间 prompt 等待并翻译新 binding、
//! load 的未知/终态 chat 拒绝、rejected retryable、begin replay 持久化失败
//! 不达 acp（§8.5）。公共 helper bound_session/load_action 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
/// P0（review #1）：load 在途时 prompt 必须等待 runtime_transition_guard——
/// load 切换 binding 期间 prompt 不得读取/翻译 binding；load 完成后 prompt
/// 用**切换后**的会话翻译投递（线性化：load 完整发生在 prompt 之前）。
#[tokio::test]
async fn prompt_waits_for_in_flight_load_and_translates_new_binding() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    let (tx, mut rx) = mpsc::channel(16);

    // load 提交并 dispatch（持 guard），L3 不回复。
    let load_cid = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        env.coordinator
            .submit(&ctx("c"), load_action(&load_cid, S1, "acp-2"), tx.clone())
            .await,
        SubmitAck::Accepted { .. }
    ));
    let load_fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("load dispatched")
        .expect("rx alive");
    let load_rpc_id = match &load_fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            assert_eq!(f.frame["method"], serde_json::json!("session/load"));
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
        other => panic!("expected session/load forward, got {other:?}"),
    };
    assert_eq!(env.chats.resolve("acp-2").await.as_deref(), Some(S1));

    // prompt 提交：executor 消费时须阻塞在 guard——instance 不得收到
    // prompt 帧（binding 仍可能被 load 改写）。
    let cid = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        env.coordinator
            .submit(&ctx("c"), prompt_action(&cid, S1), tx.clone())
            .await,
        SubmitAck::Accepted { .. }
    ));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        env.instance_rx.try_recv().is_err(),
        "load 在途时 prompt 不得 dispatch"
    );

    // 完成 load → guard 释放 → prompt 继续，且用新 binding（acp-2）翻译。
    let load_resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": load_rpc_id,
            "result": { "sessionId": "acp-2" },
        }),
    };
    let r = env.relay.on_instance_event("local", &load_resp).await;
    assert!(
        matches!(r, crate::channel::ConsumeResult::RpcConfirmed { .. }),
        "{r:?}"
    );
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected load committed ack, got {other:?}"),
    }

    let prompt_fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("prompt dispatched after load completed")
        .expect("rx alive");
    let prompt_rpc_id = match &prompt_fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            assert_eq!(f.frame["method"], serde_json::json!("session/prompt"));
            assert_eq!(
                f.frame["params"]["sessionId"],
                serde_json::json!("acp-2"),
                "prompt 必须用 load 完成后的 binding 翻译"
            );
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
        other => panic!("expected prompt forward, got {other:?}"),
    };
    let prompt_resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 2,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": prompt_rpc_id,
            "result": { "stopReason": "end_turn" },
        }),
    };
    let r = env.relay.on_instance_event("local", &prompt_resp).await;
    assert!(
        matches!(r, crate::channel::ConsumeResult::RpcConfirmed { .. }),
        "{r:?}"
    );
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected prompt committed ack, got {other:?}"),
    }
}


/// 未知 chat → CHAT_NOT_FOUND（同步失败，无 instance 帧）。
#[tokio::test]
async fn load_chat_unknown_chat_fails_chat_not_found() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(
            &ctx("c"),
            load_action(&cid, "ffffffff-ffff-ffff-ffff-ffffffffffff", "acp-x"),
            tx,
        )
        .await;
    match r {
        SubmitAck::Failed(e) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::ChatNotFound);
        }
        other => panic!("expected failed, got {other:?}"),
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(env.instance_rx.try_recv().is_err(), "instance 不应收到帧");
    assert!(rx.try_recv().is_err(), "client 不应收到帧");
}

/// 终态 chat（进程已退出）→ INVALID_STATE：load 是进程内操作，无进程
/// 则无会话可切（§8.5）。
#[tokio::test]
async fn load_chat_terminal_chat_fails_invalid_state() {
    let env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    let exit = peri_studio_proto::instance::InstanceProcessExit {
        chat_id: S1.into(),
        code: 0,
    };
    env.relay.on_process_exit("local", &exit).await;
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), load_action(&cid, S1, "acp-2"), tx.clone())
        .await;
    match r {
        SubmitAck::Failed(e) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::InvalidState);
            assert!(!e.retryable);
        }
        other => panic!("expected failed, got {other:?}"),
    }
    assert!(rx.try_recv().is_err(), "client 不应收到帧");
}

/// L3 错误响应（如目标会话不存在）→ action_error（可重试；会话切换
/// 无副作用残留——回放窗口已开，但 load 拒绝时 agent 侧未切换，下次
/// load 重开窗口覆盖）。
#[tokio::test]
async fn load_chat_rejected_response_is_retryable_error() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), load_action(&cid, S1, "ghost"), tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("instance should receive session/load RPC")
        .expect("rx alive");
    let rpc_id = match &fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
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
    // L3：JSON-RPC error（会话不存在）。
    let resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": { "code": -32602, "message": "session not found" },
        }),
    };
    let r = env.relay.on_instance_event("local", &resp).await;
    assert!(
        matches!(r, crate::channel::ConsumeResult::RpcConfirmed { .. }),
        "{r:?}"
    );
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(e)))) => {
            assert_eq!(e.command_id, cid);
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::AgentUnavailable);
            assert!(e.retryable);
        }
        other => panic!("expected action_error, got {other:?}"),
    }
    // chat 当前会话未被改动（切换失败不落地）。
    assert_eq!(env.chats.session_id(S1).await.as_deref(), Some("acp-1"));
}

/// BeginLoadReplay 已改写内存态但投递失败时，不得继续把 session/load
/// 送进 ACP；协调器必须恢复旧 binding 并给出确定的可重试错误。
#[tokio::test]
async fn load_chat_begin_replay_persist_failure_never_reaches_acp() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    env.sink_fail.store(true, Ordering::SeqCst);

    let cid = uuid::Uuid::new_v4().to_string();
    let submitted = env
        .coordinator
        .submit(&ctx("c"), load_action(&cid, S1, "acp-2"), tx)
        .await;
    assert!(matches!(submitted, SubmitAck::Accepted { .. }));

    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.command_id, cid);
            assert_eq!(error.code, ErrorCode::AgentUnavailable);
            assert!(error.retryable);
        }
        other => panic!("expected replay persistence error, got {other:?}"),
    }
    assert!(
        env.instance_rx.try_recv().is_err(),
        "ACP must not observe a load whose replay barrier was not durable"
    );
    assert_eq!(env.chats.session_id(S1).await.as_deref(), Some("acp-1"));
    env.sink_fail.store(false, Ordering::SeqCst);
}

// ---------------------------------------------------------------------------
// chat/session-new 当前对话内新建会话（§8.5）：不新建 chat/进程，等价
// create 序列的 session/new 一步
// ---------------------------------------------------------------------------
