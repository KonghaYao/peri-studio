//! web 模块共享测试工具（http_test / static_test 共用）。
//!
//! socket 端到端助手：绑定回环 listener，spawn `serve_http`，客户端写请求
//! 读完整响应（`read_to_end` 依赖 `Connection: close` + shutdown 产生 EOF）。

use std::sync::Arc;

use tempfile::tempdir;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

use crate::auth::{AuthService, TokenStore};
use crate::web::{serve_http, BrowserAuthSetup, HealthSnapshot};

pub(crate) fn test_auth_setup(dir: &std::path::Path) -> BrowserAuthSetup {
    let mut cfg = crate::config::Config::defaults();
    cfg.config_dir = dir.to_path_buf();
    BrowserAuthSetup::from_config(&cfg)
}

pub(crate) fn test_health() -> HealthSnapshot {
    HealthSnapshot::from_global_status(peri_studio_proto::schema::GlobalStatus::Healthy)
}

pub(crate) async fn auth_socket_response(request: &str) -> String {
    let dir = tempdir().unwrap();
    let auth = Arc::new(Mutex::new(AuthService::new(
        TokenStore::load(&dir.path().join("tokens.toml")).unwrap(),
    )));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, peer) = listener.accept().await.unwrap();
        serve_http(
            stream,
            peer,
            auth,
            test_auth_setup(dir.path()),
            test_health(),
        )
        .await
        .unwrap();
    });
    let mut client = TcpStream::connect(addr).await.unwrap();
    client.write_all(request.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    client.read_to_end(&mut buf).await.unwrap();
    server.await.unwrap();
    String::from_utf8(buf).unwrap()
}

pub(crate) async fn auth_socket_response_fragments(parts: &[&[u8]]) -> String {
    let dir = tempdir().unwrap();
    let auth = Arc::new(Mutex::new(AuthService::new(
        TokenStore::load(&dir.path().join("tokens.toml")).unwrap(),
    )));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let setup = test_auth_setup(dir.path());
    let server = tokio::spawn(async move {
        let (stream, peer) = listener.accept().await.unwrap();
        serve_http(stream, peer, auth, setup, test_health())
            .await
            .unwrap();
    });
    let mut client = TcpStream::connect(addr).await.unwrap();
    for part in parts {
        client.write_all(part).await.unwrap();
        tokio::task::yield_now().await;
    }
    let mut buf = Vec::new();
    client.read_to_end(&mut buf).await.unwrap();
    server.await.unwrap();
    String::from_utf8(buf).unwrap()
}

pub(crate) async fn health_socket_response(health: HealthSnapshot, request: &str) -> String {
    let dir = tempdir().unwrap();
    let auth = Arc::new(Mutex::new(AuthService::new(
        TokenStore::load(&dir.path().join("tokens.toml")).unwrap(),
    )));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let setup = test_auth_setup(dir.path());
    let server = tokio::spawn(async move {
        let (stream, peer) = listener.accept().await.unwrap();
        serve_http(stream, peer, auth, setup, health).await.unwrap();
    });
    let mut client = TcpStream::connect(addr).await.unwrap();
    client.write_all(request.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    client.read_to_end(&mut buf).await.unwrap();
    server.await.unwrap();
    String::from_utf8(buf).unwrap()
}
