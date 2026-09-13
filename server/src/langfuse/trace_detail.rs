//! Langfuse 单 trace 详情与 observation 树映射（树列表不含 IO；详情含有界 preview）。

use serde::Deserialize;

use super::config::LangfuseConfig;
use super::upstream::{fetch_bounded_get, UpstreamError, MAX_UPSTREAM_BODY_BYTES};

const OBSERVATION_NAME_MAX_LEN: usize = 120;
const MAX_OBSERVATIONS: usize = 200;
/// observation input/output preview 上限（8 KiB UTF-8 字节）。
const IO_PREVIEW_MAX_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorObservationView {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    pub level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_data_type: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<MonitorObservationView>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorTraceDetailView {
    pub session_id: String,
    pub trace_id: String,
    pub name: String,
    pub observations: Vec<MonitorObservationView>,
}

#[derive(Debug, Deserialize)]
struct TraceDetailRecord {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    observations: Option<Vec<ObservationRecord>>,
}

#[derive(Debug, Deserialize)]
struct ObservationRecord {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    latency: Option<f64>,
    #[serde(rename = "latencyMs")]
    latency_ms: Option<f64>,
    level: Option<String>,
    model: Option<String>,
    #[serde(rename = "parentObservationId")]
    parent_observation_id: Option<String>,
    input: Option<serde_json::Value>,
    output: Option<serde_json::Value>,
    value: Option<serde_json::Value>,
    #[serde(rename = "dataType")]
    data_type: Option<String>,
    usage: Option<UsageRecord>,
}

#[derive(Debug, Deserialize)]
struct UsageRecord {
    #[serde(rename = "totalTokens")]
    total_tokens: Option<u64>,
    total: Option<u64>,
    #[serde(rename = "inputTokens")]
    input_tokens: Option<u64>,
    #[serde(rename = "outputTokens")]
    output_tokens: Option<u64>,
}

pub async fn fetch_trace_detail(
    config: &LangfuseConfig,
    session_id: &str,
    trace_id: &str,
) -> Result<MonitorTraceDetailView, UpstreamError> {
    let url = config
        .trace_url(trace_id)
        .map_err(|_| UpstreamError::Transport)?;
    let body = fetch_bounded_get(&url, &config.basic_authorization()).await?;
    map_trace_detail_response(session_id, trace_id, body)
}

fn map_trace_detail_response(
    expected_session_id: &str,
    expected_trace_id: &str,
    body: Vec<u8>,
) -> Result<MonitorTraceDetailView, UpstreamError> {
    if body.len() > MAX_UPSTREAM_BODY_BYTES {
        return Err(UpstreamError::PayloadTooLarge);
    }
    let record: TraceDetailRecord =
        serde_json::from_slice(&body).map_err(|_| UpstreamError::InvalidBody)?;
    let trace_id = record.id.unwrap_or_default();
    if trace_id.is_empty() || trace_id != expected_trace_id {
        return Err(UpstreamError::HttpStatus(404));
    }
    let actual_session_id = record.session_id.unwrap_or_default();
    if actual_session_id != expected_session_id {
        return Err(UpstreamError::HttpStatus(404));
    }
    let observations = record
        .observations
        .unwrap_or_default()
        .into_iter()
        .take(MAX_OBSERVATIONS)
        .map(map_observation_record)
        .collect::<Vec<_>>();
    Ok(MonitorTraceDetailView {
        session_id: expected_session_id.to_string(),
        trace_id: expected_trace_id.to_string(),
        name: truncate_observation_name(record.name.unwrap_or_else(|| "Untitled trace".into())),
        observations: build_observation_tree(observations),
    })
}

fn map_observation_record(record: ObservationRecord) -> FlatObservation {
    let kind = map_observation_kind(record.kind.as_deref());
    let (input_preview, input_truncated) = record
        .input
        .as_ref()
        .map(serialize_io_preview)
        .unwrap_or((None, false));
    let (output_preview, output_truncated) = record
        .output
        .as_ref()
        .map(serialize_io_preview)
        .unwrap_or((None, false));
    let (score_value, score_data_type) = if kind == "SCORE" {
        (
            record.value.as_ref().and_then(format_score_value),
            record
                .data_type
                .filter(|value| !value.trim().is_empty()),
        )
    } else {
        (None, None)
    };
    FlatObservation {
        id: record.id.unwrap_or_default(),
        name: truncate_observation_name(record.name.unwrap_or_else(|| "Untitled observation".into())),
        kind,
        latency_ms: record
            .latency_ms
            .or(record.latency)
            .and_then(|value| (value >= 0.0).then_some(value.round() as u64)),
        level: map_observation_level(record.level.as_deref()),
        model: record.model.filter(|value| !value.trim().is_empty()),
        tokens: record
            .usage
            .as_ref()
            .and_then(|usage| usage.total_tokens.or(usage.total)),
        input_tokens: record
            .usage
            .as_ref()
            .and_then(|usage| usage.input_tokens),
        output_tokens: record
            .usage
            .as_ref()
            .and_then(|usage| usage.output_tokens),
        input_preview,
        output_preview,
        input_truncated: input_truncated.then_some(true),
        output_truncated: output_truncated.then_some(true),
        score_value,
        score_data_type,
        parent_id: record.parent_observation_id.filter(|value| !value.is_empty()),
    }
}

#[derive(Debug, Clone)]
struct FlatObservation {
    id: String,
    name: String,
    kind: String,
    latency_ms: Option<u64>,
    level: String,
    model: Option<String>,
    tokens: Option<u64>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    input_preview: Option<String>,
    output_preview: Option<String>,
    input_truncated: Option<bool>,
    output_truncated: Option<bool>,
    score_value: Option<String>,
    score_data_type: Option<String>,
    parent_id: Option<String>,
}

fn build_observation_tree(flat: Vec<FlatObservation>) -> Vec<MonitorObservationView> {
    let items: Vec<FlatObservation> = flat.into_iter().filter(|item| !item.id.is_empty()).collect();
    let ids: std::collections::HashSet<String> = items.iter().map(|item| item.id.clone()).collect();
    items
        .iter()
        .filter(|item| {
            item.parent_id
                .as_ref()
                .is_none_or(|parent| !ids.contains(parent))
        })
        .map(|item| build_observation_node(item, &items))
        .collect()
}

fn build_observation_node(item: &FlatObservation, items: &[FlatObservation]) -> MonitorObservationView {
    let children = items
        .iter()
        .filter(|child| child.parent_id.as_deref() == Some(item.id.as_str()))
        .map(|child| build_observation_node(child, items))
        .collect();
    MonitorObservationView {
        id: item.id.clone(),
        name: item.name.clone(),
        kind: item.kind.clone(),
        latency_ms: item.latency_ms,
        level: item.level.clone(),
        model: item.model.clone(),
        tokens: item.tokens,
        input_tokens: item.input_tokens,
        output_tokens: item.output_tokens,
        input_preview: item.input_preview.clone(),
        output_preview: item.output_preview.clone(),
        input_truncated: item.input_truncated,
        output_truncated: item.output_truncated,
        score_value: item.score_value.clone(),
        score_data_type: item.score_data_type.clone(),
        children,
    }
}

fn serialize_io_preview(value: &serde_json::Value) -> (Option<String>, bool) {
    let text = match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => return (None, false),
        other => other.to_string(),
    };
    if text.is_empty() {
        return (None, false);
    }
    if text.len() <= IO_PREVIEW_MAX_BYTES {
        return (Some(text), false);
    }
    (Some(truncate_utf8_bytes(&text, IO_PREVIEW_MAX_BYTES)), true)
}

fn truncate_utf8_bytes(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

fn format_score_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Number(number) => Some(number.to_string()),
        serde_json::Value::Bool(flag) => Some(flag.to_string()),
        serde_json::Value::String(text) if !text.is_empty() => Some(text.clone()),
        _ => None,
    }
}

fn truncate_observation_name(name: String) -> String {
    if name.chars().count() <= OBSERVATION_NAME_MAX_LEN {
        return name;
    }
    name.chars().take(OBSERVATION_NAME_MAX_LEN).collect()
}

fn map_observation_kind(raw: Option<&str>) -> String {
    match raw.unwrap_or("SPAN").trim().to_ascii_uppercase().as_str() {
        "GENERATION" => "GENERATION".to_string(),
        "EVENT" => "EVENT".to_string(),
        "SCORE" => "SCORE".to_string(),
        _ => "SPAN".to_string(),
    }
}

fn map_observation_level(raw: Option<&str>) -> String {
    match raw.unwrap_or("DEFAULT").trim().to_ascii_uppercase().as_str() {
        "ERROR" => "ERROR".to_string(),
        "WARNING" => "WARNING".to_string(),
        "DEBUG" => "DEBUG".to_string(),
        _ => "DEFAULT".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_observations_into_tree_with_bounded_io_preview() {
        let body = br#"{
            "id": "trace-1",
            "name": "turn",
            "sessionId": "acp-1",
            "observations": [
                {
                    "id": "root",
                    "name": "agent",
                    "type": "SPAN",
                    "latencyMs": 900,
                    "level": "DEFAULT",
                    "input": {"task": "run"},
                    "output": {"status": "ok"}
                },
                {
                    "id": "child",
                    "name": "llm",
                    "type": "GENERATION",
                    "latencyMs": 700,
                    "level": "DEFAULT",
                    "parentObservationId": "root",
                    "model": "gpt-4",
                    "usage": {"totalTokens": 1200, "inputTokens": 900, "outputTokens": 300},
                    "input": {"prompt": "hello"},
                    "output": {"text": "world"}
                },
                {
                    "id": "score-1",
                    "name": "cache-hit-rate-low",
                    "type": "SCORE",
                    "level": "DEFAULT",
                    "parentObservationId": "root",
                    "value": 0.42,
                    "dataType": "NUMERIC"
                }
            ]
        }"#;
        let view = map_trace_detail_response("acp-1", "trace-1", body.to_vec()).unwrap();
        assert_eq!(view.trace_id, "trace-1");
        assert_eq!(view.observations.len(), 1);
        assert_eq!(view.observations[0].children.len(), 2);
        let generation = &view.observations[0].children[0];
        assert_eq!(generation.model.as_deref(), Some("gpt-4"));
        assert_eq!(generation.tokens, Some(1200));
        assert_eq!(generation.input_tokens, Some(900));
        assert_eq!(generation.output_tokens, Some(300));
        assert_eq!(generation.input_preview.as_deref(), Some("{\"prompt\":\"hello\"}"));
        assert_eq!(generation.output_preview.as_deref(), Some("{\"text\":\"world\"}"));
        assert_eq!(generation.input_truncated, None);
        let score = &view.observations[0].children[1];
        assert_eq!(score.kind, "SCORE");
        assert_eq!(score.score_value.as_deref(), Some("0.42"));
        assert_eq!(score.score_data_type.as_deref(), Some("NUMERIC"));
    }

    #[test]
    fn truncates_large_io_preview() {
        let long = "x".repeat(IO_PREVIEW_MAX_BYTES + 64);
        let body = format!(
            r#"{{"id":"trace-1","sessionId":"acp-1","observations":[{{"id":"gen","name":"step","type":"GENERATION","level":"DEFAULT","input":"{long}"}}]}}"#,
        );
        let view = map_trace_detail_response("acp-1", "trace-1", body.into_bytes()).unwrap();
        let preview = view.observations[0].input_preview.as_deref().unwrap();
        assert_eq!(preview.len(), IO_PREVIEW_MAX_BYTES);
        assert_eq!(view.observations[0].input_truncated, Some(true));
    }

    #[test]
    fn rejects_session_mismatch_as_not_found() {
        let body = br#"{"id":"trace-1","sessionId":"other","observations":[]}"#;
        assert_eq!(
            map_trace_detail_response("acp-1", "trace-1", body.to_vec()),
            Err(UpstreamError::HttpStatus(404))
        );
    }
}
