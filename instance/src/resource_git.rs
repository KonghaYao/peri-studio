use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use peri_studio_proto::resource::{
    GitChange, GitChangeStatus, GitGroupId, GitGroupPage, GitGroupSummary, GitRepositorySnapshot,
    GitRepositorySummary, InstanceMutationResult, InstanceResourcePayload, RepositoriesPage,
    ResourceErrorCode, ResourceFailure, ResourceGitActionKind, MAX_DIRECTORY_PAGE_SIZE,
};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;

use super::common::{
    canonical_root, cursor_for, failure, hash_bytes, hash_text, map_io, parse_cursor,
    relative_path, validate_relative,
};
use super::ResourceHost;

const STATUS_ARGS: &[&str] = &[
    "status",
    "--porcelain=v1",
    "-z",
    "--branch",
    "--untracked-files=all",
];
const MAX_GIT_OUTPUT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_MUTATION_PATH_BYTES: usize = 64 * 1024;

impl ResourceHost {
    pub(super) async fn git_mutate(
        &self,
        root: &str,
        expected_repo_id: &str,
        action: ResourceGitActionKind,
        paths: &[String],
        expected_generation: &str,
    ) -> Result<InstanceResourcePayload, ResourceFailure> {
        if paths.is_empty()
            || paths.len() > 500
            || paths.iter().map(String::len).sum::<usize>() > MAX_MUTATION_PATH_BYTES
        {
            return Err(failure(ResourceErrorCode::InvalidRequest, false));
        }
        for path in paths {
            validate_relative(path)?;
        }
        let mutation_lock = self.mutation_lock(root, expected_repo_id).await;
        let _mutation_guard = mutation_lock.lock().await;
        let (_root, repo) = self.resolve_repo(root, expected_repo_id).await?;
        let before = self.git(&repo, STATUS_ARGS).await?;
        if expected_generation != hash_bytes(&before) {
            return Err(failure(ResourceErrorCode::VersionConflict, false));
        }
        let mut command = Command::new("git");
        command.current_dir(&repo).env("GIT_TERMINAL_PROMPT", "0");
        match action {
            ResourceGitActionKind::Stage => command.arg("add"),
            ResourceGitActionKind::Unstage => command.args(["restore", "--staged"]),
        };
        command
            .arg("--")
            .args(paths)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let status = tokio::time::timeout(self.git_timeout, command.status())
            .await
            .map_err(|_| failure(ResourceErrorCode::Timeout, true))?
            .map_err(map_io)?;
        if !status.success() {
            return Err(failure(ResourceErrorCode::Unavailable, false));
        }
        let after = self.git(&repo, STATUS_ARGS).await?;
        Ok(InstanceResourcePayload::Mutation(InstanceMutationResult {
            generation: hash_bytes(&after),
        }))
    }

    pub(super) async fn discover_repositories(
        &self,
        root: &str,
    ) -> Result<InstanceResourcePayload, ResourceFailure> {
        let root = canonical_root(root)?;
        let output = match self.git(&root, &["rev-parse", "--show-toplevel"]).await {
            Ok(output) => output,
            Err(error) if error.code == ResourceErrorCode::RepoNotFound => {
                return Ok(InstanceResourcePayload::RepositoriesPage(
                    RepositoriesPage {
                        source_generation: hash_bytes(root.to_string_lossy().as_bytes()),
                        repositories: vec![],
                        next_cursor: None,
                    },
                ));
            }
            Err(error) => return Err(error),
        };
        let repo = canonical_repo(&root, &output)?;
        let relative = relative_path(&root, &repo)?;
        let repo_id = repo_id(&repo);
        let name = repo
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("repository")
            .to_string();
        Ok(InstanceResourcePayload::RepositoriesPage(
            RepositoriesPage {
                source_generation: hash_bytes(repo_id.as_bytes()),
                repositories: vec![GitRepositorySummary {
                    repo_id,
                    root: relative,
                    name,
                }],
                next_cursor: None,
            },
        ))
    }

    pub(super) async fn git_snapshot(
        &self,
        root: &str,
        expected_repo_id: &str,
    ) -> Result<InstanceResourcePayload, ResourceFailure> {
        let (root, repo) = self.resolve_repo(root, expected_repo_id).await?;
        let status = self.git(&repo, STATUS_ARGS).await?;
        let parsed = parse_status(&status);
        let head_oid = self.git(&repo, &["rev-parse", "HEAD"]).await.ok();
        let generation = hash_bytes(&status);
        let groups = [
            GitGroupId::Conflicts,
            GitGroupId::Index,
            GitGroupId::WorkingTree,
            GitGroupId::Untracked,
        ]
        .into_iter()
        .map(|id| GitGroupSummary {
            id,
            count: parsed
                .changes
                .iter()
                .filter(|change| change.groups.contains(&id))
                .count() as u32,
            revision: hash_text(&format!("{generation}:{id:?}")),
        })
        .collect();
        Ok(InstanceResourcePayload::GitRepository(
            GitRepositorySnapshot {
                repo_id: expected_repo_id.to_string(),
                root: relative_path(&root, &repo)?,
                generation,
                head_name: parsed.head_name,
                head_oid: head_oid
                    .and_then(|bytes| String::from_utf8(bytes).ok())
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                detached: parsed.detached,
                upstream: parsed.upstream,
                ahead: parsed.ahead,
                behind: parsed.behind,
                groups,
            },
        ))
    }

    pub(super) async fn git_changes(
        &self,
        root: &str,
        expected_repo_id: &str,
        group_id: GitGroupId,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<InstanceResourcePayload, ResourceFailure> {
        if limit == 0 || limit > MAX_DIRECTORY_PAGE_SIZE {
            return Err(failure(ResourceErrorCode::ViewTooLarge, false));
        }
        let (_, repo) = self.resolve_repo(root, expected_repo_id).await?;
        let status = self.git(&repo, STATUS_ARGS).await?;
        let generation = hash_bytes(&status);
        let offset = parse_cursor(cursor, &generation)?;
        let filtered = parse_status(&status)
            .changes
            .into_iter()
            .filter(|change| change.groups.contains(&group_id))
            .collect::<Vec<_>>();
        let end = (offset + limit as usize).min(filtered.len());
        let changes = filtered[offset.min(filtered.len())..end]
            .iter()
            .map(|change| GitChange {
                change_id: hash_text(&format!(
                    "{}:{}:{}",
                    generation,
                    group_label(group_id),
                    change.path
                )),
                path: change.path.clone(),
                original_path: change.original_path.clone(),
                status: change.status_for(group_id),
            })
            .collect();
        let next_cursor = (end < filtered.len()).then(|| cursor_for(&generation, end));
        Ok(InstanceResourcePayload::GitGroupPage(GitGroupPage {
            repo_id: expected_repo_id.to_string(),
            group_id,
            source_generation: generation,
            changes,
            next_cursor,
        }))
    }

    async fn resolve_repo(
        &self,
        root: &str,
        expected_repo_id: &str,
    ) -> Result<(PathBuf, PathBuf), ResourceFailure> {
        let root = canonical_root(root)?;
        let output = self.git(&root, &["rev-parse", "--show-toplevel"]).await?;
        let repo = canonical_repo(&root, &output)?;
        if repo_id(&repo) != expected_repo_id {
            return Err(failure(ResourceErrorCode::RepoNotFound, false));
        }
        Ok((root, repo))
    }

    async fn mutation_lock(&self, root: &str, repo_id: &str) -> Arc<Mutex<()>> {
        let key = format!("{root}\0{repo_id}");
        self.mutation_locks
            .lock()
            .await
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn git(&self, cwd: &Path, args: &[&str]) -> Result<Vec<u8>, ResourceFailure> {
        let mut command = Command::new("git");
        command
            .current_dir(cwd)
            .args(args)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                failure(ResourceErrorCode::GitNotAvailable, false)
            } else {
                failure(ResourceErrorCode::Unavailable, true)
            }
        })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| failure(ResourceErrorCode::Unavailable, true))?;
        let output = tokio::time::timeout(self.git_timeout, async move {
            let mut bytes = Vec::new();
            stdout
                .take(MAX_GIT_OUTPUT_BYTES + 1)
                .read_to_end(&mut bytes)
                .await
                .map_err(map_io)?;
            if bytes.len() as u64 > MAX_GIT_OUTPUT_BYTES {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(failure(ResourceErrorCode::ViewTooLarge, false));
            }
            let status = child.wait().await.map_err(map_io)?;
            Ok((status, bytes))
        })
        .await
        .map_err(|_| failure(ResourceErrorCode::Timeout, true))??;
        if output.0.success() {
            Ok(output.1)
        } else {
            Err(failure(ResourceErrorCode::RepoNotFound, false))
        }
    }
}

fn canonical_repo(root: &Path, output: &[u8]) -> Result<PathBuf, ResourceFailure> {
    let value = String::from_utf8(output.to_vec())
        .map_err(|_| failure(ResourceErrorCode::RepoNotFound, false))?;
    let repo = std::fs::canonicalize(value.trim()).map_err(map_io)?;
    if !repo.starts_with(root) {
        return Err(failure(ResourceErrorCode::OutsideWorkspace, false));
    }
    Ok(repo)
}

fn repo_id(repo: &Path) -> String {
    hash_bytes(repo.to_string_lossy().as_bytes())
}

#[derive(Default)]
struct ParsedStatus {
    head_name: Option<String>,
    upstream: Option<String>,
    detached: bool,
    ahead: u32,
    behind: u32,
    changes: Vec<ParsedChange>,
}

struct ParsedChange {
    path: String,
    original_path: Option<String>,
    x: char,
    y: char,
    groups: Vec<GitGroupId>,
}

impl ParsedChange {
    fn status_for(&self, group: GitGroupId) -> GitChangeStatus {
        if group == GitGroupId::Conflicts {
            return GitChangeStatus::Conflict;
        }
        if group == GitGroupId::Untracked {
            return GitChangeStatus::Untracked;
        }
        let code = if group == GitGroupId::Index {
            self.x
        } else {
            self.y
        };
        match code {
            'A' => GitChangeStatus::Added,
            'D' => GitChangeStatus::Deleted,
            'R' => GitChangeStatus::Renamed,
            'C' => GitChangeStatus::Copied,
            'T' => GitChangeStatus::TypeChanged,
            '?' => GitChangeStatus::Untracked,
            _ => GitChangeStatus::Modified,
        }
    }
}

fn parse_status(output: &[u8]) -> ParsedStatus {
    let chunks = output.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut parsed = ParsedStatus::default();
    let mut index = 0;
    while index < chunks.len() {
        let value = String::from_utf8_lossy(chunks[index]);
        if let Some(branch) = value.strip_prefix("## ") {
            parse_branch(branch, &mut parsed);
            index += 1;
            continue;
        }
        let bytes = value.as_bytes();
        if bytes.len() < 3 {
            index += 1;
            continue;
        }
        let x = bytes[0] as char;
        let y = bytes[1] as char;
        let path = value[3..].to_string();
        let conflict = matches!(
            (x, y),
            ('D', 'D')
                | ('A', 'U')
                | ('U', 'D')
                | ('U', 'A')
                | ('D', 'U')
                | ('A', 'A')
                | ('U', 'U')
        );
        let mut groups = Vec::new();
        if conflict {
            groups.push(GitGroupId::Conflicts);
        } else if x == '?' && y == '?' {
            groups.push(GitGroupId::Untracked);
        } else {
            if x != ' ' {
                groups.push(GitGroupId::Index);
            }
            if y != ' ' {
                groups.push(GitGroupId::WorkingTree);
            }
        }
        let original_path = if matches!(x, 'R' | 'C') && index + 1 < chunks.len() {
            index += 1;
            Some(String::from_utf8_lossy(chunks[index]).to_string())
        } else {
            None
        };
        parsed.changes.push(ParsedChange {
            path,
            original_path,
            x,
            y,
            groups,
        });
        index += 1;
    }
    parsed
}

fn parse_branch(value: &str, parsed: &mut ParsedStatus) {
    let (name_and_upstream, counts) = value.split_once(" [").unwrap_or((value, ""));
    let (head, upstream) = name_and_upstream
        .split_once("...")
        .map_or((name_and_upstream, None), |(head, upstream)| {
            (head, Some(upstream))
        });
    parsed.detached = head.starts_with("HEAD (") || head == "HEAD";
    parsed.head_name = (!parsed.detached).then(|| head.to_string());
    parsed.upstream = upstream.map(str::to_string);
    for part in counts.trim_end_matches(']').split(", ") {
        if let Some(value) = part.strip_prefix("ahead ") {
            parsed.ahead = value.parse().unwrap_or_default();
        } else if let Some(value) = part.strip_prefix("behind ") {
            parsed.behind = value.parse().unwrap_or_default();
        }
    }
}

fn group_label(group: GitGroupId) -> &'static str {
    group.as_str()
}
