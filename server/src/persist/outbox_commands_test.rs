use chrono::Utc;

use crate::persist::outbox::{
    CommandType, DeliveryVerdict, LastError, NewOutboxRecord, OutboxStatus, OutboxStore,
};
use crate::persist::StoreError;

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

fn fatal_err() -> LastError {
    LastError::from_error_code(peri_studio_proto::ack::ErrorCode::InvalidState)
}

#[test]
fn t4_legal_transitions_all_green() {
    let sid = uuid::Uuid::new_v4();
    let mut ob = test_outbox();
    let rec = new_rec(sid, CommandType::Prompt);
    ob.insert(rec.clone()).unwrap();
    assert_eq!(
        ob.get(rec.command_id).unwrap().status,
        OutboxStatus::Received
    );
    ob.mark_accepted(rec.command_id).unwrap();
    assert_eq!(
        ob.get(rec.command_id).unwrap().status,
        OutboxStatus::Accepted
    );
    ob.mark_intent_durable(rec.command_id).unwrap();
    assert_eq!(
        ob.get(rec.command_id).unwrap().status,
        OutboxStatus::IntentDurable
    );
    let at = Utc::now();
    ob.mark_dispatched(rec.command_id, at).unwrap();
    let r = ob.get(rec.command_id).unwrap();
    assert_eq!(r.status, OutboxStatus::Dispatched);
    assert_eq!(r.dispatched_at, Some(at));
    assert_eq!(r.attempt_count, 1);
    ob.mark_delivery_confirmed(rec.command_id).unwrap();
    assert_eq!(
        ob.get(rec.command_id).unwrap().status,
        OutboxStatus::DeliveryConfirmed
    );
    ob.mark_projection_committed(rec.command_id).unwrap();
    assert_eq!(
        ob.get(rec.command_id).unwrap().status,
        OutboxStatus::ProjectionCommitted
    );
    ob.mark_completed(rec.command_id).unwrap();
    assert_eq!(
        ob.get(rec.command_id).unwrap().status,
        OutboxStatus::Completed
    );

    // delivery_unknown → ConfirmedDelivered → completed
    let rec2 = new_rec(sid, CommandType::Prompt);
    ob.insert(rec2.clone()).unwrap();
    ob.mark_accepted(rec2.command_id).unwrap();
    ob.mark_intent_durable(rec2.command_id).unwrap();
    ob.mark_dispatched(rec2.command_id, Utc::now()).unwrap();
    ob.mark_delivery_unknown(rec2.command_id).unwrap();
    assert_eq!(
        ob.get(rec2.command_id).unwrap().status,
        OutboxStatus::DeliveryUnknown
    );
    ob.resolve_delivery_unknown(rec2.command_id, DeliveryVerdict::ConfirmedDelivered)
        .unwrap();
    assert_eq!(
        ob.get(rec2.command_id).unwrap().status,
        OutboxStatus::Completed
    );

    // delivery_unknown → ConfirmedNotDelivered → tombstone
    let rec3 = new_rec(sid, CommandType::Cancel);
    ob.insert(rec3.clone()).unwrap();
    ob.mark_accepted(rec3.command_id).unwrap();
    ob.mark_intent_durable(rec3.command_id).unwrap();
    ob.mark_dispatched(rec3.command_id, Utc::now()).unwrap();
    ob.mark_delivery_unknown(rec3.command_id).unwrap();
    ob.resolve_delivery_unknown(rec3.command_id, DeliveryVerdict::ConfirmedNotDelivered)
        .unwrap();
    assert!(ob.get(rec3.command_id).is_none());

    // delivery_unknown → StillUnknown 幂等保持
    let rec4 = new_rec(sid, CommandType::Cancel);
    ob.insert(rec4.clone()).unwrap();
    ob.mark_accepted(rec4.command_id).unwrap();
    ob.mark_intent_durable(rec4.command_id).unwrap();
    ob.mark_dispatched(rec4.command_id, Utc::now()).unwrap();
    ob.mark_delivery_unknown(rec4.command_id).unwrap();
    ob.resolve_delivery_unknown(rec4.command_id, DeliveryVerdict::StillUnknown)
        .unwrap();
    assert_eq!(
        ob.get(rec4.command_id).unwrap().status,
        OutboxStatus::DeliveryUnknown
    );

    // delivery_confirmed → failed（业务失败）
    let rec5 = new_rec(sid, CommandType::Prompt);
    ob.insert(rec5.clone()).unwrap();
    ob.mark_accepted(rec5.command_id).unwrap();
    ob.mark_intent_durable(rec5.command_id).unwrap();
    ob.mark_dispatched(rec5.command_id, Utc::now()).unwrap();
    ob.mark_delivery_confirmed(rec5.command_id).unwrap();
    ob.mark_failed(rec5.command_id, fatal_err()).unwrap();
    assert_eq!(
        ob.get(rec5.command_id).unwrap().status,
        OutboxStatus::Failed
    );

    // intent_durable → clear_for_retry（retryable 清除）
    let rec6 = new_rec(sid, CommandType::Close);
    ob.insert(rec6.clone()).unwrap();
    ob.mark_accepted(rec6.command_id).unwrap();
    ob.mark_intent_durable(rec6.command_id).unwrap();
    ob.clear_for_retry(rec6.command_id).unwrap();
    assert!(ob.get(rec6.command_id).is_none());
}

#[test]
fn t4_illegal_transitions_rejected() {
    let sid = uuid::Uuid::new_v4();
    let mut ob = test_outbox();
    // —— 合法 setup（先全部走完，之后测量文件基线）——
    let rec = new_rec(sid, CommandType::Prompt);
    ob.insert(rec.clone()).unwrap();
    // 走完主链到 completed
    ob.mark_accepted(rec.command_id).unwrap();
    ob.mark_intent_durable(rec.command_id).unwrap();
    ob.mark_dispatched(rec.command_id, Utc::now()).unwrap();
    ob.mark_delivery_confirmed(rec.command_id).unwrap();
    ob.mark_projection_committed(rec.command_id).unwrap();
    ob.mark_completed(rec.command_id).unwrap();
    // 独立记录（合法走到 dispatched）
    let rec2 = new_rec(sid, CommandType::Prompt);
    ob.insert(rec2.clone()).unwrap();
    ob.mark_accepted(rec2.command_id).unwrap();
    ob.mark_intent_durable(rec2.command_id).unwrap();
    ob.mark_dispatched(rec2.command_id, Utc::now()).unwrap();
    // delivery_unknown 记录
    let rec3 = new_rec(sid, CommandType::Cancel);
    ob.insert(rec3.clone()).unwrap();
    ob.mark_accepted(rec3.command_id).unwrap();
    ob.mark_intent_durable(rec3.command_id).unwrap();
    ob.mark_dispatched(rec3.command_id, Utc::now()).unwrap();
    ob.mark_delivery_unknown(rec3.command_id).unwrap();
    // accepted 状态记录
    let rec4 = new_rec(sid, CommandType::Prompt);
    ob.insert(rec4.clone()).unwrap();
    ob.mark_accepted(rec4.command_id).unwrap();

    // —— 非法迁移（全部拒绝）——
    // 终态 → 任何状态
    assert!(matches!(
        ob.mark_accepted(rec.command_id),
        Err(StoreError::InvalidTransition { .. })
    ));
    assert!(matches!(
        ob.mark_dispatched(rec.command_id, Utc::now()),
        Err(StoreError::InvalidTransition { .. })
    ));
    assert!(matches!(
        ob.mark_failed(rec.command_id, retryable_err()),
        Err(StoreError::InvalidTransition { .. })
    ));
    assert!(matches!(
        ob.resolve_delivery_unknown(rec.command_id, DeliveryVerdict::ConfirmedDelivered),
        Err(StoreError::InvalidTransition { .. })
    ));

    // 独立记录：跳过状态（received → dispatched）
    assert!(matches!(
        ob.mark_dispatched(rec2.command_id, Utc::now()),
        Err(StoreError::InvalidTransition { .. })
    ));
    assert!(matches!(
        ob.mark_projection_committed(rec2.command_id),
        Err(StoreError::InvalidTransition { .. })
    ));
    // 非法：dispatched → projection_committed（跳过确认）
    assert!(matches!(
        ob.mark_projection_committed(rec2.command_id),
        Err(StoreError::InvalidTransition { .. })
    ));
    // 非法：delivery_unknown → dispatched（非幂等禁止自动重发）
    assert!(matches!(
        ob.mark_dispatched(rec3.command_id, Utc::now()),
        Err(StoreError::InvalidTransition { .. })
    ));
    // 非法：delivery_unknown 直接 mark_failed（须走裁决）
    assert!(matches!(
        ob.mark_failed(rec3.command_id, fatal_err()),
        Err(StoreError::InvalidTransition { .. })
    ));
    // 非法：clear_for_retry 对非 intent_durable/delivery_unknown 状态
    assert!(matches!(
        ob.clear_for_retry(rec4.command_id),
        Err(StoreError::InvalidTransition { .. })
    ));
    // 重复 insert（重发穿透防护）
    assert!(matches!(
        ob.insert(rec.clone()),
        Err(StoreError::DuplicateCommand { .. })
    ));
    // 不存在的 commandId
    assert!(matches!(
        ob.mark_accepted(uuid::Uuid::new_v4()),
        Err(StoreError::CommandNotFound { .. })
    ));
}

/// H1 裁决：投递后 retryable 失败 → 回退 intent_durable（记录保留、索引不删、
/// dispatched_at 清除、可重发）；重发 attempt_count 递增。
#[test]
fn h1_delivery_confirmed_retryable_failure_falls_back() {
    let sid = uuid::Uuid::new_v4();
    let mut ob = test_outbox();
    let rec = new_rec(sid, CommandType::Prompt);
    ob.insert(rec.clone()).unwrap();
    ob.mark_accepted(rec.command_id).unwrap();
    ob.mark_intent_durable(rec.command_id).unwrap();
    ob.mark_dispatched(rec.command_id, Utc::now()).unwrap();
    ob.mark_delivery_confirmed(rec.command_id).unwrap();
    // 投递后 retryable 失败（如 AGENT_UNAVAILABLE）
    ob.mark_failed(rec.command_id, retryable_err()).unwrap();
    let r = ob.get(rec.command_id).expect("record must be kept");
    assert_eq!(
        r.status,
        OutboxStatus::IntentDurable,
        "fallback to intent_durable"
    );
    assert_eq!(r.dispatched_at, None, "dispatch bit cleared");
    assert_eq!(r.last_error.as_ref().unwrap().code, "AGENT_UNAVAILABLE");
    // 可重发：再次投递
    ob.mark_dispatched(rec.command_id, Utc::now()).unwrap();
    let r2 = ob.get(rec.command_id).unwrap();
    assert_eq!(r2.status, OutboxStatus::Dispatched);
    assert_eq!(r2.attempt_count, 2, "attempt count observable");
}

/// H1 裁决：投递前 retryable 失败 → tombstone 清除（设计稿 §5.2 原语义）；
/// 非 retryable 失败 → failed 终态。
#[test]
fn h1_pre_dispatch_retryable_clears_and_fatal_fails() {
    let sid = uuid::Uuid::new_v4();
    let mut ob = test_outbox();
    // 投递前 retryable → 清除
    let rec = new_rec(sid, CommandType::Prompt);
    ob.insert(rec.clone()).unwrap();
    ob.mark_accepted(rec.command_id).unwrap();
    ob.mark_intent_durable(rec.command_id).unwrap();
    ob.mark_failed(rec.command_id, retryable_err()).unwrap();
    assert!(ob.get(rec.command_id).is_none(), "cleared for retry");
    // 投递后非 retryable → failed 终态
    let rec2 = new_rec(sid, CommandType::Prompt);
    ob.insert(rec2.clone()).unwrap();
    ob.mark_accepted(rec2.command_id).unwrap();
    ob.mark_intent_durable(rec2.command_id).unwrap();
    ob.mark_dispatched(rec2.command_id, Utc::now()).unwrap();
    ob.mark_delivery_confirmed(rec2.command_id).unwrap();
    ob.mark_failed(rec2.command_id, fatal_err()).unwrap();
    let r = ob.get(rec2.command_id).unwrap();
    assert_eq!(r.status, OutboxStatus::Failed);
    assert!(!r.last_error.as_ref().unwrap().retryable);
    // 非 retryable 失败对投递前 → failed（不删除）
    let rec3 = new_rec(sid, CommandType::Cancel);
    ob.insert(rec3.clone()).unwrap();
    ob.mark_accepted(rec3.command_id).unwrap();
    ob.mark_failed(rec3.command_id, fatal_err()).unwrap();
    assert_eq!(
        ob.get(rec3.command_id).unwrap().status,
        OutboxStatus::Failed
    );
}

/// T5：跨重启（新实例重放同一目录）重建去重索引；dispatched/delivery_unknown
/// 保留；tombstone 生效。

#[test]
fn prompt_v2_barrier_is_additive_durable_and_never_retryable() {
    let sid = uuid::Uuid::new_v4();
    let mut ob = test_outbox();
    let rec = new_rec(sid, CommandType::Prompt);
    ob.insert(rec.clone()).unwrap();
    ob.mark_accepted(rec.command_id).unwrap();
    ob.mark_prompt_intent_durable(rec.command_id, "sha256:abc".into())
        .unwrap();
    let barrier = Utc::now();
    ob.mark_dispatch_barrier(rec.command_id, barrier).unwrap();

    let current = ob.get(rec.command_id).unwrap();
    assert_eq!(current.status, OutboxStatus::IntentDurable);
    assert_eq!(current.delivery_protocol_version, Some(2));
    assert_eq!(current.payload_fingerprint.as_deref(), Some("sha256:abc"));
    assert_eq!(current.dispatch_barrier_at, Some(barrier));

    ob.mark_failed(rec.command_id, retryable_err()).unwrap();
    assert_eq!(
        ob.get(rec.command_id).unwrap().status,
        OutboxStatus::DeliveryUnknown
    );

    let durable = ob.get(rec.command_id).unwrap();
    assert_eq!(durable.status, OutboxStatus::DeliveryUnknown);
    assert_eq!(durable.delivery_protocol_version, Some(2));
    assert_eq!(durable.payload_fingerprint.as_deref(), Some("sha256:abc"));
    assert_eq!(durable.dispatch_barrier_at, Some(barrier));
}
