//! instance 侧远程文件系统与 Git 查询深模块。
//!
//! 所有路径以 server 传入的可信 workspace root 为锚；浏览器相对路径不得
//! 越过 root。Git 仅通过固定 argv 执行并输出结构化 DTO，不暴露 stdout。

#[path = "resource_common.rs"]
mod common;
#[path = "resource_fs.rs"]
mod fs;
#[path = "resource_git.rs"]
mod git;

use std::time::Duration;

use peri_studio_proto::resource::{
    InstanceResourceQuery, InstanceResourceQueryKind, InstanceResourceResult, ResourceErrorCode,
};

use common::failure;
use fs::{read_directory, read_file};

const GIT_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone)]
pub struct ResourceHost {
    pub(super) git_timeout: Duration,
}

impl Default for ResourceHost {
    fn default() -> Self {
        Self {
            git_timeout: GIT_TIMEOUT,
        }
    }
}

impl ResourceHost {
    pub async fn query(&self, query: InstanceResourceQuery) -> InstanceResourceResult {
        let request_id = query.request_id;
        let result = match query.query {
            InstanceResourceQueryKind::ReadDirectory(input) => {
                let root = query.root;
                tokio::task::spawn_blocking(move || read_directory(&root, input))
                    .await
                    .unwrap_or_else(|_| Err(failure(ResourceErrorCode::Unavailable, true)))
            }
            InstanceResourceQueryKind::ReadFile(input) => {
                let root = query.root;
                tokio::task::spawn_blocking(move || read_file(&root, input))
                    .await
                    .unwrap_or_else(|_| Err(failure(ResourceErrorCode::Unavailable, true)))
            }
            InstanceResourceQueryKind::DiscoverRepositories(_) => {
                self.discover_repositories(&query.root).await
            }
            InstanceResourceQueryKind::GitSnapshot(input) => {
                self.git_snapshot(&query.root, &input.repo_id).await
            }
            InstanceResourceQueryKind::GitChanges(input) => {
                self.git_changes(
                    &query.root,
                    &input.repo_id,
                    input.group_id,
                    input.cursor.as_deref(),
                    input.limit,
                )
                .await
            }
            InstanceResourceQueryKind::GitMutate(input) => {
                self.git_mutate(
                    &query.root,
                    &input.repo_id,
                    input.action,
                    &input.paths,
                    input.expected_generation.as_deref(),
                )
                .await
            }
        };
        match result {
            Ok(result) => InstanceResourceResult {
                request_id,
                result: Some(result),
                error: None,
            },
            Err(error) => InstanceResourceResult {
                request_id,
                result: None,
                error: Some(error),
            },
        }
    }
}

#[cfg(test)]
#[path = "resource_test.rs"]
mod resource_test;
