//! 持久化 project/session 元数据命令编排（review #2 结构拆分）。
//!
//! 深模块职责：校验、commandId 去重（`begin_command_with_activation`）、
//! SQLite 变更、Registry 投影屏障与持久化会话运行时激活。
//!
//! 结构：`submit` 入口负责公共序列「command_id/payload_hash 校验 →
//! 权威 catalog 预校验（`metadata_validation.rs`）→ BeginCommand 去重 →
//! accepted ack → 按 action 分发」；各 action 编排下沉到
//! `metadata_project_actions.rs` / `metadata_session_actions.rs`；持久化
//! 激活在 `metadata_activation.rs`。

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use peri_studio_proto::ack::{AckStatus, ActionAck, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::frame::Frame;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use crate::auth::audit::audit;
use crate::auth::ConnectionCtx;
use crate::channel::broadcaster::OutboundMsg;
use crate::control::{ChatRegistry, ProjectService};
use crate::persist::metadata::{payload_hash, BeginCommand, MetadataError};

use super::command_coordinator::{action_error, extract_command_id, SubmitAck};

pub(super) trait MetadataRuntimePort: Clone + Send + Sync + 'static {
    fn submit_runtime<'a>(
        &'a self,
        ctx: &'a ConnectionCtx,
        action: ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> Pin<Box<dyn Future<Output = SubmitAck> + Send + 'a>>;
}

#[derive(Clone)]
pub(super) struct MetadataCommandProcessor {
    pub(super) projects: Arc<RwLock<Option<ProjectService>>>,
    pub(super) chats: ChatRegistry,
}

#[derive(Clone)]
pub(super) struct MetadataCommand {
    pub ctx: ConnectionCtx,
    pub action: ActionEnvelope,
    pub tx: mpsc::Sender<OutboundMsg>,
}

impl MetadataCommandProcessor {
    pub fn new(projects: Arc<RwLock<Option<ProjectService>>>, chats: ChatRegistry) -> Self {
        Self { projects, chats }
    }

    /// 提交入口：公共序列（校验 → payload_hash → BeginCommand 去重 →
    /// accepted ack → 按 action 分发）；被拒绝的请求不得留下 in-progress
    /// 去重行。
    pub async fn submit<R: MetadataRuntimePort>(
        &self,
        runtime: R,
        ctx: &ConnectionCtx,
        action: ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> SubmitAck {
        let command_id = extract_command_id(&action).unwrap_or_default();
        if Uuid::parse_str(&command_id).is_err() {
            return SubmitAck::Failed(action_error(
                command_id,
                ErrorCode::InvalidState,
                "invalid commandId",
                false,
            ));
        }
        let Some(projects) = self.projects.read().await.clone() else {
            return SubmitAck::Failed(action_error(
                command_id,
                ErrorCode::AgentUnavailable,
                "metadata catalog unavailable",
                true,
            ));
        };
        let hash = match payload_hash(&action) {
            Ok(v) => v,
            Err(_) => {
                return SubmitAck::Failed(action_error(
                    command_id,
                    ErrorCode::InvalidState,
                    "invalid metadata payload",
                    false,
                ))
            }
        };
        // Validate against the authoritative catalog before reserving the
        // command id. A rejected request must not leave an in-progress dedup row.
        let prepared = match self.validate(&projects, &action).await {
            Ok(prepared) => prepared,
            Err(ack) => return ack,
        };
        let PreparedValidation {
            prepared_create,
            prepared_open,
        } = prepared;
        let (project_hint, session_hint) = match &action {
            ActionEnvelope::ProjectArchive { payload, .. }
            | ActionEnvelope::ProjectRestore { payload, .. } => {
                (Some(payload.project_id.as_str()), None)
            }
            ActionEnvelope::ProjectRename { payload, .. } => {
                (Some(payload.project_id.as_str()), None)
            }
            ActionEnvelope::PersistedSessionCreate { payload, .. } => {
                (Some(payload.project_id.as_str()), None)
            }
            ActionEnvelope::PersistedSessionOpen { payload, .. } => {
                (None, Some(payload.session_id.as_str()))
            }
            ActionEnvelope::PersistedSessionRename { payload, .. } => {
                (None, Some(payload.session_id.as_str()))
            }
            ActionEnvelope::PersistedSessionArchive { payload, .. }
            | ActionEnvelope::PersistedSessionRestore { payload, .. } => {
                (None, Some(payload.session_id.as_str()))
            }
            ActionEnvelope::PersistedSessionImport { payload, .. } => {
                (Some(payload.project_id.as_str()), None)
            }
            _ => (None, None),
        };
        let new_session = None;
        let activate = prepared_open
            .as_ref()
            .and_then(|(_, acp_id, live)| live.is_none().then_some(acp_id.as_str()));
        match projects
            .metadata()
            .begin_command_with_activation(
                &command_id,
                action.type_str(),
                &hash,
                project_hint,
                session_hint.or_else(|| prepared_open.as_ref().map(|(_, acp, _)| acp.as_str())),
                new_session,
                activate,
            )
            .await
        {
            Ok(BeginCommand::Existing) => match projects.metadata().command(&command_id).await {
                Ok(Some(c)) if c.phase == "committed" => {
                    return SubmitAck::Duplicate(ActionAck {
                        command_id,
                        status: AckStatus::Duplicate,
                        turn_id: None,
                        chat_id: c.chat_id,
                        project_id: c.project_id,
                        session_id: c.session_id,
                        acp_session_id: c.acp_session_id,
                        committed_projection_version: None,
                    })
                }
                Ok(Some(c)) if c.phase == "projection_pending" => {
                    if projects.reproject().await.is_err()
                        || projects
                            .metadata()
                            .update_command(
                                &command_id,
                                "committed",
                                c.project_id.as_deref(),
                                c.session_id.as_deref(),
                                c.chat_id.as_deref(),
                                c.acp_session_id.as_deref(),
                                None,
                            )
                            .await
                            .is_err()
                    {
                        return SubmitAck::Failed(action_error(
                            command_id,
                            ErrorCode::AgentUnavailable,
                            "metadata projection retry failed",
                            true,
                        ));
                    }
                    return SubmitAck::Duplicate(ActionAck {
                        command_id,
                        status: AckStatus::Duplicate,
                        turn_id: None,
                        chat_id: c.chat_id,
                        project_id: c.project_id,
                        session_id: c.session_id,
                        acp_session_id: c.acp_session_id,
                        committed_projection_version: None,
                    });
                }
                Ok(Some(c)) if c.phase == "reconciliation_required" => {
                    return SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "metadata command requires reconciliation",
                        false,
                    ))
                }
                Ok(Some(c)) if c.phase == "failed" => {
                    return SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        c.error_code.as_deref().unwrap_or("metadata command failed"),
                        false,
                    ))
                }
                Ok(_) => {
                    return SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::InvalidState,
                        "metadata command already in progress",
                        false,
                    ))
                }
                Err(_) => {
                    return SubmitAck::Failed(action_error(
                        command_id,
                        ErrorCode::AgentUnavailable,
                        "metadata command lookup failed",
                        true,
                    ))
                }
            },
            Err(MetadataError::Conflict(_)) => {
                return SubmitAck::Failed(action_error(
                    command_id,
                    ErrorCode::InvalidState,
                    "commandId reused with different payload",
                    false,
                ))
            }
            Err(_) => {
                return SubmitAck::Failed(action_error(
                    command_id,
                    ErrorCode::DeliveryUnknown,
                    "metadata command persist failed",
                    true,
                ))
            }
            Ok(BeginCommand::New) => {}
        }
        if tx
            .send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
                command_id: command_id.clone(),
                status: AckStatus::Accepted,
                turn_id: None,
                chat_id: None,
                project_id: None,
                session_id: None,
                acp_session_id: None,
                committed_projection_version: None,
            })))
            .await
            .is_err()
        {
            return SubmitAck::Handled;
        }
        let cmd = MetadataCommand {
            ctx: ctx.clone(),
            action: action.clone(),
            tx: tx.clone(),
        };
        match action {
            ActionEnvelope::ProjectCreate { payload, .. } => {
                self.submit_project_create(&cmd, &projects, &command_id, &payload)
                    .await
            }
            ActionEnvelope::ProjectArchive { payload, .. } => {
                self.submit_project_archive(&cmd, &projects, &command_id, &payload.project_id)
                    .await
            }
            ActionEnvelope::ProjectRestore { payload, .. } => {
                self.submit_project_restore(&cmd, &projects, &command_id, &payload.project_id)
                    .await
            }
            ActionEnvelope::ProjectRename { payload, .. } => {
                self.submit_project_rename(
                    &cmd,
                    &projects,
                    &command_id,
                    &payload.project_id,
                    &payload.name,
                )
                .await
            }
            ActionEnvelope::PersistedSessionRename { payload, .. } => {
                self.submit_session_rename(
                    &cmd,
                    &projects,
                    &command_id,
                    &payload.session_id,
                    &payload.name,
                )
                .await
            }
            ActionEnvelope::PersistedSessionArchive { payload, .. }
            | ActionEnvelope::PersistedSessionRestore { payload, .. } => {
                let archive = matches!(cmd.action, ActionEnvelope::PersistedSessionArchive { .. });
                self.submit_session_archive_or_restore(
                    &cmd,
                    &projects,
                    &command_id,
                    &payload.session_id,
                    archive,
                )
                .await
            }
            ActionEnvelope::PersistedSessionImport { payload, .. } => {
                self.submit_session_import(
                    &cmd,
                    &projects,
                    &command_id,
                    &payload.project_id,
                    &payload.acp_session_id,
                )
                .await
            }
            ActionEnvelope::PersistedSessionCreate { payload, .. } => {
                self.submit_session_create(
                    runtime.clone(),
                    cmd,
                    projects,
                    prepared_create.expect("validated create preparation"),
                    payload.title,
                )
                .await
            }
            ActionEnvelope::PersistedSessionOpen { .. } => {
                self.submit_session_open(
                    runtime.clone(),
                    cmd,
                    projects,
                    &command_id,
                    prepared_open.expect("validated open preparation"),
                )
                .await
            }
            _ => unreachable!("dispatch guarantees metadata action"),
        }
    }

    /// committed/error 终态 ack 回投（action 执行段共用；广播经 tx 队列）。
    pub(super) async fn send_metadata_ack(
        &self,
        cmd: &MetadataCommand,
        status: AckStatus,
        project_id: Option<&str>,
        session_id: Option<&str>,
        chat_id: Option<&str>,
        acp_id: Option<String>,
    ) {
        let _ = cmd
            .tx
            .send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
                command_id: extract_command_id(&cmd.action).unwrap_or_default(),
                status,
                turn_id: None,
                chat_id: chat_id.map(str::to_string),
                project_id: project_id.map(str::to_string),
                session_id: session_id.map(str::to_string),
                acp_session_id: acp_id,
                committed_projection_version: None,
            })))
            .await;
    }

    /// 错误回投（与 coordinator 的 send_error 同款审计纪律）。
    pub(super) async fn send_error(
        &self,
        cmd: &MetadataCommand,
        code: ErrorCode,
        message: &str,
        retryable: bool,
    ) {
        let command_id = extract_command_id(&cmd.action).unwrap_or_default();
        audit(
            "command.error",
            Some(&command_id),
            Some(&cmd.ctx.token_id),
            "error",
            std::time::Duration::ZERO,
            None,
        );
        let _ = cmd
            .tx
            .send(OutboundMsg::Frame(Frame::ActionError(action_error(
                command_id, code, message, retryable,
            ))))
            .await;
    }
}

use crate::channel::metadata_validation::PreparedValidation;
