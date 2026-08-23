//! Git diff 数据面：opaque change identity → 有界 unified diff blob。

use std::process::Stdio;

use base64::Engine as _;
use peri_studio_proto::resource::{
    GitGroupId, InstanceBlob, InstanceResourcePayload, ResourceErrorCode, ResourceFailure,
};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::{change_id, parse_status, STATUS_ARGS};
use crate::resource::common::{failure, hash_bytes, map_io, validate_relative};
use crate::resource::ResourceHost;

const MAX_DIFF_BYTES: u64 = 8 * 1024 * 1024;

impl ResourceHost {
    pub(in crate::resource) async fn git_diff(
        &self,
        root: &str,
        expected_repo_id: &str,
        expected_change_id: &str,
        max_bytes: u64,
    ) -> Result<InstanceResourcePayload, ResourceFailure> {
        if expected_change_id.is_empty() || max_bytes == 0 || max_bytes > MAX_DIFF_BYTES {
            return Err(failure(ResourceErrorCode::InvalidRequest, false));
        }
        let (_, repo) = self.resolve_repo(root, expected_repo_id).await?;
        let status = self.git(&repo, STATUS_ARGS).await?;
        let generation = hash_bytes(&status);
        let parsed = parse_status(&status)?;
        let Some((change, group)) = parsed.changes.iter().find_map(|change| {
            change.groups.iter().find_map(|group| {
                (change_id(&generation, *group, &change.path) == expected_change_id)
                    .then_some((change, *group))
            })
        }) else {
            return Err(failure(ResourceErrorCode::VersionConflict, false));
        };
        validate_relative(&change.path)?;
        if let Some(original_path) = &change.original_path {
            validate_relative(original_path)?;
        }
        let bytes = self.run_diff(&repo, change, group, max_bytes).await?;
        Ok(InstanceResourcePayload::Blob(InstanceBlob {
            content_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
            content_type: "text/x-diff; charset=utf-8".into(),
            etag: hash_bytes(&bytes),
        }))
    }

    async fn run_diff(
        &self,
        repo: &std::path::Path,
        change: &super::ParsedChange,
        group: GitGroupId,
        max_bytes: u64,
    ) -> Result<Vec<u8>, ResourceFailure> {
        let mut command = Command::new("git");
        command.current_dir(repo).args([
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=3",
        ]);
        match group {
            GitGroupId::Index => {
                command.arg("--cached");
            }
            GitGroupId::Conflicts => {
                command.arg("--cc");
            }
            GitGroupId::Untracked => {
                command.arg("--no-index");
            }
            GitGroupId::WorkingTree => {}
        }
        command.arg("--");
        if group == GitGroupId::Untracked {
            command.arg(null_device());
        }
        command.arg(&change.path);
        if matches!(group, GitGroupId::Index | GitGroupId::WorkingTree)
            && change.status_for(group) == peri_studio_proto::resource::GitChangeStatus::Renamed
        {
            if let Some(original_path) = &change.original_path {
                command.arg(original_path);
            }
        }
        command
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
        let (status, bytes) = tokio::time::timeout(self.git_timeout, async move {
            let mut bytes = Vec::new();
            stdout
                .take(max_bytes + 1)
                .read_to_end(&mut bytes)
                .await
                .map_err(map_io)?;
            if bytes.len() as u64 > max_bytes {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(failure(ResourceErrorCode::ViewTooLarge, false));
            }
            let status = child.wait().await.map_err(map_io)?;
            Ok((status, bytes))
        })
        .await
        .map_err(|_| failure(ResourceErrorCode::Timeout, true))??;
        let expected_no_index_difference =
            group == GitGroupId::Untracked && status.code() == Some(1);
        if !status.success() && !expected_no_index_difference {
            return Err(failure(ResourceErrorCode::Unavailable, false));
        }
        Ok(bytes)
    }
}

#[cfg(unix)]
fn null_device() -> &'static str {
    "/dev/null"
}

#[cfg(windows)]
fn null_device() -> &'static str {
    "NUL"
}
