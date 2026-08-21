//! ACPChannel 字段/解析类 helper（acp_channel.rs 拆分产物）。
//!
//! 拆分动机：原 acp_channel.rs 1824 行超阈值（≤500 行要求），本模块承载
//! **无状态纯函数**层——字段提取（camelCase 优先、snake_case 回退）、
//! 截断/脱敏（§9.3 4KB 容量约束）、replay provenance 判定、activity 指标/
//! 属性白名单解析、prediction 文本归一化，以及 map_raw 内部错误 [`MapError`]。
//!
//! 职责边界：本模块只含不依赖 [`crate::protocol::acp_channel::AcpChannel`]
//! 状态的顶层函数与常量；事件映射（map_raw/map_acp_update）、官方 request
//! 解析、agent plan/config 目录、elicitation 规范化分别在 acp_channel_map.rs
//! / acp_channel_activity.rs / acp_channel_config.rs / acp_channel_elicitation.rs。
//! 所有函数语义与拆分前逐字符一致（仅文件级 use 调整）。

use std::collections::BTreeMap;

use serde_json::Value;

use peri_studio_proto::schema::{PublicError, ToolCallStatus};

use crate::state::normalized::EventProvenance;

/// 事件正文/错误消息端到端长度上限（§9.3：4KB 截断是容量约束；脱敏先于
/// 截断——本层只提取结构化字段，自由文本仅 message 类，截断处理见
/// [`truncate_text`]）。
pub const TEXT_MAX_BYTES: usize = 4096;

const ACTIVITY_LABEL_MAX_BYTES: usize = 128;
const PREDICTION_TEXT_MAX_CHARS: usize = 200;
const PREDICTION_ACTION_MAX_ITEMS: usize = 4;

pub(crate) fn exact_replay_marker(meta: Option<&serde_json::Map<String, Value>>) -> bool {
    meta.and_then(|value| value.get("periReplay")) == Some(&Value::Bool(true))
}

pub(crate) fn acp_replay_provenance(update: &serde_json::Map<String, Value>) -> EventProvenance {
    let kind = update.get("sessionUpdate").and_then(Value::as_str);
    let marked = match kind {
        Some("agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk") => update
            .get("content")
            .and_then(Value::as_object)
            .and_then(|content| content.get("_meta"))
            .and_then(Value::as_object)
            .is_some_and(|meta| exact_replay_marker(Some(meta))),
        Some("tool_call" | "tool_call_update") => {
            exact_replay_marker(update.get("_meta").and_then(Value::as_object))
        }
        _ => false,
    };
    if marked {
        EventProvenance::PeriReplay
    } else {
        EventProvenance::Unspecified
    }
}

pub(crate) fn raw_replay_provenance(
    kind: &str,
    payload: &serde_json::Map<String, Value>,
) -> EventProvenance {
    let marked = match kind {
        "agent_message_chunk"
        | "agent_thought_chunk"
        | "agent_reasoning_chunk"
        | "user_message_chunk" => {
            payload
                .get("content")
                .and_then(Value::as_object)
                .and_then(|content| content.get("_meta"))
                .and_then(Value::as_object)
                .is_some_and(|meta| exact_replay_marker(Some(meta)))
                || exact_replay_marker(payload.get("_meta").and_then(Value::as_object))
        }
        "tool_call" | "tool_call_update" => {
            exact_replay_marker(payload.get("_meta").and_then(Value::as_object))
        }
        _ => false,
    };
    if marked {
        EventProvenance::PeriReplay
    } else {
        EventProvenance::Unspecified
    }
}

/// 双格式 sessionId 提取（§3.3/§6.1 兼容规则；提取到的是原始 acp_session_id）。
///
/// 1. 原始 `{type, payload}`：`payload.sessionId` → `payload.session_id` →
///    顶层 `sessionId`；
/// 2. JSON-RPC 包裹：`params.sessionId` → `params.session_id`（notification
///    与 response 同规则）；
/// 3. 均缺失 → None（上层按 [`DropReason::NoSessionId`] 丢弃并计数）。
pub fn extract_session_id(frame: &Value) -> Option<String> {
    let obj = frame.as_object()?;
    // 原始形态：payload 内优先。
    if let Some(payload) = obj.get("payload").and_then(Value::as_object) {
        if let Some(id) = field(payload, &["sessionId", "session_id"]) {
            return Some(id);
        }
    }
    if let Some(id) = field(obj, &["sessionId", "session_id"]) {
        return Some(id);
    }
    // JSON-RPC 形态：params 内。
    if let Some(params) = obj.get("params").and_then(Value::as_object) {
        if let Some(id) = field(params, &["sessionId", "session_id"]) {
            return Some(id);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// 字段提取 helper（camelCase 优先，snake_case 回退）
// ---------------------------------------------------------------------------

pub(crate) fn field(obj: &serde_json::Map<String, Value>, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|n| obj.get(*n).and_then(Value::as_str).map(str::to_string))
}

pub(crate) fn string_field(
    obj: &serde_json::Map<String, Value>,
    camel: &str,
    snake: &str,
) -> Option<String> {
    field(obj, &[camel, snake])
}

pub(crate) fn valid_activity_correlation(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_:-".contains(&byte)
        })
}

pub(crate) fn normalize_activity_label(value: &str) -> Option<String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    Some(truncate_at_char_boundary(
        &normalized,
        ACTIVITY_LABEL_MAX_BYTES,
    ))
}

pub(crate) fn parse_activity_metrics(
    value: Option<&Value>,
) -> Result<BTreeMap<String, u64>, MapError> {
    const KEYS: &[&str] = &[
        "tool_count",
        "duration_ms",
        "step",
        "file_count",
        "skill_count",
        "micro_cleared",
        "token_before",
        "token_after",
        "affected_count",
        "estimated_tokens_saved",
        "used_tokens",
        "total_tokens",
        "attempt",
        "max_attempts",
        "delay_ms",
        "token_count",
        "error_count",
        "warning_count",
        "files_with_errors",
        "tokens_in",
        "tokens_out",
        "agent_count",
    ];
    let Some(value) = value else {
        return Ok(BTreeMap::new());
    };
    let object = value.as_object().ok_or(MapError::MissingField)?;
    let mut result = BTreeMap::new();
    for (key, value) in object {
        if !KEYS.contains(&key.as_str()) {
            return Err(MapError::Unsupported);
        }
        let value = value.as_u64().ok_or(MapError::MissingField)?;
        if value > i64::MAX as u64 {
            return Err(MapError::Unsupported);
        }
        result.insert(key.clone(), value);
    }
    Ok(result)
}

pub(crate) fn parse_activity_attributes(
    value: Option<&Value>,
) -> Result<BTreeMap<String, String>, MapError> {
    let Some(value) = value else {
        return Ok(BTreeMap::new());
    };
    let object = value.as_object().ok_or(MapError::MissingField)?;
    let mut result = BTreeMap::new();
    for (key, value) in object {
        let value = value.as_str().ok_or(MapError::MissingField)?;
        let allowed = match key.as_str() {
            "reason" => matches!(value, "timed_out"),
            "strategy" => matches!(value, "skip" | "micro" | "full" | "smart"),
            "trigger" => matches!(value, "auto" | "manual"),
            "outcome" => matches!(
                value,
                "skipped"
                    | "micro_applied"
                    | "smart_applied"
                    | "full_applied"
                    | "full_failed"
                    | "shadowed"
                    | "micro_applied_then_full_failed"
                    | "smart_applied_then_full_failed"
                    | "interrupted_after_commit"
                    | "interrupted"
            ),
            "event_type" => matches!(
                value,
                "run_started"
                    | "phase_started"
                    | "phase_done"
                    | "agent_started"
                    | "agent_progress"
                    | "agent_done"
                    | "run_done"
            ),
            "task_kind" => matches!(value, "shell" | "agent" | "workflow"),
            "threshold" => matches!(value, "micro" | "full"),
            _ => false,
        };
        if !allowed {
            return Err(MapError::Unsupported);
        }
        result.insert(key.clone(), value.to_string());
    }
    Ok(result)
}

/// Normalize ACP's non-terminal aliases. Terminal values are handled by callers before this
/// helper; unknown or absent values remain pending for backward compatibility.
pub(crate) fn nonterminal_tool_status(status: Option<&str>) -> ToolCallStatus {
    match status {
        Some("in_progress" | "running" | "streaming") => ToolCallStatus::Running,
        Some("awaiting_permission" | "awaitingPermission") => ToolCallStatus::AwaitingPermission,
        _ => ToolCallStatus::Pending,
    }
}

/// 非负整数提取（camelCase 优先，snake_case 回退）：负数/超 u32 上限 →
/// None（缺省语义，不整体拒绝——§6.3 仅必填字段缺失才 MissingField）。
pub(crate) fn number_field(
    obj: &serde_json::Map<String, Value>,
    camel: &str,
    snake: &str,
) -> Option<u32> {
    [camel, snake]
        .iter()
        .find_map(|n| obj.get(*n).and_then(Value::as_u64))
        .and_then(|n| u32::try_from(n).ok())
}

/// 必填字符串字段：缺失 → 整体 [`DropReason::MissingField`]（§6.3 同源拒绝）。
pub(crate) fn required(
    obj: &serde_json::Map<String, Value>,
    camel: &str,
    snake: &str,
) -> Result<String, MapError> {
    string_field(obj, camel, snake).ok_or(MapError::MissingField)
}

pub(crate) fn opt_json(obj: &serde_json::Map<String, Value>, name: &str) -> Option<Value> {
    obj.get(name).cloned()
}

/// map_raw 内部错误（私有；调用方统一收敛为 [`DropReason`]，与外部
/// [`NormalizeOutcome`] 解耦——避免大 Err 变体；语义由收敛点精确映射，§6.3
/// 同源拒绝）。
#[derive(Debug, Clone, Copy)]
pub(crate) enum MapError {
    /// 缺少必要关联信息（无 turn_id 的增量等，§6.3 同源拒绝）。
    MissingField,
    /// 未知 type（§4.8 白名单精神：不静默、不 panic、供计数）。
    Unsupported,
}

/// public_error 提取（§9.3：稳定错误码 + 脱敏消息；message 截断 4KB）。
pub(crate) fn public_error(obj: &serde_json::Map<String, Value>) -> Option<PublicError> {
    let err = obj.get("publicError").or_else(|| obj.get("public_error"))?;
    let o = err.as_object()?;
    let code = string_field(o, "code", "code").unwrap_or_else(|| "AGENT_ERROR".to_string());
    let message = string_field(o, "message", "message").unwrap_or_default();
    Some(PublicError {
        code,
        message: truncate_text(&message),
    })
}

pub(crate) fn permission_options(
    obj: &serde_json::Map<String, Value>,
) -> Vec<peri_studio_proto::schema::PermissionOptions> {
    use peri_studio_proto::schema::PermissionOptions as O;
    obj.get("options")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    Some(match v.as_str()? {
                        "allow_once" | "allowOnce" => O::AllowOnce,
                        "allow_session" | "allowSession" => O::AllowSession,
                        "deny" => O::Deny,
                        _ => return None,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 脱敏截断（§9.3：4KB 容量约束；按字节截断，非法 UTF-8 边界由
/// `String::truncate` 语义规避——先按 char 边界裁剪）。
pub(crate) fn truncate_text(s: &str) -> String {
    if s.len() <= TEXT_MAX_BYTES {
        return s.to_string();
    }
    let mut end = TEXT_MAX_BYTES;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// Small opaque identifiers and labels are useful diagnostics, but must not
/// inherit the 4 KiB free-text budget of message content.
pub(crate) fn truncate_identifier(value: &str) -> String {
    const MAX_BYTES: usize = 256;
    if value.len() <= MAX_BYTES {
        return value.to_string();
    }
    let mut end = MAX_BYTES;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

pub(crate) fn truncate_at_char_boundary(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

pub(crate) fn normalize_prediction_text(value: &str) -> Result<Option<String>, MapError> {
    let mut normalized = String::new();
    let mut pending_space = false;
    let mut chars = 0usize;
    for ch in value.chars() {
        if ch.is_whitespace() || ch.is_control() {
            pending_space = !normalized.is_empty();
            continue;
        }
        if pending_space {
            normalized.push(' ');
            pending_space = false;
            chars += 1;
        }
        normalized.push(ch);
        chars += 1;
        if chars > PREDICTION_TEXT_MAX_CHARS {
            return Err(MapError::Unsupported);
        }
    }
    Ok((!normalized.is_empty()).then_some(normalized))
}

pub(crate) fn validate_prediction_actions(value: &Value) -> Result<(), MapError> {
    let actions = value.as_array().ok_or(MapError::MissingField)?;
    if actions.len() > PREDICTION_ACTION_MAX_ITEMS {
        return Err(MapError::Unsupported);
    }
    for value in actions {
        let action = value.as_object().ok_or(MapError::MissingField)?;
        let (field, allowed): (&str, &[&str]) = match action.get("kind").and_then(Value::as_str) {
            Some("placeholder") => ("text", &["kind", "text"]),
            Some("set_title") => ("title", &["kind", "title"]),
            Some("add_tag") => ("tag", &["kind", "tag"]),
            Some("summary") => ("text", &["kind", "text"]),
            Some(_) => return Err(MapError::Unsupported),
            None => return Err(MapError::MissingField),
        };
        if action.keys().any(|key| !allowed.contains(&key.as_str())) {
            return Err(MapError::Unsupported);
        }
        let content = action
            .get(field)
            .and_then(Value::as_str)
            .ok_or(MapError::MissingField)?;
        if normalize_prediction_text(content)?.is_none() {
            return Err(MapError::MissingField);
        }
    }
    Ok(())
}
