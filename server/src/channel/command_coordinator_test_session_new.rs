//! CommandCoordinator chat/session-new 主题测试（command_coordinator_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 session/new 成功创建 + binding 更新、rejected
//! retryable、L3 超时 delivery unknown、投影失败 delivery unknown、终态
//! chat 拒绝（§8.5）。公共 helper bound_session/session_new_action 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn session_new_creates_session_and_commits() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), session_new_action(&cid, S1), tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");

    // instance 侧收到 session/new RPC 帧（cwd 来自 chat record；带 id 的
    // request 非 notification，§6.1）。
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("instance should receive session/new RPC")
        .expect("rx alive");
    let rpc_id = match &fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            assert_eq!(f.frame["method"], serde_json::json!("session/new"));
            assert_eq!(f.frame["params"]["cwd"], serde_json::json!("/"));
            assert_eq!(f.frame["params"]["mcpServers"], serde_json::json!([]));
            assert!(f.frame["id"].is_string(), "request 必带 id（§6.1）");
            // 转发目标必须是 hub chat id（instance 进程表键），不是 acp
            // session id——与 session/list/load 同款（§6.2）。
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

    // L3：instance 回 session/new 响应（含新 sessionId + configOptions——
    // handle_new 不发 config_option_update 通知，响应即 model/effort 唯一
    // 路径，§5.4）。
    let resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {
                "sessionId": "acp-new",
                "configOptions": [
                    {
                        "id": "model", "name": "Model", "type": "select",
                        "currentValue": "default",
                        "options": [
                            { "value": "default", "name": "default (claude-sonnet-4-5)" },
                            { "value": "sonnet", "name": "sonnet (claude-sonnet-4-5)" }
                        ]
                    },
                    {
                        "id": "thinking_effort", "name": "Thinking Effort", "type": "select",
                        "currentValue": "high",
                        "options": [
                            { "value": "low", "name": "Low" },
                            { "value": "high", "name": "High" }
                        ]
                    }
                ]
            },
        }),
    };
    let r = env.relay.on_instance_event("local", &resp).await;
    assert!(
        matches!(r, crate::channel::ConsumeResult::RpcConfirmed { .. }),
        "{r:?}"
    );

    // client 收 committed ack（携带 chat_id + 新 acpSessionId，跨任务契约 §3）。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.command_id, cid);
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
            assert_eq!(ack.chat_id.as_deref(), Some(S1));
            assert_eq!(ack.acp_session_id.as_deref(), Some("acp-new"));
        }
        other => panic!("expected committed ack, got {other:?}"),
    }
    // chat 当前会话已切换到新会话（进程内）：entry.session_id = acp-new；
    // 新旧会话 binding 均指向本 chat（relay 逐帧校验仍通过）。
    assert_eq!(env.chats.session_id(S1).await.as_deref(), Some("acp-new"));
    assert_eq!(env.chats.resolve("acp-1").await.as_deref(), Some(S1));
    assert_eq!(env.chats.resolve("acp-new").await.as_deref(), Some(S1));
    // session doc agent.acp_session_id 已写回（§5.4 agent map；镜像快照
    // 解码断言，hub_test 同款）。
    let (state, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S1))
        .await
        .expect("session doc snapshot");
    let y = yrs::Doc::new();
    let parsed = yrs::Update::decode_v1(&state).expect("decode v1");
    {
        let mut txn = y.transact_mut();
        txn.apply_update(parsed).unwrap();
    }
    let txn = y.transact();
    let root = txn.get_map(crate::state::factory::ROOT).expect("root");
    let agent = root
        .get(&txn, "agent")
        .and_then(|v| v.cast::<yrs::MapRef>().ok())
        .expect("agent map");
    assert_eq!(
        agent.get(&txn, "acp_session_id"),
        Some(yrs::Out::Any("acp-new".into())),
        "agent.acp_session_id 应随绑定更新"
    );
    // 模型/effort 投影（§5.4）：响应 configOptions 提取——model 取
    // options 匹配项 name 括号内模型名，effort 取 thinking_effort
    // 的 currentValue。
    assert_eq!(
        agent.get(&txn, "model"),
        Some(yrs::Out::Any("claude-sonnet-4-5".into())),
        "agent.model 应来自 configOptions 提取"
    );
    assert_eq!(
        agent.get(&txn, "effort"),
        Some(yrs::Out::Any("high".into())),
        "agent.effort 应来自 configOptions 提取"
    );
}

/// L3 错误响应 → action_error（可重试；新会话未建立，binding 无残留）。
#[tokio::test]
async fn session_new_rejected_response_is_retryable_error() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), session_new_action(&cid, S1), tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("instance should receive session/new RPC")
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
    // L3：JSON-RPC error（如会话数超限）。
    let resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": { "code": -32602, "message": "session limit reached" },
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
    // chat 当前会话未被改动（新会话未建立不落地）。
    assert_eq!(env.chats.session_id(S1).await.as_deref(), Some("acp-1"));
}

/// forward ack 只证明 instance 已写入 ACP stdin；L3 丢失后 session/new
/// 是否创建成功不可知，必须阻止自动重试，避免生成第二个 ACP 会话。
#[tokio::test]
async fn session_new_l3_timeout_is_delivery_unknown() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    let cid = uuid::Uuid::new_v4().to_string();
    let submitted = env
        .coordinator
        .submit(&ctx("c"), session_new_action(&cid, S1), tx)
        .await;
    assert!(matches!(submitted, SubmitAck::Accepted { .. }));

    let forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("instance should receive session/new")
        .expect("instance channel alive");
    match forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
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
        }
        other => panic!("expected instance forward, got {other:?}"),
    }

    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.command_id, cid);
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected DELIVERY_UNKNOWN, got {other:?}"),
    }
    assert_eq!(env.chats.session_id(S1).await.as_deref(), Some("acp-1"));
}

/// ACP 已返回新 sessionId 后，关键 binding 投影投递失败不能伪装成
/// committed，也不能告诉客户端安全重试；ACP 侧新会话已经真实存在。
#[tokio::test]
async fn session_new_projection_failure_is_delivery_unknown() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    let cid = uuid::Uuid::new_v4().to_string();
    let submitted = env
        .coordinator
        .submit(&ctx("c"), session_new_action(&cid, S1), tx)
        .await;
    assert!(matches!(submitted, SubmitAck::Accepted { .. }));

    let forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("instance should receive session/new")
        .expect("instance channel alive");
    let rpc_id = match forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => {
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
        other => panic!("expected instance forward, got {other:?}"),
    };
    env.sink_fail.store(true, Ordering::SeqCst);
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": { "sessionId": "acp-created-but-unprojected" },
        }),
    };
    assert!(matches!(
        env.relay.on_instance_event("local", &response).await,
        crate::channel::ConsumeResult::RpcConfirmed { .. }
    ));

    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.command_id, cid);
            assert_eq!(error.code, ErrorCode::DeliveryUnknown);
            assert!(!error.retryable);
        }
        other => panic!("expected projection DELIVERY_UNKNOWN, got {other:?}"),
    }
    assert!(rx.try_recv().is_err(), "must not also emit committed");
    assert_eq!(
        env.chats.session_id(S1).await.as_deref(),
        Some("acp-created-but-unprojected")
    );
    env.sink_fail.store(false, Ordering::SeqCst);
}

/// 终态 chat（进程已退出）→ INVALID_STATE：session-new 是进程内操作，
/// 无进程则无会话可建（§8.5）。
#[tokio::test]
async fn session_new_terminal_chat_fails_invalid_state() {
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
        .submit(&ctx("c"), session_new_action(&cid, S1), tx.clone())
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

// ---------------------------------------------------------------------------
// prompt L3 响应 → turn 终态（§7.2 宿主驱动 turn 模型）：真实 peri 不发
// turn_complete 通知，唯一终态信号是 prompt 的 L3 响应 result.stopReason
// （acp-channel.ts 同源）：failed/error → Failed、cancelled → Cancelled、
// 缺省 → Completed。同时断言活动 turn 表项清理（clear_active_turn——终态
// 后表项不得滞留阻塞后续 load「有活动 turn」校验）。
// ---------------------------------------------------------------------------
