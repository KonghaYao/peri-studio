//! CommandCoordinator cancel 抢占主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：cancel 通知路径测试已接近阈值；§7.4 规则 2 的抢占契约单独成
//! 文件，避免与既有 unknown/retry 路径混杂。
//!
//! 职责边界：active prompt 等待 L3 时同一执行器可优先消费 cancel；cancel
//! 不得越过尚未 dispatch 的 prompt；优先窗口关闭后后续 cancel 不得越过更早
//! 的普通命令。公共 helper 见 command_coordinator_test_util。
use super::*;

/// cancel 是 active prompt 的中断控制，不得排在等待 L3 终态的 prompt 后。
#[tokio::test]
async fn cancel_interrupts_prompt_before_prompt_terminal() {
    let mut env = env().await;
    bound_session(&env, S5, "acp-cancel-active-prompt").await;

    let (prompt_tx, mut prompt_rx) = mpsc::channel(16);
    let prompt_command_id = uuid::Uuid::new_v4().to_string();
    let submitted = env
        .coordinator
        .submit(
            &ctx("prompt-before-cancel"),
            prompt_action(&prompt_command_id, S5),
            prompt_tx,
        )
        .await;
    assert!(
        matches!(submitted, SubmitAck::Accepted { .. }),
        "{submitted:?}"
    );

    let prompt_forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("prompt forward received")
        .expect("instance channel alive");
    let prompt_forward = match prompt_forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected prompt forward, got {other:?}"),
    };
    assert_eq!(prompt_forward.frame["method"], "session/prompt");
    env.instance
        .on_ack(
            "local",
            &prompt_forward.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: prompt_forward.command_id.clone(),
                chat_id: prompt_forward.chat_id.clone(),
                ok: true,
                error: None,
            }),
        )
        .await;

    tokio::time::timeout(Duration::from_secs(2), async {
        while env.chats.active_turn(S5).await.is_none() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("prompt registered an active turn");

    // 持续刷新 prompt 活动窗口，确保测试观察到的是 cancel 抢占，而不是 prompt
    // 先因测试环境的短 L3 timeout 自然退出后普通 FIFO 才继续执行。
    let chats = env.chats.clone();
    let keep_active = tokio::spawn(async move {
        loop {
            chats.touch_active_turn(S5).await;
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    });

    let (close_tx, mut close_rx) = mpsc::channel(16);
    let close_command_id = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        env.coordinator
            .submit(
                &ctx("close-behind-prompt"),
                ActionEnvelope::Close {
                    command_id: close_command_id,
                    payload: peri_studio_proto::action::CloseChatPayload { chat_id: S5.into() },
                },
                close_tx,
            )
            .await,
        SubmitAck::Accepted { .. }
    ));

    let (cancel_tx, mut cancel_rx) = mpsc::channel(16);
    let cancel_command_id = uuid::Uuid::new_v4().to_string();
    let submitted = env
        .coordinator
        .submit(
            &ctx("cancel-active-prompt"),
            ActionEnvelope::Cancel {
                command_id: cancel_command_id.clone(),
                payload: peri_studio_proto::action::CancelChatPayload { chat_id: S5.into() },
            },
            cancel_tx,
        )
        .await;
    assert!(
        matches!(submitted, SubmitAck::Accepted { .. }),
        "{submitted:?}"
    );
    let (second_cancel_tx, mut second_cancel_rx) = mpsc::channel(16);
    let second_cancel_command_id = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        env.coordinator
            .submit(
                &ctx("second-cancel-active-prompt"),
                ActionEnvelope::Cancel {
                    command_id: second_cancel_command_id.clone(),
                    payload: peri_studio_proto::action::CancelChatPayload { chat_id: S5.into() },
                },
                second_cancel_tx,
            )
            .await,
        SubmitAck::Accepted { .. }
    ));

    let cancel_forward =
        tokio::time::timeout(Duration::from_millis(250), env.instance_rx.recv()).await;
    keep_active.abort();
    let cancel_forward = cancel_forward
        .expect("cancel must bypass the active prompt executor")
        .expect("instance channel alive");
    let cancel_forward = match cancel_forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected cancel forward, got {other:?}"),
    };
    assert_eq!(cancel_forward.command_id, cancel_command_id);
    assert_eq!(cancel_forward.frame["method"], "session/cancel");
    assert!(
        prompt_rx.try_recv().is_err(),
        "prompt must remain active until cancel is delivered"
    );

    env.instance
        .on_ack(
            "local",
            &cancel_forward.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: cancel_forward.command_id.clone(),
                chat_id: cancel_forward.chat_id.clone(),
                ok: true,
                error: None,
            }),
        )
        .await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), cancel_rx.recv()).await,
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))))
            if ack.status == AckStatus::Committed
    ));
    assert!(matches!(
        tokio::time::timeout(Duration::from_millis(250), prompt_rx.recv()).await,
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))))
            if ack.status == AckStatus::Committed
    ));
    assert!(env.chats.active_turn(S5).await.is_none());

    let close = tokio::time::timeout(Duration::from_millis(250), env.instance_rx.recv())
        .await
        .expect("deferred close must resume after the prompt terminal")
        .expect("instance channel alive");
    let close = match close {
        OutboundMsg::Frame(Frame::InstanceKill(kill)) => kill,
        other => panic!("deferred FIFO must run close before the second cancel, got {other:?}"),
    };
    assert!(
        second_cancel_rx.try_recv().is_err(),
        "a second cancel must not continue bypassing the older deferred close"
    );
    env.instance
        .on_ack(
            "local",
            &close.command_id,
            InstanceAck::Kill(peri_studio_proto::instance::InstanceKillAck {
                command_id: close.command_id.clone(),
                chat_id: S5.into(),
                ok: true,
            }),
        )
        .await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), close_rx.recv()).await,
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))))
            if ack.status == AckStatus::Committed
    ));
    let second_cancel = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("second cancel may run only after the deferred close")
        .expect("instance channel alive");
    let second_cancel = match second_cancel {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected second cancel forward, got {other:?}"),
    };
    assert_eq!(second_cancel.command_id, second_cancel_command_id);
    assert_eq!(second_cancel.frame["method"], "session/cancel");
    env.instance
        .on_ack(
            "local",
            &second_cancel.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: second_cancel.command_id.clone(),
                chat_id: S5.into(),
                ok: true,
                error: None,
            }),
        )
        .await;
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), second_cancel_rx.recv()).await,
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))))
            if ack.status == AckStatus::Committed
    ));
}

/// dispatch 完成前执行器仍被 prompt 占用；queued cancel 不得先写入 ACP。
#[tokio::test]
async fn cancel_does_not_overtake_undispatched_prompt() {
    let mut env = env().await;
    bound_session(&env, S5, "acp-cancel-before-dispatch").await;

    let (prompt_tx, mut prompt_rx) = mpsc::channel(16);
    let prompt_command_id = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        env.coordinator
            .submit(
                &ctx("prompt-before-dispatch"),
                prompt_action(&prompt_command_id, S5),
                prompt_tx,
            )
            .await,
        SubmitAck::Accepted { .. }
    ));

    let prompt_forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("prompt forward received")
        .expect("instance channel alive");
    let prompt_forward = match prompt_forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected prompt forward, got {other:?}"),
    };
    assert_eq!(prompt_forward.frame["method"], "session/prompt");

    let (cancel_tx, mut cancel_rx) = mpsc::channel(16);
    let cancel_command_id = uuid::Uuid::new_v4().to_string();
    assert!(matches!(
        env.coordinator
            .submit(
                &ctx("cancel-before-dispatch"),
                ActionEnvelope::Cancel {
                    command_id: cancel_command_id.clone(),
                    payload: peri_studio_proto::action::CancelChatPayload { chat_id: S5.into() },
                },
                cancel_tx,
            )
            .await,
        SubmitAck::Accepted { .. }
    ));
    assert!(
        tokio::time::timeout(Duration::from_millis(150), env.instance_rx.recv())
            .await
            .is_err(),
        "cancel must not overtake a prompt that has not finished dispatch"
    );
    assert!(env.chats.active_turn(S5).await.is_none());
    assert!(prompt_rx.try_recv().is_err());
    assert!(cancel_rx.try_recv().is_err());

    env.instance
        .on_ack(
            "local",
            &prompt_forward.command_id,
            InstanceAck::Forward(InstanceForwardAck {
                command_id: prompt_forward.command_id.clone(),
                chat_id: prompt_forward.chat_id.clone(),
                ok: true,
                error: None,
            }),
        )
        .await;

    let cancel_forward = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("cancel may run only after the prompt is dispatched")
        .expect("instance channel alive");
    let cancel_forward = match cancel_forward {
        OutboundMsg::Frame(Frame::InstanceForward(forward)) => forward,
        other => panic!("expected cancel forward after prompt dispatch, got {other:?}"),
    };
    assert_eq!(cancel_forward.command_id, cancel_command_id);
    assert_eq!(cancel_forward.frame["method"], "session/cancel");
}
