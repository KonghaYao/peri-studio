//! 远程文件系统与 Git 资源协议。
//!
//! 浏览器只提交 project identity 与相对资源定位；server 解析可信的 instance
//! 与 workspace root 后，构造独立的 `instance/resource_query`。文件正文、diff
//! 与 upload 字节不属于本模块的 JSON 帧，统一经 HTTP/blob 数据面传输。

use serde::{Deserialize, Serialize};

use crate::conn::DocId;

pub const RESOURCE_PROTOCOL_VERSION: u32 = 1;
pub const DEFAULT_DIRECTORY_PAGE_SIZE: u32 = 200;
pub const MAX_DIRECTORY_PAGE_SIZE: u32 = 500;

/// Web 面板申请一个有界只读投影视图。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ResourceQuery {
    #[serde(rename = "resource/open-view", rename_all = "camelCase")]
    OpenView {
        request_id: String,
        project_id: String,
        payload: OpenResourceView,
    },
    #[serde(rename = "resource/release-view", rename_all = "camelCase")]
    ReleaseView {
        request_id: String,
        payload: ReleaseResourceView,
    },
    #[serde(rename = "resource/open-blob", rename_all = "camelCase")]
    OpenBlob {
        request_id: String,
        project_id: String,
        payload: OpenResourceBlob,
    },
    #[serde(rename = "resource/git-action", rename_all = "camelCase")]
    GitAction {
        request_id: String,
        project_id: String,
        payload: ResourceGitAction,
    },
}

impl ResourceQuery {
    pub fn request_id(&self) -> &str {
        match self {
            Self::OpenView { request_id, .. }
            | Self::ReleaseView { request_id, .. }
            | Self::OpenBlob { request_id, .. }
            | Self::GitAction { request_id, .. } => request_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceGitAction {
    pub repo_id: String,
    pub action: ResourceGitActionKind,
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_generation: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceGitActionKind {
    Stage,
    Unstage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResourceView {
    pub kind: ResourceViewKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<GitGroupId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

fn default_page_size() -> u32 {
    DEFAULT_DIRECTORY_PAGE_SIZE
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceViewKind {
    WorkspaceSummary,
    WorkspaceRepositoriesPage,
    FsDirectoryPage,
    GitRepository,
    GitGroupPage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseResourceView {
    pub view_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResourceBlob {
    pub kind: ResourceBlobKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub if_match: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceBlobKind {
    File,
    GitDiff,
    GitHead,
    GitIndex,
}

/// Web 面板查询结果。失败时不回显路径、命令或底层错误。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceResult {
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ResourceQueryResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ResourceFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ResourceQueryResult {
    View(ResourceViewOpened),
    Released,
    Blob(ResourceBlobOpened),
    Mutated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceViewOpened {
    pub view_id: String,
    pub doc_id: DocId,
    pub lease_expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceBlobOpened {
    pub blob_id: String,
    pub url: String,
    pub expires_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFailure {
    pub code: ResourceErrorCode,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResourceErrorCode {
    InvalidRequest,
    Forbidden,
    ProjectNotFound,
    InstanceOffline,
    InvalidPath,
    OutsideWorkspace,
    NotFound,
    NotDirectory,
    PermissionDenied,
    StaleCursor,
    VersionConflict,
    RepoNotFound,
    GitNotAvailable,
    ViewTooLarge,
    RateLimited,
    Timeout,
    Unavailable,
}

/// server → instance 的可信查询。`root` 只由 server 从 project metadata 构造。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceResourceQuery {
    pub request_id: String,
    pub workspace_id: String,
    pub root: String,
    pub query: InstanceResourceQueryKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum InstanceResourceQueryKind {
    ReadDirectory(ReadDirectoryQuery),
    ReadFile(ReadFileQuery),
    DiscoverRepositories(DiscoverRepositoriesQuery),
    GitSnapshot(GitSnapshotQuery),
    GitChanges(GitChangesQuery),
    GitMutate(GitMutateQuery),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMutateQuery {
    pub repo_id: String,
    pub action: ResourceGitActionKind,
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_generation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileQuery {
    pub path: String,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDirectoryQuery {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverRepositoriesQuery {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshotQuery {
    pub repo_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangesQuery {
    pub repo_id: String,
    pub group_id: GitGroupId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceResourceResult {
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<InstanceResourcePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ResourceFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum InstanceResourcePayload {
    DirectoryPage(DirectoryPage),
    RepositoriesPage(RepositoriesPage),
    GitRepository(GitRepositorySnapshot),
    GitGroupPage(GitGroupPage),
    Blob(InstanceBlob),
    Mutation(InstanceMutationResult),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceMutationResult {
    pub generation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceBlob {
    pub content_base64: String,
    pub content_type: String,
    pub etag: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPage {
    pub path: String,
    pub source_generation: String,
    pub entries: Vec<FileEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    pub mtime_ns: String,
    pub revision: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoriesPage {
    pub source_generation: String,
    pub repositories: Vec<GitRepositorySummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositorySummary {
    pub repo_id: String,
    pub root: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositorySnapshot {
    pub repo_id: String,
    pub root: String,
    pub generation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_oid: Option<String>,
    pub detached: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub groups: Vec<GitGroupSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGroupSummary {
    pub id: GitGroupId,
    pub count: u32,
    pub revision: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitGroupId {
    Conflicts,
    Index,
    WorkingTree,
    Untracked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGroupPage {
    pub repo_id: String,
    pub group_id: GitGroupId,
    pub source_generation: String,
    pub changes: Vec<GitChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub change_id: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    pub status: GitChangeStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitChangeStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Ignored,
    Conflict,
    TypeChanged,
}

#[cfg(test)]
#[path = "resource_test.rs"]
mod resource_test;
