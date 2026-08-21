use tempfile::tempdir;

use super::metadata::{payload_hash, BeginCommand, MetadataError, MetadataStore, NewSession};

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

#[tokio::test]
async fn activation_restart_before_dispatch_is_safe_failure() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    store
        .create_pending_session("s1", "p1", None)
        .await
        .unwrap();
    store
        .begin_command_with_activation(
            "c1",
            "session/create",
            "h",
            Some("p1"),
            Some("s1"),
            None,
            Some("s1"),
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .stale_activations_require_reconciliation()
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().lifecycle,
        "failed"
    );
}

#[test]
fn payload_hash_is_stable() {
    let value = serde_json::json!({"projectId":"p1","title":"x"});
    assert_eq!(payload_hash(&value).unwrap(), payload_hash(&value).unwrap());
}

#[tokio::test]
async fn atomic_create_and_simultaneous_open_lease() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    store
        .begin_command_with_activation(
            "c1",
            "session/create",
            "h1",
            Some("p1"),
            Some("s1"),
            Some(NewSession {
                id: "s1",
                project_id: "p1",
                title: Some("Title"),
            }),
            Some("s1"),
        )
        .await
        .unwrap();
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().lifecycle,
        "activating"
    );
    store
        .activation_phase("s1", "acp_id_durable", Some("chat1"), Some("acp1"))
        .await
        .unwrap();
    store
        .finalize_session_and_command("c1", "s1", "p1", "acp1", Some("Title"), "chat1")
        .await
        .unwrap();
    assert_eq!(
        store.command("c1").await.unwrap().unwrap().phase,
        "projection_pending"
    );
    store
        .update_command(
            "c1",
            "committed",
            Some("p1"),
            Some("s1"),
            Some("chat1"),
            Some("acp1"),
            None,
        )
        .await
        .unwrap();
    store
        .begin_command_with_activation(
            "o1",
            "session/open",
            "h2",
            None,
            Some("s1"),
            None,
            Some("s1"),
        )
        .await
        .unwrap();
    assert!(matches!(
        store
            .begin_command_with_activation(
                "o2",
                "session/open",
                "h3",
                None,
                Some("s1"),
                None,
                Some("s1")
            )
            .await,
        Err(MetadataError::Conflict(_))
    ));
    assert!(
        store.command("o2").await.unwrap().is_none(),
        "losing lease transaction must roll back command intention"
    );
}

/// 重新打开（恢复路径）：终态激活记录（reconciliation_required/failed）被
/// 新一轮激活覆盖；进行中的激活（非终态）仍必须冲突拒绝。
#[tokio::test]
async fn reentrant_open_replaces_terminal_activation_but_keeps_inflight_conflict() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    store
        .create_pending_session("s1", "p1", None)
        .await
        .unwrap();

    // 第一轮激活 → 终态 reconciliation_required（残留记录）。
    store
        .begin_command_with_activation(
            "c1",
            "session/open",
            "h1",
            None,
            Some("s1"),
            None,
            Some("s1"),
        )
        .await
        .unwrap();
    store
        .mark_reconciliation_required("s1", "activation_failed_or_unknown")
        .await
        .unwrap();
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().lifecycle,
        "reconciliation_required"
    );

    // 重新打开：终态记录被新激活覆盖（新 command 接管激活）。
    store
        .begin_command_with_activation(
            "c2",
            "session/open",
            "h2",
            None,
            Some("s1"),
            None,
            Some("s1"),
        )
        .await
        .unwrap();
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().lifecycle,
        "activating"
    );
    // 进行中的激活（非终态，intention_durable）仍必须冲突拒绝。
    assert!(matches!(
        store
            .begin_command_with_activation(
                "c3",
                "session/open",
                "h3",
                None,
                Some("s1"),
                None,
                Some("s1"),
            )
            .await,
        Err(MetadataError::Conflict(_))
    ));
    assert!(
        store.command("c3").await.unwrap().is_none(),
        "losing lease transaction must roll back command intention"
    );
}

#[tokio::test]
async fn unknown_activation_atomically_reconciles_command_and_session() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    store
        .begin_command_with_activation(
            "c1",
            "session/create",
            "h",
            Some("p1"),
            Some("s1"),
            Some(NewSession {
                id: "s1",
                project_id: "p1",
                title: None,
            }),
            Some("s1"),
        )
        .await
        .unwrap();
    store
        .reconcile_activation_and_command("s1", "c1", "channel_closed")
        .await
        .unwrap();
    assert_eq!(
        store.command("c1").await.unwrap().unwrap().phase,
        "reconciliation_required"
    );
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().lifecycle,
        "reconciliation_required"
    );
}
