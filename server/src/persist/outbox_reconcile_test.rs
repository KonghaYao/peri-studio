use chrono::Utc;

use crate::persist::outbox::{
    CommandType, LastError, NewOutboxRecord, OutboxStatus, OutboxStore,
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


fn fatal_err() -> LastError {
    LastError::from_error_code(peri_studio_proto::ack::ErrorCode::InvalidState)
}

#[test]
fn close_restart_reconciliation_retires_every_replayable_state() {
    let sid = uuid::Uuid::new_v4();
    let mut ob = test_outbox();

    let received = new_rec(sid, CommandType::Close);
    ob.insert(received.clone()).unwrap();

    let accepted = new_rec(sid, CommandType::Close);
    ob.insert(accepted.clone()).unwrap();
    ob.mark_accepted(accepted.command_id).unwrap();

    let intent = new_rec(sid, CommandType::Close);
    ob.insert(intent.clone()).unwrap();
    ob.mark_accepted(intent.command_id).unwrap();
    ob.mark_intent_durable(intent.command_id).unwrap();

    let dispatched = new_rec(sid, CommandType::Close);
    ob.insert(dispatched.clone()).unwrap();
    ob.mark_accepted(dispatched.command_id).unwrap();
    ob.mark_intent_durable(dispatched.command_id).unwrap();
    ob.mark_dispatched(dispatched.command_id, Utc::now())
        .unwrap();

    let confirmed = new_rec(sid, CommandType::Close);
    ob.insert(confirmed.clone()).unwrap();
    ob.mark_accepted(confirmed.command_id).unwrap();
    ob.mark_intent_durable(confirmed.command_id).unwrap();
    ob.mark_dispatched(confirmed.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(confirmed.command_id).unwrap();

    let projected = new_rec(sid, CommandType::Close);
    ob.insert(projected.clone()).unwrap();
    ob.mark_accepted(projected.command_id).unwrap();
    ob.mark_intent_durable(projected.command_id).unwrap();
    ob.mark_dispatched(projected.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(projected.command_id).unwrap();
    ob.mark_projection_committed(projected.command_id).unwrap();

    let unknown = new_rec(sid, CommandType::Close);
    ob.insert(unknown.clone()).unwrap();
    ob.mark_accepted(unknown.command_id).unwrap();
    ob.mark_intent_durable(unknown.command_id).unwrap();
    ob.mark_dispatched(unknown.command_id, Utc::now()).unwrap();
    ob.mark_delivery_unknown(unknown.command_id).unwrap();

    let completed = new_rec(sid, CommandType::Close);
    ob.insert(completed.clone()).unwrap();
    ob.mark_accepted(completed.command_id).unwrap();
    ob.mark_intent_durable(completed.command_id).unwrap();
    ob.mark_dispatched(completed.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(completed.command_id).unwrap();
    ob.mark_projection_committed(completed.command_id).unwrap();
    ob.mark_completed(completed.command_id).unwrap();

    let failed = new_rec(sid, CommandType::Close);
    ob.insert(failed.clone()).unwrap();
    ob.mark_accepted(failed.command_id).unwrap();
    ob.mark_intent_durable(failed.command_id).unwrap();
    ob.mark_failed(failed.command_id, fatal_err()).unwrap();

    assert_eq!(ob.reconcile_close_after_restart().unwrap(), 7);
    for id in [
        received.command_id,
        accepted.command_id,
        intent.command_id,
        dispatched.command_id,
        confirmed.command_id,
        projected.command_id,
        unknown.command_id,
    ] {
        assert!(ob.get(id).is_none(), "replayable close {id} must retire");
    }
    assert_eq!(
        ob.get(completed.command_id).unwrap().status,
        OutboxStatus::Completed
    );
    assert_eq!(
        ob.get(failed.command_id).unwrap().status,
        OutboxStatus::Failed
    );
}

#[test]
fn cancel_restart_converges_every_lost_executor_state() {
    let sid = uuid::Uuid::new_v4();
    let mut ob = test_outbox();

    let received = new_rec(sid, CommandType::Cancel);
    ob.insert(received.clone()).unwrap();

    let accepted = new_rec(sid, CommandType::Cancel);
    ob.insert(accepted.clone()).unwrap();
    ob.mark_accepted(accepted.command_id).unwrap();

    let intent = new_rec(sid, CommandType::Cancel);
    ob.insert(intent.clone()).unwrap();
    ob.mark_accepted(intent.command_id).unwrap();
    ob.mark_intent_durable(intent.command_id).unwrap();

    let barrier = new_rec(sid, CommandType::Cancel);
    ob.insert(barrier.clone()).unwrap();
    ob.mark_accepted(barrier.command_id).unwrap();
    ob.mark_intent_durable(barrier.command_id).unwrap();
    ob.mark_no_redelivery_barrier(barrier.command_id, Utc::now())
        .unwrap();

    let dispatched = new_rec(sid, CommandType::Cancel);
    ob.insert(dispatched.clone()).unwrap();
    ob.mark_accepted(dispatched.command_id).unwrap();
    ob.mark_intent_durable(dispatched.command_id).unwrap();
    ob.mark_no_redelivery_barrier(dispatched.command_id, Utc::now())
        .unwrap();
    ob.mark_dispatched(dispatched.command_id, Utc::now())
        .unwrap();

    let confirmed = new_rec(sid, CommandType::Cancel);
    ob.insert(confirmed.clone()).unwrap();
    ob.mark_accepted(confirmed.command_id).unwrap();
    ob.mark_intent_durable(confirmed.command_id).unwrap();
    ob.mark_no_redelivery_barrier(confirmed.command_id, Utc::now())
        .unwrap();
    ob.mark_dispatched(confirmed.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(confirmed.command_id).unwrap();

    let projected = new_rec(sid, CommandType::Cancel);
    ob.insert(projected.clone()).unwrap();
    ob.mark_accepted(projected.command_id).unwrap();
    ob.mark_intent_durable(projected.command_id).unwrap();
    ob.mark_no_redelivery_barrier(projected.command_id, Utc::now())
        .unwrap();
    ob.mark_dispatched(projected.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(projected.command_id).unwrap();
    ob.mark_projection_committed(projected.command_id).unwrap();

    let completed = new_rec(sid, CommandType::Cancel);
    ob.insert(completed.clone()).unwrap();
    ob.mark_accepted(completed.command_id).unwrap();
    ob.mark_intent_durable(completed.command_id).unwrap();
    ob.mark_no_redelivery_barrier(completed.command_id, Utc::now())
        .unwrap();
    ob.mark_dispatched(completed.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(completed.command_id).unwrap();
    ob.mark_projection_committed(completed.command_id).unwrap();
    ob.mark_completed(completed.command_id).unwrap();

    assert_eq!(ob.reconcile_cancel_after_restart().unwrap(), 7);
    for id in [received.command_id, accepted.command_id, intent.command_id] {
        assert!(
            ob.get(id).is_none(),
            "pre-barrier cancel {id} is replayable"
        );
    }
    for id in [
        barrier.command_id,
        dispatched.command_id,
        confirmed.command_id,
    ] {
        assert_eq!(
            ob.get(id).unwrap().status,
            OutboxStatus::DeliveryUnknown,
            "post-barrier cancel {id} must fail closed"
        );
    }
    assert_eq!(
        ob.get(projected.command_id).unwrap().status,
        OutboxStatus::Completed
    );
    assert_eq!(
        ob.get(completed.command_id).unwrap().status,
        OutboxStatus::Completed
    );
}

#[test]
fn create_restart_reconciliation_has_no_orphan_in_progress_state() {
    let chat_id = uuid::Uuid::new_v4();
    let mut ob = test_outbox();
    let create = |ob: &mut OutboxStore| {
        let mut rec = new_rec(chat_id, CommandType::Create);
        rec.retryable_class = RetryableClass::NoAutoRedeliver;
        ob.insert(rec.clone()).unwrap();
        rec
    };

    let accepted = create(&mut ob);
    ob.mark_accepted(accepted.command_id).unwrap();

    let safe_intent = create(&mut ob);
    ob.mark_accepted(safe_intent.command_id).unwrap();
    ob.mark_intent_durable(safe_intent.command_id).unwrap();

    let barrier_intent = create(&mut ob);
    ob.mark_accepted(barrier_intent.command_id).unwrap();
    ob.mark_intent_durable(barrier_intent.command_id).unwrap();
    ob.mark_no_redelivery_barrier(barrier_intent.command_id, Utc::now())
        .unwrap();

    let dispatched = create(&mut ob);
    ob.mark_accepted(dispatched.command_id).unwrap();
    ob.mark_intent_durable(dispatched.command_id).unwrap();
    ob.mark_no_redelivery_barrier(dispatched.command_id, Utc::now())
        .unwrap();
    ob.mark_dispatched(dispatched.command_id, Utc::now())
        .unwrap();

    let confirmed = create(&mut ob);
    ob.mark_accepted(confirmed.command_id).unwrap();
    ob.mark_intent_durable(confirmed.command_id).unwrap();
    ob.mark_no_redelivery_barrier(confirmed.command_id, Utc::now())
        .unwrap();
    ob.mark_dispatched(confirmed.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(confirmed.command_id).unwrap();

    let projected = create(&mut ob);
    ob.mark_accepted(projected.command_id).unwrap();
    ob.mark_intent_durable(projected.command_id).unwrap();
    ob.mark_no_redelivery_barrier(projected.command_id, Utc::now())
        .unwrap();
    ob.mark_dispatched(projected.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(projected.command_id).unwrap();
    ob.mark_projection_committed(projected.command_id).unwrap();

    assert_eq!(ob.reconcile_create_after_restart().unwrap(), 6);
    assert!(ob.get(accepted.command_id).is_none());
    assert!(ob.get(safe_intent.command_id).is_none());
    for command_id in [
        barrier_intent.command_id,
        dispatched.command_id,
        confirmed.command_id,
    ] {
        assert_eq!(
            ob.get(command_id).unwrap().status,
            OutboxStatus::DeliveryUnknown
        );
    }
    assert_eq!(
        ob.get(projected.command_id).unwrap().status,
        OutboxStatus::Completed
    );
}

#[test]
fn permission_restart_reconciliation_has_no_orphan_in_progress_state() {
    let sid = uuid::Uuid::new_v4();
    let mut ob = test_outbox();

    let accepted = new_rec(sid, CommandType::Resolve);
    ob.insert(accepted.clone()).unwrap();
    ob.mark_accepted(accepted.command_id).unwrap();

    let safe_intent = new_rec(sid, CommandType::Resolve);
    ob.insert(safe_intent.clone()).unwrap();
    ob.mark_accepted(safe_intent.command_id).unwrap();
    ob.mark_intent_durable(safe_intent.command_id).unwrap();

    let dispatched = new_rec(sid, CommandType::Resolve);
    ob.insert(dispatched.clone()).unwrap();
    ob.mark_accepted(dispatched.command_id).unwrap();
    ob.mark_intent_durable(dispatched.command_id).unwrap();
    ob.mark_dispatched(dispatched.command_id, Utc::now())
        .unwrap();

    let confirmed = new_rec(sid, CommandType::Resolve);
    ob.insert(confirmed.clone()).unwrap();
    ob.mark_accepted(confirmed.command_id).unwrap();
    ob.mark_intent_durable(confirmed.command_id).unwrap();
    ob.mark_dispatched(confirmed.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(confirmed.command_id).unwrap();

    let projected = new_rec(sid, CommandType::Resolve);
    ob.insert(projected.clone()).unwrap();
    ob.mark_accepted(projected.command_id).unwrap();
    ob.mark_intent_durable(projected.command_id).unwrap();
    ob.mark_dispatched(projected.command_id, Utc::now())
        .unwrap();
    ob.mark_delivery_confirmed(projected.command_id).unwrap();
    ob.mark_projection_committed(projected.command_id).unwrap();

    assert_eq!(ob.reconcile_permission_after_restart().unwrap(), 5);
    assert_eq!(
        ob.get(accepted.command_id).unwrap().status,
        OutboxStatus::Failed
    );
    assert_eq!(
        ob.get(safe_intent.command_id).unwrap().status,
        OutboxStatus::Failed
    );
    assert_eq!(
        ob.get(dispatched.command_id).unwrap().status,
        OutboxStatus::DeliveryUnknown
    );
    assert_eq!(
        ob.get(confirmed.command_id).unwrap().status,
        OutboxStatus::Completed
    );
    assert_eq!(
        ob.get(projected.command_id).unwrap().status,
        OutboxStatus::Completed
    );
}

#[test]
fn elicitation_restart_reconciliation_never_redelivers_one_shot_answers() {
    let chat_id = uuid::Uuid::new_v4();
    let mut outbox = test_outbox();

    let accepted = new_rec(chat_id, CommandType::ElicitationRespond);
    outbox.insert(accepted.clone()).unwrap();
    outbox.mark_accepted(accepted.command_id).unwrap();

    let safe_intent = new_rec(chat_id, CommandType::ElicitationRespond);
    outbox.insert(safe_intent.clone()).unwrap();
    outbox.mark_accepted(safe_intent.command_id).unwrap();
    outbox.mark_intent_durable(safe_intent.command_id).unwrap();

    let barrier = new_rec(chat_id, CommandType::ElicitationRespond);
    outbox.insert(barrier.clone()).unwrap();
    outbox.mark_accepted(barrier.command_id).unwrap();
    outbox.mark_intent_durable(barrier.command_id).unwrap();
    outbox
        .mark_no_redelivery_barrier(barrier.command_id, Utc::now())
        .unwrap();

    let dispatched = new_rec(chat_id, CommandType::ElicitationRespond);
    outbox.insert(dispatched.clone()).unwrap();
    outbox.mark_accepted(dispatched.command_id).unwrap();
    outbox.mark_intent_durable(dispatched.command_id).unwrap();
    outbox
        .mark_dispatched(dispatched.command_id, Utc::now())
        .unwrap();

    let confirmed = new_rec(chat_id, CommandType::ElicitationRespond);
    outbox.insert(confirmed.clone()).unwrap();
    outbox.mark_accepted(confirmed.command_id).unwrap();
    outbox.mark_intent_durable(confirmed.command_id).unwrap();
    outbox
        .mark_dispatched(confirmed.command_id, Utc::now())
        .unwrap();
    outbox
        .mark_delivery_confirmed(confirmed.command_id)
        .unwrap();

    assert_eq!(outbox.reconcile_elicitation_after_restart().unwrap(), 5);
    assert_eq!(
        outbox.get(accepted.command_id).unwrap().status,
        OutboxStatus::Failed
    );
    assert_eq!(
        outbox.get(safe_intent.command_id).unwrap().status,
        OutboxStatus::Failed
    );
    assert_eq!(
        outbox.get(barrier.command_id).unwrap().status,
        OutboxStatus::DeliveryUnknown
    );
    assert_eq!(
        outbox.get(dispatched.command_id).unwrap().status,
        OutboxStatus::DeliveryUnknown
    );
    assert_eq!(
        outbox.get(confirmed.command_id).unwrap().status,
        OutboxStatus::Completed
    );
}

