//! `interactive_question` normalize 与非法帧 Dropped（WP-A / G1）。

use serde_json::json;

use crate::state::normalized::EventBody;

use super::*;

fn interactive_question_frame(question_id: &str) -> serde_json::Value {
    json!({
        "type": "interactive_question",
        "payload": {
            "sessionId": "ses_1",
            "questionId": question_id,
            "toolId": "toolu_1",
            "toolName": "AskUserQuestion",
            "questions": [{
                "question": "Which deployment target should I use?",
                "header": "Deployment Target",
                "options": [
                    { "label": "production", "description": "Production environment" },
                    { "label": "staging", "description": "Staging environment" }
                ]
            }],
            "description": "Please answer the following questions"
        }
    })
}

#[test]
fn interactive_question_normalizes_to_question_requested() {
    match norm(interactive_question_frame("iqa_1")) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::QuestionRequested {
                question_id,
                tool_id,
                tool_name,
                description,
                questions,
                expires_at,
            } => {
                assert_eq!(question_id, "iqa_1");
                assert_eq!(tool_id.as_deref(), Some("toolu_1"));
                assert_eq!(tool_name.as_deref(), Some("AskUserQuestion"));
                assert_eq!(
                    description.as_deref(),
                    Some("Please answer the following questions")
                );
                assert_eq!(questions.len(), 1);
                assert_eq!(
                    questions[0].question,
                    "Which deployment target should I use?"
                );
                assert_eq!(questions[0].options.len(), 2);
                assert!(!expires_at.is_empty());
            }
            other => panic!("expected question_requested, got {other:?}"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn question_resolved_normalizes_to_event() {
    let frame = json!({
        "type": "question_resolved",
        "payload": {
            "sessionId": "ses_1",
            "questionId": "iqa_1",
            "answers": ["production"]
        }
    });
    match norm(frame) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::QuestionResolved {
                question_id,
                answers,
            } => {
                assert_eq!(question_id, "iqa_1");
                assert_eq!(
                    answers,
                    vec![peri_studio_proto::schema::QuestionAnswer::Single(
                        "production".into()
                    )]
                );
            }
            other => panic!("expected question_resolved, got {other:?}"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn question_resolved_accepts_option_ids_compat() {
    let frame = json!({
        "type": "question_resolved",
        "payload": {
            "sessionId": "ses_1",
            "questionId": "iqa_2",
            "optionIds": ["staging", ["a", "b"]]
        }
    });
    match norm(frame) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::QuestionResolved { answers, .. } => {
                assert_eq!(answers.len(), 2);
                assert_eq!(
                    answers[0],
                    peri_studio_proto::schema::QuestionAnswer::Single("staging".into())
                );
                assert_eq!(
                    answers[1],
                    peri_studio_proto::schema::QuestionAnswer::Multiple(vec![
                        "a".into(),
                        "b".into()
                    ])
                );
            }
            other => panic!("expected question_resolved, got {other:?}"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn question_resolved_missing_question_id_is_dropped() {
    let frame = json!({
        "type": "question_resolved",
        "payload": {
            "sessionId": "ses_1",
            "answers": ["production"]
        }
    });
    assert!(matches!(
        norm(frame),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}

#[test]
fn question_resolved_without_valid_answers_is_dropped() {
    let frame = json!({
        "type": "question_resolved",
        "payload": {
            "sessionId": "ses_1",
            "questionId": "iqa_1",
            "answers": []
        }
    });
    assert!(matches!(
        norm(frame),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}

#[test]
fn interactive_question_missing_question_id_is_dropped() {
    let mut frame = interactive_question_frame("iqa_1");
    frame["payload"]
        .as_object_mut()
        .unwrap()
        .remove("questionId");
    assert!(matches!(
        norm(frame),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}

#[test]
fn interactive_question_without_valid_questions_is_dropped() {
    let frame = json!({
        "type": "interactive_question",
        "payload": {
            "sessionId": "ses_1",
            "questionId": "iqa_1",
            "questions": []
        }
    });
    assert!(matches!(
        norm(frame),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}

#[test]
fn private_plan_frame_normalizes_to_agent_plan() {
    let frame = json!({
        "type": "plan",
        "payload": {
            "sessionId": "ses_1",
            "entries": [{ "content": "step", "status": "pending", "priority": "medium" }]
        }
    });
    match norm(frame) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::AgentPlan { entries } => {
                assert_eq!(entries.len(), 1);
                assert_eq!(entries[0].content, "step");
            }
            other => panic!("expected agent_plan, got {other:?}"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn private_plan_frame_without_entries_is_dropped() {
    let frame = json!({
        "type": "plan",
        "payload": { "sessionId": "ses_1" }
    });
    assert!(matches!(
        norm(frame),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}
