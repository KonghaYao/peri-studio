use super::*;
use peri_studio_proto::resource::{DirectoryPage, FileEntry, FileKind};
use yrs::{Array, Map, Transact};

#[tokio::test]
async fn projection_is_principal_bound_and_reclaimed_on_release() {
    let sink = Arc::new(StoreSink::new());
    let projection = ResourceProjection::new(sink.clone(), Duration::from_secs(60), 2);
    let payload = InstanceResourcePayload::DirectoryPage(DirectoryPage {
        path: "src".into(),
        source_generation: "g1".into(),
        entries: vec![FileEntry {
            id: "file-1".into(),
            name: "main.rs".into(),
            path: "src/main.rs".into(),
            kind: FileKind::File,
            size: 42,
            mtime_ns: "1".into(),
            revision: "r1".into(),
        }],
        next_cursor: None,
    });

    let opened = projection
        .publish("token-a", "project-1", &payload)
        .await
        .unwrap();
    assert!(projection.authorize("token-a", &opened.doc_id).await);
    assert!(!projection.authorize("token-b", &opened.doc_id).await);

    let (state, version) = sink.snapshot(&opened.doc_id).await.unwrap();
    assert_eq!(version, 1);
    let doc = yrs::Doc::new();
    {
        use yrs::updates::decoder::Decode as _;
        let update = yrs::Update::decode_v1(&state).unwrap();
        doc.transact_mut().apply_update(update).unwrap();
    }
    let txn = doc.transact();
    let root = txn.get_map(ROOT).unwrap();
    let meta = root
        .get(&txn, "meta")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        meta.get(&txn, "view_type")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("fs_directory_page")
    );
    let order = root
        .get(&txn, "entry_order")
        .unwrap()
        .cast::<yrs::ArrayRef>()
        .unwrap();
    assert_eq!(order.len(&txn), 1);
    drop(txn);

    assert!(!projection.release("token-b", &opened.view_id).await);
    assert!(projection.release("token-a", &opened.view_id).await);
    assert!(sink.snapshot(&opened.doc_id).await.is_none());
}

#[tokio::test]
async fn projection_enforces_bounded_views_per_principal() {
    let sink = Arc::new(StoreSink::new());
    let projection = ResourceProjection::new(sink, Duration::from_secs(60), 1);
    let payload =
        InstanceResourcePayload::RepositoriesPage(peri_studio_proto::resource::RepositoriesPage {
            source_generation: "g1".into(),
            repositories: Vec::new(),
            next_cursor: None,
        });
    let (left, right) = tokio::join!(
        projection.publish("token-a", "p1", &payload),
        projection.publish("token-a", "p1", &payload),
    );
    let results = [left, right];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .filter(|error| error.code == ResourceErrorCode::RateLimited)
            .count(),
        1
    );
}

#[tokio::test]
async fn expired_projection_removes_its_doc_snapshot() {
    let sink = Arc::new(StoreSink::new());
    let projection = ResourceProjection::new(sink.clone(), Duration::ZERO, 1);
    let payload =
        InstanceResourcePayload::RepositoriesPage(peri_studio_proto::resource::RepositoriesPage {
            source_generation: "g1".into(),
            repositories: Vec::new(),
            next_cursor: None,
        });
    let opened = projection.publish("token-a", "p1", &payload).await.unwrap();
    assert!(!projection.authorize("token-a", &opened.doc_id).await);
    assert!(sink.snapshot(&opened.doc_id).await.is_none());
}
