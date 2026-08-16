//! 应答校验：按字段 schema 校验 elicitation 应答。
//!
//! 拆分动机：`execute` 主流程（持久化 → CAS 投影 → 交付）与应答校验
//! （`validate_answers` / `answer_is_empty`）合计超 500 行，按"校验"主题
//! 拆出。字段 schema（Text / SingleSelect / MultiSelect）校验规则与错误
//! 消息保持不变；函数可见性提升为 `pub(super)` 仅为了跨子模块调用，
//! 对外 pub 面不变。

use std::collections::{HashMap, HashSet};

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::{
    ElicitationAnswer, ElicitationResponseAction, RespondElicitationPayload,
};
use peri_studio_proto::schema::{ElicitationFieldKind, ElicitationFieldProjection};

use super::{failure, ElicitationResponseFailure};

pub(super) fn validate_answers(
    payload: &RespondElicitationPayload,
    fields: &[ElicitationFieldProjection],
) -> Result<(), ElicitationResponseFailure> {
    if payload.action != ElicitationResponseAction::Accept {
        if payload.answers.is_empty() {
            return Ok(());
        }
        return Err(failure(
            ErrorCode::InvalidState,
            "decline and cancel responses cannot contain answers",
            false,
            "answers_for_non_accept",
        ));
    }
    let by_id = fields
        .iter()
        .map(|field| (field.id.as_str(), field))
        .collect::<HashMap<_, _>>();
    if payload
        .answers
        .keys()
        .any(|id| !by_id.contains_key(id.as_str()))
    {
        return Err(failure(
            ErrorCode::InvalidState,
            "elicitation response contains an unknown field",
            false,
            "unknown_field",
        ));
    }
    for field in fields {
        let answer = payload.answers.get(&field.id);
        if field.required && answer.is_none_or(answer_is_empty) {
            return Err(failure(
                ErrorCode::InvalidState,
                "a required elicitation field is missing",
                false,
                "required_missing",
            ));
        }
        let Some(answer) = answer else { continue };
        match (&field.kind, answer) {
            (ElicitationFieldKind::Text, ElicitationAnswer::Text(value))
                if !value.is_empty() && value.len() <= 4096 => {}
            (ElicitationFieldKind::SingleSelect, ElicitationAnswer::Text(value))
                if field.options.iter().any(|option| option.value == *value) => {}
            (ElicitationFieldKind::MultiSelect, ElicitationAnswer::Multiple(values))
                if values.len() <= field.options.len()
                    && values.iter().collect::<HashSet<_>>().len() == values.len()
                    && values
                        .iter()
                        .all(|value| field.options.iter().any(|option| option.value == *value)) => {
            }
            _ => {
                return Err(failure(
                    ErrorCode::InvalidState,
                    "elicitation answer does not match its field schema",
                    false,
                    "answer_schema_mismatch",
                ))
            }
        }
    }
    Ok(())
}

fn answer_is_empty(answer: &ElicitationAnswer) -> bool {
    match answer {
        ElicitationAnswer::Text(value) => value.is_empty(),
        ElicitationAnswer::Multiple(values) => values.is_empty(),
    }
}
