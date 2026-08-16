use tempfile::tempdir;

use super::metadata::{
    MetadataError, MetadataStore, NewSession,
};

#[tokio::test]
async fn project_archive_is_reversible_without_losing_sessions() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    store
        .import_session("s1", "p1", "acp-1", "Saved work", "2026-08-13T00:00:00Z")
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
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().display_title(),
        "Saved work"
    );
    assert!(
        store.restore_project("p1").await.is_err(),
        "restoring an active project is not an idempotent mutation"
    );
}

#[tokio::test]
async fn session_archive_is_reversible_and_preserves_runtime_lifecycle() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    store
        .import_session("s1", "p1", "acp-1", "Saved work", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    let lifecycle = store.session("s1").await.unwrap().unwrap().lifecycle;

    store.archive_session("s1").await.unwrap();
    let archived = store.session("s1").await.unwrap().unwrap();
    assert!(archived.archived_at.is_some());
    assert_eq!(archived.lifecycle, lifecycle);

    store.restore_session("s1").await.unwrap();
    let restored = store.session("s1").await.unwrap().unwrap();
    assert!(restored.archived_at.is_none());
    assert_eq!(restored.lifecycle, lifecycle);
    assert_eq!(restored.acp_session_id.as_deref(), Some("acp-1"));
}

#[tokio::test]
async fn session_restore_requires_an_active_parent_project() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    store
        .import_session("s1", "p1", "acp-1", "Saved work", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    store.archive_session("s1").await.unwrap();
    store.archive_project("p1").await.unwrap();
    assert!(matches!(
        store.restore_session("s1").await,
        Err(MetadataError::InvalidState(_))
    ));
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
async fn acp_title_refresh_is_exact_idempotent_and_preserves_user_alias() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    store
        .import_session("s1", "p1", "acp-1", "Old ACP title", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    store.rename_session("s1", "My alias").await.unwrap();
    let generation_before = store.generation().await.unwrap().0;

    assert_eq!(
        store
            .update_acp_titles(&[
                ("acp-1".into(), "New ACP title".into()),
                ("unknown".into(), "Ignored".into()),
                ("acp-1".into(), "".into()),
            ])
            .await
            .unwrap(),
        1
    );
    let refreshed = store.session("s1").await.unwrap().unwrap();
    assert_eq!(refreshed.acp_title.as_deref(), Some("New ACP title"));
    assert_eq!(refreshed.display_title(), "My alias");
    assert_eq!(store.generation().await.unwrap().0, generation_before + 1);

    assert_eq!(
        store
            .update_acp_titles(&[("acp-1".into(), "New ACP title".into())])
            .await
            .unwrap(),
        0
    );
    assert_eq!(store.generation().await.unwrap().0, generation_before + 1);
}

#[tokio::test]
async fn hub_prompt_title_is_one_shot_and_never_outranks_owned_titles() {
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
                title: None,
            }),
            Some("s1"),
        )
        .await
        .unwrap();
    store
        .activation_phase("s1", "acp_id_durable", Some("chat1"), Some("acp1"))
        .await
        .unwrap();
    store
        .finalize_session_and_command("c1", "s1", "p1", "acp1", None, "chat1")
        .await
        .unwrap();

    assert!(store.seed_hub_title("acp1", "First task").await.unwrap());
    assert!(!store.seed_hub_title("acp1", "Second task").await.unwrap());
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().display_title(),
        "First task"
    );

    store.update_acp_title("acp1", "ACP title").await.unwrap();
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().display_title(),
        "ACP title"
    );
    store.rename_session("s1", "My alias").await.unwrap();
    assert_eq!(
        store.session("s1").await.unwrap().unwrap().display_title(),
        "My alias"
    );
    assert!(
        !store.seed_hub_title("missing", "Ignored").await.unwrap(),
        "unknown and imported ACP ids must not create navigation facts"
    );
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
async fn explicit_import_promotes_hidden_session_and_preserves_single_identity() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    store
        .import_session("legacy", "p1", "acp1", "Old", "2026-08-01T00:00:00Z")
        .await
        .unwrap();
    assert_eq!(
        store.session("legacy").await.unwrap().unwrap().origin,
        "legacy_hidden"
    );

    let imported = store
        .import_explicit_session("new-id", "p1", "acp1", "Imported", "2026-08-12T00:00:00Z")
        .await
        .unwrap();
    assert_eq!(imported.id, "legacy");
    assert_eq!(imported.origin, "imported");
    assert_eq!(store.list_sessions().await.unwrap().len(), 1);
    store
        .create_project("p2", "Other", dir.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    assert!(matches!(
        store
            .import_explicit_session("other", "p2", "acp1", "Moved", "")
            .await,
        Err(MetadataError::Conflict(_))
    ));
}

#[tokio::test]
async fn list_runtime_chats_returns_live_runtime_views_for_view_rebuild() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    assert!(
        store.list_runtime_chats().await.unwrap().is_empty(),
        "empty catalog must yield no runtime views"
    );
    store
        .create_project("p1", "Demo", "/work/demo", "local")
        .await
        .unwrap();
    store
        .import_session("s1", "p1", "acp-1", "First", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    store
        .import_session("s2", "p1", "acp-2", "Second", "2026-08-13T00:00:01Z")
        .await
        .unwrap();
    store.record_session_runtime("s1", "chat-1").await.unwrap();
    store.record_session_runtime("s2", "chat-2").await.unwrap();
    // 活跃 chat 权威 = last_chat_id（runtime history 是身份追踪，不构成
    // 活跃证据）；open 时更新。
    store.touch_session_open("s1", "chat-1").await.unwrap();
    store.touch_session_open("s2", "chat-2").await.unwrap();

    let views = store.list_runtime_chats().await.unwrap();
    assert_eq!(views.len(), 2);
    let first = views.iter().find(|v| v.chat_id == "chat-1").unwrap();
    assert_eq!(first.instance_id, "local");
    assert_eq!(first.acp_session_id.as_deref(), Some("acp-1"));
    assert_eq!(first.cwd, "/work/demo");
    assert_eq!(first.workspace_id.as_deref(), Some("p1"));
    assert_eq!(first.title, "First");
    let second = views.iter().find(|v| v.chat_id == "chat-2").unwrap();
    assert_eq!(second.acp_session_id.as_deref(), Some("acp-2"));
    assert_eq!(second.title, "Second");
}

#[tokio::test]
async fn list_runtime_chats_excludes_archived_projects_and_sessions() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .create_project("p1", "Demo", "/work/demo", "local")
        .await
        .unwrap();
    store
        .import_session("s1", "p1", "acp-1", "Active", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    store
        .import_session("s2", "p1", "acp-2", "Gone", "2026-08-13T00:00:01Z")
        .await
        .unwrap();
    store.record_session_runtime("s1", "chat-1").await.unwrap();
    store.record_session_runtime("s2", "chat-2").await.unwrap();
    store.touch_session_open("s1", "chat-1").await.unwrap();
    store.touch_session_open("s2", "chat-2").await.unwrap();
    store.archive_session("s2").await.unwrap();

    let views = store.list_runtime_chats().await.unwrap();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].chat_id, "chat-1");
}
