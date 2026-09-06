use tempfile::tempdir;

use super::metadata::{MetadataError, MetadataStore};

#[tokio::test]
async fn project_archive_is_reversible() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();

    store.archive_project("p1").await.unwrap();
    assert!(store
        .project("p1")
        .await
        .unwrap()
        .unwrap()
        .archived_at
        .is_some());
    store.restore_project("p1").await.unwrap();
    assert!(store
        .project("p1")
        .await
        .unwrap()
        .unwrap()
        .archived_at
        .is_none());
    assert!(
        store.restore_project("p1").await.is_err(),
        "restoring an active project is not an idempotent mutation"
    );
}

#[tokio::test]
async fn project_rename_preserves_directory_and_rejects_empty_or_archived_projects() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    let cwd = dir.path().to_str().unwrap();
    store
        .create_project("p1", "Before", cwd, "local")
        .await
        .unwrap();
    store.rename_project("p1", "  After  ").await.unwrap();
    let renamed = store.project("p1").await.unwrap().unwrap();
    assert_eq!(renamed.name, "After");
    assert_eq!(renamed.cwd, cwd);
    assert!(store.rename_project("p1", "  ").await.is_err());
    store.archive_project("p1").await.unwrap();
    assert!(store.rename_project("p1", "Hidden").await.is_err());
}

#[tokio::test]
async fn projection_snapshot_is_generation_consistent_and_watermark_monotonic() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    let snapshot = store.snapshot().await.unwrap();
    assert_eq!(snapshot.projects.len(), 1);
    assert_eq!(snapshot.sessions.len(), 0);

    store.mark_projected(snapshot.generation).await.unwrap();
    store.mark_projected(snapshot.generation - 1).await.unwrap();
    assert_eq!(
        store.generation().await.unwrap().1,
        snapshot.generation,
        "an older projection completion cannot move the watermark backwards"
    );
}

#[tokio::test]
async fn list_runtime_chats_is_empty_without_sqlite_session_catalog() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    assert!(
        store.list_runtime_chats().await.unwrap().is_empty(),
        "session catalog is no longer rebuilt from SQLite"
    );
    store
        .create_project("p1", "Demo", "/work/demo", "local")
        .await
        .unwrap();
    assert!(
        store.list_runtime_chats().await.unwrap().is_empty(),
        "projects alone do not imply runtime chat views"
    );
}

#[tokio::test]
async fn import_completed_marker_is_idempotent() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    assert!(!store.import_completed("legacy").await.unwrap());
    store.mark_import_complete("legacy", 3, 1).await.unwrap();
    assert!(store.import_completed("legacy").await.unwrap());
    assert!(matches!(
        store.mark_import_complete("legacy", 0, 0).await,
        Err(MetadataError::Database(_))
    ));
}
