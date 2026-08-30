//! MCP Apps 沙箱静态面：第二 loopback origin，无认证 Cookie、无业务 API。

use std::net::SocketAddr;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const SANDBOX_HTML: &[u8] = include_bytes!("../../../web/sandbox.html");

/// 绑定 `listen_port + 1` 或 `PERI_STUDIO_SANDBOX_PORT` 上的最小静态 HTTP。
pub async fn serve_sandbox(listener: TcpListener) -> std::io::Result<()> {
    let addr = listener.local_addr()?;
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
        return write_response(&mut stream, "403 Forbidden", "text/plain", b"forbidden\n").await;
    }
    let mut buf = [0u8; 2048];
    let n = stream.read(&mut buf).await?;
    let head = std::str::from_utf8(&buf[..n]).unwrap_or("");
    let path = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");
    if path == "/" || path == "/sandbox.html" {
        write_response(
            &mut stream,
            "200 OK",
            "text/html; charset=utf-8",
            SANDBOX_HTML,
        )
        .await
    } else {
        write_response(&mut stream, "404 Not Found", "text/plain", b"not found\n").await
    }
}

async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
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
