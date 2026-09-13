//! Monitor API 契约测试。

use std::sync::Arc;

use serial_test::serial;
use tempfile::tempdir;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

use crate::auth::{AuthService, TokenRole, TokenStore};
use crate::control::{CatalogSession, SessionCatalog};
use crate::langfuse::{
    LANGFUSE_HOST_ENV, LANGFUSE_PUBLIC_KEY_ENV, LANGFUSE_SECRET_KEY_ENV,
};
use crate::web::{serve_http_with_resources, BrowserAuthSetup, HealthSnapshot, HttpRouteDeps};

async fn monitor_response(
    auth: Arc<Mutex<AuthService>>,
    setup: BrowserAuthSetup,
    catalog: SessionCatalog,
    request: String,
) -> String {
    let metadata = Arc::new(
        crate::persist::metadata::MetadataStore::open(tempdir().unwrap().path())
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
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, peer) = listener.accept().await.unwrap();
        serve_http_with_resources(
            stream,
            peer,
            auth,
            setup,
            HealthSnapshot::from_global_status(
                peri_studio_proto::schema::GlobalStatus::Healthy,
            ),
            HttpRouteDeps {
                resources,
                session_catalog: catalog,
            },
        )
        .await
        .unwrap();
    });
    let mut client = TcpStream::connect(addr).await.unwrap();
    client.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    client.read_to_string(&mut response).await.unwrap();
    server.await.unwrap();
    response
}

fn auth_fixture() -> (tempfile::TempDir, Arc<Mutex<AuthService>>, String, BrowserAuthSetup) {
    let dir = tempdir().unwrap();
    let mut token_store = TokenStore::load(&dir.path().join("tokens.toml")).unwrap();
    let record = token_store
        .generate(TokenRole::Full, "monitor-reader")
        .unwrap();
    let mut auth_service = AuthService::new(token_store);
    let (session_id, _) = auth_service.create_browser_session(&record.token).unwrap();
    let auth = Arc::new(Mutex::new(auth_service));
    let setup = BrowserAuthSetup::from_parts(
        &{
            let mut cfg = crate::config::Config::defaults();
            cfg.config_dir = dir.path().to_path_buf();
            cfg
        },
        "peri-studio",
    );
    (dir, auth, session_id, setup)
}

async fn seed_catalog(session_id: &str) -> SessionCatalog {
    let catalog = SessionCatalog::new();
    catalog
        .upsert(CatalogSession {
            acp_session_id: session_id.to_string(),
            project_id: "project-1".to_string(),
            title: "Turn".into(),
            updated_at: "2026-09-13T08:00:00.000Z".into(),
            status: "ready".into(),
            lifecycle: "ready".into(),
            last_opened_at: None,
            hub_title: None,
        })
        .await;
    catalog
}

async fn start_fake_langfuse(port: u16) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
            .await
            .unwrap();
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut buf = vec![0u8; 8192];
        let _ = stream.read(&mut buf).await;
        let body = br#"{"data":[{"id":"trace-1","name":"turn","timestamp":"2026-09-13T08:00:00.000Z","latencyMs":1200,"totalCost":0.003,"level":"DEFAULT","projectId":"proj-1","input":{"secret":true},"output":{"secret":true},"usage":{"totalTokens":4100}}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        stream.write_all(body).await.unwrap();
    })
}

#[tokio::test]
#[serial]
async fn monitor_requires_langfuse_configuration() {
    std::env::remove_var(LANGFUSE_PUBLIC_KEY_ENV);
    std::env::remove_var(LANGFUSE_SECRET_KEY_ENV);
    std::env::remove_var(LANGFUSE_HOST_ENV);
    let (_dir, auth, session_id, setup) = auth_fixture();
    let response = monitor_response(
        auth,
        setup,
        SessionCatalog::new(),
        format!(
            "GET /api/monitor/session?sessionId=acp-1 HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nOrigin: http://127.0.0.1:8456\r\nCookie: peri_studio_session={session_id}\r\nContent-Length: 0\r\n\r\n"
        ),
    )
    .await;
    assert!(response.starts_with("HTTP/1.1 503"));
    assert!(response.contains(r#""error":"langfuse_not_configured""#));
}

#[tokio::test]
#[serial]
async fn monitor_requires_cookie_and_catalog_entry() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    std::env::set_var(LANGFUSE_PUBLIC_KEY_ENV, "pk");
    std::env::set_var(LANGFUSE_SECRET_KEY_ENV, "sk");
    std::env::set_var(LANGFUSE_HOST_ENV, format!("http://127.0.0.1:{port}"));
    let fake = start_fake_langfuse(port).await;
    drop(listener);

    let (_dir, auth, session_id, setup) = auth_fixture();
    let no_cookie = monitor_response(
        auth.clone(),
        setup.clone(),
        seed_catalog("acp-1").await,
        "GET /api/monitor/session?sessionId=acp-1 HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nOrigin: http://127.0.0.1:8456\r\nContent-Length: 0\r\n\r\n"
            .to_string(),
    )
    .await;
    assert!(no_cookie.starts_with("HTTP/1.1 401"));
    assert!(no_cookie.contains(r#""error":"unauthorized""#));

    let missing_catalog = monitor_response(
        auth.clone(),
        setup.clone(),
        SessionCatalog::new(),
        format!(
            "GET /api/monitor/session?sessionId=acp-1 HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nOrigin: http://127.0.0.1:8456\r\nCookie: peri_studio_session={session_id}\r\nContent-Length: 0\r\n\r\n"
        ),
    )
    .await;
    assert!(missing_catalog.starts_with("HTTP/1.1 403"));
    assert!(missing_catalog.contains(r#""error":"session_not_accessible""#));

    let success = monitor_response(
        auth,
        setup,
        seed_catalog("acp-1").await,
        format!(
            "GET /api/monitor/session?sessionId=acp-1 HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nOrigin: http://127.0.0.1:8456\r\nCookie: peri_studio_session={session_id}\r\nContent-Length: 0\r\n\r\n"
        ),
    )
    .await;
    fake.abort();
    std::env::remove_var(LANGFUSE_PUBLIC_KEY_ENV);
    std::env::remove_var(LANGFUSE_SECRET_KEY_ENV);
    std::env::remove_var(LANGFUSE_HOST_ENV);

    assert!(success.starts_with("HTTP/1.1 200"));
    let body = success.split_once("\r\n\r\n").unwrap().1;
    let json: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(json["sessionId"], "acp-1");
    assert_eq!(json["found"], true);
    assert_eq!(json["summary"]["traceCount"], 1);
    assert!(json["traces"][0].get("input").is_none());
    assert!(json["traces"][0].get("output").is_none());
    assert!(!body.contains("secret"));
}

#[tokio::test]
#[serial]
async fn health_langfuse_boolean_tracks_configuration() {
    std::env::remove_var(LANGFUSE_PUBLIC_KEY_ENV);
    std::env::remove_var(LANGFUSE_SECRET_KEY_ENV);
    let mut health = HealthSnapshot::from_global_status(
        peri_studio_proto::schema::GlobalStatus::Healthy,
    );
    health.langfuse = crate::langfuse::is_configured();
    assert!(!health.langfuse);

    std::env::set_var(LANGFUSE_PUBLIC_KEY_ENV, "pk");
    std::env::set_var(LANGFUSE_SECRET_KEY_ENV, "sk");
    health.langfuse = crate::langfuse::is_configured();
    assert!(health.langfuse);
    std::env::remove_var(LANGFUSE_PUBLIC_KEY_ENV);
    std::env::remove_var(LANGFUSE_SECRET_KEY_ENV);
}
