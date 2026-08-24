//! Prompt 字节预算在 ready 前缓冲与 ready 后 admission 的双边界测试。

use std::sync::Arc;

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::{ActionEnvelope, PromptChatPayload, MAX_PROMPT_BYTES};
use peri_studio_proto::conn::DocId;
use peri_studio_proto::frame::Frame;
use peri_studio_proto::ysync::{YsyncSubscribe, CAP_PROMPT_DELIVERY_V2};
use tokio::sync::mpsc;

use crate::channel::{ChannelDeps, ChatChannel, DispatchOutcome, OutboundMsg};

use super::chat_channel_test_support::{ctx, env};

fn oversized_prompt(command_id: String) -> Frame {
    Frame::Action(ActionEnvelope::Prompt {
        command_id,
        payload: PromptChatPayload {
            chat_id: "missing-chat".into(),
            message: "x".repeat(MAX_PROMPT_BYTES + 1),
            effort: None,
        },
    })
}

fn assert_payload_too_large(outcome: DispatchOutcome, command_id: &str) {
    let DispatchOutcome::Send(messages) = outcome else {
        panic!("expected action error");
    };
    let OutboundMsg::Frame(Frame::ActionError(error)) = &messages[0] else {
        panic!("expected action error frame");
    };
    assert_eq!(error.command_id, command_id);
    assert_eq!(error.code, ErrorCode::PayloadTooLarge);
}

#[tokio::test]
async fn oversized_prompt_is_rejected_before_ready_buffering() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    let mut channel = ChatChannel::new(ctx("oversized-before-ready"));
    let (tx, _rx) = mpsc::channel(8);
    let command_id = uuid::Uuid::new_v4().to_string();
    let outcome = channel
        .dispatch(oversized_prompt(command_id.clone()), &deps, tx)
        .await;
    assert_payload_too_large(outcome, &command_id);
    assert_eq!(channel.pending_len(), 0);
}

#[tokio::test]
async fn prompt_over_negotiated_byte_budget_is_rejected_before_admission() {
    let env = env().await;
    let deps = ChannelDeps {
        coordinator: env.coordinator.clone(),
        broadcast: env.broadcast.clone(),
        instance: env.instance.clone(),
        chats: Arc::new(env.chats.clone()),
        conns: env.conns.clone(),
    };
    let mut channel = ChatChannel::new(ctx("prompt-budget"));
    let (tx, _rx) = mpsc::channel(8);
    channel
        .dispatch(
            Frame::YsyncSubscribe(YsyncSubscribe {
                docs: vec![DocId::REGISTRY],
                client_capabilities: vec![CAP_PROMPT_DELIVERY_V2.to_string()],
            }),
            &deps,
            tx.clone(),
        )
        .await;
    channel.mark_ready();
    let command_id = uuid::Uuid::new_v4().to_string();
    let outcome = channel
        .dispatch(oversized_prompt(command_id.clone()), &deps, tx)
        .await;
    assert_payload_too_large(outcome, &command_id);
}
