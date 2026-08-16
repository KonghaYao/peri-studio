//! CommandOutcomeBroker observer 附加/隔离测试（command_outcome_broker_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 997 行超 500 行阈值，按「broker 职责」分主题。
//!
//! 职责边界：本模块只覆盖 observer 附加生命周期——替换附加仅一次 committed、
//! 同通道附加幂等、原通道关闭不抑制错误 fan-out、同 command uuid 按
//! chat/无 chat 发布隔离。基础契约（指纹/持久化状态机/存储降级）、fallback
//! 重放、permission recovery 重新分类、容量溢出分属其他模块。
use super::*;
#[tokio::test]
async fn attached_replacement_receives_committed_once_after_original() {
    let env = env();
    let command_id = Uuid::new_v4();
    seed_accepted(&env, command_id).await;
    let action = close_action(command_id, env.chat_id);
    let (observer_tx, mut observer_rx) = mpsc::channel(4);
    assert!(matches!(
        env.broker
            .adjudicate_existing(request(&env, command_id, &action, observer_tx))
            .await,
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Accepted { .. })
    ));

    let (original_tx, mut original_rx) = mpsc::channel(4);
    env.broker
        .publish_terminal(TerminalPublication {
            command_id_text: &command_id.to_string(),
            chat_id: Some(env.chat_id),
            original: &original_tx,
            outcome: TerminalOutcome::Committed {
                turn_id: None,
                chat_id: None,
            },
        })
        .await;

    for message in [original_rx.recv().await, observer_rx.recv().await] {
        assert!(matches!(
            message,
            Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
                if ack.status == AckStatus::Committed && ack.command_id == command_id.to_string()
        ));
    }
    assert!(!matches!(
        tokio::time::timeout(Duration::from_millis(20), observer_rx.recv()).await,
        Ok(Some(_))
    ));
}

#[tokio::test]
async fn same_channel_attachment_is_idempotent() {
    let env = env();
    let command_id = Uuid::new_v4();
    seed_accepted(&env, command_id).await;
    let action = close_action(command_id, env.chat_id);
    let (observer_tx, mut observer_rx) = mpsc::channel(4);
    for _ in 0..2 {
        assert!(matches!(
            env.broker
                .adjudicate_existing(request(&env, command_id, &action, observer_tx.clone(),))
                .await,
            ExistingCommandDisposition::Respond(ExistingCommandResponse::Accepted { .. })
        ));
    }

    let (original_tx, _original_rx) = mpsc::channel(4);
    env.broker
        .publish_terminal(TerminalPublication {
            command_id_text: &command_id.to_string(),
            chat_id: Some(env.chat_id),
            original: &original_tx,
            outcome: TerminalOutcome::Committed {
                turn_id: None,
                chat_id: None,
            },
        })
        .await;
    assert!(observer_rx.recv().await.is_some());
    assert!(
        tokio::time::timeout(Duration::from_millis(20), observer_rx.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn closed_original_does_not_suppress_error_fanout() {
    let env = env();
    let command_id = Uuid::new_v4();
    seed_accepted(&env, command_id).await;
    let action = close_action(command_id, env.chat_id);
    let (observer_tx, mut observer_rx) = mpsc::channel(4);
    assert!(matches!(
        env.broker
            .adjudicate_existing(request(&env, command_id, &action, observer_tx))
            .await,
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Accepted { .. })
    ));

    let (original_tx, original_rx) = mpsc::channel(1);
    drop(original_rx);
    let error = action_error(
        &command_id.to_string(),
        ErrorCode::InvalidState,
        "definite failure",
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
        observer_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionError(ref sent))) if sent == &error
    ));
}

#[tokio::test]
async fn same_command_uuid_is_isolated_by_chat_and_chatless_publication() {
    let env = env();
    let command_id = Uuid::new_v4();
    seed_accepted(&env, command_id).await;
    let action = close_action(command_id, env.chat_id);
    let (observer_tx, mut observer_rx) = mpsc::channel(4);
    assert!(matches!(
        env.broker
            .adjudicate_existing(request(&env, command_id, &action, observer_tx))
            .await,
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Accepted { .. })
    ));

    let other_chat = Uuid::new_v4();
    let (other_tx, mut other_rx) = mpsc::channel(2);
    env.broker
        .publish_terminal(TerminalPublication {
            command_id_text: &command_id.to_string(),
            chat_id: Some(other_chat),
            original: &other_tx,
            outcome: TerminalOutcome::Committed {
                turn_id: None,
                chat_id: None,
            },
        })
        .await;
    assert!(other_rx.recv().await.is_some());
    assert!(
        tokio::time::timeout(Duration::from_millis(20), observer_rx.recv())
            .await
            .is_err()
    );

    let (chatless_tx, mut chatless_rx) = mpsc::channel(2);
    env.broker
        .publish_terminal(TerminalPublication {
            command_id_text: &command_id.to_string(),
            chat_id: None,
            original: &chatless_tx,
            outcome: TerminalOutcome::Committed {
                turn_id: None,
                chat_id: None,
            },
        })
        .await;
    assert!(chatless_rx.recv().await.is_some());
    assert!(
        tokio::time::timeout(Duration::from_millis(20), observer_rx.recv())
            .await
            .is_err()
    );

    let (original_tx, _original_rx) = mpsc::channel(2);
    env.broker
        .publish_terminal(TerminalPublication {
            command_id_text: &command_id.to_string(),
            chat_id: Some(env.chat_id),
            original: &original_tx,
            outcome: TerminalOutcome::Committed {
                turn_id: None,
                chat_id: None,
            },
        })
        .await;
    assert!(observer_rx.recv().await.is_some());
}
