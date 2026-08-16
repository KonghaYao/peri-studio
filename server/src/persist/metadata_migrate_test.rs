use sqlx::{Connection, Executor};
use tempfile::tempdir;

use super::metadata::{
    payload_hash, BeginOAuthCommand, MetadataError, MetadataStore,
};

#[tokio::test]
async fn v2_catalog_migrates_additively_to_current_schema() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("metadata.sqlite3");
    let mut connection =
        sqlx::SqliteConnection::connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
    connection
        .execute(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
        )
        .await
        .unwrap();
    connection
        .execute("INSERT INTO schema_migrations VALUES(1,'t'),(2,'t')")
        .await
        .unwrap();
    connection
        .execute(
            "CREATE TABLE project_sessions(\
             id TEXT PRIMARY KEY,project_id TEXT NOT NULL,acp_session_id TEXT UNIQUE,\
             acp_title TEXT,custom_name TEXT,lifecycle TEXT NOT NULL,created_at TEXT NOT NULL,\
             updated_at TEXT NOT NULL,last_opened_at TEXT,last_chat_id TEXT,failure_code TEXT,\
             origin TEXT NOT NULL DEFAULT 'legacy_hidden')",
        )
        .await
        .unwrap();
    connection.close().await.unwrap();

    let store = MetadataStore::open(dir.path()).await.unwrap();
    assert!(
        !store.seed_hub_title("unknown", "Title").await.unwrap(),
        "the additive column must be queryable without rebuilding user data"
    );
    assert!(
        store.session("unknown").await.unwrap().is_none(),
        "the archive column must also be queryable after an additive migration"
    );
    assert!(store.session_runtimes("unknown").await.unwrap().is_empty());
}

#[tokio::test]
async fn fresh_open_reopen_and_crud() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    let p = store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    assert_eq!(p.name, "Demo");
    let s = store
        .create_pending_session("s1", "p1", Some("ACP title"))
        .await
        .unwrap();
    assert_eq!(s.display_title(), "ACP title");
    store.rename_session("s1", "Alias").await.unwrap();
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().display_title(),
        "Alias"
    );
    drop(store);
    let reopened = MetadataStore::open(dir.path()).await.unwrap();
    assert_eq!(reopened.list_projects().await.unwrap().len(), 1);
    assert_eq!(reopened.list_sessions().await.unwrap().len(), 1);
}

#[tokio::test]
async fn runtime_history_is_append_only_identity_not_liveness() {
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
    store.record_session_runtime("s1", "chat-1").await.unwrap();
    store.record_session_runtime("s1", "chat-1").await.unwrap();
    store.record_session_runtime("s1", "chat-2").await.unwrap();
    let history = store.session_runtimes("s1").await.unwrap();
    assert_eq!(history.len(), 2, "same runtime provenance is idempotent");
    assert!(history.iter().all(|record| record.retired_at.is_none()));

    store.recover_after_restart().await.unwrap();
    assert_eq!(
        store.session_runtimes("s1").await.unwrap().len(),
        2,
        "restart clears active hints, not historical provenance"
    );
}

#[tokio::test]
async fn v4_migration_backfills_the_last_known_runtime_before_restart_clears_the_hint() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("metadata.sqlite3");
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
        .finalize_session("s1", "acp-1", None, "chat-before-v5")
        .await
        .unwrap();
    drop(store);

    let mut connection =
        sqlx::SqliteConnection::connect(&format!("sqlite://{}?mode=rw", path.display()))
            .await
            .unwrap();
    connection
        .execute("DROP INDEX session_runtime_history_session_activated_idx")
        .await
        .unwrap();
    connection
        .execute("DROP TABLE session_runtime_history")
        .await
        .unwrap();
    connection
        .execute("DROP INDEX oauth_commands_updated_idx")
        .await
        .unwrap();
    connection
        .execute("DROP TABLE oauth_commands")
        .await
        .unwrap();
    connection
        .execute("DELETE FROM schema_migrations WHERE version>=5")
        .await
        .unwrap();
    connection.close().await.unwrap();

    let migrated = MetadataStore::open(dir.path()).await.unwrap();
    let history = migrated.session_runtimes("s1").await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].chat_id, "chat-before-v5");
}

#[tokio::test]
async fn v5_migration_adds_body_free_oauth_command_ledger() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("metadata.sqlite3");
    let store = MetadataStore::open(dir.path()).await.unwrap();
    drop(store);

    let mut connection =
        sqlx::SqliteConnection::connect(&format!("sqlite://{}?mode=rw", path.display()))
            .await
            .unwrap();
    connection
        .execute("DROP INDEX oauth_commands_updated_idx")
        .await
        .unwrap();
    connection
        .execute("DROP TABLE oauth_commands")
        .await
        .unwrap();
    connection
        .execute("DELETE FROM schema_migrations WHERE version=6")
        .await
        .unwrap();
    connection.close().await.unwrap();

    let migrated = MetadataStore::open(dir.path()).await.unwrap();
    assert_eq!(
        migrated
            .begin_oauth_command("cmd", "mcp/oauth-start", "chat", "fingerprint")
            .await
            .unwrap(),
        BeginOAuthCommand::New
    );
}

#[tokio::test]
async fn unknown_newer_metadata_schema_fails_before_mutating_user_tables() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("metadata.sqlite3");
    let mut connection =
        sqlx::SqliteConnection::connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
    connection
        .execute(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
        )
        .await
        .unwrap();
    connection
        .execute("INSERT INTO schema_migrations VALUES(7,'future')")
        .await
        .unwrap();
    connection.close().await.unwrap();

    assert!(matches!(
        MetadataStore::open(dir.path()).await,
        Err(MetadataError::NewerSchema {
            found: 7,
            supported: 6
        })
    ));
    let mut connection =
        sqlx::SqliteConnection::connect(&format!("sqlite://{}?mode=rw", path.display()))
            .await
            .unwrap();
    let table: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='oauth_commands'",
    )
    .fetch_optional(&mut connection)
    .await
    .unwrap();
    assert!(
        table.is_none(),
        "a future schema must not be migrated backward"
    );
}

#[tokio::test]
async fn oauth_command_identity_and_transitions_are_durable_and_strict() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    assert_eq!(
        store
            .begin_oauth_command("cmd", "mcp/oauth-start", "chat", "fingerprint")
            .await
            .unwrap(),
        BeginOAuthCommand::New
    );
    assert_eq!(
        store
            .begin_oauth_command("cmd", "mcp/oauth-start", "chat", "fingerprint")
            .await
            .unwrap(),
        BeginOAuthCommand::Existing
    );
    assert!(matches!(
        store
            .begin_oauth_command("cmd", "mcp/oauth-start", "chat", "different")
            .await,
        Err(MetadataError::Conflict(_))
    ));
    store
        .transition_oauth_command("cmd", "intent_durable", "dispatching", None)
        .await
        .unwrap();
    assert!(matches!(
        store
            .transition_oauth_command("cmd", "intent_durable", "committed", None)
            .await,
        Err(MetadataError::Conflict(_))
    ));
    store
        .transition_oauth_command("cmd", "dispatching", "committed", None)
        .await
        .unwrap();
    drop(store);

    let reopened = MetadataStore::open(dir.path()).await.unwrap();
    assert_eq!(
        reopened.oauth_command("cmd").await.unwrap().unwrap().phase,
        "committed"
    );
}

#[tokio::test]
async fn oauth_restart_reconciliation_respects_the_dispatch_barrier() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .begin_oauth_command("before", "mcp/oauth-start", "chat", "one")
        .await
        .unwrap();
    store
        .begin_oauth_command("after", "mcp/oauth-cancel", "chat", "two")
        .await
        .unwrap();
    store
        .transition_oauth_command("after", "intent_durable", "dispatching", None)
        .await
        .unwrap();
    store.recover_after_restart().await.unwrap();

    let before = store.oauth_command("before").await.unwrap().unwrap();
    assert_eq!(before.phase, "failed_not_delivered");
    assert_eq!(
        before.error_code.as_deref(),
        Some("server_restart_before_dispatch")
    );
    let after = store.oauth_command("after").await.unwrap().unwrap();
    assert_eq!(after.phase, "delivery_unknown");
    assert_eq!(
        after.error_code.as_deref(),
        Some("server_restart_after_dispatch")
    );
}

#[tokio::test]
async fn oauth_ledger_persists_only_a_one_way_payload_fingerprint() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    let sentinel = "https://provider.invalid/authorize?secret=oauth-ledger-sentinel";
    let fingerprint = payload_hash(&sentinel).unwrap();
    store
        .begin_oauth_command("cmd", "mcp/oauth-start", "chat", &fingerprint)
        .await
        .unwrap();
    let record = store.oauth_command("cmd").await.unwrap().unwrap();
    assert_eq!(record.payload_fingerprint, fingerprint);
    assert!(!format!("{record:?}").contains(sentinel));
    drop(store);
    for name in [
        "metadata.sqlite3",
        "metadata.sqlite3-wal",
        "metadata.sqlite3-shm",
    ] {
        let path = dir.path().join(name);
        if path.exists() {
            let bytes = std::fs::read(path).unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains(sentinel));
        }
    }
}

#[tokio::test]
async fn owner_lock_is_exclusive_and_db_files_are_private() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    assert!(matches!(
        MetadataStore::open(dir.path()).await,
        Err(MetadataError::Conflict(_))
    ));
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    for name in [
        "metadata.sqlite3",
        "metadata.sqlite3-wal",
        "metadata.sqlite3-shm",
        "metadata.owner.lock",
    ] {
        let path = dir.path().join(name);
        if path.exists() {
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    drop(store);
    MetadataStore::open(dir.path()).await.unwrap();
}

