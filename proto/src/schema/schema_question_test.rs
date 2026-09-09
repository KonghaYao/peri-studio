//! Question schema 与 `question/respond` payload 兼容（WP-A）。

use crate::action::RespondQuestionPayload;
use crate::schema::QuestionAnswer;

#[test]
fn respond_question_prefers_answers_over_option_ids() {
    let raw = serde_json::json!({
        "chatId": "chat-1",
        "questionId": "iqa_1",
        "answers": ["production"],
        "optionIds": ["staging"]
    });
    let decoded: RespondQuestionPayload = serde_json::from_value(raw).unwrap();
    assert_eq!(
        decoded.answers,
        vec![QuestionAnswer::Single("production".into())]
    );
}

#[test]
fn respond_question_falls_back_to_option_ids() {
    let raw = serde_json::json!({
        "chatId": "chat-1",
        "questionId": "iqa_1",
        "optionIds": ["production", ["a", "b"]]
    });
    let decoded: RespondQuestionPayload = serde_json::from_value(raw).unwrap();
    assert_eq!(decoded.answers.len(), 2);
    assert_eq!(
        decoded.answers[0],
        QuestionAnswer::Single("production".into())
    );
    assert_eq!(
        decoded.answers[1],
        QuestionAnswer::Multiple(vec!["a".into(), "b".into()])
    );
}

#[test]
fn respond_question_falls_back_to_option_id() {
    let raw = serde_json::json!({
        "chatId": "chat-1",
        "questionId": "iqa_1",
        "optionId": "production"
    });
    let decoded: RespondQuestionPayload = serde_json::from_value(raw).unwrap();
    assert_eq!(
        decoded.answers,
        vec![QuestionAnswer::Single("production".into())]
    );
}
