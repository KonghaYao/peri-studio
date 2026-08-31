//! metadata 命令的预校验段（review #2 结构拆分）：submit 入口在
//! `begin_command_with_activation` 前对 10 个 ActionEnvelope 变体做权威
//! catalog 校验——被拒绝的请求不得留下 in-progress 去重行。
//!
//! 本文件是 [`MetadataCommandProcessor`] 的实现段；字段经 `pub(super)` 在
//! channel 模块内共享（结构拆分，行为语义不变）。

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::ActionEnvelope;

use crate::channel::metadata_command_processor::MetadataCommandProcessor;
use crate::control::ProjectService;
use crate::persist::metadata::ProjectRecord;
use crate::protocol::validate_cwd;

use super::command_coordinator::{action_error, SubmitAck};

/// 预校验产物（submit 后续 hint/activate 计算与 action 执行使用）。
pub(super) struct PreparedValidation {
    pub prepared_create: Option<ProjectRecord>,
    /// 元组顺序：(project, acp_session_id, live_chat)。
    pub prepared_open: Option<(ProjectRecord, String, Option<String>)>,
}

impl MetadataCommandProcessor {
    /// 预校验（§4.4 纪律：校验先于保留 commandId 去重行）。
    #[allow(clippy::result_large_err)]
    pub(super) async fn validate(
        &self,
        projects: &ProjectService,
        action: &ActionEnvelope,
    ) -> Result<PreparedValidation, SubmitAck> {
        let command_id = super::command_coordinator::extract_command_id(action).unwrap_or_default();
        let mut prepared_create = None;
        let mut prepared_open = None;
        match action {
            ActionEnvelope::ProjectCreate { payload, .. } => {
                if let Err(e) = validate_cwd(&payload.cwd) {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        &format!("invalid cwd: {e}"),
                        false,
                    )));
                }
                if !std::path::Path::new(&payload.cwd).is_dir() {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "cwd not found",
                        false,
                    )));
                }
            }
            ActionEnvelope::ProjectArchive { payload, .. } => {
                let project_exists = matches!(projects.metadata().project(&payload.project_id).await, Ok(Some(ref p)) if p.archived_at.is_none());
                if !project_exists {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "project not found or archived",
                        false,
                    )));
                }
                if self.chats.has_live_workspace(&payload.project_id).await {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "project has a running session; close it before archiving",
                        false,
                    )));
                }
            }
            ActionEnvelope::ProjectRestore { payload, .. } => {
                if !matches!(projects.metadata().project(&payload.project_id).await, Ok(Some(ref p)) if p.archived_at.is_some())
                {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "archived project not found",
                        false,
                    )));
                }
            }
            ActionEnvelope::ProjectRename { payload, .. } => {
                if payload.name.trim().is_empty()
                    || !matches!(projects.metadata().project(&payload.project_id).await, Ok(Some(ref p)) if p.archived_at.is_none())
                {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "active project not found or name empty",
                        false,
                    )));
                }
            }
            ActionEnvelope::PersistedSessionRename { payload, .. } => {
                if payload.name.trim().is_empty()
                    || projects.catalog().get(&payload.session_id).await.is_none()
                {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "session not found or name empty",
                        false,
                    )));
                }
            }
            ActionEnvelope::PersistedSessionArchive { payload, .. } => {
                if projects.catalog().get(&payload.session_id).await.is_none() {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "active session not found",
                        false,
                    )));
                }
                if self.chats.has_live_acp_session(&payload.session_id).await {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "session has a running instance; close it before archiving",
                        false,
                    )));
                }
            }
            ActionEnvelope::PersistedSessionRestore { payload, .. } => {
                let Some(session) = projects.catalog().get(&payload.session_id).await else {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "archived session or active project not found",
                        false,
                    )));
                };
                if !matches!(projects.metadata().project(&session.project_id).await, Ok(Some(ref project)) if project.archived_at.is_none())
                {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "archived session or active project not found",
                        false,
                    )));
                }
            }
            ActionEnvelope::PersistedSessionImport { payload, .. } => {
                let Some(project) = projects
                    .metadata()
                    .project(&payload.project_id)
                    .await
                    .ok()
                    .flatten()
                    .filter(|p| p.archived_at.is_none())
                else {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "project not found or archived",
                        false,
                    )));
                };
                let candidate = self
                    .chats
                    .registry()
                    .list_legacy_sessions()
                    .await
                    .ok()
                    .and_then(|items| {
                        items.into_iter().find(|s| {
                            s.session_id == payload.acp_session_id && s.cwd == project.cwd
                        })
                    });
                if candidate.is_none() {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "ACP session is not available for this project",
                        false,
                    )));
                }
            }
            ActionEnvelope::PersistedSessionCreate { payload, .. } => {
                let Some(project) = projects
                    .metadata()
                    .project(&payload.project_id)
                    .await
                    .ok()
                    .flatten()
                    .filter(|p| p.archived_at.is_none())
                else {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "project not found or archived",
                        false,
                    )));
                };
                prepared_create = Some(project);
            }
            ActionEnvelope::PersistedSessionOpen { payload, .. } => {
                let acp_id = payload.session_id.trim();
                let Some(session) = projects.catalog().get(acp_id).await else {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "session not found",
                        false,
                    )));
                };
                if session.lifecycle == "activating" {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "session activation in progress",
                        false,
                    )));
                }
                let Some(project) = projects
                    .metadata()
                    .project(&session.project_id)
                    .await
                    .ok()
                    .flatten()
                    .filter(|p| p.archived_at.is_none())
                else {
                    return Err(SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "project not found or archived",
                        false,
                    )));
                };
                let live_chat = if let Some(chat) = self.chats.resolve(acp_id).await {
                    self.chats
                        .entry(&chat)
                        .await
                        .filter(|entry| {
                            !entry.state.is_terminal()
                                && entry.runtime_confirmed
                                && entry.session_id.as_deref() == Some(acp_id)
                        })
                        .map(|_| chat)
                } else {
                    None
                };
                prepared_open = Some((project, acp_id.to_string(), live_chat));
            }
            _ => unreachable!("dispatch guarantees metadata action"),
        }
        Ok(PreparedValidation {
            prepared_create,
            prepared_open,
        })
    }
}
