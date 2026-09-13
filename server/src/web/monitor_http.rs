//! Monitor API：`GET /api/monitor/session|trace`（cookie + loopback + Origin）。

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::net::TcpStream;
use tokio::sync::Mutex;

use crate::auth::{AuthService, TokenRole};
use crate::control::SessionCatalog;
use crate::config::Config;
use crate::langfuse::{
    fetch_session_traces, fetch_trace_detail, validate_session_id, validate_trace_id,
    SessionIdError, TraceIdError, UpstreamError,
};
use crate::web::http::security_headers;
use crate::web::http::write_http;
use crate::web::parse::valid_origin;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn serve_monitor_session(
    mut stream: TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
    config: &Config,
    catalog: &SessionCatalog,
    method: &str,
    raw_target: &str,
    cookie: Option<String>,
    host: Option<&str>,
    origin: Option<&str>,
    transfer_encoding: Option<&str>,
    content_length: Option<usize>,
) -> std::io::Result<()> {
    let headers = security_headers();
    let Some(session_id) = authorize_monitor_get(
        &mut stream,
        peer,
        auth,
        config,
        catalog,
        method,
        cookie,
        host,
        origin,
        transfer_encoding,
        content_length,
        &headers,
        raw_target,
    )
    .await?
    else {
        return Ok(());
    };
    let Some(langfuse) = config.langfuse_client_config() else {
        return write_json_error(
            &mut stream,
            "503 Service Unavailable",
            "langfuse_not_configured",
            &headers,
        )
        .await;
    };
    match fetch_session_traces(&langfuse, &session_id).await {
        Ok(view) => {
            let body = serde_json::to_vec(&view).expect("monitor view serializes");
            write_http(&mut stream, "200 OK", "application/json", &body, &headers).await
        }
        Err(error) => write_upstream_error(&mut stream, &session_id, &langfuse, error, &headers).await,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn serve_monitor_trace(
    mut stream: TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
    config: &Config,
    catalog: &SessionCatalog,
    method: &str,
    raw_target: &str,
    cookie: Option<String>,
    host: Option<&str>,
    origin: Option<&str>,
    transfer_encoding: Option<&str>,
    content_length: Option<usize>,
) -> std::io::Result<()> {
    let headers = security_headers();
    let Some(session_id) = authorize_monitor_get(
        &mut stream,
        peer,
        auth,
        config,
        catalog,
        method,
        cookie,
        host,
        origin,
        transfer_encoding,
        content_length,
        &headers,
        raw_target,
    )
    .await?
    else {
        return Ok(());
    };
    let trace_id = match parse_trace_id_query(raw_target) {
        Ok(value) => value,
        Err(TraceIdError::Missing) => {
            return write_json_error(&mut stream, "400 Bad Request", "trace_required", &headers)
                .await
        }
        Err(TraceIdError::Invalid) => {
            return write_json_error(
                &mut stream,
                "400 Bad Request",
                "invalid_trace_id",
                &headers,
            )
            .await
        }
    };
    let Some(langfuse) = config.langfuse_client_config() else {
        return write_json_error(
            &mut stream,
            "503 Service Unavailable",
            "langfuse_not_configured",
            &headers,
        )
        .await;
    };
    match fetch_trace_detail(&langfuse, &session_id, &trace_id).await {
        Ok(view) => {
            let body = serde_json::to_vec(&view).expect("monitor trace view serializes");
            write_http(&mut stream, "200 OK", "application/json", &body, &headers).await
        }
        Err(UpstreamError::HttpStatus(404)) => {
            write_json_error(&mut stream, "404 Not Found", "trace_not_found", &headers).await
        }
        Err(error) => write_upstream_error(&mut stream, &session_id, &langfuse, error, &headers).await,
    }
}

#[allow(clippy::too_many_arguments)]
async fn authorize_monitor_get(
    stream: &mut TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
    config: &Config,
    catalog: &SessionCatalog,
    method: &str,
    cookie: Option<String>,
    host: Option<&str>,
    origin: Option<&str>,
    transfer_encoding: Option<&str>,
    content_length: Option<usize>,
    headers: &[(String, String)],
    raw_target: &str,
) -> std::io::Result<Option<String>> {
    if !peer.ip().is_loopback()
        || !crate::web::parse::valid_loopback_host(host.unwrap_or_default())
        || !valid_origin(origin, host.unwrap_or_default())
    {
        write_json_error(stream, "403 Forbidden", "forbidden", headers).await?;
        return Ok(None);
    }
    if method != "GET" || transfer_encoding.is_some() || content_length.unwrap_or(0) != 0 {
        write_json_error(stream, "405 Method Not Allowed", "method", headers).await?;
        return Ok(None);
    }
    if !config.langfuse_enabled() {
        write_json_error(
            stream,
            "503 Service Unavailable",
            "langfuse_not_configured",
            headers,
        )
        .await?;
        return Ok(None);
    }
    let Some(session_cookie) = cookie.as_deref() else {
        write_json_error(stream, "401 Unauthorized", "unauthorized", headers).await?;
        return Ok(None);
    };
    let ctx = match auth.lock().await.validate_browser_session(session_cookie, peer) {
        Ok(ctx) => ctx,
        Err(_) => {
            write_json_error(stream, "401 Unauthorized", "unauthorized", headers).await?;
            return Ok(None);
        }
    };
    if ctx.role != TokenRole::Full {
        write_json_error(stream, "403 Forbidden", "forbidden", headers).await?;
        return Ok(None);
    }
    let session_id = match parse_session_id_query(raw_target) {
        Ok(value) => value,
        Err(SessionIdError::Missing) => {
            write_json_error(stream, "400 Bad Request", "session_required", headers).await?;
            return Ok(None);
        }
        Err(SessionIdError::Invalid) => {
            write_json_error(stream, "400 Bad Request", "invalid_session_id", headers).await?;
            return Ok(None);
        }
    };
    if catalog.get(&session_id).await.is_none() {
        write_json_error(stream, "403 Forbidden", "session_not_accessible", headers).await?;
        return Ok(None);
    }
    Ok(Some(session_id))
}

async fn write_upstream_error(
    stream: &mut TcpStream,
    session_id: &str,
    langfuse: &crate::langfuse::LangfuseConfig,
    error: UpstreamError,
    headers: &[(String, String)],
) -> std::io::Result<()> {
    match error {
        UpstreamError::Timeout => {
            tracing::warn!(
                session_id_len = session_id.len(),
                upstream_host = langfuse.upstream_host_origin(),
                error = "langfuse_upstream_timeout",
                "langfuse monitor upstream timeout"
            );
            write_json_error(
                stream,
                "504 Gateway Timeout",
                "langfuse_upstream_timeout",
                headers,
            )
            .await
        }
        UpstreamError::PayloadTooLarge => {
            tracing::warn!(
                session_id_len = session_id.len(),
                error = "upstream_payload_too_large",
                "langfuse monitor upstream payload too large"
            );
            write_json_error(
                stream,
                "502 Bad Gateway",
                "upstream_payload_too_large",
                headers,
            )
            .await
        }
        UpstreamError::HttpStatus(status) => {
            tracing::warn!(
                session_id_len = session_id.len(),
                upstream_status = status,
                error = "langfuse_upstream_error",
                "langfuse monitor upstream non-success"
            );
            write_json_error(
                stream,
                "502 Bad Gateway",
                "langfuse_upstream_error",
                headers,
            )
            .await
        }
        UpstreamError::Transport | UpstreamError::InvalidBody => {
            tracing::warn!(
                session_id_len = session_id.len(),
                error = "langfuse_upstream_error",
                "langfuse monitor upstream transport/body failure"
            );
            write_json_error(
                stream,
                "502 Bad Gateway",
                "langfuse_upstream_error",
                headers,
            )
            .await
        }
    }
}

fn parse_session_id_query(raw_target: &str) -> Result<String, SessionIdError> {
    let query = raw_target.split('?').nth(1);
    let session_id = query.and_then(|query| {
        url::form_urlencoded::parse(query.as_bytes())
            .find(|(key, _)| key == "sessionId")
            .map(|(_, value)| value.into_owned())
    });
    validate_session_id(session_id.as_deref())
}

fn parse_trace_id_query(raw_target: &str) -> Result<String, TraceIdError> {
    let query = raw_target.split('?').nth(1);
    let trace_id = query.and_then(|query| {
        url::form_urlencoded::parse(query.as_bytes())
            .find(|(key, _)| key == "traceId")
            .map(|(_, value)| value.into_owned())
    });
    validate_trace_id(trace_id.as_deref())
}

async fn write_json_error(
    stream: &mut TcpStream,
    status: &str,
    error: &str,
    headers: &[(String, String)],
) -> std::io::Result<()> {
    let body = format!(r#"{{"error":"{error}"}}"#);
    write_http(
        stream,
        status,
        "application/json",
        body.as_bytes(),
        headers,
    )
    .await
}

#[cfg(test)]
#[path = "monitor_http_test.rs"]
mod monitor_http_test;
