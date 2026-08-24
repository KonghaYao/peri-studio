//! CommandOutcomeBroker durable fallback/重放测试（command_outcome_broker_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 997 行超 500 行阈值，按「broker 职责」分主题。
//!
//! 职责边界：本模块只覆盖 durable 缺失时的 fallback 语义——fallback 抢占
//! permission recovery、missing publisher 先重放不搁浅 observer、重试附加
//! 临界区、tombstone 重读改走 fallback。observer 附加生命周期、基础契约、
//! permission recovery 重新分类、容量溢出分属其他模块。
use super::*;
#[tokio::test]
async fn missing_durable_fallback_preempts_permission_recovery() {
    let env = env();
    let command_id = Uuid::new_v4();
    let permission_id = "permission-1".to_string();
    let chat = env.store.chat(env.chat_id).unwrap();
    {
        let mut outbox = chat.outbox().lock().await;
        outbox
            .insert(NewOutboxRecord {
                command_id,
                chat_id: env.chat_id,
                command_type: CommandType::Resolve,
                turn_id: None,
                retryable_class: RetryableClass::NoAutoRedeliver,
            })
            .unwrap();
        outbox.mark_accepted(command_id).unwrap();
        outbox.mark_intent_durable(command_id).unwrap();
        outbox
            .set_recovery(
                command_id,
                CommandRecovery::PermissionResponse {
                    permission_id: permission_id.clone(),
                    request_id: serde_json::json!("request-1"),
                    options: Vec::new(),
                    decision: PermissionDecision::Allow,
                    option_id: None,
                },
            )
            .unwrap();
    }
    let fallback = action_error(
        &command_id.to_string(),
        ErrorCode::DeliveryUnknown,
        "permission terminal append failed",
        false,
    );
    let (original_tx, _original_rx) = mpsc::channel(2);
    env.broker
        .publish_terminal(TerminalPublication {
            command_id_text: &command_id.to_string(),
            chat_id: Some(env.chat_id),
            original: &original_tx,
            outcome: TerminalOutcome::Error(fallback.clone()),
        })
        .await;

    let action = ActionEnvelope::ResolvePermission {
        command_id: command_id.to_string(),
        payload: ResolvePermissionPayload {
            chat_id: env.chat_id.to_string(),
            permission_id,
            decision: PermissionDecision::Allow,
            option_id: None,
        },
    };
    let (retry_tx, _retry_rx) = mpsc::channel(2);
    match env
        .broker
        .adjudicate_existing(request(&env, command_id, &action, retry_tx))
        .await
    {
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(error)) => {
            assert_eq!(error, fallback)
        }
        other => panic!("fallback must preempt permission resume, got {other:?}"),
    }
}

#[tokio::test]
async fn missing_durable_publisher_first_replays_instead_of_stranding_observer() {
    let env = env();
    let command_id = Uuid::new_v4();
    seed_accepted(&env, command_id).await;

    let (original_tx, mut original_rx) = mpsc::channel(4);
    let error = action_error(
        &command_id.to_string(),
        ErrorCode::DeliveryUnknown,
        "terminal append failed",
        false,
    );
    env.broker
        .publish_terminal(TerminalPublication {
            command_id_text: &command_id.to_string(),
            chat_id: Some(env.chat_id),
            original: &original_tx,
            outcome: TerminalOutcome::Error(error.clone()),
        })
        .await;
    assert!(matches!(
        original_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionError(ref sent))) if sent == &error
    ));

    let action = close_action(command_id, env.chat_id);
    let (observer_tx, _observer_rx) = mpsc::channel(4);
    match env
        .broker
        .adjudicate_existing(request(&env, command_id, &action, observer_tx))
        .await
    {
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(replayed)) => {
            assert_eq!(replayed, error)
        }
        other => panic!("fallback must replay synchronously, got {other:?}"),
    }
    assert!(
        !env.broker
            .state
            .lock()
            .await
            .observers
            .contains_key(&key(env.chat_id, command_id)),
        "publisher-first fallback must not leave a future observer"
    );
}

#[tokio::test]
async fn fallback_publication_cannot_cross_the_retry_attach_critical_section() {
    let env = env();
    let command_id = Uuid::new_v4();
    seed_accepted(&env, command_id).await;
    let (reached, resume) = env.broker.install_fallback_check_barrier().await;
    let (observer_tx, mut observer_rx) = mpsc::channel(4);
    let retry_broker = env.broker.clone();
    let chat_id = env.chat_id;
    let retry = tokio::spawn(async move {
        let action = close_action(command_id, chat_id);
        let command_id_text = command_id.to_string();
        retry_broker
            .adjudicate_existing(ExistingCommandRequest {
                chat_id,
                command_id,
                command_id_text: &command_id_text,
                action: &action,
                observer: observer_tx,
                duplicate_chat_id: None,
            })
            .await
    });
    reached
        .await
        .expect("retry reached fallback/attach barrier");

    let fallback = action_error(
        &command_id.to_string(),
        ErrorCode::DeliveryUnknown,
        "terminal append failed",
        false,
    );
    let publish_broker = env.broker.clone();
    let (original_tx, mut original_rx) = mpsc::channel(4);
    let expected = fallback.clone();
    let mut publish = tokio::spawn(async move {
        let command_id_text = command_id.to_string();
        publish_broker
            .publish_terminal(TerminalPublication {
                command_id_text: &command_id_text,
                chat_id: Some(chat_id),
                original: &original_tx,
                outcome: TerminalOutcome::Error(expected),
            })
            .await;
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut publish)
            .await
            .is_err(),
        "publisher must wait while retry owns the shared outcome critical section"
    );

    resume.send(()).unwrap();
    assert!(matches!(
        retry.await.unwrap(),
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Accepted { .. })
    ));
    publish.await.unwrap();
    assert!(matches!(
        original_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionError(ref error))) if error == &fallback
    ));
    assert!(matches!(
        observer_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionError(ref error))) if error == &fallback
    ));
}

#[tokio::test]
async fn locked_reread_tombstone_proceeds_instead_of_attaching() {
    let env = env();
    let command_id = Uuid::new_v4();
    seed_accepted(&env, command_id).await;
    let (reached, resume) = env.broker.install_fallback_check_barrier().await;
    let (observer_tx, _observer_rx) = mpsc::channel(4);
    let retry_broker = env.broker.clone();
    let chat_id = env.chat_id;
    let retry = tokio::spawn(async move {
        let action = close_action(command_id, chat_id);
        let command_id_text = command_id.to_string();
        retry_broker
            .adjudicate_existing(ExistingCommandRequest {
                chat_id,
                command_id,
                command_id_text: &command_id_text,
                action: &action,
                observer: observer_tx,
                duplicate_chat_id: None,
            })
            .await
    });
    reached.await.expect("retry reached locked reread barrier");

    env.store
        .chat(env.chat_id)
        .unwrap()
        .outbox()
        .lock()
        .await
        .mark_failed(
            command_id,
            LastError::from_error_code(ErrorCode::AgentUnavailable),
        )
        .unwrap();
    resume.send(()).unwrap();
    assert!(matches!(
        retry.await.unwrap(),
        ExistingCommandDisposition::ProceedNew
    ));
    assert!(!env
        .broker
        .state
        .lock()
        .await
        .observers
        .contains_key(&key(env.chat_id, command_id)));
}
