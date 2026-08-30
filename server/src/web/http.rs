//! HTTP 面（非 ws 连接）：有限 HTTP/1.1 手工解析 + 认证端点 + 静态路由。
//!
//! 本文件承载 `serve_http` 入口与响应写出层；头部解析辅助在
//! [`super::parse`]，认证端点在 [`super::auth_http`]，静态资源路由在
//! [`super::static_`]。认证端点使用独立的有限 HTTP/1.1 解析：限制头/body/
//! 读取总时长，拒绝 chunked/重复 framing，校验 loopback Host 与同源
//! Origin，并固定 `no-store` 安全头。静态资源响应固定 `Connection: close`
//! + `Content-Length`，写毕 `shutdown()`。

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;

use crate::auth::AuthService;
use crate::web::auth_http::serve_auth_session;
use crate::web::pick_directory_http::serve_pick_directory;
#[cfg(test)]
use crate::web::parse::request_path;
use crate::web::parse::{
    cookie_value, header_end, is_http_header_name, set_unique_header, valid_loopback_host,
    valid_origin,
};
use crate::web::static_::{cache_headers_for_static, route};
use crate::web::{BrowserAuthSetup, HealthSnapshot};

pub(super) const MAX_HTTP_HEAD: usize = 16 * 1024;
pub(super) const MAX_HTTP_BODY: usize = 4 * 1024;
const HTTP_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BrowserLoginRequest {
    pub(super) token: String,
}

/// 处理一个非 ws 的 HTTP 连接：请求行解析 → 路由 → 响应 → shutdown。
/// 未知路径 / 非 GET → 404（最小实现，不区分 405）。调用方保证已窥探
/// 出请求首段（`head` 为头部文本，本函数只取首行）。
#[cfg(test)]
pub(crate) async fn serve(mut stream: TcpStream, head: &str) -> std::io::Result<()> {
    let (status, content_type, body): (&str, &str, &[u8]) = match request_path(head).and_then(route)
    {
        Some((_, ct, bytes)) => ("200 OK", ct, bytes),
        None => (
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"404 Not Found\n",
        ),
    };
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(body).await?;
    // AsyncWriteExt::shutdown：写半部 FIN（配合 `Connection: close`，
    // 客户端 read_to_end 得 EOF）。
    stream.shutdown().await
}

#[cfg(test)]
pub(crate) async fn serve_http(
    stream: TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
    auth_setup: BrowserAuthSetup,
    health: HealthSnapshot,
) -> std::io::Result<()> {
    serve_http_inner(stream, peer, auth, auth_setup, health, None).await
}

pub(crate) async fn serve_http_with_resources(
    stream: TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
    auth_setup: BrowserAuthSetup,
    health: HealthSnapshot,
    resources: Arc<crate::control::ResourceService>,
) -> std::io::Result<()> {
    serve_http_inner(stream, peer, auth, auth_setup, health, Some(resources)).await
}

async fn serve_http_inner(
    mut stream: TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
    auth_setup: BrowserAuthSetup,
    health: HealthSnapshot,
    resources: Option<Arc<crate::control::ResourceService>>,
) -> std::io::Result<()> {
    let deadline = tokio::time::Instant::now() + HTTP_READ_TIMEOUT;
    let mut buf = Vec::with_capacity(2048);
    let head_end = loop {
        if buf.len() >= MAX_HTTP_HEAD {
            return write_http(
                &mut stream,
                "431 Request Header Fields Too Large",
                "text/plain",
                b"bad request",
                &[],
            )
            .await;
        }
        let mut chunk = [0u8; 1024];
        let n = match tokio::time::timeout_at(deadline, stream.read(&mut chunk)).await {
            Ok(result) => result?,
            Err(_) => {
                return write_http(
                    &mut stream,
                    "408 Request Timeout",
                    "text/plain",
                    b"timeout",
                    &[],
                )
                .await
            }
        };
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_HTTP_HEAD && header_end(&buf).is_none() {
            return write_http(
                &mut stream,
                "431 Request Header Fields Too Large",
                "text/plain",
                b"bad request",
                &[],
            )
            .await;
        }
        if let Some(end) = header_end(&buf) {
            break end + 4;
        }
    };
    if head_end > MAX_HTTP_HEAD {
        return write_http(
            &mut stream,
            "431 Request Header Fields Too Large",
            "text/plain",
            b"bad request",
            &[],
        )
        .await;
    }
    let head = match std::str::from_utf8(&buf[..head_end]) {
        Ok(v) => v.to_string(),
        Err(_) => {
            return write_http(
                &mut stream,
                "400 Bad Request",
                "text/plain",
                b"bad request",
                &[],
            )
            .await
        }
    };
    let mut lines = head.split("\r\n");
    let request = lines.next().unwrap_or_default();
    let mut request_parts = request.split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let path = request_parts
        .next()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default();
    let version = request_parts.next().unwrap_or_default();
    let mut malformed = version != "HTTP/1.1" || request_parts.next().is_some();
    let mut host = None;
    let mut origin = None;
    let mut cookie = None;
    let mut content_type = None;
    let mut content_length = None;
    let mut transfer_encoding = None;
    let mut cookie_header_seen = false;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            malformed = true;
            continue;
        };
        if name != name.trim() || !is_http_header_name(name) {
            malformed = true;
            continue;
        }
        let name = name.to_ascii_lowercase();
        let value = value.trim();
        match name.as_str() {
            "host" => set_unique_header(&mut host, value, &mut malformed),
            "origin" => set_unique_header(&mut origin, value, &mut malformed),
            "cookie" => {
                if cookie_header_seen {
                    malformed = true;
                } else {
                    cookie_header_seen = true;
                    cookie = cookie_value(value, crate::auth::BROWSER_COOKIE);
                }
            }
            "content-type" => set_unique_header(&mut content_type, value, &mut malformed),
            "content-length" => {
                if content_length.is_some() {
                    malformed = true;
                } else {
                    content_length = value.parse::<usize>().ok();
                    if content_length.is_none() {
                        malformed = true;
                    }
                }
            }
            "transfer-encoding" => set_unique_header(&mut transfer_encoding, value, &mut malformed),
            _ => {}
        }
    }
    if malformed || method.is_empty() || path.is_empty() {
        return write_http(
            &mut stream,
            "400 Bad Request",
            "application/json",
            br#"{"error":"bad_request"}"#,
            &security_headers(),
        )
        .await;
    }
    if path == "/api/health" {
        if !peer.ip().is_loopback() || !valid_loopback_host(host.unwrap_or_default()) {
            return write_http(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"forbidden"}"#,
                &security_headers(),
            )
            .await;
        }
        if method != "GET" {
            return write_http(
                &mut stream,
                "405 Method Not Allowed",
                "application/json",
                br#"{"error":"method"}"#,
                &security_headers(),
            )
            .await;
        }
        if transfer_encoding.is_some() || content_length.unwrap_or(0) != 0 {
            return write_http(
                &mut stream,
                "400 Bad Request",
                "application/json",
                br#"{"error":"body_not_allowed"}"#,
                &security_headers(),
            )
            .await;
        }
        let body = serde_json::to_vec(&health).expect("health snapshot serializes");
        return write_http(
            &mut stream,
            "200 OK",
            "application/json",
            &body,
            &security_headers(),
        )
        .await;
    }
    if let Some(blob_id) = path.strip_prefix("/api/resource-blobs/") {
        if blob_id.is_empty()
            || blob_id.contains('/')
            || !peer.ip().is_loopback()
            || !valid_loopback_host(host.unwrap_or_default())
        {
            return write_http(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"forbidden"}"#,
                &security_headers(),
            )
            .await;
        }
        if !matches!(method, "GET" | "HEAD")
            || transfer_encoding.is_some()
            || content_length.unwrap_or(0) != 0
        {
            return write_http(
                &mut stream,
                "405 Method Not Allowed",
                "application/json",
                br#"{"error":"method"}"#,
                &security_headers(),
            )
            .await;
        }
        let Some(resources) = resources else {
            return write_http(
                &mut stream,
                "404 Not Found",
                "application/json",
                br#"{"error":"not_found"}"#,
                &security_headers(),
            )
            .await;
        };
        let Some(session_id) = cookie.as_deref() else {
            return write_http(
                &mut stream,
                "401 Unauthorized",
                "application/json",
                br#"{"error":"unauthorized"}"#,
                &security_headers(),
            )
            .await;
        };
        let principal = match auth.lock().await.validate_browser_session(session_id, peer) {
            Ok(ctx) => ctx.token_id,
            Err(_) => {
                return write_http(
                    &mut stream,
                    "401 Unauthorized",
                    "application/json",
                    br#"{"error":"unauthorized"}"#,
                    &security_headers(),
                )
                .await
            }
        };
        let Some(blob) = resources.blob(&principal, blob_id).await else {
            return write_http(
                &mut stream,
                "404 Not Found",
                "application/json",
                br#"{"error":"not_found"}"#,
                &security_headers(),
            )
            .await;
        };
        let mut headers = security_headers();
        headers.push(("ETag".into(), format!("\"{}\"", blob.etag)));
        return write_http_response(
            &mut stream,
            "200 OK",
            &blob.content_type,
            blob.bytes.as_slice(),
            &headers,
            method == "GET",
        )
        .await;
    }
    if path == "/api/local/pick-directory" {
        if !peer.ip().is_loopback() || !valid_loopback_host(host.unwrap_or_default()) {
            return write_http(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"forbidden"}"#,
                &security_headers(),
            )
            .await;
        }
        if !valid_origin(origin, host.unwrap_or_default()) {
            return write_http(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"forbidden"}"#,
                &security_headers(),
            )
            .await;
        }
        return serve_pick_directory(
            stream,
            peer,
            auth,
            method,
            cookie.as_deref(),
            transfer_encoding.as_deref(),
            content_length.unwrap_or(0),
        )
        .await;
    }
    if path != "/api/auth/session" {
        return serve_static_consumed(stream, method, path).await;
    }
    // 认证端点：loopback + Host/Origin 校验（§9.5）后移交独立端点处理。
    if !peer.ip().is_loopback()
        || !valid_loopback_host(host.unwrap_or_default())
        || !valid_origin(origin, host.unwrap_or_default())
    {
        return write_http(
            &mut stream,
            "403 Forbidden",
            "application/json",
            br#"{"error":"forbidden"}"#,
            &security_headers(),
        )
        .await;
    }
    serve_auth_session(
        stream,
        peer,
        auth,
        auth_setup,
        method,
        cookie,
        origin,
        content_type,
        transfer_encoding,
        content_length.unwrap_or(0),
        head_end,
        buf,
        deadline,
    )
    .await
}

async fn serve_static_consumed(
    mut stream: TcpStream,
    method: &str,
    path: &str,
) -> std::io::Result<()> {
    let is_head = method == "HEAD";
    let found = if method == "GET" || is_head {
        route(path)
    } else {
        None
    };
    match found {
        Some((name, ct, body)) => {
            let mut headers = base_security_headers();
            headers.extend(cache_headers_for_static(path, Some(name)));
            write_http_response(&mut stream, "200 OK", ct, body, &headers, !is_head).await
        }
        None => {
            let mut headers = base_security_headers();
            headers.extend(cache_headers_for_static(path, None));
            write_http_response(
                &mut stream,
                "404 Not Found",
                "text/plain",
                b"404 Not Found\n",
                &headers,
                !is_head,
            )
            .await
        }
    }
}

pub(super) async fn write_http(
    stream: &mut TcpStream,
    status: &str,
    ct: &str,
    body: &[u8],
    headers: &[(String, String)],
) -> std::io::Result<()> {
    write_http_response(stream, status, ct, body, headers, true).await
}

async fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    ct: &str,
    body: &[u8],
    headers: &[(String, String)],
    include_body: bool,
) -> std::io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in headers {
        head.push_str(k.as_ref());
        head.push_str(": ");
        head.push_str(v.as_ref());
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await?;
    if include_body {
        stream.write_all(body).await?;
    }
    stream.shutdown().await
}
pub(super) fn security_headers() -> Vec<(String, String)> {
    let mut headers = base_security_headers();
    headers.extend([
        ("Cache-Control".into(), "no-store".into()),
        ("Pragma".into(), "no-cache".into()),
    ]);
    headers
}

/// 面板允许嵌入 loopback 第二 origin 的 MCP Apps 沙箱。未声明 `frame-src` 时
/// 回落到 `default-src 'self'`，会拦截异源 iframe。Chrome 的 `frame-src` **完全不接受**
/// IPv6 host-source（`http://[::1]:8457` 与 `http://[::1]:*` 一样会被丢弃并刷控制台），
/// 因此只写 `127.0.0.1` / `localhost`；e2e 必须用 `http://127.0.0.1`。
fn panel_csp() -> String {
    let port = crate::web::sandbox::advertised_sandbox_port();
    format!(
        "default-src 'self'; script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-src http://127.0.0.1:{port} http://localhost:{port} https://127.0.0.1:{port} https://localhost:{port}"
    )
}

fn base_security_headers() -> Vec<(String, String)> {
    vec![
        ("X-Content-Type-Options".into(), "nosniff".into()),
        ("Content-Security-Policy".into(), panel_csp()),
        ("Referrer-Policy".into(), "no-referrer".into()),
        ("X-Frame-Options".into(), "DENY".into()),
    ]
}
