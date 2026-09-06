use std::sync::Arc;

use tempfile::tempdir;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

use peri_studio_proto::resource::{OpenResourceUpload, ResourceQuery, ResourceQueryResult};

use super::{serve_http_with_resources, BrowserAuthSetup};
use crate::auth::{AuthService, TokenRole, TokenStore};
use crate::web::test_util::{test_auth_setup, test_health};

async fn put(
    auth: Arc<Mutex<AuthService>>,
    resources: Arc<crate::control::ResourceService>,
    setup: BrowserAuthSetup,
    request: String,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, peer) = listener.accept().await.unwrap();
        serve_http_with_resources(stream, peer, auth, setup, test_health(), resources)
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

#[tokio::test]
async fn resource_upload_put_requires_session_origin_and_is_single_use() {
    let dir = tempdir().unwrap();
    let token_path = dir.path().join("tokens.toml");
    let mut token_store = TokenStore::load(&token_path).unwrap();
    let record = token_store
        .generate(TokenRole::Full, "upload-writer")
        .unwrap();
    let mut auth_service = AuthService::new(token_store);
    let (session_id, ctx) = auth_service.create_browser_session(&record.token).unwrap();
    let auth = Arc::new(Mutex::new(auth_service));
    let metadata = Arc::new(
        crate::persist::metadata::MetadataStore::open(dir.path())
            .await
            .unwrap(),
    );
    metadata
        .create_project("project-1", "Project", "/workspace", "local")
        .await
        .unwrap();
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
        .handle(
            &ctx.token_id,
            1,
            true,
            ResourceQuery::OpenUpload {
                request_id: "open-upload".into(),
                project_id: "project-1".into(),
                payload: OpenResourceUpload {
                    path: "file.txt".into(),
                    expected_bytes: Some(3),
                    sha256: None,
                },
            },
        )
        .await;
    let Some(ResourceQueryResult::Upload(opened)) = opened.result else {
        panic!("expected upload ticket: {opened:?}");
    };

    let request = format!(
        "PUT {} HTTP/1.1\r\nHost: 127.0.0.1:8456\r\nOrigin: http://127.0.0.1:8456\r\nCookie: peri_studio_session={}\r\nContent-Length: 3\r\n\r\nabc",
        opened.url, session_id
    );
    let first = put(
        auth.clone(),
        resources.clone(),
        test_auth_setup(dir.path()),
        request.clone(),
    )
    .await;
    assert!(first.starts_with("HTTP/1.1 204 No Content\r\n"));
    let duplicate = put(auth, resources, test_auth_setup(dir.path()), request).await;
    assert!(duplicate.starts_with("HTTP/1.1 409 Conflict\r\n"));
    assert!(!duplicate.contains("abc"));
}
