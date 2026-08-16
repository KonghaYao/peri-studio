//! Legacy `workspace/*` compatibility over the durable project catalog.
//!
//! Modern clients use `project/*`. This deep module keeps the older workspace
//! wire contract coherent with SQLite project authority and the legacy
//! Registry projection without exposing those dual-write details to command
//! admission or runtime execution.

use std::path::Path;
use std::sync::Arc;

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;
use tokio::sync::RwLock;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::auth::audit::audit;
use crate::auth::ConnectionCtx;
use crate::channel::DEFAULT_INSTANCE_ID;
use crate::control::{ProjectService, ProjectServiceError, WorkspaceRegistry};
use crate::persist::metadata::MetadataError;
use crate::protocol::validate_cwd;

#[derive(Debug)]
pub(super) enum WorkspaceCommandOutcome {
    /// The compatibility mutation and both projections reached their current
    /// commit point; the caller may publish committed.
    Committed,
    /// Execution began, so the caller preserves Accepted followed by this
    /// terminal error.
    Failed(ActionError),
    /// Preflight could not begin. The caller returns a synchronous failure and
    /// must not publish Accepted.
    Rejected(ActionError),
}

#[derive(Clone)]
pub(super) struct WorkspaceCompatibility {
    projects: Arc<RwLock<Option<ProjectService>>>,
    workspaces: WorkspaceRegistry,
}

impl WorkspaceCompatibility {
    pub fn new(
        projects: Arc<RwLock<Option<ProjectService>>>,
        workspaces: WorkspaceRegistry,
    ) -> Self {
        Self {
            projects,
            workspaces,
        }
    }

    /// Rebuilds the process-local compatibility index from the Registry
    /// projection. Startup and mutation paths deliberately share this owner.
    pub async fn rebuild(&self) {
        self.workspaces.rebuild().await;
    }

    pub async fn execute(
        &self,
        ctx: &ConnectionCtx,
        action: &ActionEnvelope,
    ) -> WorkspaceCommandOutcome {
        let command_id = workspace_command_id(action);
        let Some(projects) = self.projects.read().await.clone() else {
            return WorkspaceCommandOutcome::Rejected(action_error(
                command_id,
                ErrorCode::AgentUnavailable,
                "metadata catalog unavailable",
                true,
            ));
        };

        match action {
            ActionEnvelope::WorkspaceCreate { payload, .. } => {
                if let Err(error) = validate_cwd(&payload.cwd) {
                    return WorkspaceCommandOutcome::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        &format!("invalid cwd: {error}"),
                        false,
                    ));
                }
                if !Path::new(&payload.cwd).is_dir() {
                    return WorkspaceCommandOutcome::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        &format!("cwd not found: {}", payload.cwd),
                        false,
                    ));
                }

                let id = Uuid::new_v4().to_string();
                let name = workspace_name(&payload.name, &payload.cwd, &id);
                match projects
                    .create_project(&id, &name, &payload.cwd, DEFAULT_INSTANCE_ID)
                    .await
                {
                    Ok(record) if projects.mirror_legacy_workspace(&record).await.is_ok() => {
                        self.rebuild().await;
                        audit(
                            "workspace.create",
                            Some(command_id),
                            Some(&ctx.token_id),
                            "ok",
                            std::time::Duration::ZERO,
                            None,
                        );
                        debug!(workspace_id = %record.id, cwd = %record.cwd, "workspace created");
                        WorkspaceCommandOutcome::Committed
                    }
                    Err(error) => {
                        warn!(error = ?error, "workspace create metadata write failed");
                        WorkspaceCommandOutcome::Failed(action_error(
                            command_id,
                            ErrorCode::AgentUnavailable,
                            "workspace metadata write failed",
                            true,
                        ))
                    }
                    Ok(_) => WorkspaceCommandOutcome::Failed(action_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        "workspace projection failed",
                        true,
                    )),
                }
            }
            ActionEnvelope::WorkspaceRemove { payload, .. } => {
                match projects.archive_project(&payload.workspace_id).await {
                    Ok(()) => {
                        if projects
                            .metadata()
                            .project(&payload.workspace_id)
                            .await
                            .is_ok()
                        {
                            let _ = self
                                .workspaces
                                .registry()
                                .remove_workspace(&payload.workspace_id)
                                .await;
                            self.rebuild().await;
                        }
                        audit(
                            "workspace.remove",
                            Some(command_id),
                            Some(&ctx.token_id),
                            "ok",
                            std::time::Duration::ZERO,
                            None,
                        );
                        debug!(workspace_id = %payload.workspace_id, "workspace removed");
                        WorkspaceCommandOutcome::Committed
                    }
                    Err(ProjectServiceError::Metadata(MetadataError::NotFound(id))) => {
                        WorkspaceCommandOutcome::Failed(action_error(
                            command_id,
                            ErrorCode::InvalidState,
                            &format!("workspace not found: {id}"),
                            false,
                        ))
                    }
                    Err(error) => {
                        warn!(error = ?error, "workspace remove registry write failed");
                        WorkspaceCommandOutcome::Failed(action_error(
                            command_id,
                            ErrorCode::DeliveryUnknown,
                            "workspace registry write failed",
                            true,
                        ))
                    }
                }
            }
            _ => unreachable!("dispatch guarantees workspace command"),
        }
    }
}

fn workspace_command_id(action: &ActionEnvelope) -> &str {
    match action {
        ActionEnvelope::WorkspaceCreate { command_id, .. }
        | ActionEnvelope::WorkspaceRemove { command_id, .. } => command_id,
        _ => unreachable!("dispatch guarantees workspace command"),
    }
}

fn workspace_name(name: &str, cwd: &str, id: &str) -> String {
    if !name.trim().is_empty() {
        return name.trim().to_string();
    }
    Path::new(cwd)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| id.chars().take(8).collect())
}

fn action_error(command_id: &str, code: ErrorCode, message: &str, retryable: bool) -> ActionError {
    ActionError {
        command_id: command_id.to_string(),
        code,
        message: message.to_string(),
        retryable,
        retry_after_ms: None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use peri_studio_proto::action::{ActionEnvelope, WorkspaceCreatePayload};

    use super::{workspace_name, WorkspaceCommandOutcome, WorkspaceCompatibility};
    use crate::auth::{ConnectionCtx, TokenRole};
    use crate::control::{StoreSink, WorkspaceRegistry};
    use crate::state::doc_manager::{BatchConfig, DocManager};

    #[test]
    fn fallback_name_prefers_trimmed_label_then_directory_then_id() {
        assert_eq!(workspace_name("  Demo  ", "/tmp/repo", "123456789"), "Demo");
        assert_eq!(workspace_name("", "/tmp/repo", "123456789"), "repo");
        assert_eq!(workspace_name("", "/", "123456789"), "12345678");
    }

    #[tokio::test]
    async fn unavailable_catalog_rejects_before_execution() {
        let directory = tempfile::tempdir().unwrap();
        let sink = Arc::new(StoreSink::new());
        let doc = DocManager::new(BatchConfig::default(), sink);
        let compatibility = WorkspaceCompatibility::new(
            Arc::new(tokio::sync::RwLock::new(None)),
            WorkspaceRegistry::new(doc.registry()),
        );
        let command_id = uuid::Uuid::new_v4().to_string();
        let action = ActionEnvelope::WorkspaceCreate {
            command_id: command_id.clone(),
            payload: WorkspaceCreatePayload {
                name: "demo".into(),
                cwd: directory.path().to_string_lossy().into_owned(),
            },
        };
        let context = ConnectionCtx {
            token_id: "token-id".into(),
            role: TokenRole::Full,
            name: "test".into(),
            peer: "127.0.0.1:1234".parse().unwrap(),
            hostname: None,
            established_at: chrono::Utc::now(),
        };

        let outcome = compatibility.execute(&context, &action).await;

        assert!(matches!(
            outcome,
            WorkspaceCommandOutcome::Rejected(ref error)
                if error.command_id == command_id
                    && error.code == peri_studio_proto::ack::ErrorCode::AgentUnavailable
                    && error.retryable
        ));
        assert!(doc.registry().list_workspaces().await.unwrap().is_empty());
    }
}
