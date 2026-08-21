//! metadata 命令的 session 系 action 执行段（review #2 结构拆分）：
//! PersistedSessionRename/Archive/Restore/Import 的编排 + Create/Open 的
//! 激活入口（激活本体在 `metadata_activation.rs`）。公共序列（校验 →
//! payload_hash → BeginCommand 去重 → accepted ack）在 submit 入口。
//!
//! 本文件是 [`MetadataCommandProcessor`] 的实现段（结构拆分，行为语义
//! 不变）。

use peri_studio_proto::ack::{AckStatus, ErrorCode};
use uuid::Uuid;

use crate::channel::metadata_activation::PersistedActivation;
use crate::channel::metadata_command_processor::{
    MetadataCommand, MetadataCommandProcessor, MetadataRuntimePort,
};
use crate::control::{ProjectService, ProjectServiceError};
use crate::persist::metadata::{MetadataError, ProjectRecord, ProjectSessionRecord};

use super::command_coordinator::{action_error, SubmitAck};

impl MetadataCommandProcessor {
    /// PersistedSessionRename：重命名会话元数据（保持 identity）→
    /// `projection_pending` → reproject → `committed` → committed ack；
    /// 失败落 reconciliation_required。
    pub(super) async fn submit_session_rename(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        command_id: &str,
        session_id: &str,
        name: &str,
    ) -> SubmitAck {
        if name.trim().is_empty()
            || projects
                .rename_session_metadata(session_id, name.trim())
                .await
                .is_err()
        {
            let _ = projects
                .metadata()
                .update_command(
                    command_id,
                    "reconciliation_required",
                    None,
                    Some(session_id),
                    None,
                    None,
                    Some("rename_projection_failed"),
                )
                .await;
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "session rename requires reconciliation",
                false,
            )
            .await;
            return SubmitAck::Handled;
        }
        let rec = projects.metadata().session(session_id).await.ok().flatten();
        let project_id = rec.as_ref().map(|r| r.project_id.clone());
        let acp_session_id = rec.as_ref().and_then(|r| r.acp_session_id.clone());
        if projects
            .metadata()
            .update_command(
                command_id,
                "projection_pending",
                project_id.as_deref(),
                Some(session_id),
                None,
                acp_session_id.as_deref(),
                None,
            )
            .await
            .is_err()
        {
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "session rename projection state failed",
                true,
            )
            .await;
            return SubmitAck::Handled;
        }
        if projects.reproject().await.is_err() {
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "session rename projection pending",
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
                project_id.as_deref(),
                Some(session_id),
                None,
                acp_session_id.as_deref(),
                None,
            )
            .await
            .is_err()
        {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::AgentUnavailable,
                "session rename finalize failed",
                true,
            ));
        }
        self.send_metadata_ack(
            cmd,
            AckStatus::Committed,
            project_id.as_deref(),
            Some(session_id),
            None,
            acp_session_id,
        )
        .await;
        SubmitAck::Handled
    }

    /// PersistedSessionArchive/Restore：生命周期变更（归档/恢复）→ 投影
    /// 屏障 → committed ack；InvalidState 类变更错误落 `failed`（确定语义），
    /// 其余落 reconciliation_required。
    pub(super) async fn submit_session_archive_or_restore(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        command_id: &str,
        session_id: &str,
        archive: bool,
    ) -> SubmitAck {
        let mutation = if archive {
            projects.archive_session_metadata(session_id).await
        } else {
            projects.restore_session_metadata(session_id).await
        };
        let rec = projects.metadata().session(session_id).await.ok().flatten();
        let project_id = rec.as_ref().map(|record| record.project_id.as_str());
        let acp_id = rec
            .as_ref()
            .and_then(|record| record.acp_session_id.as_deref());
        if matches!(
            &mutation,
            Err(ProjectServiceError::Metadata(
                MetadataError::InvalidState(_)
                    | MetadataError::NotFound(_)
                    | MetadataError::Conflict(_)
            ))
        ) {
            let _ = projects
                .metadata()
                .update_command(
                    command_id,
                    "failed",
                    project_id,
                    Some(session_id),
                    None,
                    acp_id,
                    Some("invalid_state"),
                )
                .await;
            self.send_error(
                cmd,
                ErrorCode::InvalidState,
                "session lifecycle changed before mutation",
                false,
            )
            .await;
            return SubmitAck::Handled;
        }
        if mutation.is_err()
            || projects
                .metadata()
                .update_command(
                    command_id,
                    "projection_pending",
                    project_id,
                    Some(session_id),
                    None,
                    acp_id,
                    None,
                )
                .await
                .is_err()
        {
            let error = if archive {
                "session_archive_projection_failed"
            } else {
                "session_restore_projection_failed"
            };
            let _ = projects
                .metadata()
                .update_command(
                    command_id,
                    "reconciliation_required",
                    project_id,
                    Some(session_id),
                    None,
                    acp_id,
                    Some(error),
                )
                .await;
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "session lifecycle change requires reconciliation",
                false,
            )
            .await;
            return SubmitAck::Handled;
        }
        if projects.reproject().await.is_err() {
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "session lifecycle projection pending",
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
                project_id,
                Some(session_id),
                None,
                acp_id,
                None,
            )
            .await
            .is_err()
        {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::AgentUnavailable,
                "session lifecycle command finalize failed",
                true,
            ));
        }
        self.send_metadata_ack(
            cmd,
            AckStatus::Committed,
            project_id,
            Some(session_id),
            None,
            acp_id.map(str::to_string),
        )
        .await;
        SubmitAck::Handled
    }

    /// PersistedSessionImport：legacy session（Registry 列表）显式导入为
    /// 逻辑会话（UUID v5 确定性 id）→ 投影屏障 → committed ack。
    pub(super) async fn submit_session_import(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        command_id: &str,
        project_id: &str,
        acp_session_id: &str,
    ) -> SubmitAck {
        let Some(project) = projects.metadata().project(project_id).await.ok().flatten() else {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::InvalidState,
                "project not found",
                false,
            ));
        };
        let candidate = self
            .chats
            .registry()
            .list_legacy_sessions()
            .await
            .ok()
            .and_then(|items| {
                items
                    .into_iter()
                    .find(|s| s.session_id == acp_session_id && s.cwd == project.cwd)
            });
        let Some(candidate) = candidate else {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::InvalidState,
                "ACP session disappeared before import",
                false,
            ));
        };
        let logical_id = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!("peri-studio:imported-session:{}", candidate.session_id).as_bytes(),
        )
        .to_string();
        let imported = projects
            .metadata()
            .import_explicit_session(
                &logical_id,
                &project.id,
                &candidate.session_id,
                &candidate.title,
                &candidate.updated_at,
            )
            .await;
        let Ok(imported) = imported else {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::AgentUnavailable,
                "session import persist failed",
                true,
            ));
        };
        if projects
            .metadata()
            .update_command(
                command_id,
                "projection_pending",
                Some(&project.id),
                Some(&imported.id),
                None,
                Some(&candidate.session_id),
                None,
            )
            .await
            .is_err()
            || projects.reproject().await.is_err()
            || projects
                .metadata()
                .update_command(
                    command_id,
                    "committed",
                    Some(&project.id),
                    Some(&imported.id),
                    None,
                    Some(&candidate.session_id),
                    None,
                )
                .await
                .is_err()
        {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::AgentUnavailable,
                "session import commit failed",
                true,
            ));
        }
        self.send_metadata_ack(
            cmd,
            AckStatus::Committed,
            Some(&project.id),
            Some(&imported.id),
            None,
            Some(candidate.session_id),
        )
        .await;
        SubmitAck::Handled
    }

    /// PersistedSessionCreate：预生成逻辑会话 id（prepared_create）→
    /// 持久化激活（spawn + initialize + session/load，经 runtime submit）。
    pub(super) async fn submit_session_create<R: MetadataRuntimePort>(
        &self,
        runtime: R,
        cmd: MetadataCommand,
        projects: ProjectService,
        prepared: (ProjectRecord, String),
        title: Option<String>,
    ) -> SubmitAck {
        let (project, session_id) = prepared;
        self.spawn_persisted_activation(
            runtime,
            PersistedActivation {
                cmd,
                projects,
                project,
                session_id,
                title,
                acp_id: None,
            },
        );
        SubmitAck::Handled
    }

    /// PersistedSessionOpen：复用已确认存活的 runtime（live_chat）直接
    /// committed；否则持久化激活（spawn + session/load 恢复）。
    pub(super) async fn submit_session_open<R: MetadataRuntimePort>(
        &self,
        runtime: R,
        cmd: MetadataCommand,
        projects: ProjectService,
        command_id: &str,
        prepared: (ProjectRecord, ProjectSessionRecord, Option<String>),
    ) -> SubmitAck {
        let (project, session, live_chat) = prepared;
        let acp_id = session.acp_session_id.clone().expect("validated ACP id");
        if let Some(chat) = live_chat.as_deref() {
            if projects
                .metadata()
                .record_session_runtime(&session.id, chat)
                .await
                .is_err()
                || projects
                    .metadata()
                    .update_command(
                        command_id,
                        "committed",
                        Some(&session.project_id),
                        Some(&session.id),
                        Some(chat),
                        Some(&acp_id),
                        None,
                    )
                    .await
                    .is_err()
            {
                return SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::AgentUnavailable,
                    "session open finalize failed",
                    true,
                ));
            }
            self.send_metadata_ack(
                &cmd,
                AckStatus::Committed,
                Some(&session.project_id),
                Some(&session.id),
                Some(chat),
                Some(acp_id),
            )
            .await;
            return SubmitAck::Handled;
        }
        self.spawn_persisted_activation(
            runtime,
            PersistedActivation {
                cmd,
                projects,
                project,
                session_id: session.id,
                title: session.acp_title,
                acp_id: Some(acp_id),
            },
        );
        SubmitAck::Handled
    }
}
