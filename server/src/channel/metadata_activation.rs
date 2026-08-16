//! 持久化会话激活段（review #2 结构拆分）：`spawn_persisted_activation`
//! 编排「持久化屏障 → runtime submit（spawn + initialize + session/load）→
//! 终态 ack 回投」；`reconcile_activation` 是失败路径的 reconciliation 恢复。
//!
//! no-redelivery 纪律：在 inner submit 可能 enqueue/spawn 任何 ACP 生命周期
//! 工作**之前**，先持久化不可安全重试的边界（activation_phase + 命令
//! phase），屏障失败 → reconcile（review #16：两段屏障代码提取为
//! `persist_activation_barrier` 组合子，语义不变）。

use peri_studio_proto::ack::{AckStatus, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::frame::Frame;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::channel::broadcaster::OutboundMsg;
use crate::channel::metadata_command_processor::{
    MetadataCommand, MetadataCommandProcessor, MetadataRuntimePort,
};
use crate::control::ProjectService;
use crate::persist::metadata::ProjectRecord;

use super::command_coordinator::{extract_command_id, SubmitAck};

/// 持久化激活的输入（action 执行段组装，本文件消费）。
pub(super) struct PersistedActivation {
    pub cmd: MetadataCommand,
    pub projects: ProjectService,
    pub project: ProjectRecord,
    pub session_id: String,
    pub title: Option<String>,
    pub acp_id: Option<String>,
}

impl MetadataCommandProcessor {
    /// 持久化激活（后台任务）：屏障 → inner submit（create runtime）→
    /// 终态 ack 回投；所有失败路径 reconcile（不静默，无自动重发）。
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
                session_id,
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
                .persist_activation_barrier(
                    &cmd,
                    &projects,
                    &project,
                    &session_id,
                    "dispatch_pending",
                    acp_id.as_deref(),
                    "dispatch_barrier_failed",
                )
                .await
            {
                return;
            }
            // Persist the unsafe-to-retry boundary before inner submit can
            // enqueue/spawn any ACP lifecycle work.
            if !me
                .persist_activation_barrier(
                    &cmd,
                    &projects,
                    &project,
                    &session_id,
                    "dispatched",
                    acp_id.as_deref(),
                    "dispatched_barrier_failed",
                )
                .await
            {
                return;
            }
            match runtime.submit_runtime(&cmd.ctx, create, inner_tx).await {
                SubmitAck::Accepted { .. } => {}
                _ => {
                    if projects
                        .metadata()
                        .fail_session(&session_id, "activation_submit_failed")
                        .await
                        .is_err()
                        || projects.reproject().await.is_err()
                    {
                        let _ = projects
                            .metadata()
                            .mark_reconciliation_required(
                                &session_id,
                                "activation_submit_failure_barrier_failed",
                            )
                            .await;
                    }
                    let _ = projects
                        .metadata()
                        .update_command(
                            &extract_command_id(&cmd.action).unwrap_or_default(),
                            "failed",
                            Some(&project.id),
                            Some(&session_id),
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
                        if projects
                            .metadata()
                            .activation_phase(
                                &session_id,
                                "acp_id_durable",
                                Some(&chat_id),
                                Some(&acp_session_id),
                            )
                            .await
                            .is_err()
                        {
                            me.reconcile_activation(
                                &cmd,
                                &projects,
                                &session_id,
                                "acp_id_barrier_failed",
                            )
                            .await;
                            return;
                        }
                        let original = extract_command_id(&cmd.action).unwrap_or_default();
                        if projects
                            .metadata()
                            .finalize_session_and_command(
                                &original,
                                &session_id,
                                &project.id,
                                &acp_session_id,
                                title.as_deref(),
                                &chat_id,
                            )
                            .await
                            .is_err()
                        {
                            me.reconcile_activation(
                                &cmd,
                                &projects,
                                &session_id,
                                "finalize_barrier_failed",
                            )
                            .await;
                            return;
                        }
                        if projects.reproject().await.is_err() {
                            let _ = projects
                                .metadata()
                                .mark_reconciliation_required(&session_id, "projection_failed")
                                .await;
                            let _ = projects
                                .metadata()
                                .update_command(
                                    &original,
                                    "reconciliation_required",
                                    Some(&project.id),
                                    Some(&session_id),
                                    Some(&chat_id),
                                    Some(&acp_session_id),
                                    Some("projection_failed"),
                                )
                                .await;
                            me.send_error(
                                &cmd,
                                ErrorCode::AgentUnavailable,
                                "session projection failed",
                                true,
                            )
                            .await;
                            return;
                        }
                        if projects
                            .metadata()
                            .update_command(
                                &original,
                                "committed",
                                Some(&project.id),
                                Some(&session_id),
                                Some(&chat_id),
                                Some(&acp_session_id),
                                None,
                            )
                            .await
                            .is_err()
                        {
                            me.reconcile_activation(
                                &cmd,
                                &projects,
                                &session_id,
                                "command_commit_barrier_failed",
                            )
                            .await;
                            return;
                        }
                        me.send_metadata_ack(
                            &cmd,
                            AckStatus::Committed,
                            Some(&project.id),
                            Some(&session_id),
                            Some(&chat_id),
                            Some(acp_session_id),
                        )
                        .await;
                        return;
                    }
                    OutboundMsg::Frame(Frame::ActionError(_)) => {
                        let original = extract_command_id(&cmd.action).unwrap_or_default();
                        let _ = projects
                            .metadata()
                            .reconcile_activation_and_command(
                                &session_id,
                                &original,
                                "activation_failed_or_unknown",
                            )
                            .await;
                        let _ = projects.reproject().await;
                        me.send_error(
                            &cmd,
                            ErrorCode::AgentUnavailable,
                            "session activation failed; reconciliation required",
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
                .reconcile_activation_and_command(
                    &session_id,
                    &original,
                    "activation_channel_closed",
                )
                .await;
            let _ = projects.reproject().await;
            me.send_error(
                &cmd,
                ErrorCode::AgentUnavailable,
                "session activation outcome unknown",
                false,
            )
            .await;
        });
    }

    /// 持久化屏障组合子（review #16）：`activation_phase(phase)` +
    /// `update_command(..., "dispatched", ...)` 两段屏障代码的唯一实现；
    /// 任一失败 → reconcile 并返回 false（调用方短路返回）。
    #[allow(clippy::too_many_arguments)]
    async fn persist_activation_barrier(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        project: &ProjectRecord,
        session_id: &str,
        phase: &str,
        acp_id: Option<&str>,
        barrier_code: &str,
    ) -> bool {
        if projects
            .metadata()
            .activation_phase(session_id, phase, None, acp_id)
            .await
            .is_err()
            || projects
                .metadata()
                .update_command(
                    &extract_command_id(&cmd.action).unwrap_or_default(),
                    "dispatched",
                    Some(&project.id),
                    Some(session_id),
                    None,
                    acp_id,
                    None,
                )
                .await
                .is_err()
        {
            self.reconcile_activation(cmd, projects, session_id, barrier_code)
                .await;
            return false;
        }
        true
    }

    /// 激活失败恢复：`reconcile_activation_and_command` + reproject +
    /// 确定性错误回投（reconciliation 语义，无自动重发）。
    async fn reconcile_activation(
        &self,
        cmd: &MetadataCommand,
        projects: &ProjectService,
        session_id: &str,
        code: &str,
    ) {
        let original = extract_command_id(&cmd.action).unwrap_or_default();
        let _ = projects
            .metadata()
            .reconcile_activation_and_command(session_id, &original, code)
            .await;
        let _ = projects.reproject().await;
        self.send_error(
            cmd,
            ErrorCode::AgentUnavailable,
            "session activation requires reconciliation",
            false,
        )
        .await;
    }
}
