use chrono::Utc;

use crate::persist::outbox::{
    CommandRecovery, CommandType, LastError, NewOutboxRecord, OutboxStatus, OutboxStore,
    RetryableClass,
};

fn test_outbox() -> OutboxStore {
    OutboxStore::new()
}

fn new_rec(chat_id: uuid::Uuid, command_type: CommandType) -> NewOutboxRecord {
    NewOutboxRecord {
        command_id: uuid::Uuid::new_v4(),
        chat_id,
        command_type,
        turn_id: None,
        retryable_class: command_type.default_retryable_class(),
    }
}

fn retryable_err() -> LastError {
    LastError::from_error_code(peri_studio_proto::ack::ErrorCode::AgentUnavailable)
}

#[test]
fn permission_recovery_clears_after_confirmed_delivery() {
    let sid = uuid::Uuid::new_v4();
    let rec = new_rec(sid, CommandType::Resolve);
    let evidence = CommandRecovery::PermissionResponse {
        permission_id: "permission-1".into(),
        request_id: serde_json::json!(42),
        options: vec![],
        decision: peri_studio_proto::action::PermissionDecision::Deny,
    };
    let mut ob = test_outbox();
    ob.insert(rec.clone()).unwrap();
    ob.mark_accepted(rec.command_id).unwrap();
    ob.mark_intent_durable(rec.command_id).unwrap();
    ob.set_recovery(rec.command_id, evidence).unwrap();
    ob.mark_dispatched(rec.command_id, Utc::now()).unwrap();
    ob.mark_delivery_confirmed(rec.command_id).unwrap();
    ob.clear_recovery(rec.command_id).unwrap();
    assert!(ob.get(rec.command_id).unwrap().recovery.is_none());
}

#[test]
fn permission_dispatch_barrier_only_clears_with_recovery_evidence() {
    let sid = uuid::Uuid::new_v4();
    let rec = new_rec(sid, CommandType::Resolve);
    let evidence = CommandRecovery::PermissionResponse {
        permission_id: "permission-1".into(),
        request_id: serde_json::json!(42),
        options: vec![],
        decision: peri_studio_proto::action::PermissionDecision::Allow,
    };
    let mut ob = test_outbox();
    ob.insert(rec.clone()).unwrap();
    ob.mark_accepted(rec.command_id).unwrap();
    ob.mark_intent_durable(rec.command_id).unwrap();
    ob.set_recovery(rec.command_id, evidence).unwrap();
    ob.mark_no_redelivery_barrier(rec.command_id, Utc::now())
        .unwrap();
    assert!(ob
        .get(rec.command_id)
        .unwrap()
        .dispatch_barrier_at
        .is_some());

    ob.mark_recovery_not_delivered(rec.command_id, retryable_err())
        .unwrap();
    let record = ob.get(rec.command_id).unwrap();
    assert_eq!(record.status, OutboxStatus::IntentDurable);
    assert!(record.dispatch_barrier_at.is_none());
    assert!(record.recovery.is_some());
    assert!(record
        .last_error
        .as_ref()
        .is_some_and(|error| error.retryable));
}

#[test]
fn cancel_dispatch_barrier_only_clears_after_definite_writer_rejection() {
    let sid = uuid::Uuid::new_v4();
    let rec = new_rec(sid, CommandType::Cancel);
    let mut ob = test_outbox();
    ob.insert(rec.clone()).unwrap();
    ob.mark_accepted(rec.command_id).unwrap();
    ob.mark_intent_durable(rec.command_id).unwrap();
    ob.mark_no_redelivery_barrier(rec.command_id, Utc::now())
        .unwrap();

    ob.mark_cancel_not_delivered(rec.command_id, retryable_err())
        .unwrap();
    let record = ob.get(rec.command_id).unwrap();
    assert_eq!(record.status, OutboxStatus::IntentDurable);
    assert!(record.dispatch_barrier_at.is_none());
    assert!(record
        .last_error
        .as_ref()
        .is_some_and(|error| error.retryable));

    ob.mark_failed(rec.command_id, retryable_err()).unwrap();
    assert!(
        ob.get(rec.command_id).is_none(),
        "definite non-delivery retires the command for same-id replay"
    );
}

#[test]
fn create_cleanup_confirmation_is_the_only_safe_barrier_escape() {
    let chat_id = uuid::Uuid::new_v4();
    let mut rec = new_rec(chat_id, CommandType::Create);
    rec.retryable_class = RetryableClass::NoAutoRedeliver;
    let mut ob = test_outbox();
    ob.insert(rec.clone()).unwrap();
    ob.mark_accepted(rec.command_id).unwrap();
    ob.mark_intent_durable(rec.command_id).unwrap();
    ob.mark_no_redelivery_barrier(rec.command_id, Utc::now())
        .unwrap();
    ob.mark_dispatched(rec.command_id, Utc::now()).unwrap();
    ob.mark_delivery_confirmed(rec.command_id).unwrap();

    ob.mark_create_cleanup_confirmed(rec.command_id, retryable_err())
        .unwrap();
    let record = ob.get(rec.command_id).unwrap();
    assert_eq!(record.status, OutboxStatus::IntentDurable);
    assert!(record.dispatch_barrier_at.is_none());
    assert!(record.dispatched_at.is_none());

    ob.mark_failed(rec.command_id, retryable_err()).unwrap();
    assert!(ob.get(rec.command_id).is_none());
}

#[test]
fn prompt_restart_reconciliation_never_redelivers_across_the_barrier() {
    let chat_id = uuid::Uuid::new_v4();
    let mut outbox = test_outbox();

    let accepted = new_rec(chat_id, CommandType::Prompt);
    outbox.insert(accepted.clone()).unwrap();
    outbox.mark_accepted(accepted.command_id).unwrap();
    outbox
        .set_prompt_payload_fingerprint(accepted.command_id, "accepted-fingerprint".into())
        .unwrap();

    let safe_intent = new_rec(chat_id, CommandType::Prompt);
    outbox.insert(safe_intent.clone()).unwrap();
    outbox.mark_accepted(safe_intent.command_id).unwrap();
    outbox
        .mark_prompt_intent_durable(safe_intent.command_id, "safe-fingerprint".into())
        .unwrap();

    let barrier = new_rec(chat_id, CommandType::Prompt);
    outbox.insert(barrier.clone()).unwrap();
    outbox.mark_accepted(barrier.command_id).unwrap();
    outbox
        .mark_prompt_intent_durable(barrier.command_id, "barrier-fingerprint".into())
        .unwrap();
    outbox
        .mark_dispatch_barrier(barrier.command_id, Utc::now())
        .unwrap();

    let legacy = new_rec(chat_id, CommandType::Prompt);
    outbox.insert(legacy.clone()).unwrap();
    outbox.mark_accepted(legacy.command_id).unwrap();
    outbox.mark_intent_durable(legacy.command_id).unwrap();

    let projected = new_rec(chat_id, CommandType::Prompt);
    outbox.insert(projected.clone()).unwrap();
    outbox.mark_accepted(projected.command_id).unwrap();
    outbox.mark_intent_durable(projected.command_id).unwrap();
    outbox
        .mark_dispatched(projected.command_id, Utc::now())
        .unwrap();
    outbox
        .mark_delivery_confirmed(projected.command_id)
        .unwrap();
    outbox
        .mark_projection_committed(projected.command_id)
        .unwrap();

    let repairable = new_rec(chat_id, CommandType::Prompt);
    outbox.insert(repairable.clone()).unwrap();
    outbox.mark_accepted(repairable.command_id).unwrap();
    outbox
        .mark_prompt_intent_durable(repairable.command_id, "repair-fingerprint".into())
        .unwrap();
    outbox
        .mark_dispatch_barrier(repairable.command_id, Utc::now())
        .unwrap();
    outbox
        .mark_dispatched(repairable.command_id, Utc::now())
        .unwrap();
    outbox
        .mark_delivery_confirmed(repairable.command_id)
        .unwrap();

    let terminal = std::collections::HashSet::from([repairable.command_id]);

    assert_eq!(
        outbox
            .reconcile_prompt_delivery_after_restart(&terminal)
            .unwrap(),
        6
    );
    assert_eq!(
        outbox.get(accepted.command_id).unwrap().status,
        OutboxStatus::Failed
    );
    assert_eq!(
        outbox.get(safe_intent.command_id).unwrap().status,
        OutboxStatus::Failed
    );
    for id in [barrier.command_id, legacy.command_id, projected.command_id] {
        let record = outbox.get(id).unwrap();
        assert_eq!(record.status, OutboxStatus::DeliveryUnknown);
        assert_eq!(record.last_error.as_ref().unwrap().code, "DELIVERY_UNKNOWN");
        assert!(!record.last_error.as_ref().unwrap().retryable);
    }
    assert_eq!(
        outbox.get(repairable.command_id).unwrap().status,
        OutboxStatus::Completed
    );
}
