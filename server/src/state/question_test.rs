//! Question CAS 测试（WP-C；镜像 Fenix `state/question.ts` 语义）。

use peri_studio_proto::schema::{
    QuestionAnswer, QuestionItemProjection, QuestionOptionProjection, QuestionProjection,
    QuestionStatus,
};

use crate::state::doc_pair::DocPair;
use crate::state::factory::Factory;
use crate::state::question::{expire, respond, upsert, QuestionCasOutcome};

fn pair_with_question(id: &str) -> DocPair {
    let mut p = Factory::new().create_chat_doc();
    upsert(
        &mut p,
        &QuestionProjection {
            question_id: id.to_string(),
            status: QuestionStatus::Pending,
            questions: vec![QuestionItemProjection {
                question: "Pick one".to_string(),
                header: None,
                multi_select: false,
                options: vec![QuestionOptionProjection {
                    label: "A".to_string(),
                    description: None,
                }],
            }],
            description: None,
            expires_at: "2026-09-08T12:01:00Z".to_string(),
            answer: None,
        },
    );
    p
}

#[test]
fn respond_pending_migrates_once() {
    let mut p = pair_with_question("q1");
    assert_eq!(
        respond(&mut p, "q1", &[QuestionAnswer::Single("A".to_string())]),
        QuestionCasOutcome::Migrated
    );
    assert_eq!(
        respond(&mut p, "q1", &[QuestionAnswer::Single("A".to_string())]),
        QuestionCasOutcome::Duplicate
    );
}

#[test]
fn expire_pending_migrates_once() {
    let mut p = pair_with_question("q2");
    assert_eq!(expire(&mut p, "q2"), QuestionCasOutcome::Migrated);
    assert_eq!(expire(&mut p, "q2"), QuestionCasOutcome::Duplicate);
}

#[test]
fn respond_after_expired_is_expired_outcome() {
    let mut p = pair_with_question("q3");
    assert_eq!(expire(&mut p, "q3"), QuestionCasOutcome::Migrated);
    assert_eq!(
        respond(&mut p, "q3", &[QuestionAnswer::Single("A".to_string())]),
        QuestionCasOutcome::Expired
    );
}

#[test]
fn unknown_question_is_unknown() {
    let mut p = pair_with_question("q4");
    assert_eq!(
        respond(
            &mut p,
            "missing",
            &[QuestionAnswer::Single("x".to_string())]
        ),
        QuestionCasOutcome::Unknown
    );
}
