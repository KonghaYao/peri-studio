//! CommandOutcomeBroker 单测。本文件按主题拆分（纯结构重组，行为语义不变）：
//! - 本文件：测试环境（TestEnv/env/seed_accepted 等公共 helper，经 `use
//!   super::*` 被子模块继承）与基础契约主题（fingerprint 稳定性、持久化
//!   状态机穷举、投递去重 wire 一致性、durable unknown 无进程内 fallback、
//!   存储降级粘滞）；
//! - command_outcome_broker_attach_test.rs：observer 附加/替换/隔离；
//! - command_outcome_broker_fallback_test.rs：durable fallback/重放/tombstone；
//! - command_outcome_broker_recovery_test.rs：permission recovery 重新分类；
//! - command_outcome_broker_capacity_test.rs：observer/fallback 容量与溢出。
//!
//! 注：admit_terminal_fallback 在 command_outcome_broker_terminal 子模块
//! （源文件拆分产物），此处显式导入供本模块与子模块共用。
use std::sync::Arc;
use std::time::Duration;

use peri_studio_proto::ack::{AckStatus, ErrorCode};
use peri_studio_proto::action::{
    ActionEnvelope, CloseChatPayload, PermissionDecision, PromptChatPayload,
    ResolvePermissionPayload,
};
use peri_studio_proto::frame::Frame;
use tempfile::TempDir;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::*;
use crate::channel::command_identity::prompt_payload_fingerprint;
use crate::persist::outbox::{
    CommandRecovery, CommandType, LastError, NewOutboxRecord, OutboxRecord, OutboxStatus,
    RetryableClass,
};
use crate::persist::PersistConfig;
use crate::state::registry::{RegistryMsg, RegistryState};
use super::command_outcome_broker_terminal::admit_terminal_fallback;

/// 主题子模块：observer 附加 / fallback 重放 / permission recovery / 容量。
#[cfg(test)]
#[path = "command_outcome_broker_attach_test.rs"]
mod command_outcome_broker_attach_test;

#[cfg(test)]
#[path = "command_outcome_broker_fallback_test.rs"]
mod command_outcome_broker_fallback_test;

#[cfg(test)]
#[path = "command_outcome_broker_recovery_test.rs"]
mod command_outcome_broker_recovery_test;

#[cfg(test)]
#[path = "command_outcome_broker_capacity_test.rs"]
mod command_outcome_broker_capacity_test;

struct TestEnv {
    _tmp: TempDir,
    store: Arc<Store>,
    broker: CommandOutcomeBroker,
    chat_id: Uuid,
}

fn env() -> TestEnv {
    let tmp = tempfile::tempdir().unwrap();
    let config = PersistConfig {
        data_dir: tmp.path().to_path_buf(),
    };
    let store = Arc::new(Store::open(&config).unwrap());
    let chat_id = Uuid::new_v4();
    store.create_chat(chat_id).unwrap();
    let (registry_tx, _registry_rx) = mpsc::channel::<RegistryMsg>(8);
    let chats = ChatRegistry::new(RegistryState::new(registry_tx));
    let broker = CommandOutcomeBroker::new(store.clone(), chats);
    TestEnv {
        _tmp: tmp,
        store,
        broker,
        chat_id,
    }
}

async fn seed_accepted(env: &TestEnv, command_id: Uuid) {
    let chat = env.store.chat(env.chat_id).unwrap();
    let mut outbox = chat.outbox().lock().await;
    outbox
        .insert(NewOutboxRecord {
            command_id,
            chat_id: env.chat_id,
            command_type: CommandType::Close,
            turn_id: None,
            retryable_class: RetryableClass::NoAutoRedeliver,
        })
        .unwrap();
    outbox.mark_accepted(command_id).unwrap();
}

#[tokio::test]
async fn legacy_safe_create_unknown_remains_blocked() {
    let env = env();
    let command_id = Uuid::new_v4();
    let chat = env.store.chat(env.chat_id).unwrap();
    let mut outbox = chat.outbox().lock().await;
    outbox
        .insert(NewOutboxRecord {
            command_id,
            chat_id: env.chat_id,
            command_type: CommandType::Create,
            turn_id: None,
            retryable_class: RetryableClass::SafeToRedeliver,
        })
        .unwrap();
    outbox.mark_accepted(command_id).unwrap();
    outbox.mark_intent_durable(command_id).unwrap();
    outbox
        .mark_dispatched(command_id, chrono::Utc::now())
        .unwrap();
    outbox.mark_delivery_unknown(command_id).unwrap();
    let record = outbox.get(command_id).unwrap();
    assert!(matches!(
        dedup_verdict(record),
        DedupVerdict::RedeliverUnknown
    ));
}

fn close_action(command_id: Uuid, chat_id: Uuid) -> ActionEnvelope {
    ActionEnvelope::Close {
        command_id: command_id.to_string(),
        payload: CloseChatPayload {
            chat_id: chat_id.to_string(),
        },
    }
}

fn prompt_action(command_id: Uuid, chat_id: Uuid, message: &str) -> ActionEnvelope {
    ActionEnvelope::Prompt {
        command_id: command_id.to_string(),
        payload: PromptChatPayload {
            chat_id: chat_id.to_string(),
            message: message.to_string(),
            effort: Some("high".to_string()),
        },
    }
}

fn key(chat_id: Uuid, command_id: Uuid) -> OutcomeKey {
    OutcomeKey {
        chat_id,
        command_id,
    }
}

fn request<'a>(
    env: &'a TestEnv,
    command_id: Uuid,
    action: &'a ActionEnvelope,
    observer: mpsc::Sender<OutboundMsg>,
) -> ExistingCommandRequest<'a> {
    ExistingCommandRequest {
        chat_id: env.chat_id,
        command_id,
        command_id_text: action_command_id(action),
        action,
        observer,
        duplicate_chat_id: None,
    }
}

fn action_command_id(action: &ActionEnvelope) -> &str {
    match action {
        ActionEnvelope::Close { command_id, .. }
        | ActionEnvelope::Prompt { command_id, .. }
        | ActionEnvelope::ResolvePermission { command_id, .. } => command_id,
        _ => unreachable!("test constructs close or permission actions only"),
    }
}

#[test]
fn canonical_prompt_fingerprint_fixture_is_stable() {
    let fingerprint = prompt_payload_fingerprint(&PromptChatPayload {
        chat_id: "chat-1".to_string(),
        message: "hello".to_string(),
        effort: Some("high".to_string()),
    })
    .unwrap();
    assert_eq!(
        fingerprint,
        "b57e63f7dca9cd1ec41ed207be8ee565351adbdbca6fcb494174a386c77d611b"
    );
}

#[tokio::test]
async fn prompt_observer_requires_exact_durable_fingerprint() {
    let env = env();
    let command_id = Uuid::new_v4();
    let exact = prompt_action(command_id, env.chat_id, "same body");
    let fingerprint = match &exact {
        ActionEnvelope::Prompt { payload, .. } => prompt_payload_fingerprint(payload).unwrap(),
        _ => unreachable!(),
    };
    let chat = env.store.chat(env.chat_id).unwrap();
    {
        let mut outbox = chat.outbox().lock().await;
        outbox
            .insert(NewOutboxRecord {
                command_id,
                chat_id: env.chat_id,
                command_type: CommandType::Prompt,
                turn_id: Some(Uuid::new_v4()),
                retryable_class: RetryableClass::NoAutoRedeliver,
            })
            .unwrap();
        outbox.mark_accepted(command_id).unwrap();
        outbox
            .set_prompt_payload_fingerprint(command_id, fingerprint)
            .unwrap();
    }

    let (exact_tx, _exact_rx) = mpsc::channel(2);
    assert!(matches!(
        env.broker
            .adjudicate_existing(request(&env, command_id, &exact, exact_tx))
            .await,
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Accepted { .. })
    ));

    let mismatch = prompt_action(command_id, env.chat_id, "different body");
    let (mismatch_tx, _mismatch_rx) = mpsc::channel(2);
    assert!(matches!(
        env.broker
            .adjudicate_existing(request(&env, command_id, &mismatch, mismatch_tx))
            .await,
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(ref error))
            if error.code == ErrorCode::InvalidState
    ));

    let missing_id = Uuid::new_v4();
    {
        let mut outbox = chat.outbox().lock().await;
        outbox
            .insert(NewOutboxRecord {
                command_id: missing_id,
                chat_id: env.chat_id,
                command_type: CommandType::Prompt,
                turn_id: Some(Uuid::new_v4()),
                retryable_class: RetryableClass::NoAutoRedeliver,
            })
            .unwrap();
        outbox.mark_accepted(missing_id).unwrap();
    }
    let missing = prompt_action(missing_id, env.chat_id, "same body");
    let (missing_tx, _missing_rx) = mpsc::channel(2);
    assert!(matches!(
        env.broker
            .adjudicate_existing(request(&env, missing_id, &missing, missing_tx))
            .await,
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(ref error))
            if error.code == ErrorCode::InvalidState
    ));
}

fn record_with(status: OutboxStatus) -> OutboxRecord {
    let now = chrono::Utc::now();
    OutboxRecord {
        command_id: Uuid::new_v4(),
        chat_id: Uuid::new_v4(),
        command_type: CommandType::Close,
        turn_id: None,
        status,
        retryable_class: RetryableClass::NoAutoRedeliver,
        dispatched_at: None,
        created_at: now,
        updated_at: now,
        last_error: None,
        attempt_count: 0,
        delivery_protocol_version: None,
        payload_fingerprint: None,
        dispatch_barrier_at: None,
        recovery: None,
    }
}

#[test]
fn durable_status_table_is_explicit_and_exhaustive() {
    for status in [
        OutboxStatus::Received,
        OutboxStatus::Accepted,
        OutboxStatus::IntentDurable,
        OutboxStatus::Dispatched,
        OutboxStatus::DeliveryConfirmed,
        OutboxStatus::ProjectionCommitted,
    ] {
        assert_eq!(
            dedup_verdict(&record_with(status)),
            DedupVerdict::InProgress
        );
    }
    assert_eq!(
        dedup_verdict(&record_with(OutboxStatus::Completed)),
        DedupVerdict::Duplicate
    );
    assert_eq!(
        dedup_verdict(&record_with(OutboxStatus::Failed)),
        DedupVerdict::RedeliverFailed
    );
    assert_eq!(
        dedup_verdict(&record_with(OutboxStatus::DeliveryUnknown)),
        DedupVerdict::RedeliverUnknown
    );

    let mut safe = record_with(OutboxStatus::DeliveryUnknown);
    safe.retryable_class = RetryableClass::SafeToRedeliver;
    assert_eq!(dedup_verdict(&safe), DedupVerdict::RedeliverUnknown);
    safe.command_type = CommandType::Create;
    assert_eq!(dedup_verdict(&safe), DedupVerdict::RedeliverUnknown);
}

#[test]
fn duplicate_projection_and_unknown_messages_preserve_wire_parity() {
    let mut completed = record_with(OutboxStatus::Completed);
    let turn_id = Uuid::new_v4();
    completed.turn_id = Some(turn_id);
    let create_chat_id = Uuid::new_v4().to_string();
    match terminal_response("command-1", &completed, Some(&create_chat_id)) {
        Some(ExistingCommandResponse::Duplicate(ack)) => {
            assert_eq!(ack.status, AckStatus::Duplicate);
            assert_eq!(ack.turn_id.as_deref(), Some(turn_id.to_string().as_str()));
            assert_eq!(ack.chat_id.as_deref(), Some(create_chat_id.as_str()));
        }
        other => panic!("expected create duplicate, got {other:?}"),
    }
    match terminal_response("command-1", &completed, None) {
        Some(ExistingCommandResponse::Duplicate(ack)) => assert!(ack.chat_id.is_none()),
        other => panic!("expected ordinary duplicate, got {other:?}"),
    }

    let unknown = record_with(OutboxStatus::DeliveryUnknown);
    let initial = match initial_terminal_response("command-1", &unknown, None) {
        Some(ExistingCommandResponse::Failed(error)) => error,
        other => panic!("expected initial unknown, got {other:?}"),
    };
    let reread = match terminal_response("command-1", &unknown, None) {
        Some(ExistingCommandResponse::Failed(error)) => error,
        other => panic!("expected reread unknown, got {other:?}"),
    };
    assert_eq!(
        initial.message,
        "delivery unknown; automatic retry not permitted (path B)"
    );
    assert_eq!(
        reread.message,
        "delivery outcome is unknown; retry is blocked"
    );
}

#[tokio::test]
async fn durable_unknown_uses_no_process_local_fallback_capacity() {
    let env = env();
    let command_id = Uuid::new_v4();
    let chat = env.store.chat(env.chat_id).unwrap();
    {
        let mut outbox = chat.outbox().lock().await;
        outbox
            .insert(NewOutboxRecord {
                command_id,
                chat_id: env.chat_id,
                command_type: CommandType::Close,
                turn_id: None,
                retryable_class: RetryableClass::NoAutoRedeliver,
            })
            .unwrap();
        outbox.mark_accepted(command_id).unwrap();
        outbox.mark_intent_durable(command_id).unwrap();
        outbox
            .mark_dispatched(command_id, chrono::Utc::now())
            .unwrap();
        outbox.mark_delivery_unknown(command_id).unwrap();
    }
    let (original_tx, _original_rx) = mpsc::channel(2);
    env.broker
        .publish_terminal(TerminalPublication {
            command_id_text: &command_id.to_string(),
            chat_id: Some(env.chat_id),
            original: &original_tx,
            outcome: TerminalOutcome::Error(action_error(
                &command_id.to_string(),
                ErrorCode::DeliveryUnknown,
                "durable unknown",
                false,
            )),
        })
        .await;
    assert!(env.broker.state.lock().await.terminal_fallbacks.is_empty());
}

#[tokio::test]
async fn sticky_storage_degradation_blocks_real_observer_adjudication() {
    let env = env();
    let command_id = Uuid::new_v4();
    seed_accepted(&env, command_id).await;
    env.broker.mark_terminal_state_unavailable().await;
    let action = close_action(command_id, env.chat_id);
    let (observer_tx, _observer_rx) = mpsc::channel(2);
    assert!(matches!(
        env.broker
            .adjudicate_existing(request(&env, command_id, &action, observer_tx))
            .await,
        ExistingCommandDisposition::Respond(ExistingCommandResponse::Failed(ref error))
            if error.code == ErrorCode::DeliveryUnknown
                && error.message.contains("storage is degraded")
    ));
}
