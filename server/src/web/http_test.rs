//! HTTP 面测试：bounded cookie auth、请求解析、upgrade 检测、health 端点
//! 与真实 socket 响应（静态路由/缓存策略断言在 `static_test.rs`）。
//!
//! 路由断言面向 vite 构建产物（web/dist，build.rs 编译期内嵌）：页面入口
//! 固定（/、/panel.html），assets 文件名带内容 hash。

use std::sync::Arc;

use tempfile::tempdir;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

use super::test_util::{
    auth_socket_response, auth_socket_response_fragments, health_socket_response, test_auth_setup,
    test_health,
};
use crate::auth::{AuthService, TokenRole, TokenStore};
use crate::web::{
    cookie_value, header_end, is_json_content_type, is_ws_upgrade, request_path, serve_http,
    serve_http_with_resources, valid_loopback_host, valid_ws_host, valid_ws_origin,
    BrowserAuthSetup, HealthSnapshot, HealthStatus,
};

/// 请求行解析：常规 GET 路径。
#[test]
fn request_path_get() {
    assert_eq!(
        request_path("GET / HTTP/1.1\r\nHost: 127.0.0.1:8456\r\n\r\n"),
        Some("/")
    );
    assert_eq!(
        request_path("GET /assets/index-abc.js HTTP/1.1\r\nHost: test\r\n\r\n"),
        Some("/assets/index-abc.js")
    );
}

/// 请求行解析：query 剥离（资源名纯 ASCII，不做 URL 解码）。
#[test]
fn request_path_strips_query() {
    assert_eq!(
        request_path("GET /panel.html?v=123 HTTP/1.1\r\nHost: test\r\n\r\n"),
        Some("/panel.html")
    );
}

/// 请求行解析：非 GET 与格式非法 → None。
#[test]
fn request_path_rejects_non_get_and_garbage() {
    assert_eq!(request_path("POST / HTTP/1.1\r\nHost: test\r\n\r\n"), None);
    assert_eq!(request_path("GET"), None);
    assert_eq!(request_path(""), None);
    assert_eq!(request_path("GARBAGE\r\n\r\n"), None);
}

/// 头部结束符定位：完整头部返回 `\r\n\r\n` 下标，不完整返回 None。
#[test]
fn header_end_finds_terminator() {
    let full = b"GET / HTTP/1.1\r\nHost: test\r\n\r\n";
    assert_eq!(header_end(full), Some(26));
    assert_eq!(header_end(&full[..20]), None);
    assert_eq!(header_end(b""), None);
}

/// ws 升级判定：大小写不敏感；普通 GET 不含 upgrade 头 → false。
#[test]
fn ws_upgrade_detection() {
    let ws = b"GET /instance HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
    assert!(is_ws_upgrade(ws));
    let ws_lower = b"GET / HTTP/1.1\r\nupgrade: websocket\r\n\r\n";
    assert!(is_ws_upgrade(ws_lower));
    let plain = b"GET /index.html HTTP/1.1\r\nHost: test\r\n\r\n";
    assert!(!is_ws_upgrade(plain));
}

#[test]
fn auth_contract_host_and_cookie_parsing() {
    assert!(valid_loopback_host("127.0.0.1:8456"));
    assert!(valid_loopback_host("localhost:8456"));
    assert!(valid_loopback_host("[::1]:8456"));
    assert!(!valid_loopback_host("evil.example:8456"));
    assert!(!valid_loopback_host("[::1].evil:8456"));
    assert!(!valid_loopback_host("127.0.0.1:bad"));
    assert!(!valid_loopback_host("::1"));
    assert_eq!(
        cookie_value(
            "x=1; peri_studio_session=opaque; y=2",
            "peri_studio_session"
        )
        .as_deref(),
        Some("opaque")
    );
}

#[test]
fn websocket_host_policy_requires_explicit_remote_tls_origin() {
    assert!(valid_ws_host("127.0.0.1:8456", false));
    assert!(!valid_ws_host("studio.example:443", false));
    assert!(valid_ws_host("studio.example:443", true));
    assert!(valid_ws_host("studio.example", true));
    assert!(!valid_ws_host("studio.example:0", true));
    assert!(valid_ws_origin(
        Some("https://studio.example:443"),
        "studio.example:443"
    ));
    assert!(!valid_ws_origin(
        Some("http://studio.example:443"),
        "studio.example:443"
    ));
    assert!(valid_ws_origin(None, "studio.example:443"));
}

#[test]
fn auth_json_content_type_is_closed() {
    assert!(is_json_content_type("application/json"));
    assert!(is_json_content_type("Application/JSON; charset=utf-8"));
    assert!(!is_json_content_type("text/plain"));
    assert!(!is_json_content_type("application/json; charset=latin1"));
    assert!(!is_json_content_type("application/json; boundary=x"));
    assert!(!is_json_content_type(
        "application/json; charset=utf-8; charset=utf-8"
    ));
}

#[test]
fn browser_auth_setup_uses_authoritative_config_dir_and_shell_quotes_it() {
    let mut cfg = crate::config::Config::defaults();
    cfg.config_dir = std::path::PathBuf::from("/tmp/peri studio/operator's config");

    let setup = BrowserAuthSetup::from_parts(&cfg, "/opt/peri studio/bin/peri-studio");
    let json = serde_json::to_value(setup).unwrap();

    assert_eq!(
        json["tokenFile"],
        "/tmp/peri studio/operator's config/tokens.toml"
    );
    assert_eq!(
        json["generateCommand"],
        "PERI_STUDIO_CONFIG_DIR='/tmp/peri studio/operator'\\''s config' '/opt/peri studio/bin/peri-studio' token generate --name web --role full"
    );
    assert_eq!(json.as_object().unwrap().len(), 2);
}

#[tokio::test]
async fn health_is_credential_free_liveness_with_explicit_readiness() {
    let health =
        HealthSnapshot::from_global_status(peri_studio_proto::schema::GlobalStatus::Degraded);
    let response = health_socket_response(
        health,
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nContent-Length: 0\r\n\r\n",
    )
    .await;
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(response.contains("Cache-Control: no-store"));
    let body = response.split_once("\r\n\r\n").unwrap().1;
    let snapshot: HealthSnapshot = serde_json::from_str(body).unwrap();
    assert_eq!(snapshot.status, HealthStatus::Degraded);
    assert!(!snapshot.ready);
    assert_eq!(
        snapshot.protocol_version,
        peri_studio_proto::version::PROTOCOL_VERSION
    );
    assert_eq!(snapshot.server_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(body)
            .unwrap()
            .as_object()
            .unwrap()
            .len(),
        4
    );
    assert!(!body.contains("token"));
    assert!(!body.contains("path"));
    assert!(!body.contains("reason"));
}

#[tokio::test]
async fn resource_blob_requires_cookie_and_returns_exact_bytes_with_etag() {
    let dir = tempdir().unwrap();
    let token_path = dir.path().join("tokens.toml");
    let mut token_store = TokenStore::load(&token_path).unwrap();
    let record = token_store
        .generate(TokenRole::Full, "blob-reader")
        .unwrap();
    let mut auth_service = AuthService::new(token_store);
    let (session_id, ctx) = auth_service.create_browser_session(&record.token).unwrap();
    let auth = Arc::new(Mutex::new(auth_service));

    let metadata = Arc::new(
        crate::persist::metadata::MetadataStore::open(dir.path())
            .await
            .unwrap(),
    );
    let (registry_tx, _registry_rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(registry_tx);
    let instance = Arc::new(crate::control::InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(10),
        crate::control::ChatRegistry::new(registry),
    ));
    let sink = Arc::new(crate::control::StoreSink::new());
    let resources = Arc::new(crate::control::ResourceService::new(
        metadata,
        instance,
        crate::control::ResourceProjection::new(sink, std::time::Duration::from_secs(60), 2),
    ));
    let opened = resources
        .store_blob(
            &ctx.token_id,
            b"exact\0bytes".to_vec(),
            "application/octet-stream".into(),
            "etag-1".into(),
            chrono::Duration::seconds(60),
        )
        .await
        .unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let setup = test_auth_setup(dir.path());
    let server = tokio::spawn(async move {
        let (stream, peer) = listener.accept().await.unwrap();
        serve_http_with_resources(stream, peer, auth, setup, test_health(), resources)
            .await
            .unwrap();
    });
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nCookie: peri_studio_session={}\r\nContent-Length: 0\r\n\r\n",
        opened.url, session_id
    );
    let mut client = TcpStream::connect(addr).await.unwrap();
    client.write_all(request.as_bytes()).await.unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).await.unwrap();
    server.await.unwrap();
    let split = response
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .unwrap()
        + 4;
    let head = String::from_utf8(response[..split].to_vec()).unwrap();
    assert!(head.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(head.contains("ETag: \"etag-1\""));
    assert_eq!(&response[split..], b"exact\0bytes");
}

#[tokio::test]
async fn health_rejects_dns_rebinding_host() {
    let response = auth_socket_response(
        "GET /api/health HTTP/1.1\r\nHost: evil.example:8456\r\nContent-Length: 0\r\n\r\n",
    )
    .await;
    assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
}

#[tokio::test]
async fn health_rejects_mutating_methods_and_bodies() {
    let post = auth_socket_response(
        "POST /api/health HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nContent-Length: 0\r\n\r\n",
    )
    .await;
    assert!(post.starts_with("HTTP/1.1 405 Method Not Allowed\r\n"));
    let body = auth_socket_response(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nContent-Length: 1\r\n\r\nx",
    )
    .await;
    assert!(body.starts_with("HTTP/1.1 400 Bad Request\r\n"));
}

#[tokio::test]
async fn unauthenticated_status_returns_credential_free_setup_hint() {
    let response = auth_socket_response(
        "GET /api/auth/session HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nContent-Length: 0\r\n\r\n",
    )
    .await;

    assert!(response.starts_with("HTTP/1.1 401 Unauthorized\r\n"));
    assert!(response.contains("\"authenticated\":false"));
    assert!(response.contains("\"tokenFile\":"));
    assert!(response.contains("tokens.toml"));
    assert!(response.contains("\"generateCommand\":"));
    assert!(!response.contains("token_id"));
    assert!(!response.contains("tokenId"));
}

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
        ["authenticated", "role", "setup"]
            .into_iter()
            .map(String::from)
            .collect()
    );
    assert_eq!(json["authenticated"], true);
    assert_eq!(json["role"], "full");
}

#[tokio::test]
async fn auth_lock_contention_is_service_unavailable_not_bad_credentials() {
    let dir = tempdir().unwrap();
    let auth = Arc::new(Mutex::new(AuthService::new(
        TokenStore::load(&dir.path().join("tokens.toml")).unwrap(),
    )));
    let guard = auth.lock().await;
    let body = r#"{"token":"well-formed-but-not-inspected"}"#;
    let requests = [
        format!(
            "POST /api/auth/session HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nOrigin: http://127.0.0.1:8456\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        ),
        "GET /api/auth/session HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nCookie: peri_studio_session=opaque\r\nContent-Length: 0\r\n\r\n".to_string(),
    ];
    for request in requests {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let setup = test_auth_setup(dir.path());
        let server_auth = auth.clone();
        let server = tokio::spawn(async move {
            let (stream, peer) = listener.accept().await.unwrap();
            serve_http(stream, peer, server_auth, setup, test_health())
                .await
                .unwrap();
        });
        let mut client = TcpStream::connect(addr).await.unwrap();
        client.write_all(request.as_bytes()).await.unwrap();
        let mut bytes = Vec::new();
        client.read_to_end(&mut bytes).await.unwrap();
        server.await.unwrap();
        let response = String::from_utf8(bytes).unwrap();

        assert!(response.starts_with("HTTP/1.1 503 Service Unavailable\r\n"));
        assert!(response.contains("Retry-After: 1\r\n"));
        assert!(response.contains("\"error\":\"auth_busy\""));
        assert!(response.contains("\"setup\":"));
        assert!(!response.contains("401 Unauthorized"));
    }
    drop(guard);
}

#[tokio::test]
async fn auth_http_rejects_ambiguous_request_framing() {
    let host = "127.0.0.1:8456";
    let origin = format!("http://{host}");
    let cases = [
        (
            "missing content type",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Length: 2\r\n\r\n{{}}"
            ),
            "415 Unsupported Media Type",
        ),
        (
            "form content type",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 3\r\n\r\na=b"
            ),
            "415 Unsupported Media Type",
        ),
        (
            "chunked body",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"
            ),
            "400 Bad Request",
        ),
        (
            "duplicate content length",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{{}}"
            ),
            "400 Bad Request",
        ),
        (
            "duplicate host",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}"
            ),
            "400 Bad Request",
        ),
        (
            "obs-fold style header",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\n Origin: {origin}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}"
            ),
            "400 Bad Request",
        ),
        (
            "http 1.0",
            format!(
                "POST /api/auth/session HTTP/1.0\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}"
            ),
            "400 Bad Request",
        ),
        (
            "declared body shorter than bytes",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}extra"
            ),
            "400 Bad Request",
        ),
        (
            "get body",
            format!(
                "GET /api/auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Length: 2\r\n\r\n{{}}"
            ),
            "400 Bad Request",
        ),
        (
            "invalid json",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: 1\r\n\r\n{{"
            ),
            "400 Bad Request",
        ),
        (
            "unknown login field",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: 23\r\n\r\n{{\"token\":\"x\",\"admin\":1}}"
            ),
            "400 Bad Request",
        ),
        (
            "oversized declared body",
            format!(
                "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: 4097\r\n\r\n"
            ),
            "413 Payload Too Large",
        ),
    ];

    for (name, request, expected) in cases {
        let response = auth_socket_response(&request).await;
        assert!(
            response.starts_with(&format!("HTTP/1.1 {expected}\r\n")),
            "{name}: {response:?}"
        );
        assert!(response.contains("Cache-Control: no-store\r\n"), "{name}");
        assert!(response.contains("Pragma: no-cache\r\n"), "{name}");
        assert!(
            response.contains("X-Content-Type-Options: nosniff\r\n"),
            "{name}"
        );
    }
}

#[tokio::test]
async fn auth_http_accepts_fragmented_header_and_body_reads() {
    let body = b"{\"token\":\"invalid-but-well-formed\"}";
    let head = format!(
        "POST /api/auth/session HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nOrigin: http://127.0.0.1:8456\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n\r\n",
        body.len()
    );
    let split = head.len() - 2;
    let response = auth_socket_response_fragments(&[
        &head.as_bytes()[..split],
        &head.as_bytes()[split..],
        &body[..5],
        &body[5..],
    ])
    .await;
    assert!(
        response.starts_with("HTTP/1.1 401 Unauthorized\r\n"),
        "合法分片请求应到达凭据裁决：{response:?}"
    );
}

#[tokio::test]
async fn auth_http_requires_origin_for_state_changes() {
    let host = "127.0.0.1:8456";
    for request in [
        format!(
            "POST /api/auth/session HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}"
        ),
        format!("DELETE /api/auth/session HTTP/1.1\r\nHost: {host}\r\nContent-Length: 0\r\n\r\n"),
    ] {
        let response = auth_socket_response(&request).await;
        assert!(
            response.starts_with("HTTP/1.1 403 Forbidden\r\n"),
            "{response:?}"
        );
    }
}
