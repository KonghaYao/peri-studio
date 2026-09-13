//! Langfuse Public API 有界上游 GET 与 V1 DTO 映射。

use std::sync::Arc;
use std::time::Duration;

use rustls::pki_types::ServerName;
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::TlsConnector;
use url::Url;

use super::config::LangfuseConfig;

pub const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_UPSTREAM_BODY_BYTES: usize = 512 * 1024;
const TRACE_NAME_MAX_LEN: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpstreamError {
    Timeout,
    Transport,
    HttpStatus(u16),
    PayloadTooLarge,
    InvalidBody,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSummaryView {
    pub trace_count: u32,
    pub total_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_timestamp: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorTraceRowView {
    pub id: String,
    pub name: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    pub level: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSessionView {
    pub session_id: String,
    pub configured: bool,
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<MonitorSummaryView>,
    pub traces: Vec<MonitorTraceRowView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub langfuse_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TracesEnvelope {
    #[serde(default)]
    data: Vec<TraceRecord>,
}

#[derive(Debug, Deserialize)]
struct TraceRecord {
    id: Option<String>,
    name: Option<String>,
    timestamp: Option<String>,
    latency: Option<f64>,
    #[serde(rename = "latencyMs")]
    latency_ms: Option<f64>,
    #[serde(rename = "totalCost")]
    total_cost: Option<f64>,
    #[serde(rename = "calculatedTotalCost")]
    calculated_total_cost: Option<f64>,
    level: Option<String>,
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    input: Option<serde_json::Value>,
    output: Option<serde_json::Value>,
    usage: Option<UsageRecord>,
}

#[derive(Debug, Deserialize)]
struct UsageRecord {
    #[serde(rename = "totalTokens")]
    total_tokens: Option<u64>,
    #[serde(rename = "total")]
    total: Option<u64>,
}

pub async fn fetch_session_traces(
    config: &LangfuseConfig,
    session_id: &str,
) -> Result<MonitorSessionView, UpstreamError> {
    let url = config
        .traces_url(session_id)
        .map_err(|_| UpstreamError::Transport)?;
    let body = fetch_bounded_get(&url, &config.basic_authorization()).await?;
    map_traces_response(session_id, &config.api_base, body)
}

async fn fetch_bounded_get(url: &Url, authorization: &str) -> Result<Vec<u8>, UpstreamError> {
    let host = url.host_str().ok_or(UpstreamError::Transport)?;
    let port = url.port_or_known_default().ok_or(UpstreamError::Transport)?;
    let addr = format!("{host}:{port}");
    let connect = timeout(UPSTREAM_TIMEOUT, TcpStream::connect(addr));
    let stream = connect
        .await
        .map_err(|_| UpstreamError::Timeout)?
        .map_err(|_| UpstreamError::Transport)?;
    let path = url
        .path()
        .strip_prefix('/')
        .filter(|value| !value.is_empty())
        .map(|value| format!("/{value}"))
        .unwrap_or_else(|| "/".to_string());
    let target = if let Some(query) = url.query() {
        format!("{path}?{query}")
    } else {
        path
    };
    let request = format!(
        "GET {target} HTTP/1.1\r\nHost: {host}\r\nAuthorization: {authorization}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    if url.scheme() == "https" {
        let connector = tls_connector()?;
        let server_name =
            ServerName::try_from(host.to_string()).map_err(|_| UpstreamError::Transport)?;
        let mut stream = timeout(UPSTREAM_TIMEOUT, connector.connect(server_name, stream))
            .await
            .map_err(|_| UpstreamError::Timeout)?
            .map_err(|_| UpstreamError::Transport)?;
        timeout(UPSTREAM_TIMEOUT, stream.write_all(request.as_bytes()))
            .await
            .map_err(|_| UpstreamError::Timeout)?
            .map_err(|_| UpstreamError::Transport)?;
        read_response_body(&mut stream).await
    } else {
        let mut stream = stream;
        timeout(UPSTREAM_TIMEOUT, stream.write_all(request.as_bytes()))
            .await
            .map_err(|_| UpstreamError::Timeout)?
            .map_err(|_| UpstreamError::Transport)?;
        read_response_body(&mut stream).await
    }
}

async fn read_response_body<S>(stream: &mut S) -> Result<Vec<u8>, UpstreamError>
where
    S: AsyncReadExt + Unpin,
{
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let read = timeout(UPSTREAM_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| UpstreamError::Timeout)?
            .map_err(|_| UpstreamError::Transport)?;
        if read == 0 {
            break;
        }
        if buf.len().saturating_add(read) > MAX_UPSTREAM_BODY_BYTES {
            return Err(UpstreamError::PayloadTooLarge);
        }
        buf.extend_from_slice(&chunk[..read]);
    }
    parse_http_body(&buf)
}

fn parse_http_body(response: &[u8]) -> Result<Vec<u8>, UpstreamError> {
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(UpstreamError::InvalidBody)?;
    let header = std::str::from_utf8(&response[..header_end]).map_err(|_| UpstreamError::InvalidBody)?;
    let status = header
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or(UpstreamError::InvalidBody)?;
    if !(200..300).contains(&status) {
        return Err(UpstreamError::HttpStatus(status));
    }
    let body = &response[header_end + 4..];
    if body.len() > MAX_UPSTREAM_BODY_BYTES {
        return Err(UpstreamError::PayloadTooLarge);
    }
    Ok(body.to_vec())
}

fn map_traces_response(
    session_id: &str,
    api_base: &Url,
    body: Vec<u8>,
) -> Result<MonitorSessionView, UpstreamError> {
    let envelope: TracesEnvelope =
        serde_json::from_slice(&body).map_err(|_| UpstreamError::InvalidBody)?;
    let mut traces = Vec::with_capacity(envelope.data.len());
    let mut total_tokens = 0u64;
    let mut total_cost = 0.0f64;
    let mut has_cost = false;
    let mut last_timestamp: Option<String> = None;
    let mut project_id: Option<String> = None;

    for record in envelope.data {
        let _ = (&record.input, &record.output);
        let id = record.id.unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        project_id = project_id.or(record.project_id.clone());
        let name = truncate_trace_name(record.name.unwrap_or_else(|| "turn".into()));
        let timestamp = record.timestamp.unwrap_or_default();
        if !timestamp.is_empty() {
            last_timestamp = Some(timestamp.clone());
        }
        let latency_ms = record
            .latency_ms
            .or(record.latency)
            .and_then(|value| (value >= 0.0).then_some(value.round() as u64));
        let tokens = record
            .usage
            .as_ref()
            .and_then(|usage| usage.total_tokens.or(usage.total));
        if let Some(value) = tokens {
            total_tokens = total_tokens.saturating_add(value);
        }
        let cost = record.total_cost.or(record.calculated_total_cost);
        if let Some(value) = cost {
            has_cost = true;
            total_cost += value;
        }
        traces.push(MonitorTraceRowView {
            id,
            name,
            timestamp,
            latency_ms,
            tokens,
            cost_usd: cost,
            level: map_trace_level(record.level.as_deref()),
        });
    }

    let found = !traces.is_empty();
    Ok(MonitorSessionView {
        session_id: session_id.to_string(),
        configured: true,
        found,
        summary: found.then(|| MonitorSummaryView {
            trace_count: traces.len() as u32,
            total_tokens,
            total_cost_usd: has_cost.then_some(total_cost),
            last_timestamp,
        }),
        traces,
        langfuse_url: project_id.map(|project_id| build_langfuse_url(api_base, &project_id, session_id)),
    })
}

fn build_langfuse_url(api_base: &Url, project_id: &str, session_id: &str) -> String {
    let mut url = api_base.clone();
    url.set_path(&format!("/project/{project_id}/sessions/{session_id}"));
    url.set_query(None);
    url.to_string()
}

fn truncate_trace_name(name: String) -> String {
    if name.chars().count() <= TRACE_NAME_MAX_LEN {
        return name;
    }
    name.chars().take(TRACE_NAME_MAX_LEN).collect()
}

fn map_trace_level(raw: Option<&str>) -> String {
    match raw.unwrap_or("DEFAULT").trim().to_ascii_uppercase().as_str() {
        "ERROR" => "ERROR".to_string(),
        _ => "DEFAULT".to_string(),
    }
}

fn tls_connector() -> Result<TlsConnector, UpstreamError> {
    let roots = Arc::new(
        webpki_roots::TLS_SERVER_ROOTS
            .iter()
            .cloned()
            .collect::<rustls::RootCertStore>(),
    );
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(TlsConnector::from(Arc::new(config)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::langfuse::config::{DEFAULT_LANGFUSE_HOST, LangfuseConfig};
    use url::Url;

    #[test]
    fn map_traces_response_strips_input_output_and_builds_summary() {
        let body = br#"{
            "data": [
                {
                    "id": "trace-1",
                    "name": "turn",
                    "timestamp": "2026-09-13T08:00:00.000Z",
                    "latencyMs": 1200,
                    "totalCost": 0.003,
                    "level": "DEFAULT",
                    "projectId": "proj-1",
                    "input": {"secret": true},
                    "output": {"secret": true},
                    "usage": {"totalTokens": 4100}
                }
            ]
        }"#;
        let api_base = Url::parse(DEFAULT_LANGFUSE_HOST).unwrap();
        let view = map_traces_response("acp-1", &api_base, body.to_vec()).unwrap();
        assert!(view.found);
        assert_eq!(view.traces.len(), 1);
        assert_eq!(view.traces[0].tokens, Some(4100));
        assert_eq!(view.summary.as_ref().unwrap().trace_count, 1);
        assert_eq!(
            view.langfuse_url.as_deref(),
            Some("https://cloud.langfuse.com/project/proj-1/sessions/acp-1")
        );
        let json = serde_json::to_value(&view).unwrap();
        assert!(json.get("input").is_none());
        assert!(json.get("output").is_none());
        assert!(json["traces"][0].get("input").is_none());
    }

    #[test]
    fn empty_traces_returns_found_false() {
        let api_base = Url::parse(DEFAULT_LANGFUSE_HOST).unwrap();
        let view = map_traces_response("acp-1", &api_base, br#"{"data":[]}"#.to_vec()).unwrap();
        assert!(!view.found);
        assert!(view.summary.is_none());
        assert!(view.traces.is_empty());
    }

    #[tokio::test]
    async fn fetch_bounded_get_reads_fake_upstream() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let _ = stream.read(&mut buf).await;
            let body = br#"{"data":[{"id":"t1","name":"turn","timestamp":"2026-09-13T08:00:00.000Z"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.write_all(body).await.unwrap();
        });
        let mut url = Url::parse(&format!("http://127.0.0.1:{}", addr.port())).unwrap();
        url.set_path("/api/public/traces");
        url.set_query(Some("sessionId=acp-1&limit=50"));
        let body = fetch_bounded_get(&url, "Basic dGVzdA==").await.unwrap();
        server.await.unwrap();
        let envelope: TracesEnvelope = serde_json::from_slice(&body).unwrap();
        assert_eq!(envelope.data.len(), 1);
    }

    #[test]
    fn traces_url_is_fixed_public_path() {
        let config = LangfuseConfig {
            public_key: "pk".into(),
            secret_key: "sk".into(),
            api_base: Url::parse("https://lf.example").unwrap(),
        };
        let url = config.traces_url("acp-1").unwrap();
        assert_eq!(url.path(), "/api/public/traces");
        assert!(url.query().unwrap().contains("sessionId=acp-1"));
    }
}
