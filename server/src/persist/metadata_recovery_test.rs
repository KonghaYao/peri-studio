use tempfile::tempdir;

use super::metadata::{MetadataStore, NewSession};

#[tokio::test]
async fn restart_terminates_pre_dispatch_intention_as_safe_retry() {
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
            Some("acp-session-1"),
            Some(NewSession {
                id: "acp-session-1",
                project_id: "p1",
                title: None,
            }),
            Some("acp-session-1"),
        )
        .await
        .unwrap();
    store.recover_after_restart().await.unwrap();
    let command = store.command("c1").await.unwrap().unwrap();
    assert_eq!(command.phase, "failed");
    assert_eq!(
        command.error_code.as_deref(),
        Some("server_restart_before_dispatch_safe_retry")
    );
}

#[tokio::test]
async fn dispatched_restart_is_reconciliation_not_safe_retry() {
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
            Some("acp-session-1"),
            Some(NewSession {
                id: "acp-session-1",
                project_id: "p1",
                title: None,
            }),
            Some("acp-session-1"),
        )
        .await
        .unwrap();
    store
        .update_command(
            "c1",
            "dispatched",
            Some("p1"),
            Some("acp-session-1"),
            None,
            None,
            None,
        )
        .await
        .unwrap();
    let (_, reconciled) = store.recover_after_restart().await.unwrap();
    assert_eq!(reconciled, 1);
    assert_eq!(
        store.command("c1").await.unwrap().unwrap().phase,
        "reconciliation_required"
    );
}

#[tokio::test]
async fn runtime_config_restart_respects_the_no_redelivery_barrier() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    store
        .begin_runtime_command("config-safe", "chat/config-set", "hash-a", "chat-1")
        .await
        .unwrap();
    store
        .begin_runtime_command("config-unknown", "chat/config-set", "hash-b", "chat-1")
        .await
        .unwrap();
    store
        .transition_runtime_command(
            "config-unknown",
            "chat/config-set",
            "intention_durable",
            "dispatching",
            None,
        )
        .await
        .unwrap();

    store.recover_after_restart().await.unwrap();
    let safe = store.command("config-safe").await.unwrap().unwrap();
    let unknown = store.command("config-unknown").await.unwrap().unwrap();
    assert_eq!(safe.phase, "failed");
    assert_eq!(
        safe.error_code.as_deref(),
        Some("server_restart_before_dispatch_safe_retry")
    );
    assert_eq!(unknown.phase, "delivery_unknown");
    assert_eq!(
        unknown.error_code.as_deref(),
        Some("server_restart_after_config_dispatch")
    );
}

#[tokio::test]
async fn runtime_rewind_restart_never_redelivers_dispatch_or_confirmed_effect() {
    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    for (command_id, phase) in [
        ("rewind-dispatch", "dispatching"),
        ("rewind-confirmed", "effect_confirmed"),
    ] {
        store
            .begin_runtime_command(command_id, "chat/rewind", command_id, "chat-1")
            .await
            .unwrap();
        store
            .transition_runtime_command(
                command_id,
                "chat/rewind",
                "intention_durable",
                "dispatching",
                None,
            )
            .await
            .unwrap();
        if phase == "effect_confirmed" {
            store
                .transition_runtime_command(
                    command_id,
                    "chat/rewind",
                    "dispatching",
                    "effect_confirmed",
                    None,
                )
                .await
                .unwrap();
        }
    }

    store.recover_after_restart().await.unwrap();
    let dispatch = store.command("rewind-dispatch").await.unwrap().unwrap();
    let confirmed = store.command("rewind-confirmed").await.unwrap().unwrap();
    assert_eq!(dispatch.phase, "delivery_unknown");
    assert_eq!(
        dispatch.error_code.as_deref(),
        Some("server_restart_after_rewind_dispatch")
    );
    assert_eq!(confirmed.phase, "delivery_unknown");
    assert_eq!(
        confirmed.error_code.as_deref(),
        Some("server_restart_after_rewind_confirmed")
    );
}

#[tokio::test]
async fn recover_after_restart_fails_in_progress_ssh_machines() {
    use super::metadata::{
        AdmitSshMachineParams, MetadataStore, PHASE_FAILED, new_ssh_instance_id,
    };

    let dir = tempdir().unwrap();
    let store = MetadataStore::open(dir.path()).await.unwrap();
    let id = new_ssh_instance_id();
    store
        .admit_ssh_machine(AdmitSshMachineParams {
            instance_id: &id,
            destination: "user@remote",
            port: None,
            identity_file: None,
            display_name: "remote",
        })
        .await
        .unwrap();
    store
        .update_machine_phase(&id, "tunnel", None)
        .await
        .unwrap();

    store.recover_after_restart().await.unwrap();

    let row = store.machine(&id).await.unwrap().unwrap();
    assert_eq!(row.phase, PHASE_FAILED);
    assert_eq!(row.error_code.as_deref(), Some("server_restarted"));
}
