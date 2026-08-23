use super::*;
use peri_studio_proto::resource::{GitGroupId, ResourceViewKind};
use peri_studio_proto::Frame;
use serde_json::json;

fn view(kind: ResourceViewKind) -> OpenResourceView {
    OpenResourceView {
        kind,
        path: None,
        repo_id: None,
        group_id: None,
        cursor: None,
        limit: 200,
    }
}

#[test]
fn browser_view_is_converted_without_accepting_a_root() {
    let mut directory = view(ResourceViewKind::FsDirectoryPage);
    directory.path = Some("src".into());
    let InstanceResourceQueryKind::ReadDirectory(query) =
        view_to_instance_query(directory).unwrap()
    else {
        panic!("expected directory query");
    };
    assert_eq!(query.path, "src");
    assert_eq!(query.limit, 200);
}

#[test]
fn git_group_requires_repository_and_group_identity() {
    let error = view_to_instance_query(view(ResourceViewKind::GitGroupPage)).unwrap_err();
    assert_eq!(error.code, ResourceErrorCode::InvalidRequest);

    let mut group = view(ResourceViewKind::GitGroupPage);
    group.repo_id = Some("repo-1".into());
    group.group_id = Some(GitGroupId::WorkingTree);
    assert!(matches!(
        view_to_instance_query(group).unwrap(),
        InstanceResourceQueryKind::GitChanges(_)
    ));
}

#[test]
fn page_limit_is_bounded_at_the_server_seam() {
    let mut directory = view(ResourceViewKind::FsDirectoryPage);
    directory.limit = MAX_DIRECTORY_PAGE_SIZE + 1;
    let error = view_to_instance_query(directory).unwrap_err();
    assert_eq!(error.code, ResourceErrorCode::InvalidRequest);
}

#[test]
fn git_timeout_is_reported_as_delivery_unknown_and_never_auto_retryable() {
    let error = git_instance_failure(InstanceError::Timeout);
    assert_eq!(error.code, ResourceErrorCode::DeliveryUnknown);
    assert!(!error.retryable);
}

#[tokio::test]
async fn blob_ticket_is_principal_bound() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(tx);
    let instance = Arc::new(InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(10),
        crate::control::ChatRegistry::new(registry),
    ));
    let sink = Arc::new(crate::control::StoreSink::new());
    let service = ResourceService::new(
        metadata,
        instance,
        ResourceProjection::new(sink, std::time::Duration::from_secs(60), 2),
    );
    let opened = service
        .store_blob(
            "token-a",
            b"hello".to_vec(),
            "text/plain".into(),
            "etag-1".into(),
            chrono::Duration::seconds(10),
        )
        .await
        .unwrap();
    assert_eq!(
        service
            .blob("token-a", &opened.blob_id)
            .await
            .unwrap()
            .bytes
            .as_slice(),
        b"hello"
    );
    assert!(service.blob("token-b", &opened.blob_id).await.is_none());
}

#[tokio::test]
async fn blob_cache_is_bounded_per_principal() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(tx);
    let service = ResourceService::new(
        metadata,
        Arc::new(InstanceRegistry::new(
            std::time::Duration::from_secs(30),
            std::time::Duration::from_secs(10),
            crate::control::ChatRegistry::new(registry),
        )),
        ResourceProjection::new(
            Arc::new(crate::control::StoreSink::new()),
            std::time::Duration::from_secs(60),
            2,
        ),
    );
    for index in 0..MAX_BLOBS_PER_PRINCIPAL {
        service
            .store_blob(
                "token-a",
                vec![index as u8],
                "application/octet-stream".into(),
                format!("etag-{index}"),
                chrono::Duration::seconds(10),
            )
            .await
            .unwrap();
    }
    let error = service
        .store_blob(
            "token-a",
            vec![5],
            "application/octet-stream".into(),
            "etag-5".into(),
            chrono::Duration::seconds(10),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, ResourceErrorCode::RateLimited);
}

#[tokio::test]
async fn open_view_resolves_trusted_project_and_publishes_authorized_doc() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    metadata
        .create_project(
            "project-1",
            "Demo",
            dir.path().to_str().unwrap(),
            "machine-1",
        )
        .await
        .unwrap();
    let (registry_tx, _registry_rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(registry_tx);
    let instances = Arc::new(InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(10),
        crate::control::ChatRegistry::new(registry),
    ));
    let (instance_tx, mut instance_rx) = tokio::sync::mpsc::channel(4);
    instances
        .on_hello(
            "machine-1",
            "instance-token",
            crate::control::InstanceConn { tx: instance_tx },
            &peri_studio_proto::instance::InstanceHello {
                protocol_version: peri_studio_proto::version::PROTOCOL_VERSION,
                token: "token".into(),
                hostname: "machine".into(),
                caps: json!({"resources": {"protocolVersion": peri_studio_proto::resource::RESOURCE_PROTOCOL_VERSION}}),
                buffered: None,
                buffer_lost: None,
                stream_epochs: None,
                nonce: "nonce".into(),
            },
        )
        .await;
    let sink = Arc::new(crate::control::StoreSink::new());
    let projection = ResourceProjection::new(sink.clone(), std::time::Duration::from_secs(60), 2);
    let service = ResourceService::new(metadata, instances.clone(), projection.clone());
    let pending = tokio::spawn({
        let service = service.clone();
        async move {
            service
                .handle(
                    "browser-token",
                    true,
                    ResourceQuery::OpenView {
                        request_id: "browser-query".into(),
                        project_id: "project-1".into(),
                        payload: view(ResourceViewKind::FsDirectoryPage),
                    },
                )
                .await
        }
    });
    let Some(crate::channel::OutboundMsg::Frame(Frame::InstanceResourceQuery(query))) =
        instance_rx.recv().await
    else {
        panic!("expected trusted instance resource query");
    };
    assert_eq!(query.root, dir.path().to_str().unwrap());
    assert!(
        instances
            .on_ack(
                "machine-1",
                &query.request_id,
                crate::control::InstanceAck::Resource(
                    peri_studio_proto::resource::InstanceResourceResult {
                        request_id: query.request_id.clone(),
                        result: Some(InstanceResourcePayload::DirectoryPage(
                            peri_studio_proto::resource::DirectoryPage {
                                path: "".into(),
                                source_generation: "g1".into(),
                                entries: Vec::new(),
                                next_cursor: None,
                            },
                        )),
                        error: None,
                    },
                ),
            )
            .await
    );
    let result = pending.await.unwrap();
    let Some(ResourceQueryResult::View(opened)) = result.result else {
        panic!("expected opened view: {result:?}");
    };
    assert!(projection.authorize("browser-token", &opened.doc_id).await);
    assert!(sink.snapshot(&opened.doc_id).await.is_some());
}

#[tokio::test]
async fn read_only_principal_cannot_stage_changes() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let (registry_tx, _registry_rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(registry_tx);
    let instances = Arc::new(InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(10),
        crate::control::ChatRegistry::new(registry),
    ));
    let sink = Arc::new(crate::control::StoreSink::new());
    let service = ResourceService::new(
        metadata,
        instances,
        ResourceProjection::new(sink, std::time::Duration::from_secs(60), 2),
    );
    let result = service
        .handle(
            "read-only-token",
            false,
            ResourceQuery::GitAction {
                request_id: "mutation-1".into(),
                project_id: "project-1".into(),
                payload: peri_studio_proto::resource::ResourceGitAction {
                    repo_id: "repo-1".into(),
                    action: peri_studio_proto::resource::ResourceGitActionKind::Stage,
                    paths: vec!["src/main.rs".into()],
                    expected_generation: "g1".into(),
                },
            },
        )
        .await;
    assert_eq!(result.error.unwrap().code, ResourceErrorCode::Forbidden);
}
