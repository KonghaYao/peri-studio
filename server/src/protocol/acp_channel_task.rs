//! Peri Task 通道：`peri/agent_event` 与 `peri/unstable_event` 规范化（对齐 Fenix ACPChannel）。

use serde_json::{Map, Value};

use peri_studio_proto::schema::{
    PeriTaskDetailAvailability, PeriTaskKind, PeriTaskSubtype,
};

use crate::state::normalized::EventBody;

use super::acp_channel::AcpChannel;
use super::acp_channel_parse::MapError;

pub(crate) const PERI_AGENT_EVENT_METHOD: &str = "peri/agent_event";
pub(crate) const PERI_UNSTABLE_EVENT_METHOD: &str = "peri/unstable_event";

const PERI_TASK_TITLE_MAX_CHARS: usize = 120;
const PERI_TASK_SUMMARY_MAX_CHARS: usize = 240;
const TASK_FALLBACK_TITLE: &str = "Task";

/// 从 `params._meta.peri.sourceAgentId` 读取子 Agent 来源（session/update 官方形态）。
pub(crate) fn extract_source_agent_id(params: &Map<String, Value>) -> Option<String> {
    let meta = params.get("_meta")?.as_object()?;
    let peri = meta.get("peri")?.as_object()?;
    let id = peri.get("sourceAgentId")?.as_str()?;
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

/// 有界、脱敏摘要（仅 string 输入；不含完整 result）。
pub(crate) fn bounded_summary(raw: &Value) -> Option<String> {
    let s = raw.as_str()?.trim();
    if s.is_empty() {
        return None;
    }
    let mut redacted = s.to_string();
    redacted = redact_urls(&redacted);
    redacted = redact_secrets(&redacted);
    redacted = redact_bearer(&redacted);
    redacted = redact_paths(&redacted);
    let redacted = redacted.trim();
    if redacted.is_empty() {
        return None;
    }
    Some(truncate_chars(redacted, PERI_TASK_SUMMARY_MAX_CHARS))
}

impl AcpChannel {
    pub(crate) fn parse_peri_agent_event(params: &Map<String, Value>) -> Result<EventBody, MapError> {
        let event_json = params
            .get("event_json")
            .and_then(Value::as_str)
            .ok_or(MapError::MissingField)?;
        normalize_peri_agent_event_json(event_json)
    }

    pub(crate) fn parse_peri_unstable_event(params: &Map<String, Value>) -> Result<EventBody, MapError> {
        let event_name = params.get("event").ok_or(MapError::MissingField)?;
        let data = params.get("data").ok_or(MapError::MissingField)?;
        normalize_peri_unstable_event(event_name, data)
    }
}

fn normalize_peri_agent_event_json(event_json: &str) -> Result<EventBody, MapError> {
    let parsed: Value = serde_json::from_str(event_json).map_err(|_| MapError::Unsupported)?;
    let record = parsed.as_object().ok_or(MapError::Unsupported)?;
    let event_type = record.get("type").and_then(Value::as_str).ok_or(MapError::Unsupported)?;
    if event_type != "subagent_started" && event_type != "subagent_stopped" {
        return Err(MapError::Unsupported);
    }
    let value = record.get("value").and_then(Value::as_object).ok_or(MapError::MissingField)?;
    let task_id = non_empty_string(value, "instance_id").ok_or(MapError::MissingField)?;

    if event_type == "subagent_started" {
        let agent_name = non_empty_string(value, "agent_name");
        let title = agent_name
            .map(|n| truncate_chars(&n, PERI_TASK_TITLE_MAX_CHARS))
            .unwrap_or_else(|| TASK_FALLBACK_TITLE.to_string());
        let is_background = value
            .get("is_background")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        return Ok(EventBody::PeriTaskStarted {
            task_id,
            kind: PeriTaskKind::Subagent,
            task_subtype: None,
            title,
            summary: None,
            source_started_at: None,
            is_background,
            detail_availability: PeriTaskDetailAvailability::Unavailable,
        });
    }

    let is_error = value
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let summary = value.get("result").and_then(bounded_summary);
    let detail_availability = if summary.is_some() {
        PeriTaskDetailAvailability::Preview
    } else {
        PeriTaskDetailAvailability::Unavailable
    };
    Ok(EventBody::PeriTaskCompleted {
        task_id,
        kind: PeriTaskKind::Subagent,
        success: !is_error,
        summary,
        duration_ms: None,
        detail_availability,
    })
}

fn normalize_peri_unstable_event(event_name: &Value, raw_data: &Value) -> Result<EventBody, MapError> {
    let event_name = event_name.as_str().ok_or(MapError::Unsupported)?;
    if !matches!(
        event_name,
        "bg-task-started" | "bg-task-completed" | "bg-task-cancelled"
    ) {
        return Err(MapError::Unsupported);
    }
    let data = raw_data.as_object().ok_or(MapError::MissingField)?;
    let task_id = non_empty_string(data, "task_id").ok_or(MapError::MissingField)?;
    let task_subtype = parse_task_subtype(data.get("kind"));

    if event_name == "bg-task-started" {
        let summary = data.get("summary").and_then(bounded_summary);
        let kind_label = data.get("kind").and_then(Value::as_str);
        let title = summary
            .as_ref()
            .map(|s| truncate_chars(s, PERI_TASK_TITLE_MAX_CHARS))
            .or_else(|| {
                kind_label.map(|k| truncate_chars(k, PERI_TASK_TITLE_MAX_CHARS))
            })
            .unwrap_or_else(|| TASK_FALLBACK_TITLE.to_string());
        let detail_availability = if summary.is_some() {
            PeriTaskDetailAvailability::Preview
        } else {
            PeriTaskDetailAvailability::Unavailable
        };
        return Ok(EventBody::PeriTaskStarted {
            task_id,
            kind: PeriTaskKind::Background,
            task_subtype,
            title,
            summary,
            source_started_at: non_empty_string(data, "started_at"),
            is_background: true,
            detail_availability,
        });
    }

    if event_name == "bg-task-completed" {
        let success = data.get("success").and_then(Value::as_bool).unwrap_or(false);
        let summary = data.get("output_preview").and_then(bounded_summary);
        let duration_ms = parse_duration_ms(data.get("duration_ms"));
        let detail_availability = if summary.is_some() {
            PeriTaskDetailAvailability::Preview
        } else {
            PeriTaskDetailAvailability::Unavailable
        };
        return Ok(EventBody::PeriTaskCompleted {
            task_id,
            kind: PeriTaskKind::Background,
            success,
            summary,
            duration_ms,
            detail_availability,
        });
    }

    Ok(EventBody::PeriTaskCancelled {
        task_id,
        kind: PeriTaskKind::Background,
        reason_code: Some("cancelled".to_string()),
    })
}

fn parse_task_subtype(kind: Option<&Value>) -> Option<PeriTaskSubtype> {
    match kind.and_then(Value::as_str)? {
        "shell" => Some(PeriTaskSubtype::Shell),
        "agent" => Some(PeriTaskSubtype::Agent),
        "workflow" => Some(PeriTaskSubtype::Workflow),
        _ => None,
    }
}

fn parse_duration_ms(value: Option<&Value>) -> Option<u64> {
    let n = value?.as_f64()?;
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    Some(n as u64)
}

fn non_empty_string(map: &Map<String, Value>, key: &str) -> Option<String> {
    let v = map.get(key)?.as_str()?;
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

fn redact_urls(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let rest = &s[i..];
        if rest.starts_with("http://") || rest.starts_with("https://") || rest.starts_with("wss://") {
            out.push_str("[REDACTED_URL]");
            i += rest
                .find(|c: char| c.is_whitespace())
                .unwrap_or(rest.len());
            continue;
        }
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn redact_secrets(s: &str) -> String {
    s.split_whitespace()
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            if lower.contains("token=")
                || lower.contains("secret=")
                || lower.contains("password=")
                || lower.contains("api_key=")
                || lower.contains("api-key=")
            {
                "[REDACTED_SECRET]"
            } else {
                word
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn redact_bearer(s: &str) -> String {
    let mut out = s.to_string();
    while let Some(idx) = out.find("Bearer ") {
        let start = idx + "Bearer ".len();
        let end = out[start..]
            .find(|c: char| c.is_whitespace())
            .map(|p| start + p)
            .unwrap_or(out.len());
        out.replace_range(start..end, "[REDACTED_SECRET]");
    }
    out
}

fn redact_paths(s: &str) -> String {
    let prefixes = [
        "~/", "/Users/", "/home/", "/var/", "/tmp/", "/private/", "/etc/", "/opt/", "/srv/",
        "/workspace/",
    ];
    let mut out = s.to_string();
    for prefix in prefixes {
        if let Some(idx) = out.find(prefix) {
            let end = out[idx..]
                .find(|c: char| c.is_whitespace())
                .map(|p| idx + p)
                .unwrap_or(out.len());
            out.replace_range(idx..end, "[REDACTED_PATH]");
        }
    }
    out
}

#[cfg(test)]
#[path = "acp_channel_task_test.rs"]
mod acp_channel_task_test;
