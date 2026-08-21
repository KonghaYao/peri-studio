//! ACPChannel 官方 `elicitation/create` 规范化（acp_channel.rs 拆分产物）。
//!
//! 拆分动机：原 acp_channel.rs 1824 行超阈值（≤500 行要求），按「解析主题」
//! 拆出本模块——官方 schema 表单 elicitation 请求的严格投影：mode/scope
//! 白名单、字段 schema 约束（String/Array 变体）、容量上限（消息/字段数/
//! 选项数/标识符与文本字节），产物 [`ElicitationRequestFields`]。
//!
//! 职责边界：本模块只含 elicitation 解析的常量、内部错误
//! （[`ElicitationMapError`]）与顶层函数；调用入口（JSON-RPC
//! `elicitation/create` 分支）在 acp_channel.rs 的 normalize_json_rpc，
//! 通用字段提取/截断 helper 在 acp_channel_parse.rs。所有函数语义与拆分前
//! 逐字符一致（仅可见性提升 pub(crate) 与文件级 use 调整）。

use std::collections::HashSet;

use serde_json::Value;

use agent_client_protocol_schema::v1::{
    CreateElicitationRequest, ElicitationMode, ElicitationPropertySchema, ElicitationScope,
    MultiSelectItems,
};
use peri_studio_proto::schema::{
    ElicitationFieldKind, ElicitationFieldProjection, ElicitationOptionProjection,
};

use super::acp_channel::ElicitationRequestFields;

const ELICITATION_MESSAGE_MAX_BYTES: usize = 2 * 1024;
const ELICITATION_FIELD_MAX_ITEMS: usize = 4;
const ELICITATION_FIELD_ID_MAX_BYTES: usize = 128;
const ELICITATION_TITLE_MAX_BYTES: usize = 160;
const ELICITATION_DESCRIPTION_MAX_BYTES: usize = 1024;
const ELICITATION_OPTION_MAX_ITEMS: usize = 16;
const ELICITATION_OPTION_VALUE_MAX_BYTES: usize = 256;
const ELICITATION_OPTION_LABEL_MAX_BYTES: usize = 256;
const ELICITATION_OPTION_DESCRIPTION_MAX_BYTES: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ElicitationMapError {
    Invalid,
    Unsupported,
}

pub(crate) fn normalize_elicitation_request(
    request_id: &Value,
    params: &serde_json::Map<String, Value>,
) -> Result<ElicitationRequestFields, ElicitationMapError> {
    let request: CreateElicitationRequest = serde_json::from_value(Value::Object(params.clone()))
        .map_err(|_| ElicitationMapError::Invalid)?;
    let ElicitationMode::Form(form) = request.mode else {
        return Err(ElicitationMapError::Unsupported);
    };
    let ElicitationScope::Session(scope) = form.scope else {
        return Err(ElicitationMapError::Unsupported);
    };
    let session_id = scope.session_id.to_string();
    if !bounded_nonempty(&session_id, ELICITATION_FIELD_ID_MAX_BYTES)
        || !bounded_nonempty(&request.message, ELICITATION_MESSAGE_MAX_BYTES)
        || form.requested_schema.properties.is_empty()
        || form.requested_schema.properties.len() > ELICITATION_FIELD_MAX_ITEMS
    {
        return Err(ElicitationMapError::Invalid);
    }
    let required = form
        .requested_schema
        .required
        .unwrap_or_default()
        .into_iter()
        .collect::<HashSet<_>>();
    if required
        .iter()
        .any(|id| !form.requested_schema.properties.contains_key(id))
    {
        return Err(ElicitationMapError::Invalid);
    }
    let fields = form
        .requested_schema
        .properties
        .into_iter()
        .map(|(id, schema)| normalize_elicitation_field(id, schema, &required))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ElicitationRequestFields {
        request_id: request_id.clone(),
        elicitation_id: uuid::Uuid::new_v4().to_string(),
        session_id,
        message: request.message,
        fields,
    })
}

fn normalize_elicitation_field(
    id: String,
    schema: ElicitationPropertySchema,
    required: &HashSet<String>,
) -> Result<ElicitationFieldProjection, ElicitationMapError> {
    if !bounded_nonempty(&id, ELICITATION_FIELD_ID_MAX_BYTES) || id.chars().any(char::is_control) {
        return Err(ElicitationMapError::Invalid);
    }
    let (title, description, kind, options) = match schema {
        ElicitationPropertySchema::String(value) => {
            if value.min_length.is_some()
                || value.max_length.is_some()
                || value.pattern.is_some()
                || value.format.is_some()
                || value.default.is_some()
                || (value.enum_values.is_some() && value.one_of.is_some())
            {
                return Err(ElicitationMapError::Unsupported);
            }
            let options = if let Some(values) = value.enum_values {
                normalize_plain_options(values)?
            } else if let Some(values) = value.one_of {
                normalize_titled_options(values)?
            } else {
                Vec::new()
            };
            let kind = if options.is_empty() {
                ElicitationFieldKind::Text
            } else {
                ElicitationFieldKind::SingleSelect
            };
            (value.title, value.description, kind, options)
        }
        ElicitationPropertySchema::Array(value) => {
            if value.min_items.is_some() || value.max_items.is_some() || value.default.is_some() {
                return Err(ElicitationMapError::Unsupported);
            }
            let options = match value.items {
                MultiSelectItems::String(items) => normalize_plain_options(items.values)?,
                MultiSelectItems::Titled(items) => normalize_titled_options(items.options)?,
                _ => return Err(ElicitationMapError::Unsupported),
            };
            (
                value.title,
                value.description,
                ElicitationFieldKind::MultiSelect,
                options,
            )
        }
        _ => return Err(ElicitationMapError::Unsupported),
    };
    let title = title.unwrap_or_else(|| id.clone());
    if !bounded_nonempty(&title, ELICITATION_TITLE_MAX_BYTES)
        || description
            .as_deref()
            .is_some_and(|value| !bounded(value, ELICITATION_DESCRIPTION_MAX_BYTES))
    {
        return Err(ElicitationMapError::Invalid);
    }
    Ok(ElicitationFieldProjection {
        required: required.contains(&id),
        id,
        title,
        description,
        kind,
        options,
    })
}

fn normalize_plain_options(
    values: Vec<String>,
) -> Result<Vec<ElicitationOptionProjection>, ElicitationMapError> {
    normalize_options(values.into_iter().map(|value| ElicitationOptionProjection {
        label: value.clone(),
        value,
        description: None,
    }))
}

fn normalize_titled_options(
    values: Vec<agent_client_protocol_schema::v1::EnumOption>,
) -> Result<Vec<ElicitationOptionProjection>, ElicitationMapError> {
    normalize_options(values.into_iter().map(|value| ElicitationOptionProjection {
        value: value.value,
        label: value.title,
        description: value.description,
    }))
}

fn normalize_options(
    values: impl Iterator<Item = ElicitationOptionProjection>,
) -> Result<Vec<ElicitationOptionProjection>, ElicitationMapError> {
    let values = values.collect::<Vec<_>>();
    if values.is_empty() || values.len() > ELICITATION_OPTION_MAX_ITEMS {
        return Err(ElicitationMapError::Invalid);
    }
    let mut seen = HashSet::new();
    for value in &values {
        if !bounded_nonempty(&value.value, ELICITATION_OPTION_VALUE_MAX_BYTES)
            || !bounded_nonempty(&value.label, ELICITATION_OPTION_LABEL_MAX_BYTES)
            || value.description.as_deref().is_some_and(|description| {
                !bounded(description, ELICITATION_OPTION_DESCRIPTION_MAX_BYTES)
            })
            || !seen.insert(value.value.clone())
        {
            return Err(ElicitationMapError::Invalid);
        }
    }
    Ok(values)
}

fn bounded(value: &str, max_bytes: usize) -> bool {
    value.len() <= max_bytes && !value.chars().any(|ch| ch == '\0')
}

fn bounded_nonempty(value: &str, max_bytes: usize) -> bool {
    !value.trim().is_empty() && bounded(value, max_bytes)
}
