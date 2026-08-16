//! metadata 命令的 project 系 action 执行段（review #2 结构拆分）：
//! ProjectCreate/ProjectArchive/ProjectRestore/ProjectRename 的编排——
//! SQLite 变更 → `projection_pending` → Registry 投影屏障（reproject）→
//! `committed` → committed ack；失败路径落 `reconciliation_required`（可
//! 恢复，不静默）。
//!
//! 本文件是 [`MetadataCommandProcessor`] 的实现段；公共发送 helper
//! （`send_metadata_ack`/`send_error`）与去重组合子（`begin_durable`）在
//! 主文件（结构拆分，行为语义不变）。

use peri_studio_proto::ack::{AckStatus, ErrorCode};
use peri_studio_proto::action::ProjectCreatePayload;
use uuid::Uuid;

use crate::channel::metadata_command_processor::{MetadataCommand, MetadataCommandProcessor};
use crate::control::ProjectService;

use super::command_coordinator::{action_error, SubmitAck};
use super::DEFAULT_INSTANCE_ID;

impl MetadataCommandProcessor {
    /// ProjectCreate：本地 id 生成（server 权威）→ 元数据持久化 → 投影
    /// 屏障（update_command projection_pending → reproject → committed）→
    /// 旧 workspace 镜像兼容（mirror_legacy_workspace）→ committed ack。
    pub(super) async fn submit_project_create(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        command_id: &str,
        payload: &ProjectCreatePayload,
    ) -> SubmitAck {
        let id = Uuid::new_v4().to_string();
        let name = if payload.name.trim().is_empty() {
            std::path::Path::new(&payload.cwd)
                .file_name()
                .map(|v| v.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Project".into())
        } else {
            payload.name.trim().to_string()
        };
        let instance = payload
            .instance_id
            .as_deref()
            .unwrap_or(DEFAULT_INSTANCE_ID);
        match projects
            .create_project_metadata(&id, &name, &payload.cwd, instance)
            .await
        {
            Ok(p) => {
                if projects
                    .metadata()
                    .update_command(
                        command_id,
                        "projection_pending",
                        Some(&id),
                        None,
                        None,
                        None,
                        None,
                    )
                    .await
                    .is_err()
                    || projects.reproject().await.is_err()
                    || projects.mirror_legacy_workspace(&p).await.is_err()
                    || projects
                        .metadata()
                        .update_command(
                            command_id,
                            "committed",
                            Some(&id),
                            None,
                            None,
                            None,
                            None,
                        )
                        .await
                        .is_err()
                {
                    let _ = projects
                        .metadata()
                        .update_command(
                            command_id,
                            "reconciliation_required",
                            Some(&id),
                            None,
                            None,
                            None,
                            Some("project_projection_or_finalize_failed"),
                        )
                        .await;
                    return SubmitAck::Failed(action_error(
                        command_id.to_string(),
                        ErrorCode::AgentUnavailable,
                        "project commit barrier failed",
                        true,
                    ));
                }
                self.send_metadata_ack(
                    cmd,
                    AckStatus::Committed,
                    Some(&id),
                    None,
                    None,
                    None,
                )
                .await;
            }
            Err(_) => {
                let _ = projects
                    .metadata()
                    .update_command(
                        command_id,
                        "reconciliation_required",
                        Some(&id),
                        None,
                        None,
                        None,
                        Some("project_persist_or_projection_failed"),
                    )
                    .await;
                self.send_error(
                    cmd,
                    ErrorCode::DeliveryUnknown,
                    "project persist/projection failed",
                    false,
                )
                .await;
            }
        }
        SubmitAck::Handled
    }

    /// ProjectArchive：归档元数据 → `projection_pending` → reproject →
    /// `committed` → committed ack；失败落 reconciliation_required。
    pub(super) async fn submit_project_archive(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        command_id: &str,
        project_id: &str,
    ) -> SubmitAck {
        if projects
            .archive_project_metadata(project_id)
            .await
            .is_err()
            || projects
                .metadata()
                .update_command(
                    command_id,
                    "projection_pending",
                    Some(project_id),
                    None,
                    None,
                    None,
                    None,
                )
                .await
                .is_err()
        {
            let _ = projects
                .metadata()
                .update_command(
                    command_id,
                    "reconciliation_required",
                    Some(project_id),
                    None,
                    None,
                    None,
                    Some("archive_projection_failed"),
                )
                .await;
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "project archive requires reconciliation",
                false,
            )
            .await;
            return SubmitAck::Handled;
        }
        if projects.reproject().await.is_err() {
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "project archive projection pending",
                true,
            )
            .await;
            return SubmitAck::Handled;
        }
        if projects
            .metadata()
            .update_command(
                command_id,
                "committed",
                Some(project_id),
                None,
                None,
                None,
                None,
            )
            .await
            .is_err()
        {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::AgentUnavailable,
                "project command finalize failed",
                true,
            ));
        }
        self.send_metadata_ack(cmd, AckStatus::Committed, Some(project_id), None, None, None)
            .await;
        SubmitAck::Handled
    }

    /// ProjectRestore：与 archive 对称（恢复归档项目）；投影屏障同款。
    pub(super) async fn submit_project_restore(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        command_id: &str,
        project_id: &str,
    ) -> SubmitAck {
        if projects
            .restore_project_metadata(project_id)
            .await
            .is_err()
            || projects
                .metadata()
                .update_command(
                    command_id,
                    "projection_pending",
                    Some(project_id),
                    None,
                    None,
                    None,
                    None,
                )
                .await
                .is_err()
        {
            let _ = projects
                .metadata()
                .update_command(
                    command_id,
                    "reconciliation_required",
                    Some(project_id),
                    None,
                    None,
                    None,
                    Some("restore_projection_failed"),
                )
                .await;
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "project restore requires reconciliation",
                false,
            )
            .await;
            return SubmitAck::Handled;
        }
        if projects.reproject().await.is_err() {
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "project restore projection pending",
                true,
            )
            .await;
            return SubmitAck::Handled;
        }
        if projects
            .metadata()
            .update_command(
                command_id,
                "committed",
                Some(project_id),
                None,
                None,
                None,
                None,
            )
            .await
            .is_err()
        {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::AgentUnavailable,
                "project command finalize failed",
                true,
            ));
        }
        self.send_metadata_ack(cmd, AckStatus::Committed, Some(project_id), None, None, None)
            .await;
        SubmitAck::Handled
    }

    /// ProjectRename：重命名元数据（保持 identity 不变）→ 投影屏障 →
    /// committed ack；失败落 reconciliation_required。
    pub(super) async fn submit_project_rename(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        command_id: &str,
        project_id: &str,
        name: &str,
    ) -> SubmitAck {
        if projects
            .rename_project_metadata(project_id, name.trim())
            .await
            .is_err()
            || projects
                .metadata()
                .update_command(
                    command_id,
                    "projection_pending",
                    Some(project_id),
                    None,
                    None,
                    None,
                    None,
                )
                .await
                .is_err()
        {
            let _ = projects
                .metadata()
                .update_command(
                    command_id,
                    "reconciliation_required",
                    Some(project_id),
                    None,
                    None,
                    None,
                    Some("project_rename_projection_failed"),
                )
                .await;
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "project rename requires reconciliation",
                false,
            )
            .await;
            return SubmitAck::Handled;
        }
        if projects.reproject().await.is_err() {
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "project rename projection pending",
                true,
            )
            .await;
            return SubmitAck::Handled;
        }
        if projects
            .metadata()
            .update_command(
                command_id,
                "committed",
                Some(project_id),
                None,
                None,
                None,
                None,
            )
            .await
            .is_err()
        {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::AgentUnavailable,
                "project command finalize failed",
                true,
            ));
        }
        self.send_metadata_ack(cmd, AckStatus::Committed, Some(project_id), None, None, None)
            .await;
        SubmitAck::Handled
    }
}
