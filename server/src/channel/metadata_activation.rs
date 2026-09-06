//! 持久化会话激活段（review #2 结构拆分）：`spawn_persisted_activation`
//! 编排「命令屏障 → runtime submit（spawn + initialize + session/load）→
//! 终态 ack 回投」。

use chrono::Utc;
use peri_studio_proto::ack::{AckStatus, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::frame::Frame;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::channel::broadcaster::OutboundMsg;
use crate::channel::metadata_command_processor::{
    MetadataCommand, MetadataCommandProcessor, MetadataRuntimePort,
};
use crate::control::{CatalogSession, ProjectService};
use crate::persist::metadata::ProjectRecord;

use super::command_coordinator::{extract_command_id, SubmitAck};

/// 持久化激活的输入（action 执行段组装，本文件消费）。
pub(super) struct PersistedActivation {
    pub cmd: MetadataCommand,
    pub projects: ProjectService,
    pub project: ProjectRecord,
    pub title: Option<String>,
    pub acp_id: Option<String>,
}

impl MetadataCommandProcessor {
    /// 持久化激活（后台任务）：屏障 → inner submit（create runtime）→
    /// 终态 ack 回投。
    pub(super) fn spawn_persisted_activation<R: MetadataRuntimePort>(
        &self,
        runtime: R,
        activation: PersistedActivation,
    ) {
        let me = self.clone();
        tokio::spawn(async move {
            let PersistedActivation {
                cmd,
                projects,
                project,
                title,
                acp_id,
            } = activation;
            let chat_command_id = Uuid::new_v4().to_string();
            let (inner_tx, mut inner_rx) = mpsc::channel(16);
            let create = ActionEnvelope::Create {
                command_id: chat_command_id.clone(),
                payload: peri_studio_proto::action::CreateChatPayload {
                    instance_id: Some(project.instance_id.clone()),
                    cwd: Some(project.cwd.clone()),
                    title: title.clone(),
                    acp_session_id: acp_id.clone(),
                    workspace_id: None,
                },
            };
            if !me
                .persist_dispatch_barrier(&cmd, &projects, &project, acp_id.as_deref())
                .await
            {
                return;
            }
            match runtime.submit_runtime(&cmd.ctx, create, inner_tx).await {
                SubmitAck::Accepted { .. } => {}
                _ => {
                    let original = extract_command_id(&cmd.action).unwrap_or_default();
                    let _ = projects
                        .metadata()
                        .update_command(
                            &original,
                            "failed",
                            Some(&project.id),
                            acp_id.as_deref(),
                            None,
                            acp_id.as_deref(),
                            Some("activation_submit_failed"),
                        )
                        .await;
                    me.send_error(
                        &cmd,
                        ErrorCode::AgentUnavailable,
                        "activation submit failed",
                        true,
                    )
                    .await;
                    return;
                }
            }
            while let Some(msg) = inner_rx.recv().await {
                match msg {
                    OutboundMsg::Frame(Frame::ActionAck(ack))
                        if ack.status == AckStatus::Committed =>
                    {
                        let Some(chat_id) = ack.chat_id else { break };
                        let bound = me.chats.entry(&chat_id).await.and_then(|e| e.session_id);
                        let Some(acp_session_id) =
                            ack.acp_session_id.or_else(|| acp_id.clone()).or(bound)
                        else {
                            break;
                        };
                        let now = Utc::now().to_rfc3339();
                        if projects
                            .upsert_catalog_session(CatalogSession {
                                acp_session_id: acp_session_id.clone(),
                                project_id: project.id.clone(),
                                title: title.clone().unwrap_or_default(),
                                updated_at: now.clone(),
                                status: "ready".into(),
                                lifecycle: "ready".into(),
                                last_opened_at: Some(now),
                                hub_title: None,
                            })
                            .await
                            .is_err()
                        {
                            me.send_error(
                                &cmd,
                                ErrorCode::AgentUnavailable,
                                "session projection failed",
                                true,
                            )
                            .await;
                            return;
                        }
                        let original = extract_command_id(&cmd.action).unwrap_or_default();
                        if projects
                            .metadata()
                            .update_command(
                                &original,
                                "committed",
                                Some(&project.id),
                                Some(&acp_session_id),
                                Some(&chat_id),
                                Some(&acp_session_id),
                                None,
                            )
                            .await
                            .is_err()
                        {
                            me.send_error(
                                &cmd,
                                ErrorCode::AgentUnavailable,
                                "session activation finalize failed",
                                true,
                            )
                            .await;
                            return;
                        }
                        me.send_metadata_ack(
                            &cmd,
                            AckStatus::Committed,
                            Some(&project.id),
                            None,
                            Some(&acp_session_id),
                            Some(&chat_id),
                            Some(acp_session_id.clone()),
                        )
                        .await;
                        return;
                    }
                    OutboundMsg::Frame(Frame::ActionError(_)) => {
                        let original = extract_command_id(&cmd.action).unwrap_or_default();
                        let _ = projects
                            .metadata()
                            .update_command(
                                &original,
                                "failed",
                                Some(&project.id),
                                acp_id.as_deref(),
                                None,
                                acp_id.as_deref(),
                                Some("activation_failed_or_unknown"),
                            )
                            .await;
                        me.send_error(
                            &cmd,
                            ErrorCode::AgentUnavailable,
                            "session activation failed",
                            false,
                        )
                        .await;
                        return;
                    }
                    _ => {}
                }
            }
            let original = extract_command_id(&cmd.action).unwrap_or_default();
            let _ = projects
                .metadata()
                .update_command(
                    &original,
                    "reconciliation_required",
                    Some(&project.id),
                    acp_id.as_deref(),
                    None,
                    acp_id.as_deref(),
                    Some("activation_channel_closed"),
                )
                .await;
            me.send_error(
                &cmd,
                ErrorCode::AgentUnavailable,
                "session activation outcome unknown",
                false,
            )
            .await;
        });
    }

    async fn persist_dispatch_barrier(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        project: &ProjectRecord,
        acp_id: Option<&str>,
    ) -> bool {
        if projects
            .metadata()
            .update_command(
                &extract_command_id(&cmd.action).unwrap_or_default(),
                "dispatched",
                Some(&project.id),
                acp_id,
                None,
                acp_id,
                None,
            )
            .await
            .is_err()
        {
            self.send_error(
                cmd,
                ErrorCode::AgentUnavailable,
                "session activation dispatch barrier failed",
                true,
            )
            .await;
            return false;
        }
        true
    }
}
