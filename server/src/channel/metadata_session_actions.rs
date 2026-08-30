//! metadata 命令的 session 系 action 执行段（review #2 结构拆分）：
//! PersistedSessionRename/Archive/Restore/Import 的编排 + Create/Open 的
//! 激活入口（激活本体在 `metadata_activation.rs`）。公共序列（校验 →
//! payload_hash → BeginCommand 去重 → accepted ack）在 submit 入口。
//!
//! 本文件是 [`MetadataCommandProcessor`] 的实现段（结构拆分，行为语义
//! 不变）。

use peri_studio_proto::ack::{AckStatus, ErrorCode};

use crate::channel::metadata_activation::PersistedActivation;
use crate::channel::metadata_command_processor::{
    MetadataCommand, MetadataCommandProcessor, MetadataRuntimePort,
};
use crate::control::{CatalogSession, ProjectService};
use crate::persist::metadata::ProjectRecord;

use super::command_coordinator::{action_error, SubmitAck};

impl MetadataCommandProcessor {
    /// PersistedSessionRename：自定义名称写入 SQLite `catalog_session_prefs`，
    /// 经 Registry 投影广播给所有客户端。
    pub(super) async fn submit_session_rename(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        command_id: &str,
        session_id: &str,
        name: &str,
    ) -> SubmitAck {
        let Some(session) = projects.catalog().get(session_id).await else {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::InvalidState,
                "session not found",
                false,
            ));
        };
        if projects
            .rename_session_metadata(&session.project_id, session_id, name)
            .await
            .is_err()
            || projects
                .metadata()
                .update_command(
                    command_id,
                    "projection_pending",
                    Some(&session.project_id),
                    Some(session_id),
                    None,
                    Some(session_id),
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
                    Some(&session.project_id),
                    Some(session_id),
                    None,
                    Some(session_id),
                    Some("session_rename_projection_failed"),
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
                Some(&session.project_id),
                Some(session_id),
                None,
                Some(session_id),
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
            Some(&session.project_id),
            Some(session_id),
            None,
            Some(session_id.to_string()),
        )
        .await;
        SubmitAck::Handled
    }

    /// PersistedSessionArchive/Restore：导航归档写入 SQLite，Registry 投影
    /// `archived_at`；不触碰 ACP durable thread。
    pub(super) async fn submit_session_archive_or_restore(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        command_id: &str,
        session_id: &str,
        archive: bool,
    ) -> SubmitAck {
        let Some(session) = projects.catalog().get(session_id).await else {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::InvalidState,
                "session not found",
                false,
            ));
        };
        let persist = if archive {
            projects
                .archive_session_metadata(&session.project_id, session_id)
                .await
        } else {
            projects
                .restore_session_metadata(&session.project_id, session_id)
                .await
        };
        if persist.is_err()
            || projects
                .metadata()
                .update_command(
                    command_id,
                    "projection_pending",
                    Some(&session.project_id),
                    Some(session_id),
                    None,
                    Some(session_id),
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
                    Some(&session.project_id),
                    Some(session_id),
                    None,
                    Some(session_id),
                    Some("session_lifecycle_projection_failed"),
                )
                .await;
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "session lifecycle command requires reconciliation",
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
                Some(&session.project_id),
                Some(session_id),
                None,
                Some(session_id),
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
            Some(&session.project_id),
            Some(session_id),
            None,
            Some(session_id.to_string()),
        )
        .await;
        SubmitAck::Handled
    }

    /// PersistedSessionImport：list 已包含的会话无需 server 侧导入；保留
    /// action 作兼容 duplicate ack。
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
        if projects.catalog().get(acp_session_id).await.is_none() {
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
            projects
                .upsert_catalog_session(CatalogSession {
                    acp_session_id: acp_session_id.to_string(),
                    project_id: project.id.clone(),
                    title: candidate.title,
                    updated_at: candidate.updated_at,
                    status: "ready".into(),
                    lifecycle: "ready".into(),
                    last_opened_at: None,
                    hub_title: None,
                })
                .await
                .ok();
        }
        if projects
            .metadata()
            .update_command(
                command_id,
                "committed",
                Some(&project.id),
                Some(acp_session_id),
                None,
                Some(acp_session_id),
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
            Some(acp_session_id),
            None,
            Some(acp_session_id.to_string()),
        )
        .await;
        SubmitAck::Handled
    }

    /// PersistedSessionCreate：在 project cwd 上 `session/new`；committed
    /// ack 的 `sessionId` = 新 ACP id。
    pub(super) async fn submit_session_create<R: MetadataRuntimePort>(
        &self,
        runtime: R,
        cmd: MetadataCommand,
        projects: ProjectService,
        project: ProjectRecord,
        title: Option<String>,
    ) -> SubmitAck {
        self.spawn_persisted_activation(
            runtime,
            PersistedActivation {
                cmd,
                projects,
                project,
                title,
                acp_id: None,
            },
        );
        SubmitAck::Handled
    }

    /// PersistedSessionOpen：复用已确认存活的 runtime（binding resolve）直接
    /// committed；否则持久化激活（spawn + session/load 恢复）。
    pub(super) async fn submit_session_open<R: MetadataRuntimePort>(
        &self,
        runtime: R,
        cmd: MetadataCommand,
        projects: ProjectService,
        command_id: &str,
        prepared: (ProjectRecord, String, Option<String>),
    ) -> SubmitAck {
        let (project, acp_id, live_chat) = prepared;
        if let Some(chat) = live_chat.as_deref() {
            if projects
                .metadata()
                .update_command(
                    command_id,
                    "committed",
                    Some(&project.id),
                    Some(&acp_id),
                    Some(chat),
                    Some(&acp_id),
                    None,
                )
                .await
                .is_err()
                || projects.record_opened_session(&acp_id).await.is_err()
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
                Some(&project.id),
                Some(&acp_id),
                Some(chat),
                Some(acp_id.clone()),
            )
            .await;
            return SubmitAck::Handled;
        }
        let title = projects
            .catalog()
            .get(&acp_id)
            .await
            .map(|session| session.title);
        self.spawn_persisted_activation(
            runtime,
            PersistedActivation {
                cmd,
                projects,
                project,
                title,
                acp_id: Some(acp_id),
            },
        );
        SubmitAck::Handled
    }
}
