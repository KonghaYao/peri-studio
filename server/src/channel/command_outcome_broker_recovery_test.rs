//! CommandOutcomeBroker permission recovery 重新分类测试
//! （command_outcome_broker_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 997 行超 500 行阈值，按「broker 职责」分主题。
//!
//! 职责边界：本模块只覆盖 PermissionResponse recovery 的重新分类——决策已
//! 清除时重读改判 completed / delivery_unknown。主题专属铺设
//! seed_permission_recovery 随本模块保留；observer 附加、fallback 重放、
//! 基础契约、容量溢出分属其他模块。
use super::*;
async fn seed_permission_recovery(env: &TestEnv, command_id: Uuid) -> ActionEnvelope {
    let permission_id = "permission-race".to_string();
    let chat = env.store.chat(env.chat_id).unwrap();
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
                request_id: serde_json::json!("request-race"),
                options: Vec::new(),
                decision: PermissionDecision::Allow,
                option_id: None,
            },
        )
        .unwrap();
    drop(outbox);

    ActionEnvelope::ResolvePermission {
        command_id: command_id.to_string(),
        payload: ResolvePermissionPayload {
            chat_id: env.chat_id.to_string(),
            permission_id,
            decision: PermissionDecision::Allow,
            option_id: None,
        },
    }
}

#[tokio::test]
async fn locked_reread_reclassifies_cleared_permission_recovery_as_completed() {
    let env = env();
    let command_id = Uuid::new_v4();
    let action = seed_permission_recovery(&env, command_id).await;
    let (reached, resume) = env.broker.install_fallback_check_barrier().await;
    let (observer_tx, _observer_rx) = mpsc::channel(4);
    let retry_broker = env.broker.clone();
    let chat_id = env.chat_id;
    let retry = tokio::spawn(async move {
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

    let chat = env.store.chat(env.chat_id).unwrap();
    let mut outbox = chat.outbox().lock().await;
    let now = chrono::Utc::now();
    outbox.mark_no_redelivery_barrier(command_id, now).unwrap();
    outbox.mark_dispatched(command_id, now).unwrap();
    outbox.mark_delivery_confirmed(command_id).unwrap();
    outbox.clear_recovery(command_id).unwrap();
    outbox.mark_projection_committed(command_id).unwrap();
    outbox.mark_completed(command_id).unwrap();
    drop(outbox);
    resume.send(()).unwrap();

    assert!(matches!(
        retry.await.unwrap(),
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Duplicate(_))
    ));
}

#[tokio::test]
async fn locked_reread_reclassifies_cleared_permission_recovery_as_delivery_unknown() {
    let env = env();
    let command_id = Uuid::new_v4();
    let action = seed_permission_recovery(&env, command_id).await;
    let (reached, resume) = env.broker.install_fallback_check_barrier().await;
    let (observer_tx, _observer_rx) = mpsc::channel(4);
    let retry_broker = env.broker.clone();
    let chat_id = env.chat_id;
    let retry = tokio::spawn(async move {
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

    let chat = env.store.chat(env.chat_id).unwrap();
    let mut outbox = chat.outbox().lock().await;
    let now = chrono::Utc::now();
    outbox.mark_no_redelivery_barrier(command_id, now).unwrap();
    outbox.mark_dispatched(command_id, now).unwrap();
    outbox.mark_delivery_confirmed(command_id).unwrap();
    outbox.clear_recovery(command_id).unwrap();
    outbox.mark_delivery_unknown(command_id).unwrap();
    drop(outbox);
    resume.send(()).unwrap();

    assert!(matches!(
        retry.await.unwrap(),
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(ref error))
            if error.code == ErrorCode::DeliveryUnknown
    ));
}
