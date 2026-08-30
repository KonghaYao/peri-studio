//! 远程文件系统与 Git 资源协议。
//!
//! 浏览器只提交 project identity 与相对资源定位；server 解析可信的 instance
//! 与 workspace root 后，构造独立的 `instance/resource_query`。目录与 Git 状态
//! 以有界 Yjs 视图发布；浏览器只通过短租约 HTTP blob 下载正文。当前
//! instance → server 一跳仍使用有界 base64 JSON 中继，必须受本模块的 wire
//! 上限约束，不得将其误当作任意大小的流式传输。

use serde::{Deserialize, Serialize};

use crate::conn::DocId;

pub const RESOURCE_PROTOCOL_VERSION: u32 = 4;
pub const DEFAULT_DIRECTORY_PAGE_SIZE: u32 = 200;
pub const DEFAULT_GIT_LOG_PAGE_SIZE: u32 = 50;
pub const MAX_DIRECTORY_PAGE_SIZE: u32 = 500;
/// instance → server 单次 blob 中继的原始字节上限。
pub const MAX_RESOURCE_BLOB_BYTES: u64 = 8 * 1024 * 1024;
/// 包含 base64 与 JSON 信封后的 WebSocket message 上限。
pub const MAX_RESOURCE_WS_MESSAGE_BYTES: usize = 12 * 1024 * 1024;
/// UTF-8 编码后的提交信息上限，防止控制帧和子进程 stdin 无界增长。
pub const MAX_COMMIT_MESSAGE_BYTES: usize = 4 * 1024;

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
    pub change_ids: Vec<String>,
    pub expected_generation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceGitActionKind {
    Stage,
    Unstage,
    Discard,
    Commit,
    Pull,
    Push,
    Sync,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_generation: Option<String>,
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
    GitLogPage,
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
    UnrepresentableName,
    OutsideWorkspace,
    NotFound,
    NotDirectory,
    PermissionDenied,
    StaleCursor,
    VersionConflict,
    DeliveryUnknown,
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
    GitDiff(GitDiffQuery),
    GitLog(GitLogQuery),
    GitMutate(GitMutateQuery),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffQuery {
    pub repo_id: String,
    pub change_id: String,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMutateQuery {
    pub repo_id: String,
    pub action: ResourceGitActionKind,
    pub change_ids: Vec<String>,
    pub expected_generation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
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
pub struct GitLogQuery {
    pub repo_id: String,
    pub expected_generation: String,
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
    GitLogPage(GitLogPage),
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

impl GitGroupId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Conflicts => "conflicts",
            Self::Index => "index",
            Self::WorkingTree => "working_tree",
            Self::Untracked => "untracked",
        }
    }
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
pub struct GitLogPage {
    pub repo_id: String,
    pub source_generation: String,
    pub commits: Vec<GitLogCommit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub head_oid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogCommit {
    pub commit_id: String,
    pub oid: String,
    pub short_oid: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_truncated: Option<bool>,
    pub author_name: String,
    pub author_date: String,
    pub parents: Vec<String>,
    pub parents_complete: bool,
    pub refs: Vec<GitRefLabel>,
    pub refs_complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefLabel {
    pub name: String,
    pub kind: GitRefKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitRefKind {
    Branch,
    Remote,
    Tag,
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

impl GitChangeStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Modified => "modified",
            Self::Deleted => "deleted",
            Self::Renamed => "renamed",
            Self::Copied => "copied",
            Self::Untracked => "untracked",
            Self::Ignored => "ignored",
            Self::Conflict => "conflict",
            Self::TypeChanged => "type_changed",
        }
    }
}

#[cfg(test)]
#[path = "resource_test.rs"]
mod resource_test;
