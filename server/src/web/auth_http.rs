//! 同源 `/api/auth/session` 认证端点（bounded cookie bootstrap）。
//!
//! 从 [`super::http::serve_http`] 的读头/校验阶段之后接管：body 有限读取
//! （`MAX_HTTP_BODY` 与总时长上限由调用方头读取共用同一 deadline）+ 登录/
//! 校验/登出三态。浏览器 bearer 只出现在登录请求 body；成功后仅使用
//! HttpOnly opaque cookie，WebSocket 不持有或重放 bearer。

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::sync::Mutex;

use crate::auth::{AuthService, BROWSER_COOKIE, BROWSER_SESSION_TTL_SECS};
use crate::web::http::{security_headers, write_http, BrowserLoginRequest, MAX_HTTP_BODY};
use crate::web::parse::is_json_content_type;
use crate::web::BrowserAuthSetup;

/// 认证端点主体（方法面、body 读取与响应构造）。
///
/// `buf` 持有已读取的头部 + 可能的部分 body；`head_end` 为头部结束偏移。
/// 调用方已校验 loopback peer、Host 与 Origin（403 面）。
#[allow(clippy::too_many_arguments)] // 一个自包含端点接收其完整输入上下文。
pub(crate) async fn serve_auth_session(
    mut stream: TcpStream,
    peer: SocketAddr,
    auth: Arc<Mutex<AuthService>>,
    auth_setup: BrowserAuthSetup,
    method: &str,
    cookie: Option<String>,
    origin: Option<&str>,
    content_type: Option<&str>,
    transfer_encoding: Option<&str>,
    content_length: usize,
    head_end: usize,
    buf: Vec<u8>,
    deadline: tokio::time::Instant,
) -> std::io::Result<()> {
    if transfer_encoding.is_some() {
        return write_http(
            &mut stream,
            "400 Bad Request",
            "application/json",
            br#"{"error":"transfer_encoding_not_supported"}"#,
            &security_headers(),
        )
        .await;
    }
    match method {
        "POST" => {
            if origin.is_none() {
                return write_http(
                    &mut stream,
                    "403 Forbidden",
                    "application/json",
                    br#"{"error":"origin_required"}"#,
                    &security_headers(),
                )
                .await;
            }
            if !content_type.is_some_and(is_json_content_type) {
                return write_http(
                    &mut stream,
                    "415 Unsupported Media Type",
                    "application/json",
                    br#"{"error":"content_type"}"#,
                    &security_headers(),
                )
                .await;
            }
            if content_length == 0 {
                return write_http(
                    &mut stream,
                    "400 Bad Request",
                    "application/json",
                    br#"{"error":"body_required"}"#,
                    &security_headers(),
                )
                .await;
            }
        }
        "GET" => {
            if content_length != 0 {
                return write_http(
                    &mut stream,
                    "400 Bad Request",
                    "application/json",
                    br#"{"error":"body_not_allowed"}"#,
                    &security_headers(),
                )
                .await;
            }
        }
        "DELETE" => {
            if origin.is_none() {
                return write_http(
                    &mut stream,
                    "403 Forbidden",
                    "application/json",
                    br#"{"error":"origin_required"}"#,
                    &security_headers(),
                )
                .await;
            }
            if content_length != 0 {
                return write_http(
                    &mut stream,
                    "400 Bad Request",
                    "application/json",
                    br#"{"error":"body_not_allowed"}"#,
                    &security_headers(),
                )
                .await;
            }
        }
        _ => {
            return write_http(
                &mut stream,
                "405 Method Not Allowed",
                "application/json",
                br#"{"error":"method"}"#,
                &security_headers(),
            )
            .await;
        }
    }
    if content_length > MAX_HTTP_BODY {
        return write_http(
            &mut stream,
            "413 Payload Too Large",
            "application/json",
            br#"{"error":"too_large"}"#,
            &security_headers(),
        )
        .await;
    }
    if buf.len() - head_end > content_length {
        return write_http(
            &mut stream,
            "400 Bad Request",
            "application/json",
            br#"{"error":"body_length_mismatch"}"#,
            &security_headers(),
        )
        .await;
    }
    let mut buf = buf;
    while buf.len() - head_end < content_length {
        let mut chunk = [0u8; 1024];
        let n = match tokio::time::timeout_at(deadline, stream.read(&mut chunk)).await {
            Ok(result) => result?,
            Err(_) => {
                return write_http(
                    &mut stream,
                    "408 Request Timeout",
                    "application/json",
                    br#"{"error":"timeout"}"#,
                    &security_headers(),
                )
                .await
            }
        };
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() - head_end > content_length {
            return write_http(
                &mut stream,
                "400 Bad Request",
                "application/json",
                br#"{"error":"body_length_mismatch"}"#,
                &security_headers(),
            )
            .await;
        }
    }
    if buf.len() - head_end < content_length {
        return write_http(
            &mut stream,
            "400 Bad Request",
            "application/json",
            br#"{"error":"short_body"}"#,
            &security_headers(),
        )
        .await;
    }
    let response = match method {
        "POST" => {
            let body: BrowserLoginRequest = match serde_json::from_slice(
                &buf[head_end..head_end + content_length.min(buf.len() - head_end)],
            ) {
                Ok(body) => body,
                Err(_) => {
                    return write_http(
                        &mut stream,
                        "400 Bad Request",
                        "application/json",
                        br#"{"error":"invalid_json"}"#,
                        &security_headers(),
                    )
                    .await;
                }
            };
            match auth.try_lock() {
                Ok(mut auth) => match auth.create_browser_session(&body.token) {
                    Ok((sid, ctx)) => (
                    "200 OK",
                    serde_json::to_vec(
                        &serde_json::json!({"authenticated":true,"role":ctx.role.as_str(),"setup":auth_setup}),
                    )
                    .unwrap(),
                    vec![(
                        "Set-Cookie".to_string(),
                        format!(
                            "{BROWSER_COOKIE}={sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age={BROWSER_SESSION_TTL_SECS}"
                        ),
                    )],
                    ),
                    Err(_) => (
                        "401 Unauthorized",
                        serde_json::to_vec(&serde_json::json!({"authenticated":false,"setup":auth_setup})).unwrap(),
                        vec![],
                    ),
                },
                Err(_) => (
                    "503 Service Unavailable",
                    serde_json::to_vec(&serde_json::json!({"error":"auth_busy","setup":auth_setup})).unwrap(),
                    vec![("Retry-After".to_string(), "1".to_string())],
                ),
            }
        }
        "GET" => match cookie.as_deref() {
            Some(sid) => match auth.try_lock() {
                Ok(mut auth) => match auth.validate_browser_session(sid, peer) {
                    Ok(ctx) => (
                        "200 OK",
                        serde_json::to_vec(
                            &serde_json::json!({"authenticated":true,"role":ctx.role.as_str(),"setup":auth_setup}),
                        )
                        .unwrap(),
                        vec![],
                    ),
                    Err(_) => (
                        "401 Unauthorized",
                        serde_json::to_vec(&serde_json::json!({"authenticated":false,"setup":auth_setup})).unwrap(),
                        vec![],
                    ),
                },
                Err(_) => (
                    "503 Service Unavailable",
                    serde_json::to_vec(&serde_json::json!({"error":"auth_busy","setup":auth_setup})).unwrap(),
                    vec![("Retry-After".to_string(), "1".to_string())],
                ),
            },
            None => (
                "401 Unauthorized",
                serde_json::to_vec(&serde_json::json!({"authenticated":false,"setup":auth_setup})).unwrap(),
                vec![],
            ),
        },
        "DELETE" => {
            if let Some(sid) = cookie.as_deref() {
                if let Ok(mut a) = auth.try_lock() {
                    a.delete_browser_session(sid);
                }
            }
            (
                "204 No Content",
                Vec::new(),
                vec![(
                    "Set-Cookie".to_string(),
                    format!("{BROWSER_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/"),
                )],
            )
        }
        _ => unreachable!("method surface validated before body read"),
    };
    let mut extra = security_headers();
    extra.extend(response.2);
    write_http(
        &mut stream,
        response.0,
        "application/json",
        &response.1,
        &extra,
    )
    .await
}
