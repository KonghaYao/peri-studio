use super::*;
use crate::control::InstanceError;
use peri_studio_proto::ack::AckStatus;
use peri_studio_proto::action::{FsCreateDirPayload, FsDeletePayload, FsMovePayload};
use peri_studio_proto::resource::{FileKind, FsMutationResult, FsPermissions, FsStat};

fn create_payload(path: &str) -> FsMutationPayload {
    FsMutationPayload::CreateDir(FsCreateDirPayload {
        project_id: "project".into(),
        path: path.into(),
        if_none_match: "*".into(),
    })
}

fn delete_confirm_request(path: &str, revision: &str) -> OpenResourceDeleteConfirm {
    OpenResourceDeleteConfirm {
        path: path.into(),
        if_match: revision.into(),
        recursive: true,
        use_trash: false,
    }
}

fn delete_payload(token: Option<&str>) -> FsDeletePayload {
    FsDeletePayload {
        project_id: "project".into(),
        path: "src".into(),
        if_match: "revision-1".into(),
        recursive: true,
        use_trash: false,
        confirm_token: token.map(str::to_string),
    }
}

async fn service() -> ResourceService {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.keep();
    let metadata = std::sync::Arc::new(
        crate::persist::metadata::MetadataStore::open(&data_dir)
            .await
            .unwrap(),
    );
    let (registry_tx, _registry_rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(registry_tx);
    let instances = std::sync::Arc::new(crate::control::InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(5),
        crate::control::ChatRegistry::new(registry),
    ));
    let sink = std::sync::Arc::new(crate::control::StoreSink::new());
    ResourceService::new(
        metadata,
        instances,
        crate::control::ResourceProjection::new(sink, std::time::Duration::from_secs(60), 2),
    )
}

#[test]
fn mutation_paths_and_preconditions_are_checked_before_routing() {
    for path in ["", "/tmp/x", "../x", "src/../x", "src\\x", "src//x", "src/"] {
        assert!(
            validate_mutation(&create_payload(path)).is_err(),
            "accepted {path:?}"
        );
    }
    assert!(validate_mutation(&create_payload("src/new-dir")).is_ok());

    let descendant = FsMutationPayload::Move(FsMovePayload {
        project_id: "project".into(),
        source: "src".into(),
        target: "src/child".into(),
        source_if_match: "revision-1".into(),
        target_if_match: None,
        target_if_none_match: Some("*".into()),
    });
    assert_eq!(
        validate_mutation(&descendant).unwrap_err().code,
        ResourceErrorCode::InvalidRequest
    );
}

#[test]
fn instance_errors_are_normalized_without_reflecting_raw_details() {
    let failure = normalize_instance_failure(ResourceFailure {
        code: ResourceErrorCode::PermissionDenied,
        message: "/private/workspace/secret: operation not permitted".into(),
        retryable: true,
        suggested_limit: None,
    });
    assert_eq!(failure.message, "filesystem mutation is not permitted");
    assert!(!failure.message.contains("/private"));
    assert!(!failure.retryable);

    let partial = normalize_instance_failure(ResourceFailure {
        code: ResourceErrorCode::DeliveryUnknown,
        message: "/private/workspace/secret: partially removed".into(),
        retryable: true,
        suggested_limit: None,
    });
    assert_eq!(partial.code, ResourceErrorCode::DeliveryUnknown);
    assert_eq!(
        partial.message,
        "filesystem mutation outcome is unknown; refresh to verify"
    );
    assert!(!partial.retryable);
    assert_eq!(
        resource_action_error("command", partial).code,
        ErrorCode::DeliveryUnknown
    );

    let unknown = mutation_instance_failure(InstanceError::Timeout);
    assert_eq!(unknown.code, ResourceErrorCode::DeliveryUnknown);
    assert!(!unknown.retryable);
}

#[test]
fn mutation_result_deduplicates_affected_paths() {
    let result = normalize_mutation_result(FsMutationResult {
        primary_path: "dst/item".into(),
        affected_paths: vec!["src".into(), "dst".into(), "src".into()],
        stat: Some(FsStat {
            path: "dst/item".into(),
            kind: FileKind::File,
            size: 0,
            mtime_ns: "0".into(),
            permissions: FsPermissions::ReadWrite,
            revision: "revision-2".into(),
        }),
    });
    assert_eq!(result.affected_paths, ["src", "dst"]);
}

#[test]
fn committed_ack_reports_terminal_and_duplicate_states() {
    let result = ActionResourceResult::FsMutation(FsMutationResult {
        primary_path: "src/new-dir".into(),
        affected_paths: vec!["src".into()],
        stat: None,
    });
    assert_eq!(
        committed_ack("command".into(), result.clone(), false).status,
        AckStatus::Committed
    );
    assert_eq!(
        committed_ack("command".into(), result, true).status,
        AckStatus::Duplicate
    );
}

#[tokio::test]
async fn project_gates_are_isolated_and_reclaimed() {
    let service = service().await;
    let first = service.fs_mutation_gate("project-a").await;
    let same = service.fs_mutation_gate("project-a").await;
    let other = service.fs_mutation_gate("project-b").await;
    assert!(std::sync::Arc::ptr_eq(&first, &same));
    assert!(!std::sync::Arc::ptr_eq(&first, &other));
    assert_eq!(service.fs_mutation_project_gates.lock().await.len(), 2);

    drop(first);
    drop(same);
    drop(other);
    let replacement = service.fs_mutation_gate("project-c").await;
    assert_eq!(service.fs_mutation_project_gates.lock().await.len(), 1);
    assert!(replacement.try_lock().is_ok());
}

#[tokio::test]
async fn command_id_replay_returns_original_outcome_and_payload_mismatch_is_rejected() {
    let service = service().await;
    let original = create_payload("src/new-dir");
    let original_outcome = Err(action_error(
        "command",
        ErrorCode::DeliveryUnknown,
        "filesystem mutation delivery is unknown",
        false,
    ));
    let fingerprint = crate::persist::metadata::payload_hash(&original).unwrap();
    service
        .metadata
        .begin_fs_mutation_command(
            "command",
            "principal",
            original.command_type(),
            original.project_id(),
            &fingerprint,
        )
        .await
        .unwrap();
    service
        .metadata
        .transition_fs_mutation_command(
            "command",
            "intent_durable",
            "delivery_unknown",
            Some(
                &serde_json::to_string(&DurableFsMutationOutcome::from_outcome(&original_outcome))
                    .unwrap(),
            ),
        )
        .await
        .unwrap();

    let (duplicate, replayed) = service
        .commit_fs_mutation_action("principal", "command", original)
        .await;
    assert!(duplicate);
    assert_eq!(replayed, original_outcome);

    let (duplicate, mismatch) = service
        .commit_fs_mutation_action("principal", "command", create_payload("src/other"))
        .await;
    assert!(!duplicate);
    assert_eq!(mismatch.unwrap_err().code, ErrorCode::InvalidState);
}

#[tokio::test]
async fn fs_mutation_outcome_survives_metadata_store_restart() {
    let dir = tempfile::tempdir().unwrap();
    let original = create_payload("src/new-dir");
    let fingerprint = crate::persist::metadata::payload_hash(&original).unwrap();
    let expected = Err(action_error(
        "restart-safe",
        ErrorCode::DeliveryUnknown,
        "filesystem mutation delivery is unknown",
        false,
    ));
    {
        let metadata = crate::persist::metadata::MetadataStore::open(dir.path())
            .await
            .unwrap();
        metadata
            .begin_fs_mutation_command(
                "restart-safe",
                "principal",
                original.command_type(),
                original.project_id(),
                &fingerprint,
            )
            .await
            .unwrap();
        metadata
            .transition_fs_mutation_command(
                "restart-safe",
                "intent_durable",
                "delivery_unknown",
                Some(
                    &serde_json::to_string(&DurableFsMutationOutcome::from_outcome(&expected))
                        .unwrap(),
                ),
            )
            .await
            .unwrap();
    }

    let metadata = crate::persist::metadata::MetadataStore::open(dir.path())
        .await
        .unwrap();
    let record = metadata
        .fs_mutation_command("restart-safe")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(record.phase, "delivery_unknown");
    assert_eq!(
        serde_json::from_str::<DurableFsMutationOutcome>(record.outcome_json.as_deref().unwrap())
            .unwrap()
            .into_outcome(),
        expected
    );
}

#[tokio::test]
async fn dispatching_command_reloads_as_unknown_without_redispatch() {
    let first = service().await;
    let payload = create_payload("src/new-dir");
    let fingerprint = crate::persist::metadata::payload_hash(&payload).unwrap();
    first
        .metadata
        .begin_fs_mutation_command(
            "crash-window",
            "principal",
            payload.command_type(),
            payload.project_id(),
            &fingerprint,
        )
        .await
        .unwrap();
    first
        .metadata
        .transition_fs_mutation_command("crash-window", "intent_durable", "dispatching", None)
        .await
        .unwrap();
    let sink = std::sync::Arc::new(crate::control::StoreSink::new());
    let reloaded = ResourceService::new(
        first.metadata.clone(),
        first.instance.clone(),
        crate::control::ResourceProjection::new(sink, std::time::Duration::from_secs(60), 2),
    );

    let (duplicate, outcome) = reloaded
        .commit_fs_mutation_action("principal", "crash-window", payload)
        .await;

    assert!(duplicate);
    assert_eq!(outcome.unwrap_err().code, ErrorCode::DeliveryUnknown);
}

#[tokio::test]
async fn structural_capability_is_required_independently_from_write() {
    use peri_studio_proto::instance::InstanceHello;
    use serde_json::json;

    let (registry_tx, _registry_rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(registry_tx);
    let instances = crate::control::InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(5),
        crate::control::ChatRegistry::new(registry),
    );
    let (instance_tx, _instance_rx) = tokio::sync::mpsc::channel(1);
    instances
        .on_hello(
            "machine",
            "instance-principal",
            crate::control::InstanceConn { tx: instance_tx },
            &InstanceHello {
                protocol_version: peri_studio_proto::version::PROTOCOL_VERSION,
                token: "redacted".into(),
                hostname: "test".into(),
                caps: json!({"resources": {
                    "protocolVersion": peri_studio_proto::resource::RESOURCE_PROTOCOL_VERSION,
                    "write": true
                }}),
                buffered: None,
                buffer_lost: None,
                stream_epochs: None,
                nonce: "nonce".into(),
            },
        )
        .await;
    assert!(!instances.supports_structural_fs_mutations("machine").await);
}

#[tokio::test]
async fn empty_directory_confirm_token_is_usable_bound_and_single_use() {
    let service = service().await;
    let issued = service
        .issue_delete_confirm(
            "principal",
            "project",
            delete_confirm_request("empty", "revision-empty"),
        )
        .await
        .unwrap();
    let ResourceQueryResult::DeleteConfirm(opened) = issued else {
        panic!("expected delete confirmation");
    };
    assert!(opened.expires_at.parse::<DateTime<Utc>>().unwrap() > Utc::now());

    let mut mismatched = FsDeletePayload {
        project_id: "project".into(),
        path: "empty".into(),
        if_match: "revision-other".into(),
        recursive: true,
        use_trash: false,
        confirm_token: Some(opened.confirm_token.clone()),
    };
    assert!(service
        .consume_delete_confirm("principal", &mismatched)
        .await
        .is_err());
    mismatched.if_match = "revision-empty".into();
    assert!(service
        .consume_delete_confirm("principal", &mismatched)
        .await
        .is_err());

    let ResourceQueryResult::DeleteConfirm(opened) = service
        .issue_delete_confirm(
            "principal",
            "project",
            delete_confirm_request("empty", "revision-empty"),
        )
        .await
        .unwrap()
    else {
        panic!("expected delete confirmation");
    };
    let payload = FsDeletePayload {
        confirm_token: Some(opened.confirm_token),
        ..mismatched
    };
    assert!(service
        .consume_delete_confirm("principal", &payload)
        .await
        .is_ok());
    assert!(service
        .consume_delete_confirm("principal", &payload)
        .await
        .is_err());
}

#[tokio::test]
async fn delete_confirm_token_is_bound_and_single_use() {
    let service = service().await;
    service.delete_confirm_tokens.lock().await.insert(
        "token".into(),
        DeleteConfirmRecord {
            principal: "principal".into(),
            project_id: "project".into(),
            path: "src".into(),
            if_match: "revision-1".into(),
            recursive: true,
            use_trash: false,
            expires_at: Utc::now() + Duration::seconds(30),
        },
    );
    assert!(service
        .consume_delete_confirm("other-principal", &delete_payload(Some("token")))
        .await
        .is_err());
    assert!(service
        .consume_delete_confirm("principal", &delete_payload(Some("token")))
        .await
        .is_err());

    service.delete_confirm_tokens.lock().await.insert(
        "token-2".into(),
        DeleteConfirmRecord {
            principal: "principal".into(),
            project_id: "project".into(),
            path: "src".into(),
            if_match: "revision-1".into(),
            recursive: true,
            use_trash: false,
            expires_at: Utc::now() + Duration::seconds(30),
        },
    );
    let payload = delete_payload(Some("token-2"));
    assert!(service
        .consume_delete_confirm("principal", &payload)
        .await
        .is_ok());
    assert!(service
        .consume_delete_confirm("principal", &payload)
        .await
        .is_err());
}

#[tokio::test]
async fn expired_delete_confirm_token_is_rejected() {
    let service = service().await;
    service.delete_confirm_tokens.lock().await.insert(
        "expired".into(),
        DeleteConfirmRecord {
            principal: "principal".into(),
            project_id: "project".into(),
            path: "src".into(),
            if_match: "revision-1".into(),
            recursive: true,
            use_trash: false,
            expires_at: Utc::now() - Duration::seconds(1),
        },
    );
    assert!(service
        .consume_delete_confirm("principal", &delete_payload(Some("expired")))
        .await
        .is_err());
}
