//! 浏览器 principal 伪名响应的真实 HTTP 边界测试。

use std::sync::Arc;

use tempfile::tempdir;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

use super::test_util::{test_auth_setup, test_health};
use crate::auth::{AuthService, TokenRole, TokenStore};
use crate::web::serve_http;

#[tokio::test]
async fn successful_login_never_reflects_the_bearer_or_token_record() {
    let dir = tempdir().unwrap();
    let token_path = dir.path().join("tokens.toml");
    let mut token_store = TokenStore::load(&token_path).unwrap();
    let record = token_store
        .generate(TokenRole::Full, "browser-secret-name")
        .unwrap();
    let bearer = record.token.clone();
    let token_id = record.id.clone();
    let auth = Arc::new(Mutex::new(AuthService::new(token_store)));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let setup = test_auth_setup(dir.path());
    let server = tokio::spawn(async move {
        let (stream, peer) = listener.accept().await.unwrap();
        serve_http(stream, peer, auth, setup, test_health())
            .await
            .unwrap();
    });

    let body = serde_json::json!({ "token": bearer }).to_string();
    let request = format!(
        "POST /api/auth/session HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nOrigin: http://127.0.0.1:8456\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let mut client = TcpStream::connect(addr).await.unwrap();
    client.write_all(request.as_bytes()).await.unwrap();
    let mut bytes = Vec::new();
    client.read_to_end(&mut bytes).await.unwrap();
    server.await.unwrap();
    let response = String::from_utf8(bytes).unwrap();

    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(response.contains("Set-Cookie: peri_studio_session="));
    assert!(!response.contains(&record.token));
    assert!(!response.contains(&token_id));
    assert!(!response.contains("browser-secret-name"));
    let response_body = response.split_once("\r\n\r\n").unwrap().1;
    let json: serde_json::Value = serde_json::from_str(response_body).unwrap();
    let keys = json
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        keys,
        ["authenticated", "principalId", "role", "setup"]
            .into_iter()
            .map(String::from)
            .collect()
    );
    assert_eq!(json["authenticated"], true);
    assert_eq!(json["role"], "full");
    assert!(json["principalId"]
        .as_str()
        .is_some_and(|value| value.len() == 22));
}
