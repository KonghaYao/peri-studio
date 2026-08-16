//! CommandCoordinator chat/load 主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 load 成功路径（session/load RPC + 会话切换）与
//! prompt turn 活跃期间的 load 拒绝（§8.5 进程内切换）。公共 helper
//! bound_session/load_action 见 command_coordinator_test_util（经父模块
//! re-export，经 `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn load_chat_switches_session_in_place() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    bound_session(&env, S1, "acp-1").await;
    // 目标会话曾在同一进程内加载过再切回。回归：`bind` 的幂等早退不会
    // 更新当前 session，load 预绑定必须使用 `switch_session`。
    env.chats.switch_session(S1, "acp-2").await.unwrap();
    env.chats.switch_session(S1, "acp-1").await.unwrap();
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), load_action(&cid, S1, "acp-2"), tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");

    // instance 侧收到 session/load RPC 帧（cwd 来自 chat record）。
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("instance should receive session/load RPC")
        .expect("rx alive");
    let rpc_id = match &fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            assert_eq!(f.frame["method"], serde_json::json!("session/load"));
            assert_eq!(f.frame["params"]["cwd"], serde_json::json!("/"));
            assert_eq!(f.frame["params"]["sessionId"], serde_json::json!("acp-2"));
            // 转发目标必须是 hub chat id（instance 进程表键），不是 acp
            // session id——与 session/list 同款（§6.2 spawn 时按 hub id 注册）。
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

    // 预绑定先于响应生效（§8.5 修复）：ACP spec 强制 replay before
    // response——回放帧先于 load 响应到达，binding 须先建立否则被 relay
    // 以 binding_missing 丢弃（create 路径同款预绑定）。此处 L3 响应
    // 尚未回投，binding 已命中。
    assert_eq!(env.chats.resolve("acp-2").await.as_deref(), Some(S1));

    // 第一条 load 完成前拒绝同 chat 的第二条 load，避免两组 replay 通知
    // 写入同一个 Yjs Doc。
    let concurrent_cid = uuid::Uuid::new_v4().to_string();
    let concurrent = env
        .coordinator
        .submit(
            &ctx("c"),
            load_action(&concurrent_cid, S1, "acp-3"),
            tx.clone(),
        )
        .await;
    assert!(matches!(
        concurrent,
        SubmitAck::Failed(ActionError {
            code: ErrorCode::RateLimited,
            ..
        })
    ));
    // load 与 session/new 必须共享同一把 per-chat lease；否则两个 ACP
    // 会话变更会交错改写 binding 与 replay 投影。
    let concurrent_new_id = uuid::Uuid::new_v4().to_string();
    let concurrent_new = env
        .coordinator
        .submit(
            &ctx("c"),
            session_new_action(&concurrent_new_id, S1),
            tx.clone(),
        )
        .await;
    assert!(matches!(
        concurrent_new,
        SubmitAck::Failed(ActionError {
            code: ErrorCode::RateLimited,
            ..
        })
    ));

    // L3：instance 回 session/load 响应。
    let resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": { "sessionId": "acp-2" },
        }),
    };
    let r = env.relay.on_instance_event("local", &resp).await;
    assert!(
        matches!(r, crate::channel::ConsumeResult::RpcConfirmed { .. }),
        "{r:?}"
    );

    // client 收 committed ack（带 chat_id）。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.command_id, cid);
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
            assert_eq!(ack.chat_id.as_deref(), Some(S1));
        }
        other => panic!("expected committed ack, got {other:?}"),
    }
    // chat 当前会话已切换（进程内）：entry.session_id = acp-2；新旧会话
    // binding 均指向本 chat（relay 逐帧校验仍通过）。
    assert_eq!(env.chats.session_id(S1).await.as_deref(), Some("acp-2"));
    assert_eq!(env.chats.resolve("acp-1").await.as_deref(), Some(S1));
    assert_eq!(env.chats.resolve("acp-2").await.as_deref(), Some(S1));
}

/// P0（review #1）：prompt 在途时 load 必须拒绝——prompt dispatch 后
/// active_turn 已登记（guard 在 dispatch 帧发出后释放，prompt_delivery
/// 刻意如此：L3 等待期间 load 不得插入），load 的 prepare 在拿到 guard 后
/// 检查 active_turn 并同步拒绝，binding 不得被切换。
#[tokio::test]
async fn load_rejected_while_prompt_turn_active() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    let (tx, mut rx) = mpsc::channel(16);

    // prompt 提交并 dispatch（active_turn 已登记），L3 不回复。
    let cid = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        env.coordinator
            .submit(&ctx("c"), prompt_action(&cid, S1), tx.clone())
            .await,
        SubmitAck::Accepted { .. }
    ));
    let prompt_fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("prompt dispatched")
        .expect("rx alive");
    let prompt_rpc_id = match &prompt_fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            assert_eq!(f.frame["method"], serde_json::json!("session/prompt"));
            assert_eq!(f.frame["params"]["sessionId"], serde_json::json!("acp-1"));
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

    // load 提交（S1 → acp-2）：prompt 的 active_turn 在途 → 同步拒绝，
    // binding 不得被切换（用户消息不会落入切换后的会话）。
    let load_cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), load_action(&load_cid, S1, "acp-2"), tx.clone())
        .await;
    assert!(
        matches!(
            r,
            SubmitAck::Failed(ActionError {
                code: ErrorCode::InvalidState,
                ..
            })
        ),
        "prompt 在途时 load 必须拒绝（got {r:?}）"
    );
    assert_eq!(
        env.chats.resolve("acp-2").await.as_deref(),
        None,
        "prompt 在途时 load 不得切换 binding"
    );
    assert_eq!(env.chats.session_id(S1).await.as_deref(), Some("acp-1"));

    // 完成 prompt（L3 响应）→ committed；active_turn 清除。
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
    assert!(
        env.chats.active_turn(S1).await.is_none(),
        "prompt 终态后活动 turn 必须清除"
    );
}
