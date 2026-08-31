//! 浏览器资源查询编排：不信任 browser root，始终从 SQLite project metadata
//! 解析 instance/root，再调用 instance 查询并发布短租约 Yjs Doc。

use base64::Engine as _;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use peri_studio_proto::resource::{
    DiscoverRepositoriesQuery, GitChangesQuery, GitDiffQuery, GitLogQuery, GitMutateQuery,
    GitSnapshotQuery, InstanceResourcePayload, InstanceResourceQuery, InstanceResourceQueryKind,
    OpenResourceBlob, OpenResourceView, ReadDirectoryQuery, ReadFileQuery, ResourceBlobKind,
    ResourceBlobOpened, ResourceErrorCode, ResourceFailure, ResourceGitActionKind, ResourceQuery,
    ResourceQueryResult, ResourceResult, ResourceViewKind, DEFAULT_DIRECTORY_PAGE_SIZE,
    DEFAULT_GIT_LOG_PAGE_SIZE, MAX_COMMIT_MESSAGE_BYTES, MAX_DIRECTORY_PAGE_SIZE,
    MAX_RESOURCE_BLOB_BYTES,
};

use crate::control::{InstanceError, InstanceRegistry, ResourceProjection};
use crate::persist::metadata::MetadataStore;

const MAX_BLOBS_PER_PRINCIPAL: usize = 4;
const MAX_SINGLE_BLOB_BYTES: usize = MAX_RESOURCE_BLOB_BYTES as usize;
const MAX_BLOB_CACHE_BYTES: usize = 256 * 1024 * 1024;

#[derive(Clone)]
pub struct ResourceService {
    metadata: Arc<MetadataStore>,
    instance: Arc<InstanceRegistry>,
    projection: ResourceProjection,
    blobs: Arc<Mutex<HashMap<String, ResourceBlob>>>,
}

#[derive(Debug, Clone)]
pub struct ResourceBlob {
    pub principal: String,
    pub bytes: Arc<Vec<u8>>,
    pub content_type: String,
    pub etag: String,
    pub expires_at: DateTime<Utc>,
}

impl ResourceService {
    pub fn new(
        metadata: Arc<MetadataStore>,
        instance: Arc<InstanceRegistry>,
        projection: ResourceProjection,
    ) -> Self {
        Self {
            metadata,
            instance,
            projection,
            blobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn projection(&self) -> &ResourceProjection {
        &self.projection
    }

    pub async fn handle(
        &self,
        principal: &str,
        can_mutate: bool,
        query: ResourceQuery,
    ) -> ResourceResult {
        let request_id = query.request_id().to_string();
        let outcome = match query {
            ResourceQuery::OpenView {
                project_id,
                payload,
                ..
            } => self.open_view(principal, &project_id, payload).await,
            ResourceQuery::ReleaseView { payload, .. } => {
                // release 幂等且不泄露 view 是否存在或属于其他 principal。
                self.projection.release(principal, &payload.view_id).await;
                Ok(ResourceQueryResult::Released)
            }
            ResourceQuery::OpenBlob {
                project_id,
                payload,
                ..
            } => self.open_blob(principal, &project_id, payload).await,
            ResourceQuery::GitAction {
                project_id,
                payload,
                ..
            } => {
                if can_mutate {
                    self.git_action(&project_id, payload).await
                } else {
                    Err(failure(
                        ResourceErrorCode::Forbidden,
                        "read-only principals cannot mutate Git state",
                        false,
                    ))
                }
            }
        };
        match outcome {
            Ok(result) => ResourceResult {
                request_id,
                result: Some(result),
                error: None,
            },
            Err(error) => ResourceResult {
                request_id,
                result: None,
                error: Some(error),
            },
        }
    }

    async fn git_action(
        &self,
        project_id: &str,
        action: peri_studio_proto::resource::ResourceGitAction,
    ) -> Result<ResourceQueryResult, ResourceFailure> {
        validate_git_action(&action)?;
        let project = self
            .metadata
            .project(project_id)
            .await
            .map_err(|_| unavailable())?
            .filter(|project| project.archived_at.is_none())
            .ok_or_else(|| {
                failure(
                    ResourceErrorCode::ProjectNotFound,
                    "project was not found",
                    false,
                )
            })?;
        let query = InstanceResourceQuery {
            request_id: uuid::Uuid::new_v4().to_string(),
            workspace_id: project.id,
            root: project.cwd,
            query: InstanceResourceQueryKind::GitMutate(GitMutateQuery {
                repo_id: action.repo_id,
                action: action.action,
                change_ids: action.change_ids,
                expected_generation: action.expected_generation,
                message: action.message,
            }),
        };
        let result = self
            .instance
            .query_resource(&project.instance_id, query)
            .await
            .map_err(git_instance_failure)?;
        if let Some(error) = result.error {
            return Err(error);
        }
        match result.result {
            Some(InstanceResourcePayload::Mutation(_)) => Ok(ResourceQueryResult::Mutated),
            _ => Err(unavailable()),
        }
    }

    pub async fn blob(&self, principal: &str, blob_id: &str) -> Option<ResourceBlob> {
        let now = Utc::now();
        let mut blobs = self.blobs.lock().await;
        blobs.retain(|_, blob| blob.expires_at > now);
        blobs
            .get(blob_id)
            .filter(|blob| blob.principal == principal)
            .cloned()
    }

    pub(crate) async fn store_blob(
        &self,
        principal: &str,
        bytes: Vec<u8>,
        content_type: String,
        etag: String,
        ttl: chrono::Duration,
    ) -> Result<ResourceBlobOpened, ResourceFailure> {
        let blob_id = uuid::Uuid::new_v4().to_string();
        let expires_at = Utc::now() + ttl;
        let mut blobs = self.blobs.lock().await;
        let now = Utc::now();
        blobs.retain(|_, blob| blob.expires_at > now);
        let principal_count = blobs
            .values()
            .filter(|blob| blob.principal == principal)
            .count();
        let cached_bytes = blobs.values().map(|blob| blob.bytes.len()).sum::<usize>();
        if bytes.len() > MAX_SINGLE_BLOB_BYTES
            || principal_count >= MAX_BLOBS_PER_PRINCIPAL
            || cached_bytes
                .checked_add(bytes.len())
                .is_none_or(|total| total > MAX_BLOB_CACHE_BYTES)
        {
            return Err(failure(
                ResourceErrorCode::RateLimited,
                "resource blob capacity reached",
                true,
            ));
        }
        blobs.insert(
            blob_id.clone(),
            ResourceBlob {
                principal: principal.to_string(),
                bytes: Arc::new(bytes),
                content_type,
                etag: etag.clone(),
                expires_at,
            },
        );
        Ok(ResourceBlobOpened {
            blob_id: blob_id.clone(),
            url: format!("/api/resource-blobs/{blob_id}"),
            expires_at: expires_at.to_rfc3339(),
            etag: Some(etag),
        })
    }

    async fn open_blob(
        &self,
        principal: &str,
        project_id: &str,
        request: OpenResourceBlob,
    ) -> Result<ResourceQueryResult, ResourceFailure> {
        let query_kind = match request.kind {
            ResourceBlobKind::File => {
                let path = required(request.path, "file path is required")?;
                InstanceResourceQueryKind::ReadFile(ReadFileQuery {
                    path,
                    max_bytes: MAX_RESOURCE_BLOB_BYTES,
                })
            }
            ResourceBlobKind::GitDiff => {
                let repo_id = required(request.repo_id, "repository is required")?;
                let change_id = required(request.change_id, "Git change is required")?;
                InstanceResourceQueryKind::GitDiff(GitDiffQuery {
                    repo_id,
                    change_id,
                    max_bytes: MAX_RESOURCE_BLOB_BYTES,
                })
            }
            ResourceBlobKind::GitHead | ResourceBlobKind::GitIndex => {
                return Err(failure(
                    ResourceErrorCode::InvalidRequest,
                    "blob kind is not supported",
                    false,
                ));
            }
        };
        let project = self
            .metadata
            .project(project_id)
            .await
            .map_err(|_| unavailable())?
            .filter(|project| project.archived_at.is_none())
            .ok_or_else(|| {
                failure(
                    ResourceErrorCode::ProjectNotFound,
                    "project was not found",
                    false,
                )
            })?;
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
            .map_err(instance_failure)?;
        if let Some(error) = result.error {
            return Err(error);
        }
        let Some(InstanceResourcePayload::Blob(blob)) = result.result else {
            return Err(unavailable());
        };
        // 在 decode 分配前先约束 base64 长度；加 4 覆盖 padding 取整。
        if !relay_base64_length_is_valid(blob.content_base64.len()) {
            return Err(failure(
                ResourceErrorCode::ViewTooLarge,
                "resource blob exceeds relay limit",
                false,
            ));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(blob.content_base64)
            .map_err(|_| unavailable())?;
        Ok(ResourceQueryResult::Blob(
            self.store_blob(
                principal,
                bytes,
                blob.content_type,
                blob.etag,
                chrono::Duration::seconds(60),
            )
            .await?,
        ))
    }

    async fn open_view(
        &self,
        principal: &str,
        project_id: &str,
        view: OpenResourceView,
    ) -> Result<ResourceQueryResult, ResourceFailure> {
        let project = self
            .metadata
            .project(project_id)
            .await
            .map_err(|_| unavailable())?
            .filter(|project| project.archived_at.is_none())
            .ok_or_else(|| {
                failure(
                    ResourceErrorCode::ProjectNotFound,
                    "project was not found",
                    false,
                )
            })?;
        let query_kind = if view.kind == ResourceViewKind::GitLogPage {
            self.resolve_git_log_query(&project, view).await?
        } else {
            view_to_instance_query(view)?
        };
        let query = InstanceResourceQuery {
            request_id: uuid::Uuid::new_v4().to_string(),
            workspace_id: project.id.clone(),
            root: project.cwd.clone(),
            query: query_kind,
        };
        let result = self
            .instance
            .query_resource(&project.instance_id, query)
            .await
            .map_err(instance_failure)?;
        if let Some(error) = result.error {
            return Err(error);
        }
        let payload = result.result.ok_or_else(unavailable)?;
        let opened = self
            .projection
            .publish(principal, project_id, &payload)
            .await?;
        Ok(ResourceQueryResult::View(opened))
    }

    async fn resolve_git_log_query(
        &self,
        project: &crate::persist::metadata::ProjectRecord,
        view: OpenResourceView,
    ) -> Result<InstanceResourceQueryKind, ResourceFailure> {
        let repo_id = required(view.repo_id, "repository is required")?;
        let client_generation =
            required(view.expected_generation, "repository generation is required")?;
        let limit = git_log_limit(view.limit)?;
        let snapshot = InstanceResourceQuery {
            request_id: uuid::Uuid::new_v4().to_string(),
            workspace_id: project.id.clone(),
            root: project.cwd.clone(),
            query: InstanceResourceQueryKind::GitSnapshot(GitSnapshotQuery {
                repo_id: repo_id.clone(),
            }),
        };
        let result = self
            .instance
            .query_resource(&project.instance_id, snapshot)
            .await
            .map_err(instance_failure)?;
        if let Some(error) = result.error {
            return Err(error);
        }
        let generation = match result.result {
            Some(InstanceResourcePayload::GitRepository(repo)) => repo.generation,
            _ => return Err(unavailable()),
        };
        if generation != client_generation {
            return Err(failure(
                ResourceErrorCode::StaleCursor,
                "repository generation changed; refresh required",
                false,
            ));
        }
        Ok(InstanceResourceQueryKind::GitLog(GitLogQuery {
            repo_id,
            expected_generation: generation,
            cursor: view.cursor,
            limit,
        }))
    }
}

fn relay_base64_length_is_valid(encoded_len: usize) -> bool {
    encoded_len <= (MAX_SINGLE_BLOB_BYTES * 4).div_ceil(3) + 4
}

fn validate_git_action(
    action: &peri_studio_proto::resource::ResourceGitAction,
) -> Result<(), ResourceFailure> {
    let path_action = matches!(
        action.action,
        ResourceGitActionKind::Stage
            | ResourceGitActionKind::Unstage
            | ResourceGitActionKind::Discard
    );
    let message_valid = match (action.action, action.message.as_deref()) {
        (ResourceGitActionKind::Commit, Some(message)) => {
            !message.trim().is_empty() && message.len() <= MAX_COMMIT_MESSAGE_BYTES
        }
        (ResourceGitActionKind::Commit, None) => false,
        (_, None) => true,
        (_, Some(_)) => false,
    };
    if action.repo_id.is_empty()
        || action.expected_generation.is_empty()
        || path_action == action.change_ids.is_empty()
        || action.change_ids.len() > 500
        || action.change_ids.iter().map(String::len).sum::<usize>() > 64 * 1024
        || !message_valid
    {
        return Err(failure(
            ResourceErrorCode::InvalidRequest,
            "Git action payload is invalid",
            false,
        ));
    }
    Ok(())
}

fn view_to_instance_query(
    view: OpenResourceView,
) -> Result<InstanceResourceQueryKind, ResourceFailure> {
    let limit = match view.limit {
        0 => DEFAULT_DIRECTORY_PAGE_SIZE,
        value if value <= MAX_DIRECTORY_PAGE_SIZE => value,
        _ => {
            return Err(failure(
                ResourceErrorCode::InvalidRequest,
                "resource page limit exceeds maximum",
                false,
            ))
        }
    };
    match view.kind {
        ResourceViewKind::WorkspaceSummary | ResourceViewKind::WorkspaceRepositoriesPage => Ok(
            InstanceResourceQueryKind::DiscoverRepositories(DiscoverRepositoriesQuery::default()),
        ),
        ResourceViewKind::FsDirectoryPage => Ok(InstanceResourceQueryKind::ReadDirectory(
            ReadDirectoryQuery {
                path: view.path.unwrap_or_default(),
                cursor: view.cursor,
                limit,
            },
        )),
        ResourceViewKind::GitRepository => {
            let repo_id = required(view.repo_id, "repository is required")?;
            Ok(InstanceResourceQueryKind::GitSnapshot(GitSnapshotQuery {
                repo_id,
            }))
        }
        ResourceViewKind::GitGroupPage => {
            let repo_id = required(view.repo_id, "repository is required")?;
            let group_id = view.group_id.ok_or_else(|| {
                failure(
                    ResourceErrorCode::InvalidRequest,
                    "Git group is required",
                    false,
                )
            })?;
            Ok(InstanceResourceQueryKind::GitChanges(GitChangesQuery {
                repo_id,
                group_id,
                cursor: view.cursor,
                limit,
            }))
        }
        ResourceViewKind::GitLogPage => {
            let repo_id = required(view.repo_id, "repository is required")?;
            let expected_generation =
                required(view.expected_generation, "repository generation is required")?;
            Ok(InstanceResourceQueryKind::GitLog(GitLogQuery {
                repo_id,
                expected_generation,
                cursor: view.cursor,
                limit: git_log_limit(view.limit)?,
            }))
        }
    }
}

fn git_log_limit(limit: u32) -> Result<u32, ResourceFailure> {
    let limit = if limit == 0 {
        DEFAULT_GIT_LOG_PAGE_SIZE
    } else {
        limit
    };
    if limit > MAX_DIRECTORY_PAGE_SIZE {
        return Err(failure(
            ResourceErrorCode::InvalidRequest,
            "resource page limit exceeds maximum",
            false,
        ));
    }
    Ok(limit)
}

fn required(value: Option<String>, message: &str) -> Result<String, ResourceFailure> {
    value
        .filter(|value| !value.is_empty())
        .ok_or_else(|| failure(ResourceErrorCode::InvalidRequest, message, false))
}

fn instance_failure(error: InstanceError) -> ResourceFailure {
    match error {
        InstanceError::UnknownInstance(_) | InstanceError::Offline => failure(
            ResourceErrorCode::InstanceOffline,
            "project instance is offline",
            true,
        ),
        InstanceError::Timeout => {
            failure(ResourceErrorCode::Timeout, "resource query timed out", true)
        }
        InstanceError::ResourceUnsupported => failure(
            ResourceErrorCode::Unavailable,
            "project instance does not support workspace resources",
            false,
        ),
        _ => unavailable(),
    }
}

fn git_instance_failure(error: InstanceError) -> ResourceFailure {
    match error {
        InstanceError::Timeout | InstanceError::ConnectionGone => failure(
            ResourceErrorCode::DeliveryUnknown,
            "Git outcome is unknown; refresh repository state",
            false,
        ),
        other => instance_failure(other),
    }
}

fn unavailable() -> ResourceFailure {
    failure(
        ResourceErrorCode::Unavailable,
        "resource service unavailable",
        true,
    )
}

fn failure(code: ResourceErrorCode, message: &str, retryable: bool) -> ResourceFailure {
    ResourceFailure {
        code,
        message: message.to_string(),
        retryable,
        suggested_limit: None,
    }
}

#[cfg(test)]
#[path = "resource_service_test.rs"]
mod resource_service_test;
