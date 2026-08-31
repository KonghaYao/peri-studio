//! Git 写操作的单仓库串行化与固定命令执行。
//!
//! 所有命令均禁用交互输入、丢弃 stdout/stderr，并受统一超时约束；浏览器只
//! 能提交上一快照中的 opaque change id，不能注入路径或 argv。

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Stdio;

use peri_studio_proto::resource::{
    GitGroupId, InstanceMutationResult, InstanceResourcePayload, ResourceErrorCode,
    ResourceFailure, ResourceGitActionKind, MAX_COMMIT_MESSAGE_BYTES,
};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::{change_id, parse_status, ParsedStatus, STATUS_ARGS};
use crate::resource::common::{failure, hash_bytes, validate_relative};
use crate::resource::ResourceHost;

const MAX_MUTATION_PATH_BYTES: usize = 64 * 1024;
const MAX_MUTATION_CHANGES: usize = 500;

impl ResourceHost {
    pub(in crate::resource) async fn git_mutate(
        &self,
        root: &str,
        expected_repo_id: &str,
        action: ResourceGitActionKind,
        change_ids: &[String],
        expected_generation: &str,
        message: Option<&str>,
    ) -> Result<InstanceResourcePayload, ResourceFailure> {
        validate_action(action, change_ids, message)?;
        let _permit = self.try_acquire_git_query_permit()?;
        // 先解析可信仓库再登记锁，避免随机 repoId 扩张锁表。
        let (_, initial_repo) = self.resolve_repo(root, expected_repo_id).await?;
        let mutation_lock = self.mutation_lock(&initial_repo).await;
        let _mutation_guard = mutation_lock.lock().await;
        let (_, repo) = self.resolve_repo(root, expected_repo_id).await?;
        let before = self.git(&repo, STATUS_ARGS).await?;
        let generation = hash_bytes(&before);
        if expected_generation != generation {
            return Err(failure(ResourceErrorCode::VersionConflict, false));
        }
        let parsed = parse_status(&before)?;

        match action {
            ResourceGitActionKind::Stage | ResourceGitActionKind::Unstage => {
                let paths = resolve_change_paths(&parsed, &generation, action, change_ids)?;
                validate_paths(&paths)?;
                let args = if action == ResourceGitActionKind::Stage {
                    ["add", "--"].as_slice()
                } else {
                    ["restore", "--staged", "--"].as_slice()
                };
                self.run_paths_command(&repo, args, &paths, action).await?;
            }
            ResourceGitActionKind::Discard => {
                let discard = resolve_discard_paths(&parsed, &generation, change_ids)?;
                validate_paths(&discard.tracked)?;
                validate_paths(&discard.untracked)?;
                if !discard.tracked.is_empty() {
                    self.run_paths_command(
                        &repo,
                        &["restore", "--worktree", "--"],
                        &discard.tracked,
                        action,
                    )
                    .await?;
                }
                if !discard.untracked.is_empty() {
                    self.run_paths_command(
                        &repo,
                        &["clean", "-f", "--"],
                        &discard.untracked,
                        action,
                    )
                    .await?;
                }
            }
            ResourceGitActionKind::Commit => {
                self.run_commit(&repo, message.expect("validated commit message"))
                    .await?;
            }
            ResourceGitActionKind::Pull => {
                self.run_fixed_command(&repo, &["pull", "--ff-only"], action)
                    .await?;
            }
            ResourceGitActionKind::Push => {
                self.run_fixed_command(&repo, &["push"], action).await?;
            }
            ResourceGitActionKind::Sync => {
                self.run_fixed_command(&repo, &["pull", "--ff-only"], action)
                    .await?;
                self.run_fixed_command(&repo, &["push"], action).await?;
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

fn validate_action(
    action: ResourceGitActionKind,
    change_ids: &[String],
    message: Option<&str>,
) -> Result<(), ResourceFailure> {
    let path_action = matches!(
        action,
        ResourceGitActionKind::Stage
            | ResourceGitActionKind::Unstage
            | ResourceGitActionKind::Discard
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
    };
    ResourceFailure {
        code: ResourceErrorCode::Unavailable,
        message: message.to_string(),
        retryable: false,
        suggested_limit: None,
    }
}
