//! CommandCoordinator prompt L3 主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 stopReason 映射 turn terminal、终态投影失败不提交、
//! 持久化 prompt 状态合并 catalog/outbox/精确投影、L3 error 清理活动 turn。
//! 公共 helper bound_session/drive_prompt_l3 见 command_coordinator_test_util
//! （经父模块 re-export，经 `use super::*` 可见）。
use super::*;
/// stopReason → turn 终态三分支映射（§7.2）：failed → Failed、cancelled →
/// Cancelled、缺省 → Completed。
#[tokio::test]
async fn prompt_l3_stop_reason_maps_turn_terminal() {
    let mut env = env().await;
    let failed = drive_prompt_l3(&mut env, S1, "acp-1", Some("failed")).await;
    assert_eq!(failed, "failed", "stopReason=failed → turn 终态 Failed");
    let cancelled = drive_prompt_l3(&mut env, S2, "acp-2", Some("cancelled")).await;
    assert_eq!(
        cancelled, "cancelled",
        "stopReason=cancelled → turn 终态 Cancelled"
    );
    let completed = drive_prompt_l3(&mut env, S3, "acp-3", None).await;
    assert_eq!(
        completed, "completed",
        "无 stopReason → turn 终态 Completed"
    );
}

/// ACP 已返回成功，但 control/chat 终态 update 无法投递时，command 不得越过
/// 第二个持久屏障。客户端收到明确的非重试错误，outbox 留下 failed 证据，且
/// committed Ack 永远不会被发送。
#[tokio::test]
async fn prompt_terminal_projection_failure_never_commits() {
    let mut env = env().await;
    bound_session(&env, S4, "acp-terminal-persist-failure").await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let result = env
        .coordinator
        .submit(&ctx("c"), prompt_action(&cid, S4), tx)
        .await;
    assert!(matches!(result, SubmitAck::Accepted { .. }), "{result:?}");

    let forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("forward received")
        .expect("instance channel alive");
    let rpc_id = match forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
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
            forward.frame["id"].as_str().unwrap().to_string()
        }
        other => panic!("expected instance forward, got {other:?}"),
    };

    // 等待协调器越过 L1+L2、user entry 持久化和 active-turn 注册，避免把
    // 故障误注入前一个屏障。
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if env.chats.active_turn(S4).await.is_some() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("user entry projection completed");
    // 只让随后的 terminal update 失败。
    env.sink_fail.store(true, Ordering::SeqCst);
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S4.into(),
        epoch: 0,
        seq: 2,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {},
        }),
    };
    let consumed = env.relay.on_instance_event("local", &response).await;
    assert!(
        matches!(consumed, crate::channel::ConsumeResult::RpcConfirmed { .. }),
        "{consumed:?}"
    );

    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected non-retryable action_error, got {other:?}"),
    }
    assert!(
        rx.try_recv().is_err(),
        "terminal failure must not emit committed"
    );

    let command_id = uuid::Uuid::parse_str(&cid).unwrap();
    let record = env
        .store
        .chat(uuid::Uuid::parse_str(S4).unwrap())
        .unwrap()
        .outbox_get(command_id)
        .await
        .expect("failed command evidence persisted");
    assert_eq!(
        record.status,
        crate::persist::outbox::OutboxStatus::DeliveryUnknown
    );
    assert_eq!(
        record.last_error.as_ref().map(|error| error.retryable),
        Some(false)
    );
}

#[tokio::test]
async fn persisted_session_prompt_status_joins_catalog_outbox_and_exact_projection() {
    let mut env = env().await;
    assert_eq!(
        drive_prompt_l3(&mut env, S3, "acp-3", None).await,
        "completed"
    );
    env.metadata
        .create_project("p1", "Demo", "/", "local")
        .await
        .unwrap();
    seed_catalog_session(&env.projects, "p1", "acp-3", "Demo").await;

    let query_id = uuid::Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("read-only-query"),
            ActionEnvelope::PersistedSessionPromptStatus {
                command_id: query_id.clone(),
                payload: PersistedSessionOpenPayload {
                    session_id: "acp-3".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Accepted { .. }));
    let response = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    let OutboundMsg::Frame(Frame::PromptStatus(status)) = response else {
        panic!("expected prompt_status response")
    };
    assert_eq!(status.command_id, query_id);
    assert_eq!(status.session_id, "acp-3");
    assert!(!status.runtime_restored);
    assert!(!status.evidence_incomplete);
    assert_eq!(status.prompts.len(), 1);
    assert_eq!(
        status.prompts[0].status,
        peri_studio_proto::session::PromptDeliveryStatus::Completed
    );
    let public_json = serde_json::to_value(status).unwrap();
    assert!(public_json.get("message").is_none());
    assert!(public_json.get("recovery").is_none());
}

/// L3 error（agent 拒绝 prompt）→ error ack（AgentUnavailable，可重试）+
/// 活动 turn 表项清理（§7.2：L3 error 也是 turn 的终结——表项滞留会阻塞
/// 后续 load「有活动 turn」校验）。
#[tokio::test]
async fn prompt_l3_error_clears_active_turn() {
    let mut env = env().await;
    bound_session(&env, S4, "acp-4").await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), prompt_action(&cid, S4), tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("forward received")
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
    // executor 在 forward_ack 后继续执行（RegisterUserEntry → set_active_turn）；
    // 轮询等待活动 turn 登记（避免 executor 调度时序竞态）。
    let registered = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if env.chats.active_turn(S4).await.is_some() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await;
    assert!(registered.is_ok(), "prompt 执行中登记活动 turn");
    // L3 error。
    let resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S4.into(),
        epoch: 0,
        seq: 2,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": { "code": -32603, "message": "agent rejected" },
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
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::DeliveryUnknown);
            assert!(
                !e.retryable,
                "L3 error 是终态失败（fail_terminal，不可重试）"
            );
        }
        other => panic!("expected action_error, got {other:?}"),
    }
    assert!(
        env.chats.active_turn(S4).await.is_none(),
        "L3 error → 活动 turn 表项清理"
    );
}
