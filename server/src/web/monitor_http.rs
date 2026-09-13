//! Monitor API：`GET /api/monitor/session`（cookie + loopback + Origin）。

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::net::TcpStream;
use tokio::sync::Mutex;

use crate::auth::{AuthService, TokenRole};
use crate::control::SessionCatalog;
use crate::langfuse::{
    fetch_session_traces, is_configured, validate_session_id, LangfuseConfig, SessionIdError,
    UpstreamError,
};
use crate::web::http::security_headers;
use crate::web::http::write_http;
use crate::web::parse::valid_origin;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn serve_monitor_session(
    mut stream: TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
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
    if !peer.ip().is_loopback()
        || !crate::web::parse::valid_loopback_host(host.unwrap_or_default())
        || !valid_origin(origin, host.unwrap_or_default())
    {
        return write_json_error(&mut stream, "403 Forbidden", "forbidden", &headers).await;
    }
    if method != "GET" || transfer_encoding.is_some() || content_length.unwrap_or(0) != 0 {
        return write_json_error(&mut stream, "405 Method Not Allowed", "method", &headers).await;
    }
    if !is_configured() {
        return write_json_error(
            &mut stream,
            "503 Service Unavailable",
            "langfuse_not_configured",
            &headers,
        )
        .await;
    }
    let Some(session_cookie) = cookie.as_deref() else {
        return write_json_error(&mut stream, "401 Unauthorized", "unauthorized", &headers).await;
    };
    let ctx = match auth.lock().await.validate_browser_session(session_cookie, peer) {
        Ok(ctx) => ctx,
        Err(_) => {
            return write_json_error(&mut stream, "401 Unauthorized", "unauthorized", &headers)
                .await
        }
    };
    if ctx.role != TokenRole::Full {
        return write_json_error(&mut stream, "403 Forbidden", "forbidden", &headers).await;
    }
    let session_id = match parse_session_id_query(raw_target) {
        Ok(value) => value,
        Err(SessionIdError::Missing) => {
            return write_json_error(&mut stream, "400 Bad Request", "session_required", &headers)
                .await
        }
        Err(SessionIdError::Invalid) => {
            return write_json_error(
                &mut stream,
                "400 Bad Request",
                "invalid_session_id",
                &headers,
            )
            .await
        }
    };
    if catalog.get(&session_id).await.is_none() {
        return write_json_error(
            &mut stream,
            "403 Forbidden",
            "session_not_accessible",
            &headers,
        )
        .await;
    }
    let Some(config) = LangfuseConfig::from_process_env() else {
        return write_json_error(
            &mut stream,
            "503 Service Unavailable",
            "langfuse_not_configured",
            &headers,
        )
        .await;
    };
    match fetch_session_traces(&config, &session_id).await {
        Ok(view) => {
            let body = serde_json::to_vec(&view).expect("monitor view serializes");
            write_http(&mut stream, "200 OK", "application/json", &body, &headers).await
        }
        Err(UpstreamError::Timeout) => {
            tracing::warn!(
                session_id_len = session_id.len(),
                error = "langfuse_upstream_timeout",
                "langfuse monitor upstream timeout"
            );
            write_json_error(
                &mut stream,
                "504 Gateway Timeout",
                "langfuse_upstream_timeout",
                &headers,
            )
            .await
        }
        Err(UpstreamError::PayloadTooLarge) => {
            tracing::warn!(
                session_id_len = session_id.len(),
                error = "upstream_payload_too_large",
                "langfuse monitor upstream payload too large"
            );
            write_json_error(
                &mut stream,
                "502 Bad Gateway",
                "upstream_payload_too_large",
                &headers,
            )
            .await
        }
        Err(UpstreamError::HttpStatus(status)) => {
            tracing::warn!(
                session_id_len = session_id.len(),
                upstream_status = status,
                error = "langfuse_upstream_error",
                "langfuse monitor upstream non-success"
            );
            write_json_error(
                &mut stream,
                "502 Bad Gateway",
                "langfuse_upstream_error",
                &headers,
            )
            .await
        }
        Err(UpstreamError::Transport | UpstreamError::InvalidBody) => {
            tracing::warn!(
                session_id_len = session_id.len(),
                error = "langfuse_upstream_error",
                "langfuse monitor upstream transport/body failure"
            );
            write_json_error(
                &mut stream,
                "502 Bad Gateway",
                "langfuse_upstream_error",
                &headers,
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
