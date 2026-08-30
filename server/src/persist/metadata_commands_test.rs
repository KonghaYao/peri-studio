use tempfile::tempdir;

use super::metadata::{payload_hash, BeginCommand, MetadataError, MetadataStore};

#[tokio::test]
async fn command_dedup_detects_payload_mismatch_and_replays_result() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    assert_eq!(
        store
            .begin_command("c1", "project/create", "h1", None, None)
            .await
            .unwrap(),
        BeginCommand::New
    );
    assert_eq!(
        store
            .begin_command("c1", "project/create", "h1", None, None)
            .await
            .unwrap(),
        BeginCommand::Existing
    );
    assert!(matches!(
        store
            .begin_command("c1", "project/create", "h2", None, None)
            .await,
        Err(MetadataError::Conflict(_))
    ));
    store
        .update_command("c1", "committed", Some("p1"), None, None, None, None)
        .await
        .unwrap();
    assert_eq!(
        store
            .command("c1")
            .await
            .unwrap()
            .unwrap()
            .project_id
            .as_deref(),
        Some("p1")
    );
}

#[test]
fn payload_hash_is_stable() {
    let value = serde_json::json!({"projectId":"p1","title":"x"});
    assert_eq!(payload_hash(&value).unwrap(), payload_hash(&value).unwrap());
}
