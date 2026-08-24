//! ChatChannel 单测（设计稿 §16 测试 20–21 的纯逻辑部分：首帧纪律、
//! ready 前缓冲、订阅状态；gateway ws 集成在 gateway_test）。

use std::sync::Arc;

use tokio::sync::mpsc;

use peri_studio_proto::action::PromptChatPayload;
use peri_studio_proto::conn::DocId;
use peri_studio_proto::frame::Frame;
use peri_studio_proto::ysync::{YsyncSubscribe, YsyncUnsubscribe};

use crate::auth::TokenRole;
use crate::channel::{ChannelDeps, ChatChannel, DispatchOutcome};

use super::chat_channel_test_support::{ctx, env};

#[tokio::test]
async fn first_frame_must_be_subscribe_or_action() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    let mut ch = ChatChannel::new(ctx("c"));
    let (tx, _rx) = mpsc::channel(8);
    // 首帧 pong → 断开（1011）。
    let o = ch
        .dispatch(
            Frame::Pong(peri_studio_proto::conn::Pong {}),
            &deps,
            tx.clone(),
        )
        .await;
    assert!(matches!(o, DispatchOutcome::Disconnect(1011)));
    // 新连接：首帧 auth 类（S→C 帧）→ 断开。
    let mut ch2 = ChatChannel::new(ctx("c"));
    let o = ch2
        .dispatch(
            Frame::KeepAlive(peri_studio_proto::conn::KeepAlive {}),
            &deps,
            tx,
        )
        .await;
    assert!(matches!(o, DispatchOutcome::Disconnect(1011)));
}

#[tokio::test]
async fn action_buffered_before_ready_and_flushed() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    let mut ch = ChatChannel::new(ctx("c"));
    let (tx, _rx) = mpsc::channel(8);
    let action = Frame::Action(peri_studio_proto::action::ActionEnvelope::Prompt {
        command_id: uuid::Uuid::new_v4().to_string(),
        payload: PromptChatPayload {
            chat_id: "s1".into(),
            message: "hi".into(),
            effort: None,
        },
    });
    // ready 前：缓冲不处理。
    let o = ch.dispatch(action.clone(), &deps, tx.clone()).await;
    assert!(matches!(o, DispatchOutcome::None));
    assert_eq!(ch.pending_len(), 1);
    assert!(!ch.is_ready());
    // mark_ready → flush 缓冲。
    let flushed = ch.mark_ready();
    assert_eq!(flushed.len(), 1);
    assert!(ch.is_ready());
}

#[tokio::test]
async fn buffer_overflow_rate_limited() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    let mut ch = ChatChannel::new(ctx("c"));
    let (tx, _rx) = mpsc::channel(8);
    // 65 个 action（缓冲上限 64，§4.6）。
    for i in 0..64 {
        let action = Frame::Action(peri_studio_proto::action::ActionEnvelope::Prompt {
            command_id: uuid::Uuid::new_v4().to_string(),
            payload: PromptChatPayload {
                chat_id: "s1".into(),
                message: format!("m{i}"),
                effort: None,
            },
        });
        ch.dispatch(action, &deps, tx.clone()).await;
    }
    let overflow = Frame::Action(peri_studio_proto::action::ActionEnvelope::Prompt {
        command_id: uuid::Uuid::new_v4().to_string(),
        payload: PromptChatPayload {
            chat_id: "s1".into(),
            message: "overflow".into(),
            effort: None,
        },
    });
    let o = ch.dispatch(overflow, &deps, tx.clone()).await;
    match o {
        DispatchOutcome::Send(msgs) => {
            assert_eq!(msgs.len(), 1);
            match &msgs[0] {
                crate::channel::OutboundMsg::Frame(Frame::ActionError(e)) => {
                    assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::RateLimited)
                }
                other => panic!("expected action_error, got {other:?}"),
            }
        }
        other => panic!("expected send, got {other:?}"),
    }
}

#[tokio::test]
async fn subscribe_first_and_second() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    let mut ch = ChatChannel::new(ctx("c"));
    let (tx, _rx) = mpsc::channel(8);
    let sub1 = Frame::YsyncSubscribe(YsyncSubscribe {
        docs: vec![DocId::chat("s1")],
        client_capabilities: Vec::new(),
    });
    match ch.dispatch(sub1, &deps, tx.clone()).await {
        DispatchOutcome::Subscribe { first, docs } => {
            assert!(first);
            assert_eq!(docs.len(), 1);
        }
        other => panic!("expected subscribe, got {other:?}"),
    }
    // 二次订阅：非 first。
    let sub2 = Frame::YsyncSubscribe(YsyncSubscribe {
        docs: vec![DocId::chat("s2")],
        client_capabilities: Vec::new(),
    });
    match ch.dispatch(sub2, &deps, tx.clone()).await {
        DispatchOutcome::Subscribe { first, .. } => assert!(!first),
        other => panic!("expected subscribe, got {other:?}"),
    }
    // 退订。
    let unsub = Frame::YsyncUnsubscribe(YsyncUnsubscribe {
        docs: vec![DocId::chat("s1")],
    });
    match ch.dispatch(unsub, &deps, tx).await {
        DispatchOutcome::Unsubscribe { docs } => assert_eq!(docs.len(), 1),
        other => panic!("expected unsubscribe, got {other:?}"),
    }
}

#[tokio::test]
async fn prompt_delivery_capability_is_connection_bound_and_fail_closed() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    let prompt = || {
        Frame::Action(peri_studio_proto::action::ActionEnvelope::Prompt {
            command_id: uuid::Uuid::new_v4().to_string(),
            payload: PromptChatPayload {
                chat_id: "missing-chat".into(),
                message: "must not dispatch".into(),
                effort: None,
            },
        })
    };
    let (tx, _rx) = mpsc::channel(8);

    let mut legacy = ChatChannel::new(ctx("legacy"));
    legacy
        .dispatch(
            Frame::YsyncSubscribe(YsyncSubscribe {
                docs: vec![DocId::REGISTRY],
                client_capabilities: Vec::new(),
            }),
            &deps,
            tx.clone(),
        )
        .await;
    legacy.mark_ready();
    assert!(matches!(
        legacy.dispatch(prompt(), &deps, tx.clone()).await,
        DispatchOutcome::Disconnect(4502)
    ));

    let mut empty_first = ChatChannel::new(ctx("empty-first"));
    empty_first
        .dispatch(
            Frame::YsyncSubscribe(YsyncSubscribe {
                docs: Vec::new(),
                client_capabilities: Vec::new(),
            }),
            &deps,
            tx.clone(),
        )
        .await;
    empty_first
        .dispatch(
            Frame::YsyncSubscribe(YsyncSubscribe {
                docs: vec![DocId::REGISTRY],
                client_capabilities: vec![
                    peri_studio_proto::ysync::CAP_PROMPT_DELIVERY_V2.to_string()
                ],
            }),
            &deps,
            tx.clone(),
        )
        .await;
    assert!(empty_first.negotiated_capabilities().is_empty());
    empty_first.mark_ready();
    assert!(matches!(
        empty_first.dispatch(prompt(), &deps, tx.clone()).await,
        DispatchOutcome::Disconnect(4502)
    ));

    let mut unsubscribe_all = ChatChannel::new(ctx("unsubscribe-all"));
    unsubscribe_all
        .dispatch(
            Frame::YsyncSubscribe(YsyncSubscribe {
                docs: vec![DocId::REGISTRY],
                client_capabilities: Vec::new(),
            }),
            &deps,
            tx.clone(),
        )
        .await;
    unsubscribe_all
        .dispatch(
            Frame::YsyncUnsubscribe(peri_studio_proto::ysync::YsyncUnsubscribe {
                docs: vec![DocId::REGISTRY],
            }),
            &deps,
            tx.clone(),
        )
        .await;
    unsubscribe_all
        .dispatch(
            Frame::YsyncSubscribe(YsyncSubscribe {
                docs: vec![DocId::REGISTRY],
                client_capabilities: vec![
                    peri_studio_proto::ysync::CAP_PROMPT_DELIVERY_V2.to_string()
                ],
            }),
            &deps,
            tx.clone(),
        )
        .await;
    assert!(unsubscribe_all.negotiated_capabilities().is_empty());

    let mut current = ChatChannel::new(ctx("current"));
    current
        .dispatch(
            Frame::YsyncSubscribe(YsyncSubscribe {
                docs: vec![DocId::REGISTRY],
                client_capabilities: vec![
                    peri_studio_proto::ysync::CAP_PROMPT_DELIVERY_V2.to_string(),
                    "untrusted-future-capability".to_string(),
                ],
            }),
            &deps,
            tx.clone(),
        )
        .await;
    assert_eq!(
        current.negotiated_capabilities(),
        vec![peri_studio_proto::ysync::CAP_PROMPT_DELIVERY_V2.to_string()]
    );
    current.mark_ready();
    assert!(!matches!(
        current.dispatch(prompt(), &deps, tx).await,
        DispatchOutcome::Disconnect(4502)
    ));
}

#[tokio::test]
async fn upstream_ysync_update_rejected() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    let mut ch = ChatChannel::new(ctx("c"));
    let (tx, _rx) = mpsc::channel(8);
    // 先合法订阅（首帧纪律），再上行 update → UNSUPPORTED_FRAME（§5.6）。
    ch.dispatch(
        Frame::YsyncSubscribe(YsyncSubscribe {
            docs: vec![DocId::REGISTRY],
            client_capabilities: Vec::new(),
        }),
        &deps,
        tx.clone(),
    )
    .await;
    let o = ch
        .dispatch(
            Frame::YsyncUpdate(peri_studio_proto::ysync::YsyncUpdate {
                doc: DocId::REGISTRY,
                update: "AAAA".into(),
                projection_version: None,
            }),
            &deps,
            tx.clone(),
        )
        .await;
    match o {
        DispatchOutcome::Send(msgs) => match &msgs[0] {
            crate::channel::OutboundMsg::Frame(Frame::ActionError(e)) => {
                assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::UnsupportedFrame)
            }
            other => panic!("expected error, got {other:?}"),
        },
        other => panic!("expected send, got {other:?}"),
    }
}

#[tokio::test]
async fn readonly_cannot_send_action() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    // read-only token（§9.2.2：M1 即强制，仅读）。
    let mut ro_ctx = ctx("ro");
    ro_ctx.role = TokenRole::ReadOnly;
    let mut ch = ChatChannel::new(ro_ctx);
    let (tx, _rx) = mpsc::channel(8);
    // 先订阅（首帧纪律）→ ready。
    ch.dispatch(
        Frame::YsyncSubscribe(YsyncSubscribe {
            docs: vec![DocId::REGISTRY],
            client_capabilities: Vec::new(),
        }),
        &deps,
        tx.clone(),
    )
    .await;
    ch.mark_ready();
    let action = Frame::Action(peri_studio_proto::action::ActionEnvelope::Prompt {
        command_id: uuid::Uuid::new_v4().to_string(),
        payload: PromptChatPayload {
            chat_id: "s1".into(),
            message: "x".into(),
            effort: None,
        },
    });
    let o = ch.dispatch(action, &deps, tx).await;
    match o {
        DispatchOutcome::Send(msgs) => match &msgs[0] {
            crate::channel::OutboundMsg::Frame(Frame::ActionError(e)) => {
                assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::UnsupportedFrame)
            }
            other => panic!("expected error, got {other:?}"),
        },
        other => panic!("expected send, got {other:?}"),
    }
}

#[tokio::test]
async fn readonly_can_request_body_free_prompt_recovery_but_not_mutate() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    let mut ro_ctx = ctx("ro-query");
    ro_ctx.role = TokenRole::ReadOnly;
    let mut ch = ChatChannel::new(ro_ctx);
    let (tx, _rx) = mpsc::channel(8);
    ch.dispatch(
        Frame::YsyncSubscribe(YsyncSubscribe {
            docs: vec![DocId::REGISTRY],
            client_capabilities: Vec::new(),
        }),
        &deps,
        tx.clone(),
    )
    .await;
    ch.mark_ready();
    let outcome = ch
        .dispatch(
            Frame::Action(
                peri_studio_proto::action::ActionEnvelope::PersistedSessionPromptStatus {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    payload: peri_studio_proto::action::PersistedSessionOpenPayload {
                        session_id: "logical-session".into(),
                    },
                },
            ),
            &deps,
            tx,
        )
        .await;
    match outcome {
        DispatchOutcome::Send(messages) => match &messages[0] {
            crate::channel::OutboundMsg::Frame(Frame::ActionError(error)) => assert_ne!(
                error.message, "read-only token cannot send actions",
                "the reviewed body-free query must pass the read-only gate"
            ),
            other => panic!("expected catalog availability error, got {other:?}"),
        },
        other => panic!("expected coordinator response, got {other:?}"),
    }
}
