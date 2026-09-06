//! Git 写操作的单仓库串行化与固定命令执行。
//!
//! 所有命令均禁用交互输入、丢弃 stdout/stderr，并受统一超时约束；浏览器只
//! 能提交上一快照中的 opaque change id，不能注入路径或 argv。

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Stdio;

use peri_studio_proto::resource::{
    GitGroupId, GitMutateQuery, GitResetMode, InstanceMutationResult, InstanceResourcePayload,
    ResourceErrorCode, ResourceFailure, ResourceGitActionKind, MAX_COMMIT_MESSAGE_BYTES,
};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::{change_id, parse_status, ParsedStatus, STATUS_ARGS};
use crate::resource::common::{failure, hash_bytes, validate_relative};
use crate::resource::ResourceHost;

const MAX_MUTATION_PATH_BYTES: usize = 64 * 1024;
const MAX_MUTATION_CHANGES: usize = 500;
const MAX_REF_NAME_BYTES: usize = 255;

impl ResourceHost {
    pub(in crate::resource) async fn git_mutate(
        &self,
        root: &str,
        query: &GitMutateQuery,
    ) -> Result<InstanceResourcePayload, ResourceFailure> {
        validate_action(query)?;
        let _permit = self.try_acquire_git_query_permit()?;
        // 先解析可信仓库再登记锁，避免随机 repoId 扩张锁表。
        let (_, initial_repo) = self.resolve_repo(root, &query.repo_id).await?;
        let mutation_lock = self.mutation_lock(&initial_repo).await;
        let _mutation_guard = mutation_lock.lock().await;
        let (_, repo) = self.resolve_repo(root, &query.repo_id).await?;
        let before = self.git(&repo, STATUS_ARGS).await?;
        let generation = hash_bytes(&before);
        if query.expected_generation != generation {
            return Err(failure(ResourceErrorCode::VersionConflict, false));
        }
        let parsed = parse_status(&before)?;

        match query.action {
            ResourceGitActionKind::Stage | ResourceGitActionKind::Unstage => {
                let paths =
                    resolve_change_paths(&parsed, &generation, query.action, &query.change_ids)?;
                validate_paths(&paths)?;
                let args = if query.action == ResourceGitActionKind::Stage {
                    ["add", "--"].as_slice()
                } else {
                    ["restore", "--staged", "--"].as_slice()
                };
                self.run_paths_command(&repo, args, &paths, query.action)
                    .await?;
            }
            ResourceGitActionKind::Discard => {
                let discard = resolve_discard_paths(&parsed, &generation, &query.change_ids)?;
                validate_paths(&discard.tracked)?;
                validate_paths(&discard.untracked)?;
                if !discard.tracked.is_empty() {
                    self.run_paths_command(
                        &repo,
                        &["restore", "--worktree", "--"],
                        &discard.tracked,
                        query.action,
                    )
                    .await?;
                }
                if !discard.untracked.is_empty() {
                    self.run_paths_command(
                        &repo,
                        &["clean", "-f", "--"],
                        &discard.untracked,
                        query.action,
                    )
                    .await?;
                }
            }
            ResourceGitActionKind::Commit => {
                self.run_commit(
                    &repo,
                    query.message.as_deref().expect("validated commit message"),
                )
                .await?;
            }
            ResourceGitActionKind::Pull => {
                self.run_fixed_command(&repo, &["pull", "--ff-only"], query.action)
                    .await?;
            }
            ResourceGitActionKind::Push => {
                self.run_fixed_command(&repo, &["push"], query.action)
                    .await?;
            }
            ResourceGitActionKind::Sync => {
                self.run_fixed_command(&repo, &["pull", "--ff-only"], query.action)
                    .await?;
                self.run_fixed_command(&repo, &["push"], query.action)
                    .await?;
            }
            ResourceGitActionKind::Checkout => {
                run_checkout(self, &repo, query).await?;
            }
            ResourceGitActionKind::CreateBranch => {
                run_create_branch(self, &repo, query).await?;
            }
            ResourceGitActionKind::RenameBranch => {
                run_rename_branch(self, &repo, query).await?;
            }
            ResourceGitActionKind::Reset => {
                run_reset(self, &repo, query).await?;
            }
            ResourceGitActionKind::Revert => {
                run_revert(self, &repo, query).await?;
            }
        }

        // 命令完成后若快照读取失败，调用方必须视为结果未知，不能自动重试。
        let after = self
            .git(&repo, STATUS_ARGS)
            .await
            .map_err(|_| delivery_unknown())?;
        Ok(InstanceResourcePayload::Mutation(InstanceMutationResult {
            generation: hash_bytes(&after),
        }))
    }

    async fn run_paths_command(
        &self,
        repo: &Path,
        args: &[&str],
        paths: &[String],
        action: ResourceGitActionKind,
    ) -> Result<(), ResourceFailure> {
        let mut command = noninteractive_git(repo);
        command.args(args).args(paths);
        self.wait_for_command(command, action).await
    }

    async fn run_fixed_command(
        &self,
        repo: &Path,
        args: &[&str],
        action: ResourceGitActionKind,
    ) -> Result<(), ResourceFailure> {
        let mut command = noninteractive_git(repo);
        command.args(args);
        self.wait_for_command(command, action).await
    }

    async fn run_ref_command(
        &self,
        repo: &Path,
        args: &[&str],
        value: &str,
        action: ResourceGitActionKind,
    ) -> Result<(), ResourceFailure> {
        let mut command = noninteractive_git(repo);
        command.args(args).arg(value);
        self.wait_for_command(command, action).await
    }

    async fn run_two_ref_command(
        &self,
        repo: &Path,
        args: &[&str],
        first: &str,
        second: &str,
        action: ResourceGitActionKind,
    ) -> Result<(), ResourceFailure> {
        let mut command = noninteractive_git(repo);
        command.args(args).arg(first).arg(second);
        self.wait_for_command(command, action).await
    }

    async fn wait_for_command(
        &self,
        mut command: Command,
        action: ResourceGitActionKind,
    ) -> Result<(), ResourceFailure> {
        let status = tokio::time::timeout(self.git_timeout, command.status())
            .await
            .map_err(|_| delivery_unknown())?
            .map_err(|_| action_failure(action))?;
        status
            .success()
            .then_some(())
            .ok_or_else(|| action_failure(action))
    }

    async fn run_commit(&self, repo: &Path, message: &str) -> Result<(), ResourceFailure> {
        let mut command = noninteractive_git(repo);
        command.args(["commit", "--file=-"]).stdin(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|_| action_failure(ResourceGitActionKind::Commit))?;
        let mut stdin = child.stdin.take().ok_or_else(delivery_unknown)?;
        let status = tokio::time::timeout(self.git_timeout, async {
            stdin.write_all(message.as_bytes()).await?;
            stdin.write_all(b"\n").await?;
            drop(stdin);
            child.wait().await
        })
        .await
        .map_err(|_| delivery_unknown())?
        .map_err(|_| delivery_unknown())?;
        status
            .success()
            .then_some(())
            .ok_or_else(|| action_failure(ResourceGitActionKind::Commit))
    }
}

fn noninteractive_git(repo: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(repo)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    command
}

fn validate_action(query: &GitMutateQuery) -> Result<(), ResourceFailure> {
    let action = query.action;
    let change_ids = &query.change_ids;
    let message = query.message.as_deref();
    let path_action = matches!(
        action,
        ResourceGitActionKind::Stage
            | ResourceGitActionKind::Unstage
            | ResourceGitActionKind::Discard
    );
    let graph_action = matches!(
        action,
        ResourceGitActionKind::Checkout
            | ResourceGitActionKind::CreateBranch
            | ResourceGitActionKind::RenameBranch
            | ResourceGitActionKind::Reset
            | ResourceGitActionKind::Revert
    );
    if path_action
        && (change_ids.is_empty()
            || change_ids.len() > MAX_MUTATION_CHANGES
            || change_ids.iter().map(String::len).sum::<usize>() > MAX_MUTATION_PATH_BYTES)
    {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    if !path_action && !change_ids.is_empty() {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    if graph_action {
        return validate_graph_payload(query);
    }
    if query.target_oid.is_some()
        || query.ref_name.is_some()
        || query.new_ref_name.is_some()
        || query.reset_mode.is_some()
    {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    match (action, message.map(str::trim)) {
        (ResourceGitActionKind::Commit, Some(value))
            if !value.is_empty() && value.len() <= MAX_COMMIT_MESSAGE_BYTES =>
        {
            Ok(())
        }
        (ResourceGitActionKind::Commit, _) => {
            Err(failure(ResourceErrorCode::InvalidRequest, false))
        }
        (_, None) => Ok(()),
        _ => Err(failure(ResourceErrorCode::InvalidRequest, false)),
    }
}

fn validate_graph_payload(query: &GitMutateQuery) -> Result<(), ResourceFailure> {
    if query.message.is_some() {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    match query.action {
        ResourceGitActionKind::Checkout => {
            let has_ref = query
                .ref_name
                .as_deref()
                .is_some_and(|value| validate_ref_name(value).is_ok());
            let has_oid = query
                .target_oid
                .as_deref()
                .is_some_and(|value| validate_oid(value).is_ok());
            if has_ref == has_oid || query.new_ref_name.is_some() || query.reset_mode.is_some() {
                return Err(failure(ResourceErrorCode::InvalidRequest, false));
            }
            Ok(())
        }
        ResourceGitActionKind::CreateBranch => {
            let oid = query
                .target_oid
                .as_deref()
                .and_then(|value| validate_oid(value).ok());
            let name = query
                .ref_name
                .as_deref()
                .and_then(|value| validate_ref_name(value).ok());
            if oid.is_none()
                || name.is_none()
                || query.new_ref_name.is_some()
                || query.reset_mode.is_some()
            {
                return Err(failure(ResourceErrorCode::InvalidRequest, false));
            }
            Ok(())
        }
        ResourceGitActionKind::RenameBranch => {
            let old_name = query
                .ref_name
                .as_deref()
                .and_then(|value| validate_ref_name(value).ok());
            let new_name = query
                .new_ref_name
                .as_deref()
                .and_then(|value| validate_ref_name(value).ok());
            if old_name.is_none()
                || new_name.is_none()
                || query.target_oid.is_some()
                || query.reset_mode.is_some()
            {
                return Err(failure(ResourceErrorCode::InvalidRequest, false));
            }
            Ok(())
        }
        ResourceGitActionKind::Reset => {
            if query
                .target_oid
                .as_deref()
                .and_then(|value| validate_oid(value).ok())
                .is_none()
                || query.ref_name.is_some()
                || query.new_ref_name.is_some()
            {
                return Err(failure(ResourceErrorCode::InvalidRequest, false));
            }
            Ok(())
        }
        ResourceGitActionKind::Revert => {
            if query
                .target_oid
                .as_deref()
                .and_then(|value| validate_oid(value).ok())
                .is_none()
                || query.ref_name.is_some()
                || query.new_ref_name.is_some()
                || query.reset_mode.is_some()
            {
                return Err(failure(ResourceErrorCode::InvalidRequest, false));
            }
            Ok(())
        }
        _ => Err(failure(ResourceErrorCode::InvalidRequest, false)),
    }
}

fn validate_oid(value: &str) -> Result<String, ResourceFailure> {
    let oid = value.trim();
    if oid.len() == 40 && oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(oid.to_ascii_lowercase())
    } else {
        Err(failure(ResourceErrorCode::InvalidRequest, false))
    }
}

fn validate_ref_name(value: &str) -> Result<String, ResourceFailure> {
    let name = value.trim();
    if name.is_empty() || name.len() > MAX_REF_NAME_BYTES {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    if name.bytes().any(|byte| byte < 32 || byte == 127) {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    if name.contains("..") || name.contains("@{") || name.starts_with('-') || name.ends_with('/') {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    if name.starts_with('/') || name.contains(' ') {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    Ok(name.to_string())
}

async fn run_checkout(
    host: &ResourceHost,
    repo: &Path,
    query: &GitMutateQuery,
) -> Result<(), ResourceFailure> {
    if let Some(ref_name) = query.ref_name.as_deref() {
        let name = validate_ref_name(ref_name)?;
        host.run_ref_command(repo, &["checkout", "--"], &name, query.action)
            .await
    } else {
        let oid = validate_oid(query.target_oid.as_deref().unwrap_or_default())?;
        host.run_ref_command(repo, &["checkout", "--detach"], &oid, query.action)
            .await
    }
}

async fn run_create_branch(
    host: &ResourceHost,
    repo: &Path,
    query: &GitMutateQuery,
) -> Result<(), ResourceFailure> {
    let oid = validate_oid(query.target_oid.as_deref().unwrap_or_default())?;
    let name = validate_ref_name(query.ref_name.as_deref().unwrap_or_default())?;
    host.run_two_ref_command(repo, &["branch"], &name, &oid, query.action)
        .await
}

async fn run_rename_branch(
    host: &ResourceHost,
    repo: &Path,
    query: &GitMutateQuery,
) -> Result<(), ResourceFailure> {
    let old_name = validate_ref_name(query.ref_name.as_deref().unwrap_or_default())?;
    let new_name = validate_ref_name(query.new_ref_name.as_deref().unwrap_or_default())?;
    host.run_two_ref_command(repo, &["branch", "-m"], &old_name, &new_name, query.action)
        .await
}

async fn run_reset(
    host: &ResourceHost,
    repo: &Path,
    query: &GitMutateQuery,
) -> Result<(), ResourceFailure> {
    let oid = validate_oid(query.target_oid.as_deref().unwrap_or_default())?;
    let mode = match query.reset_mode.unwrap_or(GitResetMode::Mixed) {
        GitResetMode::Soft => "--soft",
        GitResetMode::Mixed => "--mixed",
        GitResetMode::Hard => "--hard",
    };
    host.run_ref_command(repo, &["reset", mode], &oid, query.action)
        .await
}

async fn run_revert(
    host: &ResourceHost,
    repo: &Path,
    query: &GitMutateQuery,
) -> Result<(), ResourceFailure> {
    let oid = validate_oid(query.target_oid.as_deref().unwrap_or_default())?;
    host.run_ref_command(repo, &["revert", "--no-edit"], &oid, query.action)
        .await
}

fn validate_paths(paths: &[String]) -> Result<(), ResourceFailure> {
    for path in paths {
        validate_relative(path)?;
    }
    Ok(())
}

fn resolve_change_paths(
    parsed: &ParsedStatus,
    generation: &str,
    action: ResourceGitActionKind,
    change_ids: &[String],
) -> Result<Vec<String>, ResourceFailure> {
    let available = available_changes(parsed, generation, |group| match action {
        ResourceGitActionKind::Stage => group != GitGroupId::Index,
        ResourceGitActionKind::Unstage => group == GitGroupId::Index,
        _ => false,
    });
    collect_paths(&available, change_ids)
        .map(|values| values.into_iter().flat_map(|(_, paths)| paths).collect())
}

#[derive(Default)]
struct DiscardPaths {
    tracked: Vec<String>,
    untracked: Vec<String>,
}

fn resolve_discard_paths(
    parsed: &ParsedStatus,
    generation: &str,
    change_ids: &[String],
) -> Result<DiscardPaths, ResourceFailure> {
    let available = available_changes(parsed, generation, |group| {
        matches!(group, GitGroupId::WorkingTree | GitGroupId::Untracked)
    });
    let mut result = DiscardPaths::default();
    for (group, paths) in collect_paths(&available, change_ids)? {
        let target = if group == GitGroupId::Untracked {
            &mut result.untracked
        } else {
            &mut result.tracked
        };
        target.extend(paths);
    }
    deduplicate(&mut result.tracked);
    deduplicate(&mut result.untracked);
    Ok(result)
}

type AvailableChanges = HashMap<String, (GitGroupId, Vec<String>)>;

fn available_changes(
    parsed: &ParsedStatus,
    generation: &str,
    valid_group: impl Fn(GitGroupId) -> bool,
) -> AvailableChanges {
    parsed
        .changes
        .iter()
        .flat_map(|change| {
            change
                .groups
                .iter()
                .filter(|group| valid_group(**group))
                .map(|group| {
                    let mut paths = vec![change.path.clone()];
                    let rename_code = if *group == GitGroupId::Index {
                        change.x
                    } else {
                        change.y
                    };
                    if rename_code == 'R' {
                        paths.extend(change.original_path.clone());
                    }
                    (change_id(generation, *group, &change.path), (*group, paths))
                })
        })
        .collect()
}

fn collect_paths(
    available: &AvailableChanges,
    change_ids: &[String],
) -> Result<Vec<(GitGroupId, Vec<String>)>, ResourceFailure> {
    change_ids
        .iter()
        .map(|id| {
            available
                .get(id)
                .cloned()
                .ok_or_else(|| failure(ResourceErrorCode::VersionConflict, false))
        })
        .collect()
}

fn deduplicate(paths: &mut Vec<String>) {
    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(path.clone()));
}

fn delivery_unknown() -> ResourceFailure {
    failure(ResourceErrorCode::DeliveryUnknown, false)
}

fn action_failure(action: ResourceGitActionKind) -> ResourceFailure {
    let message = match action {
        ResourceGitActionKind::Stage => "Staging failed. Refresh Source Control and try again.",
        ResourceGitActionKind::Unstage => "Unstaging failed. Refresh Source Control and try again.",
        ResourceGitActionKind::Discard => {
            "Discard failed. Refresh Source Control before taking another action."
        }
        ResourceGitActionKind::Commit => "Commit failed. Check staged changes and Git identity.",
        ResourceGitActionKind::Pull => "Pull failed. Check upstream access and branch state.",
        ResourceGitActionKind::Push => "Push failed. Check upstream access and branch state.",
        ResourceGitActionKind::Sync => "Sync stopped. Refresh Source Control before retrying.",
        ResourceGitActionKind::Checkout => "Checkout failed. Refresh Git Graph and try again.",
        ResourceGitActionKind::CreateBranch => {
            "Create branch failed. Choose another name or refresh Git Graph."
        }
        ResourceGitActionKind::RenameBranch => {
            "Rename branch failed. Refresh Git Graph and try again."
        }
        ResourceGitActionKind::Reset => "Reset failed. Refresh Git Graph and try again.",
        ResourceGitActionKind::Revert => {
            "Revert failed. Resolve conflicts locally and refresh Git Graph."
        }
    };
    ResourceFailure {
        code: ResourceErrorCode::Unavailable,
        message: message.to_string(),
        retryable: false,
        suggested_limit: None,
    }
}
