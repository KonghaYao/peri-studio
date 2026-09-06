//! 上传开票与 `fs/write-file` commit 编排。

use base64::Engine as _;

use peri_studio_proto::ack::{AckStatus, ActionAck, ActionError, ErrorCode};
use peri_studio_proto::action::FsWriteFilePayload;
use peri_studio_proto::resource::{
    ActionResourceResult, InstanceResourcePayload, InstanceResourceQuery,
    InstanceResourceQueryKind, OpenResourceUpload, ResourceErrorCode, ResourceFailure,
    ResourceQueryResult, WriteFileQuery, MAX_RESOURCE_BLOB_BYTES,
};

use super::resource_upload_store::{store_failure, UploadStore, UploadStoreError};
use super::{InstanceError, ResourceService};

const MAX_UPLOAD_COMMAND_OUTCOMES: usize = 1024;

#[derive(Debug, Clone)]
pub(super) struct UploadCommandRecord {
    pub(super) principal: String,
    pub(super) payload: FsWriteFilePayload,
    pub(super) outcome: Result<ActionResourceResult, ActionError>,
}

impl ResourceService {
    pub(crate) async fn commit_upload_action(
        &self,
        principal: &str,
        command_id: &str,
        payload: &FsWriteFilePayload,
    ) -> (bool, Result<ActionResourceResult, ActionError>) {
        let _gate = self.upload_command_gate.lock().await;
        if let Some(record) = self.upload_commands.lock().await.get(command_id).cloned() {
            if record.principal == principal && record.payload == *payload {
                return (true, record.outcome);
            }
            return (
                false,
                Err(ActionError {
                    command_id: command_id.to_string(),
                    code: ErrorCode::InvalidState,
                    message: "commandId was reused with a different upload".to_string(),
                    retryable: false,
                    retry_after_ms: None,
                }),
            );
        }
        if self.upload_commands.lock().await.len() >= MAX_UPLOAD_COMMAND_OUTCOMES {
            return (
                false,
                Err(ActionError {
                    command_id: command_id.to_string(),
                    code: ErrorCode::RateLimited,
                    message: "upload command capacity reached".to_string(),
                    retryable: true,
                    retry_after_ms: None,
                }),
            );
        }
        let mut outcome = self.commit_upload(principal, payload).await;
        if let Err(error) = &mut outcome {
            error.command_id = command_id.to_string();
        }
        self.upload_commands.lock().await.insert(
            command_id.to_string(),
            UploadCommandRecord {
                principal: principal.to_string(),
                payload: payload.clone(),
                outcome: outcome.clone(),
            },
        );
        (false, outcome)
    }

    pub(crate) async fn open_upload(
        &self,
        principal: &str,
        owner_conn: u64,
        can_mutate: bool,
        project_id: &str,
        request: OpenResourceUpload,
    ) -> Result<ResourceQueryResult, ResourceFailure> {
        if !can_mutate {
            return Err(resource_failure(
                ResourceErrorCode::Forbidden,
                "read-only principals cannot upload files",
                false,
            ));
        }
        validate_upload_path(&request.path)?;
        if request
            .expected_bytes
            .is_some_and(|size| size > MAX_RESOURCE_BLOB_BYTES)
        {
            return Err(resource_failure(
                ResourceErrorCode::UploadTooLarge,
                "upload exceeds the 8 MiB limit",
                false,
            ));
        }
        let sha256 = normalize_sha256(request.sha256.as_deref())?;
        self.active_project(project_id).await?;
        let opened = self
            .uploads
            .open(
                principal,
                owner_conn,
                project_id,
                &request.path,
                request.expected_bytes,
                sha256,
            )
            .await
            .map_err(store_failure)?;
        Ok(ResourceQueryResult::Upload(opened))
    }

    pub(crate) async fn commit_upload(
        &self,
        principal: &str,
        payload: &FsWriteFilePayload,
    ) -> Result<ActionResourceResult, ActionError> {
        let command_id = String::new();
        if let Err(error) = validate_commit_payload(payload) {
            return Err(action_failure(command_id, error));
        }
        let staged = self
            .uploads
            .begin_commit(
                principal,
                &payload.project_id,
                &payload.path,
                &payload.upload_id,
            )
            .await
            .map_err(|error| action_failure(command_id.clone(), store_failure(error)))?;
        let outcome = self.commit_staged(payload, staged).await;
        let consume = outcome.is_ok()
            || matches!(
                &outcome,
                Err(failure) if failure.code == ResourceErrorCode::DeliveryUnknown
            );
        self.uploads
            .finish_commit(&payload.upload_id, consume)
            .await;
        outcome.map_err(|failure| action_failure(command_id, failure))
    }

    async fn commit_staged(
        &self,
        payload: &FsWriteFilePayload,
        staged: super::resource_upload_store::UploadCommit,
    ) -> Result<ActionResourceResult, ResourceFailure> {
        let project = self.active_project(&staged.project_id).await?;
        let query = InstanceResourceQuery {
            request_id: uuid::Uuid::new_v4().to_string(),
            workspace_id: project.id,
            root: project.cwd,
            query: InstanceResourceQueryKind::WriteFile(WriteFileQuery {
                path: staged.path,
                content_base64: base64::engine::general_purpose::STANDARD
                    .encode(staged.bytes.as_slice()),
                if_match: payload.if_match.clone(),
                if_none_match: payload.if_none_match.clone(),
            }),
        };
        let result = self
            .instance
            .query_resource(&project.instance_id, query)
            .await
            .map_err(write_instance_failure)?;
        if let Some(error) = result.error {
            return Err(error);
        }
        match result.result {
            Some(InstanceResourcePayload::FsStat(stat)) => Ok(ActionResourceResult::FsStat(stat)),
            _ => Err(resource_failure(
                ResourceErrorCode::Unavailable,
                "file write returned an invalid result",
                true,
            )),
        }
    }

    pub(crate) async fn begin_upload_put(
        &self,
        principal: &str,
        upload_id: &str,
        content_length: usize,
    ) -> Result<(), UploadStoreError> {
        self.uploads
            .begin_put(principal, upload_id, content_length)
            .await
    }

    pub(crate) async fn complete_upload_put(
        &self,
        principal: &str,
        upload_id: &str,
        bytes: Vec<u8>,
    ) -> Result<(), UploadStoreError> {
        self.uploads.complete_put(principal, upload_id, bytes).await
    }

    pub(crate) async fn abort_upload_put(&self, principal: &str, upload_id: &str) {
        self.uploads.abort_put(principal, upload_id).await;
    }

    pub(crate) async fn cleanup_uploads_for_connection(&self, owner_conn: u64) {
        self.uploads.cleanup_connection(owner_conn).await;
    }
}

pub(crate) fn upload_store() -> UploadStore {
    UploadStore::new()
}

fn validate_commit_payload(payload: &FsWriteFilePayload) -> Result<(), ResourceFailure> {
    validate_upload_path(&payload.path)?;
    if payload.project_id.is_empty() || payload.upload_id.is_empty() {
        return Err(resource_failure(
            ResourceErrorCode::InvalidRequest,
            "upload commit is invalid",
            false,
        ));
    }
    if payload.if_match.is_some() || payload.if_none_match.as_deref() != Some("*") {
        return Err(resource_failure(
            ResourceErrorCode::InvalidRequest,
            "file upload is create-only",
            false,
        ));
    }
    Ok(())
}

fn validate_upload_path(path: &str) -> Result<(), ResourceFailure> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(resource_failure(
            ResourceErrorCode::InvalidPath,
            "upload path is invalid",
            false,
        ));
    }
    Ok(())
}

fn normalize_sha256(value: Option<&str>) -> Result<Option<String>, ResourceFailure> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(resource_failure(
            ResourceErrorCode::InvalidRequest,
            "upload checksum is invalid",
            false,
        ));
    }
    Ok(Some(value.to_ascii_lowercase()))
}

fn write_instance_failure(error: InstanceError) -> ResourceFailure {
    match error {
        InstanceError::UnknownInstance(_) | InstanceError::Offline => resource_failure(
            ResourceErrorCode::InstanceOffline,
            "project instance is offline",
            true,
        ),
        InstanceError::ResourceUnsupported => resource_failure(
            ResourceErrorCode::ResourceUnsupported,
            "project instance does not support file writes",
            false,
        ),
        InstanceError::Timeout | InstanceError::ConnectionGone => resource_failure(
            ResourceErrorCode::DeliveryUnknown,
            "file write delivery is unknown",
            false,
        ),
        _ => resource_failure(ResourceErrorCode::Unavailable, "file write failed", true),
    }
}

fn resource_failure(code: ResourceErrorCode, message: &str, retryable: bool) -> ResourceFailure {
    ResourceFailure {
        code,
        message: message.to_string(),
        retryable,
        suggested_limit: None,
    }
}

fn action_failure(command_id: String, failure: ResourceFailure) -> ActionError {
    let code = match failure.code {
        ResourceErrorCode::Forbidden => ErrorCode::Forbidden,
        ResourceErrorCode::InstanceOffline => ErrorCode::InstanceOffline,
        ResourceErrorCode::VersionConflict => ErrorCode::VersionConflict,
        ResourceErrorCode::RateLimited => ErrorCode::RateLimited,
        ResourceErrorCode::UploadTooLarge => ErrorCode::PayloadTooLarge,
        ResourceErrorCode::DeliveryUnknown => ErrorCode::DeliveryUnknown,
        ResourceErrorCode::ResourceUnsupported => ErrorCode::UnsupportedFrame,
        _ => ErrorCode::InvalidState,
    };
    ActionError {
        command_id,
        code,
        message: failure.message,
        retryable: failure.retryable,
        retry_after_ms: None,
    }
}

pub(crate) fn committed_ack(
    command_id: String,
    result: ActionResourceResult,
    duplicate: bool,
) -> ActionAck {
    ActionAck {
        command_id,
        status: if duplicate {
            AckStatus::Duplicate
        } else {
            AckStatus::Committed
        },
        turn_id: None,
        chat_id: None,
        project_id: None,
        instance_id: None,
        session_id: None,
        acp_session_id: None,
        committed_projection_version: None,
        resource_result: Some(result),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_path_and_create_only_contract_are_closed() {
        for invalid in ["", "/a", "../a", "a/../b", "a\\b", "a//b", "a\0b"] {
            assert_eq!(
                validate_upload_path(invalid).unwrap_err().code,
                ResourceErrorCode::InvalidPath
            );
        }
        assert!(validate_upload_path("src/a.txt").is_ok());

        let valid = FsWriteFilePayload {
            project_id: "project".into(),
            path: "src/a.txt".into(),
            upload_id: "upload".into(),
            if_match: None,
            if_none_match: Some("*".into()),
        };
        assert!(validate_commit_payload(&valid).is_ok());
        let mut overwrite = valid.clone();
        overwrite.if_match = Some("revision".into());
        assert!(validate_commit_payload(&overwrite).is_err());
    }

    #[test]
    fn checksum_shape_is_validated_without_reflection() {
        assert_eq!(normalize_sha256(None).unwrap(), None);
        assert!(normalize_sha256(Some(&"a".repeat(64))).is_ok());
        assert_eq!(
            normalize_sha256(Some("secret")).unwrap_err().message,
            "upload checksum is invalid"
        );
    }
}

#[tokio::test]
async fn commit_routes_to_project_instance_and_returns_fs_stat() {
    use peri_studio_proto::frame::Frame;
    use peri_studio_proto::instance::InstanceHello;
    use peri_studio_proto::resource::{
        FileKind, FsPermissions, FsStat, InstanceResourcePayload, InstanceResourceResult,
    };
    use serde_json::json;

    let dir = tempfile::tempdir().unwrap();
    let metadata = std::sync::Arc::new(
        crate::persist::metadata::MetadataStore::open(dir.path())
            .await
            .unwrap(),
    );
    metadata
        .create_project(
            "project",
            "Project",
            dir.path().to_str().unwrap(),
            "machine",
        )
        .await
        .unwrap();
    let (registry_tx, _registry_rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(registry_tx);
    let instances = std::sync::Arc::new(crate::control::InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(5),
        crate::control::ChatRegistry::new(registry),
    ));
    let (instance_tx, mut instance_rx) = tokio::sync::mpsc::channel(4);
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
    let sink = std::sync::Arc::new(crate::control::StoreSink::new());
    let service = crate::control::ResourceService::new(
        metadata,
        instances.clone(),
        crate::control::ResourceProjection::new(sink, std::time::Duration::from_secs(60), 2),
    );
    let opened = service
        .uploads
        .open("principal", 1, "project", "file.txt", Some(3), None)
        .await
        .unwrap();
    service
        .uploads
        .begin_put("principal", &opened.upload_id, 3)
        .await
        .unwrap();
    service
        .uploads
        .complete_put("principal", &opened.upload_id, b"abc".to_vec())
        .await
        .unwrap();
    let payload = FsWriteFilePayload {
        project_id: "project".into(),
        path: "file.txt".into(),
        upload_id: opened.upload_id,
        if_match: None,
        if_none_match: Some("*".into()),
    };
    let pending = tokio::spawn({
        let service = service.clone();
        let payload = payload.clone();
        async move {
            service
                .commit_upload_action("principal", "command", &payload)
                .await
        }
    });
    let Some(crate::channel::OutboundMsg::Frame(Frame::InstanceResourceQuery(query))) =
        instance_rx.recv().await
    else {
        panic!("expected instance write query");
    };
    assert_eq!(query.root, dir.path().to_str().unwrap());
    let InstanceResourceQueryKind::WriteFile(write) = &query.query else {
        panic!("expected write-file query");
    };
    assert_eq!(write.path, "file.txt");
    assert_eq!(write.if_none_match.as_deref(), Some("*"));
    assert!(
        instances
            .on_ack(
                "machine",
                &query.request_id,
                crate::control::InstanceAck::Resource(InstanceResourceResult {
                    request_id: query.request_id.clone(),
                    result: Some(InstanceResourcePayload::FsStat(FsStat {
                        path: "file.txt".into(),
                        kind: FileKind::File,
                        size: 3,
                        mtime_ns: "1".into(),
                        permissions: FsPermissions::ReadWrite,
                        revision: "revision".into(),
                    })),
                    error: None,
                }),
            )
            .await
    );
    let (duplicate, result) = pending.await.unwrap();
    assert!(!duplicate);
    assert!(matches!(result, Ok(ActionResourceResult::FsStat(_))));
    let (duplicate, replay) = service
        .commit_upload_action("principal", "command", &payload)
        .await;
    assert!(duplicate);
    assert_eq!(replay, result);
}
