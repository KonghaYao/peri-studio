//! CommandCoordinator session/list 主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 session/list 的 agent 查询与响应帧回传、offline
//! instance retryable、agent error retryable、未知/终态 chat 拒绝（§4.4）。
//! 公共 helper bound_session 见 command_coordinator_test_util（经父模块
//! re-export，经 `use super::*` 可见）。
use super::*;
/// 完整链路：bound chat → submit session/list → instance 侧收到 RPC 帧 →
/// 回 forward ack + JSON-RPC 响应 → client 收 session_list 帧（条目带 cwd）。
#[tokio::test]
async fn session_list_queries_agent_and_returns_frame() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    env.metadata
        .create_project("project-1", "Demo", "/", "local")
        .await
        .unwrap();
    seed_catalog_session(&env.projects, "project-1", "acp-1", "旧标题").await;
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::SessionList {
        command_id: cid.clone(),
        payload: peri_studio_proto::action::SessionListPayload { chat_id: S1.into() },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");

    // instance 侧收到 session/list RPC 帧（cwd 来自 chat record）。
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("instance should receive session/list RPC")
        .expect("rx alive");
    let rpc_id = match &fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            assert_eq!(f.frame["method"], serde_json::json!("session/list"));
            assert_eq!(f.frame["params"]["cwd"], serde_json::json!("/"));
            // 转发目标必须是 hub chat id（instance 进程表键），不是 bound
            // 的 acp session id（否则 instance 找不到进程 → stdin_write_failed）。
            assert_eq!(f.chat_id, S1, "forward 目标须为 hub chat id");
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

    // L3：instance 回 JSON-RPC 响应（pending_rpc 匹配 → session_list 帧）。
    let resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": { "sessions": [
                { "sessionId": "acp-1", "title": "已打开会话", "status": "active",
                  "updatedAt": "2026-08-10T00:00:00Z" },
                { "sessionId": "sess-b", "title": "", "status": "",
                  "updatedAt": "" },
            ]},
        }),
    };
    let r = env.relay.on_instance_event("local", &resp).await;
    assert!(
        matches!(r, crate::channel::ConsumeResult::RpcConfirmed { .. }),
        "{r:?}"
    );

    // client 收 session_list 帧：command_id 回显 + 条目带 cwd（查询面）。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::SessionList(s)))) => {
            assert_eq!(s.command_id, cid);
            assert_eq!(s.chat_id, S1);
            assert_eq!(s.sessions.len(), 2);
            // 已绑定会话（acp-1 → S1）：标注 bound_chat_id（§8.5 激活）。
            assert_eq!(s.sessions[0].session_id, "acp-1");
            assert_eq!(s.sessions[0].bound_chat_id.as_deref(), Some(S1));
            assert_eq!(s.sessions[0].cwd, "/", "条目应标注查询面 cwd");
            // 未绑定会话：bound_chat_id = None。
            assert_eq!(s.sessions[1].bound_chat_id, None);
            assert_eq!(s.sessions[1].cwd, "/");
        }
        other => panic!("expected session_list frame, got {other:?}"),
    }
    let session = env
        .projects
        .catalog()
        .get("acp-1")
        .await
        .expect("catalog session remains present");
    assert_eq!(
        session.title, "已打开会话",
        "session/list ACP title must refresh the in-memory catalog"
    );
}

#[tokio::test]
async fn session_list_offline_instance_returns_retryable_instance_offline() {
    let env = env().await;
    bound_session(&env, S1, "acp-1").await;
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
    let result = env
        .coordinator
        .submit(
            &ctx("c"),
            ActionEnvelope::SessionList {
                command_id: cid.clone(),
                payload: peri_studio_proto::action::SessionListPayload { chat_id: S1.into() },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Accepted { .. }));
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.command_id, cid);
            assert_eq!(error.code, ErrorCode::InstanceOffline);
            assert!(error.retryable);
        }
        other => panic!("expected offline query error, got {other:?}"),
    }
}

#[tokio::test]
async fn session_list_agent_error_returns_retryable_query_failure() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        env.coordinator
            .submit(
                &ctx("c"),
                ActionEnvelope::SessionList {
                    command_id: cid.clone(),
                    payload: peri_studio_proto::action::SessionListPayload { chat_id: S1.into() },
                },
                tx,
            )
            .await,
        SubmitAck::Accepted { .. }
    ));

    let forward = match env.instance_rx.recv().await {
        Some(OutboundMsg::Frame(Frame::InstanceForward(forward))) => forward,
        other => panic!("expected session/list forward, got {other:?}"),
    };
    env.instance
        .on_ack(
            "local",
            &forward.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: forward.command_id.clone(),
                chat_id: forward.chat_id.clone(),
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
            "error": { "code": -32603, "message": "catalog unavailable" },
        }),
    };
    assert!(matches!(
        env.relay.on_instance_event("local", &response).await,
        crate::channel::ConsumeResult::RpcConfirmed { .. }
    ));
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.command_id, cid);
            assert_eq!(error.code, ErrorCode::AgentUnavailable);
            assert!(error.retryable);
        }
        other => panic!("expected query response error, got {other:?}"),
    }
}

/// 未知 chat → CHAT_NOT_FOUND（同步失败，无 instance 帧）。
#[tokio::test]
async fn session_list_unknown_chat_fails_chat_not_found() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::SessionList {
        command_id: cid.clone(),
        payload: peri_studio_proto::action::SessionListPayload {
            chat_id: "ffffffff-ffff-ffff-ffff-ffffffffffff".into(),
        },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    match r {
        SubmitAck::Failed(e) => {
            assert_eq!(e.command_id, cid);
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::ChatNotFound);
        }
        other => panic!("expected failed, got {other:?}"),
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(env.instance_rx.try_recv().is_err(), "instance 不应收到帧");
    assert!(rx.try_recv().is_err(), "client 不应收到帧");
}

/// 终态 chat（ACP 进程已退出）→ INVALID_STATE（无查询面）。
#[tokio::test]
async fn session_list_terminal_chat_fails_invalid_state() {
    let env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    // 置终态：进程退出事件。
    let exit = peri_studio_proto::instance::InstanceProcessExit {
        chat_id: S1.into(),
        code: 0,
    };
    env.relay.on_process_exit("local", &exit).await;
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::SessionList {
        command_id: cid.clone(),
        payload: peri_studio_proto::action::SessionListPayload { chat_id: S1.into() },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    match r {
        SubmitAck::Failed(e) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::InvalidState);
            assert!(!e.retryable, "终态 chat 不是瞬时故障");
        }
        other => panic!("expected failed, got {other:?}"),
    }
    assert!(rx.try_recv().is_err(), "client 不应收到帧");
}

// ---------------------------------------------------------------------------
// chat/load 会话切换（§8.5）：当前对话内 load，不新建 chat/进程
// ---------------------------------------------------------------------------
