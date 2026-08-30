//! CommandCoordinator prompt 投递主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 prompt 投递的持久化证据缺失 fail-closed（§7.2）、
//! 持久化失败终态化广播、首条投递种子 catalog 标题、in-flight 重放观察者、
//! 内存未知判定防挂起、队列满 RATE_LIMITED 与串行执行顺序。公共 helper
//! bound_session/prompt_action/broadcast_active_turn_status 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
/// Losing the per-chat durable store must never make a prompt disappear or
/// become retryable. The delivery module returns the conservative verdict to
/// its caller even when it cannot append that verdict to the missing store.
#[tokio::test]
async fn prompt_delivery_missing_store_fails_closed() {
    let env = env().await;
    let command_id = uuid::Uuid::new_v4();
    let chat_id = uuid::Uuid::new_v4().to_string();
    let outcome = env
        .coordinator
        .inner
        .prompt_delivery
        .execute(crate::channel::prompt_delivery::PromptDeliveryRequest {
            command_id,
            command_id_text: command_id.to_string(),
            chat_id: chat_id.clone(),
            payload: PromptChatPayload {
                chat_id,
                message: "must not vanish".into(),
                effort: None,
            },
        })
        .await;

    match outcome {
        crate::channel::prompt_delivery::PromptDeliveryOutcome::Failed(failure) => {
            assert_eq!(failure.code, ErrorCode::DeliveryUnknown);
            assert!(!failure.retryable);
        }
        other => panic!("missing durable evidence must fail closed, got {other:?}"),
    }
}

#[tokio::test]
async fn retryable_prompt_persist_failure_terminalizes_broadcast_turn_without_dispatch() {
    let mut env = env().await;
    bound_session(&env, S1, "acp-1").await;
    let (base_snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S1))
        .await
        .expect("session base snapshot");
    let mut updates = env.doc.subscribe_updates().await;
    env.sink_fail.store(true, Ordering::SeqCst);

    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        env.coordinator
            .submit(&ctx("c"), prompt_action(&cid, S1), tx)
            .await,
        SubmitAck::Accepted { .. }
    ));
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(error)))) => {
            assert_eq!(error.command_id, cid);
            assert_eq!(error.code, ErrorCode::AgentUnavailable);
            assert!(error.retryable);
        }
        other => panic!("expected definite pre-dispatch failure, got {other:?}"),
    }
    assert!(
        env.instance_rx.try_recv().is_err(),
        "ACP must never observe a prompt whose pending projection was not durable"
    );
    // P1（doc_manager 问题 2）：persist 失败时更新不广播（重试缓冲，
    // 客户端不得先于镜像看到未持久化状态）——accepting 与 failed 终态均
    // 被抑制，镜像停留在 base_snapshot。契约不变：UI 绝不会把该 prompt
    // 显示为 active（若有早前广播的 active 状态，此处同样保持未广播）。
    assert_eq!(
        broadcast_active_turn_status(&mut updates, S1, &base_snapshot)
            .await
            .as_deref(),
        None,
        "a persist-failed pre-dispatch prompt must not broadcast any turn state"
    );
    env.sink_fail.store(false, Ordering::SeqCst);
}

#[tokio::test]
async fn first_dispatched_prompt_seeds_the_hub_catalog_title() {
    let mut env = env().await;
    env.metadata
        .create_project("p1", "Demo", "/", "local")
        .await
        .unwrap();
    seed_catalog_session(&env.projects, "p1", "acp-1", "").await;
    bound_session(&env, S1, "acp-1").await;

    let (tx, _rx) = mpsc::channel(8);
    let command_id = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Prompt {
        command_id,
        payload: PromptChatPayload {
            chat_id: S1.into(),
            message: "  修复   session catalog 标题  \n后续细节".into(),
            effort: None,
        },
    };
    assert!(matches!(
        env.coordinator.submit(&ctx("c"), action, tx).await,
        SubmitAck::Accepted { .. }
    ));

    let forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .unwrap()
        .unwrap();
    let OutboundMsg::Frame(Frame::InstanceForward(forward)) = forward else {
        panic!("expected prompt forward")
    };
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

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if env
                .projects
                .catalog()
                .get("acp-1")
                .await
                .is_some_and(|session| {
                    session.hub_title.as_deref() == Some("修复 session catalog 标题")
                })
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("prompt title should be projected after forward acknowledgement");
}

#[tokio::test]
async fn in_flight_prompt_replay_is_accepted_observer_not_false_duplicate() {
    let env = env().await;
    bound_session(&env, S1, "acp-1").await;
    let (tx, rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();

    let first = env
        .coordinator
        .submit(&ctx("c"), prompt_action(&cid, S1), tx.clone())
        .await;
    assert!(matches!(first, SubmitAck::Accepted { .. }), "{first:?}");
    // 二次提交同 commandId attaches to the one in-flight execution. It is
    // nonterminal Accepted, never a false committed/duplicate claim.
    let second = env
        .coordinator
        .submit(&ctx("c"), prompt_action(&cid, S1), tx.clone())
        .await;
    assert!(matches!(
        second,
        SubmitAck::Accepted { ref command_id } if command_id == &cid
    ));
    drop(tx);
    drop(rx);
}

#[tokio::test]
async fn in_memory_unknown_verdict_prevents_observer_hang_when_terminal_append_failed() {
    let env = env().await;
    bound_session(&env, S1, "acp-1").await;
    let cid = uuid::Uuid::new_v4();
    let action = prompt_action(&cid.to_string(), S1);
    let store = env.store.chat(uuid::Uuid::parse_str(S1).unwrap()).unwrap();
    store
        .outbox()
        .lock()
        .await
        .insert(NewOutboxRecord {
            command_id: cid,
            chat_id: uuid::Uuid::parse_str(S1).unwrap(),
            command_type: CommandType::Prompt,
            turn_id: Some(uuid::Uuid::new_v4()),
            retryable_class: RetryableClass::NoAutoRedeliver,
        })
        .unwrap();
    store.outbox().lock().await.mark_accepted(cid).unwrap();
    let fingerprint = match &action {
        ActionEnvelope::Prompt { payload, .. } => {
            crate::channel::command_identity::prompt_payload_fingerprint(payload).unwrap()
        }
        _ => unreachable!(),
    };
    store
        .outbox()
        .lock()
        .await
        .set_prompt_payload_fingerprint(cid, fingerprint)
        .unwrap();

    let (first_tx, mut first_rx) = mpsc::channel(4);
    let cmd = crate::channel::ExecCmd {
        ctx: ctx("original"),
        chat_id: S1.into(),
        action: action.clone(),
        tx: first_tx,
    };
    env.coordinator
        .send_error(
            &cmd,
            ErrorCode::DeliveryUnknown,
            "durable terminal append failed",
            false,
        )
        .await;
    assert!(matches!(
        first_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionError(ref error)))
            if error.code == ErrorCode::DeliveryUnknown
    ));

    let (retry_tx, _retry_rx) = mpsc::channel(4);
    let replay = env
        .coordinator
        .submit(&ctx("retry"), action, retry_tx)
        .await;
    assert!(matches!(
        replay,
        SubmitAck::Failed(ref error) if error.code == ErrorCode::DeliveryUnknown
    ));
}

#[tokio::test]
async fn queue_full_rate_limited() {
    let env = env().await;
    bound_session(&env, S2, "acp-2").await;
    let (tx, _rx) = mpsc::channel(16);
    // 占满队列名额（§7.4 规则 1：try_reserve 上限 64，不提交则不释放）。
    for _ in 0..64 {
        assert!(env.doc.try_reserve(S2).await, "应能占满 64 名额");
    }
    // 第 65 次提交 → try_reserve 失败 → RATE_LIMITED。
    let cid65 = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), prompt_action(&cid65, S2), tx.clone())
        .await;
    match r {
        SubmitAck::Failed(e) => assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::RateLimited),
        other => panic!("expected rate limited, got {other:?}"),
    }
}

#[tokio::test]
async fn serial_execution_order() {
    let mut env = env().await;
    bound_session(&env, S3, "acp-3").await;
    let (tx, _rx) = mpsc::channel(16);
    // 串行提交 6 条 prompt（< 64 规避 F4 in_flight 缺口）。
    let mut cids = Vec::new();
    for _ in 0..6 {
        let cid = uuid::Uuid::new_v4().to_string();
        cids.push(cid.clone());
        let r = env
            .coordinator
            .submit(&ctx("c"), prompt_action(&cid, S3), tx.clone())
            .await;
        assert!(matches!(r, SubmitAck::Accepted { .. }));
    }
    // instance 侧收到的 forward 顺序 = 提交顺序（§7.4 规则 1 串行）。
    // 每条 forward 帧回 ack（L1+L2 确认）否则 forward_rpc 阻塞 200ms 超时。
    let mut seen = Vec::new();
    for _ in 0..6 {
        match tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv()).await {
            Ok(Some(OutboundMsg::Frame(Frame::InstanceForward(f)))) => {
                seen.push(f.frame["id"].as_str().unwrap().to_string());
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
    }
    // 6 条 prompt 的 rpc id 单调（hub-N）。
    assert_eq!(seen.len(), 6);
    let mut sorted = seen.clone();
    sorted.sort();
    assert_eq!(
        seen, sorted,
        "rpc ids should be monotonic (serial execution)"
    );
}
