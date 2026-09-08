//! CommandCoordinator prompt 超时主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 prompt 活动期间不超时、inactivity 超时 delivery
//! unknown 并清理活动 turn（§7.2）。公共 helper bound_session/prompt_action
//! 见 command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
/// #3 增量窗口续命（issue #3）：L3 窗口（500ms）内 touch（relay 事件投递
/// 等价）后续命——越过原窗口到期点投 L3 响应仍 Committed（长流式 turn
/// 不误判 delivery_unknown）。
#[tokio::test]
async fn prompt_l3_no_timeout_while_active() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), prompt_action(&cid, S1), tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    let (observer_tx, mut observer_rx) = mpsc::channel(16);
    let observer = env
        .coordinator
        .submit(&ctx("replacement"), prompt_action(&cid, S1), observer_tx)
        .await;
    assert!(matches!(observer, SubmitAck::Accepted { .. }));
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
    // 等活动 turn 登记（executor 在 forward_ack 后 set_active_turn，L3 窗口
    // 自登记时刻起算；避免 executor 调度时序竞态）。
    let registered = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if env.chats.active_turn(S1).await.is_some() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await;
    assert!(registered.is_ok(), "prompt 执行中登记活动 turn");
    // 模拟长流式 turn：窗口内投递一帧（touch 续命）→ 越过原窗口到期点
    // （250ms + 400ms > 500ms 窗口）仍不超时。
    tokio::time::sleep(Duration::from_millis(250)).await;
    env.chats.touch_active_turn(S1).await; // relay submit 成功路径等价
    tokio::time::sleep(Duration::from_millis(400)).await;
    // 投 L3 响应 → Committed（未被窗口误杀）。
    let resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 2,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": { "stopReason": "end_turn" },
        }),
    };
    let r = env.relay.on_instance_event("local", &resp).await;
    assert!(
        matches!(r, crate::channel::ConsumeResult::RpcConfirmed { .. }),
        "{r:?}"
    );
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected committed ack, got {other:?}"),
    }
    match tokio::time::timeout(Duration::from_secs(2), observer_rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
            assert_eq!(ack.command_id, cid);
        }
        other => panic!("expected replacement observer committed ack, got {other:?}"),
    }
    assert!(
        env.chats.active_turn(S1).await.is_none(),
        "终态后活动 turn 表项清理"
    );
}

/// #3 无增量窗口耗尽：L3 窗口（500ms）内无任何 touch → delivery_unknown
/// （stable DELIVERY_UNKNOWN，路径 B 不可重试）+ 活动 turn
/// 表项清理（§7.2）。
#[tokio::test]
async fn prompt_l3_inactivity_timeout_delivery_unknown() {
    let mut env = env().await;
    bound_session(&env, S2, "acp-2").await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), prompt_action(&cid, S2), tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("forward received")
        .expect("rx alive");
    match &fwd {
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
        }
        other => panic!("expected forward frame, got {other:?}"),
    }
    // 无任何事件投递（touch）：窗口耗尽 → delivery_unknown error。
    match tokio::time::timeout(Duration::from_secs(3), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(e)))) => {
            assert_eq!(e.command_id, cid);
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::DeliveryUnknown);
            assert!(
                e.message.contains("delivery unknown"),
                "错误消息应含 delivery unknown（got {}）",
                e.message
            );
            assert!(!e.retryable, "路径 B：非幂等禁止自动重发");
        }
        other => panic!("expected action_error (delivery unknown), got {other:?}"),
    }
    assert!(
        env.chats.active_turn(S2).await.is_none(),
        "delivery_unknown → 活动 turn 表项清理"
    );
    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S2))
        .await
        .expect("session 镜像快照");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    mirror
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(&snapshot).unwrap())
        .unwrap();
    let txn = mirror.transact();
    let sm = txn
        .get_map("root")
        .unwrap()
        .get(&txn, "session")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let loading = sm
        .get(&txn, "loading")
        .and_then(|v| v.cast::<bool>().ok())
        .unwrap_or(true);
    assert!(
        !loading,
        "session/prompt L3 丢失后仍须投影终态并清除 loading，否则输入框锁定"
    );
}

/// 流式回合已通过 `prompt_complete` 终态化后，迟到的 L3 超时不得再盖
/// `delivery_unknown`（用户可见误报）。
#[tokio::test]
async fn prompt_l3_timeout_does_not_unknown_after_stream_terminal() {
    let mut env = env().await;
    bound_session(&env, S3, "acp-3").await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), prompt_action(&cid, S3), tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("forward received")
        .expect("rx alive");
    match &fwd {
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
        }
        other => panic!("expected forward frame, got {other:?}"),
    }
    let turn_id = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Some(turn) = env.chats.active_turn(S3).await {
                break turn;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("prompt 执行中登记活动 turn");

    let consumed = env
        .relay
        .on_instance_event(
            "local",
            &peri_studio_proto::instance::InstanceEvent {
                chat_id: S3.into(),
                epoch: 0,
                seq: 2,
                frame: serde_json::json!({
                    "type": "prompt_complete",
                    "sessionId": "acp-3",
                    "payload": { "turnId": turn_id },
                }),
            },
        )
        .await;
    assert!(
        matches!(consumed, crate::channel::ConsumeResult::Delivered { .. }),
        "{consumed:?}"
    );

    match tokio::time::timeout(Duration::from_secs(3), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected committed ack after existing terminal, got {other:?}"),
    }

    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::chat(S3))
        .await
        .expect("chat 镜像快照");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    mirror
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(&snapshot).unwrap())
        .unwrap();
    let txn = mirror.transact();
    let user = txn
        .get_map("root")
        .unwrap()
        .get(&txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap()
        .get(&txn, &format!("{turn_id}:user"))
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let delivery = user
        .get(&txn, "delivery_state")
        .and_then(|value| value.cast::<String>().ok())
        .unwrap_or_default();
    assert_ne!(
        delivery, "delivery_unknown",
        "流式终态后不得把 user delivery 标成 unknown"
    );
}
