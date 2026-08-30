//! MCP Apps 沙箱静态面：第二 loopback origin，无认证 Cookie、无业务 API。

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU16, Ordering};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const SANDBOX_HTML: &[u8] = include_bytes!("../../../web/sandbox.html");
const DEFAULT_SANDBOX_PORT: u16 = 8457;
static BOUND_SANDBOX_PORT: AtomicU16 = AtomicU16::new(DEFAULT_SANDBOX_PORT);

/// Hub 在沙箱 listener bind 成功后记下实际端口，供面板 `frame-src` 写精确 origin。
pub fn remember_bound_port(port: u16) {
    if port != 0 {
        BOUND_SANDBOX_PORT.store(port, Ordering::Relaxed);
    }
}

pub fn advertised_sandbox_port() -> u16 {
    BOUND_SANDBOX_PORT.load(Ordering::Relaxed)
}

/// 绑定 `listen_port + 1` 或 `PERI_STUDIO_SANDBOX_PORT` 上的最小静态 HTTP。
pub async fn serve_sandbox(listener: TcpListener) -> std::io::Result<()> {
    let addr = listener.local_addr()?;
    remember_bound_port(addr.port());
    tracing::info!(%addr, "MCP Apps sandbox origin listening");
    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(conn) => conn,
            Err(error) => {
                tracing::warn!(?error, "sandbox accept failed");
                continue;
            }
        };
        tokio::spawn(async move {
            if let Err(error) = serve_one(stream, peer).await {
                tracing::debug!(?error, "sandbox connection ended");
            }
        });
    }
}

async fn serve_one(mut stream: TcpStream, peer: SocketAddr) -> std::io::Result<()> {
    if !peer.ip().is_loopback() {
        return write_response(
            &mut stream,
            "403 Forbidden",
            "text/plain",
            &format!("frame-ancestors {}", fallback_frame_ancestors()),
            b"forbidden\n",
        )
        .await;
    }
    let mut buf = [0u8; 2048];
    let n = stream.read(&mut buf).await?;
    let head = std::str::from_utf8(&buf[..n]).unwrap_or("");
    let path = sandbox_path(head);
    let ancestors = frame_ancestors_header(head);
    if path == "/" || path == "/sandbox.html" {
        write_response(
            &mut stream,
            "200 OK",
            "text/html; charset=utf-8",
            &ancestors,
            SANDBOX_HTML,
        )
        .await
    } else {
        write_response(
            &mut stream,
            "404 Not Found",
            "text/plain",
            &ancestors,
            b"not found\n",
        )
        .await
    }
}

async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    frame_ancestors: &str,
    body: &[u8],
) -> std::io::Result<()> {
    // 仅允许 loopback 面板来嵌；不设 default-src，以免打断 sandbox.html 内联模块。
    // Chrome 的 frame-ancestors 不接受 `http://[::1]:*`（IPv6 + 端口通配），精确 origin 或 v4/localhost `:*`。
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: {frame_ancestors}\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.shutdown().await
}

pub fn sandbox_port(main_port: u16) -> u16 {
    std::env::var("PERI_STUDIO_SANDBOX_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(main_port.saturating_add(1))
}

/// 沙箱只认路径，Host 经 query 传给页面；请求行带 `?host=` 时必须剥掉。
fn sandbox_path(head: &str) -> &str {
    request_target(head).split('?').next().unwrap_or("/")
}

fn request_target(head: &str) -> &str {
    head.lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/")
}

fn frame_ancestors_header(head: &str) -> String {
    if let Some(origin) = loopback_ancestor_origin(head) {
        return format!("frame-ancestors {origin}");
    }
    format!("frame-ancestors {}", fallback_frame_ancestors())
}

fn fallback_frame_ancestors() -> &'static str {
    "http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*"
}

/// `?host=` 是面板 origin。Chrome 不支持 `http://[::1]:*`，因此 IPv6 只用精确 origin。
fn loopback_ancestor_origin(head: &str) -> Option<String> {
    let query = request_target(head).split_once('?')?.1;
    let host = url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| key == "host")?
        .1
        .into_owned();
    let origin = url::Url::parse(&host).ok()?;
    if !origin.username().is_empty() || origin.password().is_some() {
        return None;
    }
    if origin.query().is_some() || origin.fragment().is_some() {
        return None;
    }
    if origin.path() != "/" && !origin.path().is_empty() {
        return None;
    }
    if !matches!(origin.scheme(), "http" | "https") {
        return None;
    }
    let loopback = match origin.host() {
        Some(url::Host::Ipv4(addr)) => addr.is_loopback(),
        Some(url::Host::Ipv6(addr)) => addr.is_loopback(),
        Some(url::Host::Domain("localhost")) => true,
        _ => false,
    };
    loopback.then(|| origin.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::{frame_ancestors_header, loopback_ancestor_origin, sandbox_path};

    #[test]
    fn sandbox_path_strips_host_query() {
        assert_eq!(
            sandbox_path("GET /sandbox.html?host=http%3A%2F%2F127.0.0.1%3A8456 HTTP/1.1\r\n"),
            "/sandbox.html"
        );
        assert_eq!(sandbox_path("GET / HTTP/1.1\r\n"), "/");
        assert_eq!(sandbox_path("GET /missing HTTP/1.1\r\n"), "/missing");
    }

    #[test]
    fn frame_ancestors_uses_exact_loopback_host_query() {
        let head = "GET /sandbox.html?host=http%3A%2F%2F127.0.0.1%3A8456 HTTP/1.1\r\n";
        assert_eq!(
            loopback_ancestor_origin(head).as_deref(),
            Some("http://127.0.0.1:8456")
        );
        assert_eq!(
            frame_ancestors_header(head),
            "frame-ancestors http://127.0.0.1:8456"
        );
        assert!(!frame_ancestors_header(head).contains("[::1]:*"));
    }

    #[test]
    fn frame_ancestors_ipv6_is_exact_origin_not_port_wildcard() {
        let head = "GET /sandbox.html?host=http%3A%2F%2F%5B%3A%3A1%5D%3A8456 HTTP/1.1\r\n";
        assert_eq!(
            loopback_ancestor_origin(head).as_deref(),
            Some("http://[::1]:8456")
        );
        assert!(!frame_ancestors_header(head).contains("[::1]:*"));
    }

    #[test]
    fn frame_ancestors_rejects_non_loopback_host_query() {
        let head = "GET /sandbox.html?host=https%3A%2F%2Fevil.example HTTP/1.1\r\n";
        assert_eq!(loopback_ancestor_origin(head), None);
        assert!(frame_ancestors_header(head).contains("http://127.0.0.1:*"));
        assert!(!frame_ancestors_header(head).contains("[::1]"));
    }
}
