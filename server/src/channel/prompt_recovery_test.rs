use chrono::Utc;
use peri_studio_proto::session::{PromptDeliveryStatus, PromptStatusItem};
use uuid::Uuid;

use super::{
    exact_terminal_evidence, is_pending_orphan, merge_conflict, normalize_status,
    PromptProjectionEvidence,
};
use crate::persist::outbox::{CommandType, LastError, OutboxRecord, OutboxStatus, RetryableClass};

fn record(status: OutboxStatus, last_error: Option<LastError>) -> OutboxRecord {
    let now = Utc::now();
    OutboxRecord {
        command_id: Uuid::new_v4(),
        chat_id: Uuid::new_v4(),
        command_type: CommandType::Prompt,
        turn_id: Some(Uuid::new_v4()),
        status,
        retryable_class: RetryableClass::NoAutoRedeliver,
        dispatched_at: Some(now),
        created_at: now,
        updated_at: now,
        last_error,
        attempt_count: 1,
        delivery_protocol_version: None,
        payload_fingerprint: None,
        dispatch_barrier_at: None,
        recovery: None,
    }
}

#[test]
fn normalization_is_conservative_and_body_free() {
    let completed_without_terminal = normalize_status(
        record(OutboxStatus::Completed, None),
        Some(&PromptProjectionEvidence {
            projected: true,
            terminal: false,
            ..Default::default()
        }),
    );
    assert_eq!(
        completed_without_terminal.status,
        PromptDeliveryStatus::Projected
    );
    assert_eq!(
        normalize_status(record(OutboxStatus::DeliveryConfirmed, None), None).status,
        PromptDeliveryStatus::DeliveryUnknown
    );
    let failed = normalize_status(
        record(
            OutboxStatus::Failed,
            Some(LastError {
                code: "AGENT_UNAVAILABLE".into(),
                retryable: false,
                at: Utc::now(),
            }),
        ),
        None,
    );
    assert_eq!(failed.status, PromptDeliveryStatus::Failed);
    let serialized = serde_json::to_string(&failed).unwrap();
    assert!(!serialized.contains("message"));
    assert!(!serialized.contains("recovery"));
}

#[test]
fn startup_evidence_requires_exact_turn_and_only_pending_entries_are_orphans() {
    let now = Utc::now();
    let turn_id = Uuid::new_v4();
    let mut persisted = record(OutboxStatus::DeliveryConfirmed, None);
    persisted.turn_id = Some(turn_id);
    persisted.delivery_protocol_version = Some(2);
    persisted.payload_fingerprint = Some("fingerprint".into());
    persisted.dispatch_barrier_at = Some(now);
    let mut evidence = PromptProjectionEvidence {
        projected: true,
        terminal: true,
        entry_id: Some(format!("{turn_id}:user")),
        turn_id: Some(Uuid::new_v4()),
        delivery_schema_version: Some(2),
        delivery_state: Some("completed".into()),
        payload_fingerprint: Some("fingerprint".into()),
        conflicted: false,
    };
    assert!(!exact_terminal_evidence(&persisted, &evidence));
    evidence.turn_id = Some(turn_id);
    assert!(exact_terminal_evidence(&persisted, &evidence));
    assert!(!is_pending_orphan(&evidence));
    evidence.delivery_state = Some("pending".into());
    assert!(is_pending_orphan(&evidence));
}

#[test]
fn duplicate_historical_identity_degrades_to_one_unknown_fact() {
    let mut existing = PromptStatusItem {
        command_id: "same-command".into(),
        turn_id: Some("turn-a".into()),
        status: PromptDeliveryStatus::Completed,
        created_at: "2026-08-14T00:00:01Z".into(),
        updated_at: "2026-08-14T00:00:02Z".into(),
        error_code: None,
    };
    merge_conflict(
        &mut existing,
        PromptStatusItem {
            command_id: "same-command".into(),
            turn_id: Some("turn-b".into()),
            status: PromptDeliveryStatus::Failed,
            created_at: "2026-08-14T00:00:00Z".into(),
            updated_at: "2026-08-14T00:00:03Z".into(),
            error_code: Some("AGENT_UNAVAILABLE".into()),
        },
    );
    assert_eq!(existing.status, PromptDeliveryStatus::DeliveryUnknown);
    assert_eq!(existing.turn_id, None);
    assert_eq!(existing.created_at, "2026-08-14T00:00:00Z");
    assert_eq!(existing.updated_at, "2026-08-14T00:00:03Z");
    assert_eq!(existing.error_code, None);
}
