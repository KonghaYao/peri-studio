use super::*;
use peri_studio_proto::resource::{
    DirectoryPage, FileEntry, FileKind, GitLogCommit, GitLogPage, GitRefKind, GitRefLabel,
};
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

#[tokio::test]
async fn idle_expired_projection_is_reclaimed_without_another_request() {
    let sink = Arc::new(StoreSink::new());
    let projection = ResourceProjection::new(sink.clone(), Duration::from_millis(10), 1);
    let payload =
        InstanceResourcePayload::RepositoriesPage(peri_studio_proto::resource::RepositoriesPage {
            source_generation: "g1".into(),
            repositories: Vec::new(),
            next_cursor: None,
        });
    let opened = projection.publish("token-a", "p1", &payload).await.unwrap();
    assert!(sink.snapshot(&opened.doc_id).await.is_some());

    tokio::time::sleep(Duration::from_millis(40)).await;

    assert!(sink.snapshot(&opened.doc_id).await.is_none());
}

#[tokio::test]
async fn active_subscription_defers_ttl_until_disconnect() {
    let sink = Arc::new(StoreSink::new());
    let projection = ResourceProjection::new(sink.clone(), Duration::from_millis(10), 1);
    let payload =
        InstanceResourcePayload::RepositoriesPage(peri_studio_proto::resource::RepositoriesPage {
            source_generation: "g1".into(),
            repositories: Vec::new(),
            next_cursor: None,
        });
    let opened = projection.publish("token-a", "p1", &payload).await.unwrap();
    assert!(projection.subscribe("token-a", 42, &opened.doc_id).await);

    tokio::time::sleep(Duration::from_millis(40)).await;
    assert!(sink.snapshot(&opened.doc_id).await.is_some());

    projection.disconnect(42).await;
    tokio::time::sleep(Duration::from_millis(40)).await;
    assert!(sink.snapshot(&opened.doc_id).await.is_none());
}

#[tokio::test]
async fn git_log_page_projection_roundtrips_nested_commit_fields() {
    let sink = Arc::new(StoreSink::new());
    let projection = ResourceProjection::new(sink.clone(), Duration::from_secs(60), 2);
    let head_oid: String = "abc123".repeat(5).chars().take(40).collect();
    let payload = InstanceResourcePayload::GitLogPage(GitLogPage {
        repo_id: "repo-1".into(),
        source_generation: "gen-1".into(),
        commits: vec![GitLogCommit {
            commit_id: head_oid.clone(),
            oid: head_oid.clone(),
            short_oid: "abc12345".into(),
            message: "Initial commit".into(),
            message_truncated: None,
            author_name: "Alice".into(),
            author_date: "2026-08-31T00:00:00Z".into(),
            parents: vec![],
            parents_complete: true,
            refs: vec![
                GitRefLabel {
                    name: "main".into(),
                    kind: GitRefKind::Branch,
                },
                GitRefLabel {
                    name: "origin/main".into(),
                    kind: GitRefKind::Remote,
                },
            ],
            refs_complete: true,
        }],
        next_cursor: Some("gen-1.50".into()),
        head_oid: head_oid.clone(),
        scope: Some(peri_studio_proto::resource::GitLogScope::Full),
    });

    let opened = projection
        .publish("token-a", "project-1", &payload)
        .await
        .unwrap();
    let (state, _) = sink.snapshot(&opened.doc_id).await.unwrap();
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
        Some("git_log_page")
    );
    assert_eq!(
        meta.get(&txn, "repo_id")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("repo-1")
    );
    assert_eq!(
        meta.get(&txn, "source_generation")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("gen-1")
    );
    assert_eq!(
        meta.get(&txn, "next_cursor")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("gen-1.50")
    );
    assert_eq!(
        meta.get(&txn, "head_oid")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some(head_oid.as_str())
    );
    assert_eq!(
        meta.get(&txn, "scope")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("full")
    );

    let order = root
        .get(&txn, "entry_order")
        .unwrap()
        .cast::<yrs::ArrayRef>()
        .unwrap();
    assert_eq!(order.len(&txn), 1);
    let commit_id = order.get(&txn, 0).unwrap().cast::<String>().unwrap();
    let entries = root
        .get(&txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let item = entries
        .get(&txn, commit_id.as_str())
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        item.get(&txn, "oid")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some(head_oid.as_str())
    );
    assert_eq!(
        item.get(&txn, "short_oid")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("abc12345")
    );
    assert_eq!(
        item.get(&txn, "parents")
            .and_then(|value| value.cast::<String>().ok())
            .as_deref(),
        Some("[]")
    );
    let refs = item
        .get(&txn, "refs")
        .and_then(|value| value.cast::<String>().ok())
        .unwrap();
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&refs).unwrap();
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0]["name"], "main");
    assert_eq!(parsed[0]["kind"], "branch");
    assert_eq!(parsed[1]["kind"], "remote");
    assert_eq!(
        item.get(&txn, "parents_complete")
            .and_then(|value| value.cast::<bool>().ok()),
        Some(true)
    );
    assert_eq!(
        item.get(&txn, "refs_complete")
            .and_then(|value| value.cast::<bool>().ok()),
        Some(true)
    );
}
