//! ACPChannel `interactive_question` 私有帧规范化（acp_channel 拆分产物）。
//!
//! 将 acp-link AskUserQuestion 帧映射为 [`EventBody::QuestionRequested`]；
//! 非法结构在 normalize 层 fail-closed → Dropped（与 Intent G1 一致）。

use chrono::DateTime;
use serde_json::Value;

use peri_studio_proto::schema::{
    QuestionAnswer, QuestionItemProjection, QuestionOptionProjection,
};

use super::acp_channel_parse::{string_field, truncate_identifier, truncate_text, MapError};

pub(crate) const QUESTION_TIMEOUT_SECS: u64 = 60;

const QUESTION_ID_MAX_BYTES: usize = 128;
const QUESTION_TEXT_MAX_BYTES: usize = 2 * 1024;
const QUESTION_HEADER_MAX_BYTES: usize = 160;
const QUESTION_DESCRIPTION_MAX_BYTES: usize = 2 * 1024;
const QUESTION_OPTION_LABEL_MAX_BYTES: usize = 256;
const QUESTION_OPTION_DESCRIPTION_MAX_BYTES: usize = 512;
const QUESTION_MAX_ITEMS: usize = 8;
const QUESTION_OPTION_MAX_ITEMS: usize = 16;

pub(crate) struct QuestionRequestedFields {
    pub question_id: String,
    pub tool_id: Option<String>,
    pub tool_name: Option<String>,
    pub description: Option<String>,
    pub questions: Vec<QuestionItemProjection>,
    pub expires_at: String,
}

pub(crate) fn map_interactive_question(
    payload: &serde_json::Map<String, Value>,
    now_rfc3339: &str,
) -> Result<QuestionRequestedFields, MapError> {
    let question_id = required_bounded(payload, "questionId", "question_id", QUESTION_ID_MAX_BYTES)?;
    let questions_raw = payload
        .get("questions")
        .or_else(|| payload.get("Questions"))
        .ok_or(MapError::MissingField)?;
    let questions = extract_question_items(questions_raw)?;
    if questions.is_empty() {
        return Err(MapError::MissingField);
    }
    let expires_at = question_expires_at(now_rfc3339);
    Ok(QuestionRequestedFields {
        question_id,
        tool_id: optional_bounded(payload, "toolId", "tool_id", QUESTION_ID_MAX_BYTES),
        tool_name: optional_bounded(payload, "toolName", "tool_name", QUESTION_HEADER_MAX_BYTES),
        description: optional_bounded(payload, "description", "description", QUESTION_DESCRIPTION_MAX_BYTES),
        questions,
        expires_at,
    })
}

/// Fenix 私有 `question_resolved` → [`EventBody::QuestionResolved`]（G4.3）。
pub(crate) fn map_question_resolved(
    payload: &serde_json::Map<String, Value>,
) -> Result<(String, Vec<QuestionAnswer>), MapError> {
    let question_id = required_bounded(payload, "questionId", "question_id", QUESTION_ID_MAX_BYTES)?;
    let answers = extract_question_resolved_answers(payload)?;
    if !has_nonempty_question_answer(&answers) {
        return Err(MapError::MissingField);
    }
    Ok((question_id, answers))
}

fn extract_question_resolved_answers(
    payload: &serde_json::Map<String, Value>,
) -> Result<Vec<QuestionAnswer>, MapError> {
    let raw = if payload
        .get("answers")
        .is_some_and(|v| v.is_array())
    {
        payload.get("answers").unwrap()
    } else if payload
        .get("optionIds")
        .or_else(|| payload.get("option_ids"))
        .is_some_and(|v| v.is_array())
    {
        payload
            .get("optionIds")
            .or_else(|| payload.get("option_ids"))
            .unwrap()
    } else if let Some(single) = string_field(payload, "optionId", "option_id")
        .filter(|s| !s.is_empty())
    {
        return Ok(vec![QuestionAnswer::Single(truncate_identifier(&single))]);
    } else {
        return Err(MapError::MissingField);
    };
    let Some(entries) = raw.as_array() else {
        return Err(MapError::MissingField);
    };
    normalize_question_answers(entries)
}

fn normalize_question_answers(entries: &[Value]) -> Result<Vec<QuestionAnswer>, MapError> {
    if entries.is_empty() {
        return Err(MapError::MissingField);
    }
    Ok(entries.iter().map(normalize_one_question_answer).collect())
}

fn normalize_one_question_answer(entry: &Value) -> QuestionAnswer {
    match entry {
        Value::String(s) => QuestionAnswer::Single(truncate_text(s)),
        Value::Array(arr) => {
            let options: Vec<String> = arr
                .iter()
                .filter_map(|v| {
                    v.as_str()
                        .filter(|s| !s.is_empty())
                        .map(|s| truncate_text(s).into())
                })
                .collect();
            QuestionAnswer::Multiple(options)
        }
        _ => QuestionAnswer::Single(String::new()),
    }
}

fn has_nonempty_question_answer(answers: &[QuestionAnswer]) -> bool {
    answers.iter().any(|answer| match answer {
        QuestionAnswer::Single(s) => !s.is_empty(),
        QuestionAnswer::Multiple(opts) => !opts.is_empty(),
    })
}

fn question_expires_at(now_rfc3339: &str) -> String {
    match DateTime::parse_from_rfc3339(now_rfc3339) {
        Ok(t) => (t + chrono::Duration::seconds(QUESTION_TIMEOUT_SECS as i64)).to_rfc3339(),
        Err(_) => (chrono::Utc::now() + chrono::Duration::seconds(QUESTION_TIMEOUT_SECS as i64))
            .to_rfc3339(),
    }
}

fn required_bounded(
    payload: &serde_json::Map<String, Value>,
    camel: &str,
    snake: &str,
    max_bytes: usize,
) -> Result<String, MapError> {
    let value = string_field(payload, camel, snake).ok_or(MapError::MissingField)?;
    if !bounded_nonempty(&value, max_bytes) {
        return Err(MapError::MissingField);
    }
    Ok(truncate_identifier(&value))
}

fn optional_bounded(
    payload: &serde_json::Map<String, Value>,
    camel: &str,
    snake: &str,
    max_bytes: usize,
) -> Option<String> {
    let value = string_field(payload, camel, snake)?;
    if !bounded_nonempty(&value, max_bytes) {
        return None;
    }
    Some(truncate_identifier(&value))
}

fn bounded_nonempty(value: &str, max_bytes: usize) -> bool {
    !value.is_empty() && value.len() <= max_bytes && !value.chars().any(char::is_control)
}

fn extract_question_items(raw: &Value) -> Result<Vec<QuestionItemProjection>, MapError> {
    let Some(entries) = raw.as_array() else {
        return Err(MapError::MissingField);
    };
    if entries.is_empty() || entries.len() > QUESTION_MAX_ITEMS {
        return Err(MapError::MissingField);
    }
    let mut items = Vec::with_capacity(entries.len());
    for entry in entries {
        let Some(record) = entry.as_object() else {
            continue;
        };
        let question = match string_field(record, "question", "question") {
            Some(q) if bounded_nonempty(&q, QUESTION_TEXT_MAX_BYTES) => truncate_text(&q),
            _ => continue,
        };
        let header = string_field(record, "header", "header")
            .filter(|h| bounded_nonempty(h, QUESTION_HEADER_MAX_BYTES))
            .map(|h| truncate_text(&h));
        let options = extract_options(record.get("options"))?;
        let multi_select = record
            .get("multiSelect")
            .or_else(|| record.get("multi_select"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        items.push(QuestionItemProjection {
            question,
            header,
            options,
            multi_select,
        });
    }
    Ok(items)
}

fn extract_options(raw: Option<&Value>) -> Result<Vec<QuestionOptionProjection>, MapError> {
    let Some(array) = raw.and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    if array.len() > QUESTION_OPTION_MAX_ITEMS {
        return Err(MapError::MissingField);
    }
    let mut options = Vec::new();
    for entry in array {
        let Some(record) = entry.as_object() else {
            continue;
        };
        let label = match string_field(record, "label", "label") {
            Some(l) if bounded_nonempty(&l, QUESTION_OPTION_LABEL_MAX_BYTES) => truncate_text(&l),
            _ => continue,
        };
        let description = string_field(record, "description", "description")
            .filter(|d| bounded_nonempty(d, QUESTION_OPTION_DESCRIPTION_MAX_BYTES))
            .map(|d| truncate_text(&d));
        options.push(QuestionOptionProjection { label, description });
    }
    Ok(options)
}
