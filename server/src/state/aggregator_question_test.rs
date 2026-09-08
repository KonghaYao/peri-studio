//! WP-B：`pending_questions` 聚合写入与 CAS 投影。

use super::util::*;

use peri_studio_proto::schema::QuestionAnswer;

use crate::state::aggregator::Aggregator;
use crate::state::normalized::EventBody;

#[test]
fn question_requested_upserts_pending_questions() {
    let mut pair = pair();
    assert!(Aggregator.apply(&mut pair, &ev("s1", 1, question_requested("q1"))).applied);
    assert_eq!(pending_question_status(&pair, "q1").as_deref(), Some("pending"));

    assert!(Aggregator.apply(&mut pair, &ev("s1", 2, question_requested("q1"))).applied);
    assert_eq!(pending_question_status(&pair, "q1").as_deref(), Some("pending"));
}

#[test]
fn question_resolved_and_expired_persist_via_cas() {
    let mut pair = pair();
    assert!(Aggregator.apply(&mut pair, &ev("s1", 1, question_requested("q2"))).applied);

    assert!(Aggregator.apply(
        &mut pair,
        &ev(
            "s1",
            2,
            EventBody::QuestionResolved {
                question_id: "q2".into(),
                answers: vec![QuestionAnswer::Single("A".into())],
            },
        ),
    )
    .applied);
    assert_eq!(pending_question_status(&pair, "q2").as_deref(), Some("resolved"));

    let mut pair_expire = super::util::pair();
    assert!(Aggregator.apply(&mut pair_expire, &ev("s1", 1, question_requested("q3"))).applied);
    assert!(Aggregator.apply(
        &mut pair_expire,
        &ev(
            "s1",
            2,
            EventBody::QuestionExpired {
                question_id: "q3".into(),
            },
        ),
    )
    .applied);
    assert_eq!(pending_question_status(&pair_expire, "q3").as_deref(), Some("expired"));
}

#[test]
fn replay_question_first_projects_pending_without_synthesizing_turn() {
    let mut pair = pair();
    pair.stream.replay_active = true;
    assert!(Aggregator.apply(&mut pair, &ev("s1", 1, question_requested("q-replay"))).applied);
    assert_eq!(
        pending_question_status(&pair, "q-replay").as_deref(),
        Some("pending")
    );
    assert!(
        pair.stream.replay_turn.is_none(),
        "question-first replay must not synthesize a chat turn"
    );
    assert!(active_turn_id(&pair).is_none());
}
