//! Structural FS mutation 编排：可信 project 路由、幂等结果与删除确认 token。

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::action::{FsCreateDirPayload, FsDeletePayload, FsMovePayload};
use peri_studio_proto::resource::{
    ActionResourceResult, CreateDirQuery, DeleteConfirmSummary, DeletePathQuery, FileKind,
    InstanceResourcePayload, InstanceResourceQuery, InstanceResourceQueryKind, MovePathQuery,
    OpenResourceDeleteConfirm, ReadDirectoryQuery, ResourceDeleteConfirmOpened, ResourceErrorCode,
    ResourceFailure, ResourceQueryResult, DEFAULT_DELETE_CONFIRM_TTL_SECS,
};

use super::resource_fs_mutation_outcome::DurableFsMutationOutcome;
pub(crate) use super::resource_fs_mutation_validation::committed_ack;
use super::resource_fs_mutation_validation::{
    action_error, failure, mutation_instance_failure, normalize_instance_failure,
    normalize_mutation_result, resource_action_error, validate_mutation, validate_path,
};
use super::ResourceService;
use crate::persist::metadata::{payload_hash, BeginCommand, MetadataError};

const MAX_DELETE_CONFIRM_TOKENS: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "kebab-case")]
pub(crate) enum FsMutationPayload {
    CreateDir(FsCreateDirPayload),
    Move(FsMovePayload),
    Delete(FsDeletePayload),
}

impl FsMutationPayload {
    fn command_type(&self) -> &'static str {
        match self {
            Self::CreateDir(_) => "fs/create-dir",
            Self::Move(_) => "fs/move",
            Self::Delete(_) => "fs/delete",
        }
    }

    fn project_id(&self) -> &str {
        match self {
            Self::CreateDir(payload) => &payload.project_id,
            Self::Move(payload) => &payload.project_id,
            Self::Delete(payload) => &payload.project_id,
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct DeleteConfirmRecord {
    principal: String,
    project_id: String,
    path: String,
    if_match: String,
    recursive: bool,
    use_trash: bool,
    expires_at: DateTime<Utc>,
}

impl ResourceService {
    async fn fs_mutation_gate(&self, project_id: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
        let mut gates = self.fs_mutation_project_gates.lock().await;
        gates.retain(|_, gate| gate.strong_count() > 0);
        match gates.get(project_id).and_then(std::sync::Weak::upgrade) {
            Some(gate) => gate,
            None => {
                let gate = std::sync::Arc::new(tokio::sync::Mutex::new(()));
                gates.insert(project_id.to_string(), std::sync::Arc::downgrade(&gate));
                gate
            }
        }
    }

    pub(crate) async fn commit_fs_mutation_action(
        &self,
        principal: &str,
        command_id: &str,
        payload: FsMutationPayload,
    ) -> (bool, Result<ActionResourceResult, ActionError>) {
        if let Err(failure) = validate_mutation(&payload) {
            return (false, Err(resource_action_error(command_id, failure)));
        }
        let fingerprint = match payload_hash(&payload) {
            Ok(fingerprint) => fingerprint,
            Err(_) => {
                return (
                    false,
                    Err(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "filesystem mutation could not be recorded",
                        false,
                    )),
                );
            }
        };
        let project_id = payload.project_id().to_string();
        let gate = self.fs_mutation_gate(&project_id).await;
        let _project_gate = gate.lock().await;
        let begun = self
            .metadata
            .begin_fs_mutation_command(
                command_id,
                principal,
                payload.command_type(),
                &project_id,
                &fingerprint,
            )
            .await;
        match begun {
            Err(MetadataError::Conflict(_)) => {
                return (
                    false,
                    Err(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "commandId was reused with a different filesystem mutation",
                        false,
                    )),
                );
            }
            Err(_) => {
                return (
                    false,
                    Err(action_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        "filesystem mutation could not be recorded",
                        true,
                    )),
                );
            }
            Ok(BeginCommand::Existing) => {
                return (true, self.durable_fs_mutation_outcome(command_id).await);
            }
            Ok(BeginCommand::New) => {}
        }
        if self
            .metadata
            .transition_fs_mutation_command(command_id, "intent_durable", "dispatching", None)
            .await
            .is_err()
        {
            return (
                false,
                Err(action_error(
                    command_id,
                    ErrorCode::AgentUnavailable,
                    "filesystem mutation could not be dispatched",
                    true,
                )),
            );
        }

        let outcome = self
            .execute_fs_mutation(principal, command_id, &payload)
            .await;
        let durable = DurableFsMutationOutcome::from_outcome(&outcome);
        let outcome_json = serde_json::to_string(&durable).ok();
        let phase = match &outcome {
            Ok(_) => "committed",
            Err(error) if error.code == ErrorCode::DeliveryUnknown => "delivery_unknown",
            Err(_) => "failed",
        };
        if self
            .metadata
            .transition_fs_mutation_command(
                command_id,
                "dispatching",
                phase,
                outcome_json.as_deref(),
            )
            .await
            .is_err()
        {
            return (
                false,
                Err(action_error(
                    command_id,
                    ErrorCode::DeliveryUnknown,
                    "filesystem mutation outcome is unknown; refresh before continuing",
                    false,
                )),
            );
        }
        (false, outcome)
    }

    async fn durable_fs_mutation_outcome(
        &self,
        command_id: &str,
    ) -> Result<ActionResourceResult, ActionError> {
        let record = self
            .metadata
            .fs_mutation_command(command_id)
            .await
            .map_err(|_| {
                action_error(
                    command_id,
                    ErrorCode::AgentUnavailable,
                    "filesystem mutation outcome is unavailable",
                    true,
                )
            })?
            .ok_or_else(|| {
                action_error(
                    command_id,
                    ErrorCode::InvalidState,
                    "filesystem mutation record is missing",
                    false,
                )
            })?;
        if let Some(outcome) = record.outcome_json {
            return serde_json::from_str::<DurableFsMutationOutcome>(&outcome)
                .map_err(|_| {
                    action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "filesystem mutation outcome is invalid",
                        false,
                    )
                })?
                .into_outcome();
        }
        Err(action_error(
            command_id,
            ErrorCode::DeliveryUnknown,
            "filesystem mutation outcome is unknown; refresh before continuing",
            false,
        ))
    }

    async fn execute_fs_mutation(
        &self,
        principal: &str,
        command_id: &str,
        payload: &FsMutationPayload,
    ) -> Result<ActionResourceResult, ActionError> {
        validate_mutation(payload).map_err(|failure| resource_action_error(command_id, failure))?;
        let (project_id, query_kind) = match payload {
            FsMutationPayload::CreateDir(payload) => (
                payload.project_id.as_str(),
                InstanceResourceQueryKind::CreateDir(CreateDirQuery {
                    path: payload.path.clone(),
                    if_none_match: payload.if_none_match.clone(),
                }),
            ),
            FsMutationPayload::Move(payload) => (
                payload.project_id.as_str(),
                InstanceResourceQueryKind::MovePath(MovePathQuery {
                    source: payload.source.clone(),
                    target: payload.target.clone(),
                    source_if_match: payload.source_if_match.clone(),
                    target_if_match: payload.target_if_match.clone(),
                    target_if_none_match: payload.target_if_none_match.clone(),
                }),
            ),
            FsMutationPayload::Delete(payload) => (
                payload.project_id.as_str(),
                InstanceResourceQueryKind::DeletePath(DeletePathQuery {
                    path: payload.path.clone(),
                    if_match: payload.if_match.clone(),
                    recursive: payload.recursive,
                    use_trash: payload.use_trash,
                }),
            ),
        };
        let project = self
            .active_project(project_id)
            .await
            .map_err(|failure| resource_action_error(command_id, failure))?;
        if !self
            .instance
            .supports_structural_fs_mutations(&project.instance_id)
            .await
        {
            return Err(action_error(
                command_id,
                ErrorCode::InvalidState,
                "project instance does not support filesystem mutations",
                false,
            ));
        }
        if let FsMutationPayload::Delete(payload) = payload {
            if payload.recursive {
                self.consume_delete_confirm(principal, payload)
                    .await
                    .map_err(|failure| resource_action_error(command_id, failure))?;
            }
        }
        let query = InstanceResourceQuery {
            request_id: uuid::Uuid::new_v4().to_string(),
            workspace_id: project.id,
            root: project.cwd,
            query: query_kind,
        };
        let result = self
            .instance
            .query_resource(&project.instance_id, query)
            .await
            .map_err(|error| resource_action_error(command_id, mutation_instance_failure(error)))?;
        if let Some(error) = result.error {
            let error = normalize_instance_failure(error);
            if matches!(payload, FsMutationPayload::Delete(delete) if delete.recursive)
                && !matches!(
                    error.code,
                    ResourceErrorCode::VersionConflict
                        | ResourceErrorCode::InvalidPath
                        | ResourceErrorCode::OutsideWorkspace
                        | ResourceErrorCode::NotFound
                )
            {
                return Err(action_error(
                    command_id,
                    ErrorCode::DeliveryUnknown,
                    "recursive delete may be partially complete; refresh to verify",
                    false,
                ));
            }
            return Err(resource_action_error(command_id, error));
        }
        match result.result {
            Some(InstanceResourcePayload::FsMutation(result)) => Ok(
                ActionResourceResult::FsMutation(normalize_mutation_result(result)),
            ),
            _ => Err(action_error(
                command_id,
                ErrorCode::AgentUnavailable,
                "filesystem mutation returned an invalid result",
                true,
            )),
        }
    }

    pub(crate) async fn open_delete_confirm(
        &self,
        principal: &str,
        can_mutate: bool,
        project_id: &str,
        request: OpenResourceDeleteConfirm,
    ) -> Result<ResourceQueryResult, ResourceFailure> {
        if !can_mutate {
            return Err(failure(
                ResourceErrorCode::Forbidden,
                "read-only principals cannot delete files",
                false,
            ));
        }
        validate_path(&request.path)?;
        if request.if_match.is_empty() || !request.recursive || request.use_trash {
            return Err(failure(
                ResourceErrorCode::InvalidRequest,
                "delete confirmation request is invalid",
                false,
            ));
        }
        let project = self.active_project(project_id).await?;
        if !self
            .instance
            .supports_structural_fs_mutations(&project.instance_id)
            .await
        {
            return Err(failure(
                ResourceErrorCode::ResourceUnsupported,
                "project instance does not support filesystem mutations",
                false,
            ));
        }
        let query = InstanceResourceQuery {
            request_id: uuid::Uuid::new_v4().to_string(),
            workspace_id: project.id.clone(),
            root: project.cwd,
            query: InstanceResourceQueryKind::ReadDirectory(ReadDirectoryQuery {
                path: request.path.clone(),
                cursor: None,
                limit: 1,
            }),
        };
        let result = self
            .instance
            .query_resource(&project.instance_id, query)
            .await
            .map_err(mutation_instance_failure)?;
        if let Some(error) = result.error {
            return Err(normalize_instance_failure(error));
        }
        let Some(InstanceResourcePayload::DirectoryPage(_page)) = result.result else {
            return Err(failure(
                ResourceErrorCode::Unavailable,
                "delete confirmation could not inspect the directory",
                true,
            ));
        };

        self.issue_delete_confirm(principal, project_id, request)
            .await
    }

    async fn issue_delete_confirm(
        &self,
        principal: &str,
        project_id: &str,
        request: OpenResourceDeleteConfirm,
    ) -> Result<ResourceQueryResult, ResourceFailure> {
        let now = Utc::now();
        let expires_at = now + Duration::seconds(DEFAULT_DELETE_CONFIRM_TTL_SECS as i64);
        let mut tokens = self.delete_confirm_tokens.lock().await;
        tokens.retain(|_, record| record.expires_at > now);
        if tokens.len() >= MAX_DELETE_CONFIRM_TOKENS {
            return Err(failure(
                ResourceErrorCode::RateLimited,
                "delete confirmation capacity reached",
                true,
            ));
        }
        let confirm_token = uuid::Uuid::new_v4().to_string();
        tokens.insert(
            confirm_token.clone(),
            DeleteConfirmRecord {
                principal: principal.to_string(),
                project_id: project_id.to_string(),
                path: request.path.clone(),
                if_match: request.if_match,
                recursive: request.recursive,
                use_trash: request.use_trash,
                expires_at,
            },
        );
        Ok(ResourceQueryResult::DeleteConfirm(
            ResourceDeleteConfirmOpened {
                confirm_token,
                expires_at: expires_at.to_rfc3339(),
                summary: DeleteConfirmSummary {
                    path: request.path,
                    kind: FileKind::Directory,
                    entry_count: None,
                },
            },
        ))
    }

    async fn consume_delete_confirm(
        &self,
        principal: &str,
        payload: &FsDeletePayload,
    ) -> Result<(), ResourceFailure> {
        let token = payload.confirm_token.as_deref().ok_or_else(|| {
            failure(
                ResourceErrorCode::Forbidden,
                "recursive delete requires confirmation",
                false,
            )
        })?;
        let now = Utc::now();
        let mut tokens = self.delete_confirm_tokens.lock().await;
        tokens.retain(|_, record| record.expires_at > now);
        let Some(record) = tokens.remove(token) else {
            return Err(failure(
                ResourceErrorCode::Forbidden,
                "delete confirmation is invalid or expired",
                false,
            ));
        };
        if record.principal != principal
            || record.project_id != payload.project_id
            || record.path != payload.path
            || record.if_match != payload.if_match
            || record.recursive != payload.recursive
            || record.use_trash != payload.use_trash
        {
            return Err(failure(
                ResourceErrorCode::Forbidden,
                "delete confirmation does not match the request",
                false,
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "resource_fs_mutation_service_test.rs"]
mod tests;
