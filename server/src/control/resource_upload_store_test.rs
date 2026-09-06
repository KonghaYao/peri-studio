use super::*;

async fn open(store: &UploadStore, principal: &str, owner_conn: u64, bytes: u64) -> String {
    store
        .open(
            principal,
            owner_conn,
            "project",
            "file.txt",
            Some(bytes),
            None,
        )
        .await
        .unwrap()
        .upload_id
}

#[tokio::test]
async fn ticket_is_principal_project_and_path_bound_and_single_put() {
    let store = UploadStore::new();
    let opened = store
        .open("principal-a", 7, "project-a", "src/a.txt", Some(3), None)
        .await
        .unwrap();
    assert_eq!(
        store.begin_put("principal-b", &opened.upload_id, 3).await,
        Err(UploadStoreError::NotFound)
    );
    store
        .begin_put("principal-a", &opened.upload_id, 3)
        .await
        .unwrap();
    store
        .complete_put("principal-a", &opened.upload_id, b"abc".to_vec())
        .await
        .unwrap();
    assert_eq!(store.quota_usage(), (3, 1));
    assert_eq!(
        store.begin_put("principal-a", &opened.upload_id, 3).await,
        Err(UploadStoreError::AlreadyComplete)
    );
    assert_eq!(
        store
            .begin_commit("principal-a", "project-b", "src/a.txt", &opened.upload_id)
            .await
            .unwrap_err(),
        UploadStoreError::BindingMismatch
    );
    let commit = store
        .begin_commit("principal-a", "project-a", "src/a.txt", &opened.upload_id)
        .await
        .unwrap();
    assert_eq!(commit.bytes.as_slice(), b"abc");
    store.finish_commit(&opened.upload_id, true).await;
    assert_eq!(store.quota_usage(), (3, 1));
    drop(commit);
    assert_eq!(store.quota_usage(), (0, 0));
    assert_eq!(
        store
            .begin_commit("principal-a", "project-a", "src/a.txt", &opened.upload_id)
            .await
            .unwrap_err(),
        UploadStoreError::AlreadyConsumed
    );
}

#[tokio::test]
async fn expected_length_checksum_and_principal_slots_are_enforced() {
    let store = UploadStore::new();
    let digest = format!("{:x}", Sha256::digest(b"abc"));
    let opened = store
        .open("principal", 9, "project", "a.txt", Some(3), Some(digest))
        .await
        .unwrap();
    assert_eq!(
        store.begin_put("principal", &opened.upload_id, 2).await,
        Err(UploadStoreError::LengthMismatch)
    );

    for index in 0..MAX_CONCURRENT_UPLOADS_PER_PRINCIPAL {
        store
            .open("other", 10, "project", &format!("{index}.txt"), None, None)
            .await
            .unwrap();
    }
    assert_eq!(
        store
            .open("other", 10, "project", "overflow.txt", None, None)
            .await
            .unwrap_err(),
        UploadStoreError::RateLimited
    );
    store.cleanup_connection(10).await;
    assert!(store
        .open("other", 11, "project", "new.txt", None, None)
        .await
        .is_ok());
}

#[tokio::test]
async fn putting_reservations_are_global_across_principals() {
    let store = UploadStore::with_limits(6, 2);
    let first = open(&store, "principal-a", 1, 3).await;
    let second = open(&store, "principal-b", 2, 3).await;
    let bytes_blocked = open(&store, "principal-c", 3, 1).await;
    store.begin_put("principal-a", &first, 3).await.unwrap();
    store.begin_put("principal-b", &second, 3).await.unwrap();
    assert_eq!(store.quota_usage(), (6, 2));
    assert_eq!(
        store.begin_put("principal-c", &bytes_blocked, 1).await,
        Err(UploadStoreError::RateLimited)
    );

    store.abort_put("principal-a", &first).await;
    assert_eq!(store.quota_usage(), (3, 1));
    store
        .begin_put("principal-c", &bytes_blocked, 1)
        .await
        .unwrap();
    assert_eq!(store.quota_usage(), (4, 2));
}

#[tokio::test(start_paused = true)]
async fn ready_upload_expires_without_another_open() {
    let store = UploadStore::with_limits(8, 1);
    let upload_id = open(&store, "principal", 1, 8).await;
    store.begin_put("principal", &upload_id, 8).await.unwrap();
    store
        .complete_put("principal", &upload_id, vec![0; 8])
        .await
        .unwrap();
    assert_eq!(store.quota_usage(), (8, 1));

    tokio::time::advance(Duration::from_secs(DEFAULT_UPLOAD_TICKET_TTL_SECS)).await;
    tokio::task::yield_now().await;

    assert_eq!(store.quota_usage(), (0, 0));
    assert_eq!(
        store
            .begin_commit("principal", "project", "file.txt", &upload_id)
            .await
            .unwrap_err(),
        UploadStoreError::Expired
    );
}

#[tokio::test(start_paused = true)]
async fn committing_expiry_cleans_ticket_but_counts_in_flight_bytes_until_drop() {
    let store = UploadStore::with_limits(8, 1);
    let upload_id = open(&store, "principal", 1, 8).await;
    store.begin_put("principal", &upload_id, 8).await.unwrap();
    store
        .complete_put("principal", &upload_id, vec![0; 8])
        .await
        .unwrap();
    let commit = store
        .begin_commit("principal", "project", "file.txt", &upload_id)
        .await
        .unwrap();

    tokio::time::advance(Duration::from_secs(DEFAULT_UPLOAD_TICKET_TTL_SECS)).await;
    tokio::task::yield_now().await;

    assert_eq!(store.quota_usage(), (8, 1));
    assert_eq!(
        store
            .begin_commit("principal", "project", "file.txt", &upload_id)
            .await
            .unwrap_err(),
        UploadStoreError::Expired
    );
    drop(commit);
    assert_eq!(store.quota_usage(), (0, 0));
}

#[tokio::test]
async fn disconnect_and_failures_release_reservations() {
    let store = UploadStore::with_limits(8, 1);
    let disconnected = open(&store, "principal", 1, 8).await;
    store
        .begin_put("principal", &disconnected, 8)
        .await
        .unwrap();
    store.cleanup_connection(1).await;
    assert_eq!(store.quota_usage(), (0, 0));

    let mismatch = open(&store, "principal", 2, 8).await;
    store.begin_put("principal", &mismatch, 8).await.unwrap();
    assert_eq!(
        store.complete_put("principal", &mismatch, vec![0; 7]).await,
        Err(UploadStoreError::LengthMismatch)
    );
    assert_eq!(store.quota_usage(), (0, 0));

    let checksum = store
        .open(
            "principal",
            3,
            "project",
            "file.txt",
            Some(8),
            Some("0".repeat(64)),
        )
        .await
        .unwrap()
        .upload_id;
    store.begin_put("principal", &checksum, 8).await.unwrap();
    assert_eq!(
        store.complete_put("principal", &checksum, vec![1; 8]).await,
        Err(UploadStoreError::ChecksumMismatch)
    );
    assert_eq!(store.quota_usage(), (0, 0));
}

#[tokio::test(start_paused = true)]
async fn repeated_cleanup_cannot_double_release_or_underflow() {
    let store = UploadStore::with_limits(8, 1);
    let upload_id = open(&store, "principal", 1, 8).await;
    store.begin_put("principal", &upload_id, 8).await.unwrap();
    store.abort_put("principal", &upload_id).await;
    store.abort_put("principal", &upload_id).await;
    store.cleanup_connection(1).await;
    tokio::time::advance(Duration::from_secs(
        DEFAULT_UPLOAD_TICKET_TTL_SECS + EXPIRED_TOMBSTONE_TTL_SECS,
    ))
    .await;
    tokio::task::yield_now().await;
    store.finish_commit(&upload_id, true).await;
    assert_eq!(store.quota_usage(), (0, 0));
}
