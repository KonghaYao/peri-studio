//! CommandCoordinator 的队列面执行族（review #3 结构拆分）：per-chat 执行器
//! 消费 prompt（run_prompt_delivery）、cancel、close、resolve、respond-elicitation。
//! active prompt 等待 L3 时，执行器可优先消费同一队列中的 cancel；终态统一走
//! `terminal_io`（outcome_broker 发布）。
//!
//! 本文件是 [`CommandCoordinator`] 的实现段（结构拆分，行为语义不变）；
//! `exec_command` 由 `queued_submission::executor_loop` 调用。

use uuid::Uuid;

use tokio::sync::oneshot;

use peri_studio_proto::ack::{AckStatus, ActionAck, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::frame::Frame;

use crate::auth::audit::audit;
use crate::channel::broadcaster::OutboundMsg;
use crate::channel::command_coordinator::{CommandCoordinator, ExecCmd};
use crate::channel::coordinator_helpers::extract_command_id;
use crate::channel::elicitation_response::{
    ElicitationResponseOutcome, ElicitationResponseRequest,
};
use crate::channel::permission_resolution::{
    PermissionResolutionOutcome, PermissionResolutionRequest,
};
use crate::channel::prompt_delivery::{PromptDeliveryOutcome, PromptDeliveryRequest};
use crate::channel::question_response::{QuestionResponseOutcome, QuestionResponseRequest};
use crate::channel::runtime_closure::CloseRuntimeRequest;
use crate::channel::turn_cancellation::CancelTurnRequest;

impl CommandCoordinator {
    /// 命令分发（§7 方法面）。
    pub(super) async fn exec_command(&self, chat_id: &str, cmd: &ExecCmd) {
        match &cmd.action {
            ActionEnvelope::Prompt { .. } => self.run_prompt_delivery(chat_id, cmd).await,
            ActionEnvelope::Cancel { .. } => {
                self.exec_cancel(chat_id, cmd).await;
            }
            // ConfigSet 在 submit 直通面由 session_configuration.set 处理
            // （review #9），队列内永无 ConfigSet——此处不设分支，落入
            // 下方防御臂（不可达，注释见下）。
            ActionEnvelope::Close { .. } => self.exec_close(chat_id, cmd).await,
            ActionEnvelope::ResolvePermission { .. } => self.exec_resolve(chat_id, cmd).await,
            ActionEnvelope::RespondElicitation { .. } => {
                self.exec_respond_elicitation(chat_id, cmd).await
            }
            ActionEnvelope::RespondQuestion { .. } => {
                self.exec_respond_question(chat_id, cmd).await
            }
            _ => {
                // M1 action type 白名单外的 action（Load/SubscribeEvents/
                // UnsubscribeEvents）已在 chat_channel::dispatch_action
                // 拦截（§4.8）；ConfigSet 由 submit 直通（review #9）；
                // 此处为防御路径。
                self.send_error(
                    cmd,
                    ErrorCode::UnsupportedFrame,
                    "unsupported action",
                    false,
                )
                .await;
            }
        }
    }

    /// Execute one prompt through the dedicated durable delivery module.
    pub(super) async fn run_prompt_delivery(&self, chat_id: &str, cmd: &ExecCmd) {
        self.run_prompt_delivery_with_active_signal(chat_id, cmd, None)
            .await;
    }

    pub(super) async fn run_prompt_delivery_with_active_signal(
        &self,
        chat_id: &str,
        cmd: &ExecCmd,
        active_signal: Option<oneshot::Sender<()>>,
    ) {
        self.inner.mcp_apps_control.tear_down_chat(chat_id).await;
        let command_id_text = extract_command_id(&cmd.action).unwrap_or_default();
        let command_id = match Uuid::parse_str(&command_id_text) {
            Ok(command_id) => command_id,
            Err(_) => {
                self.send_error(cmd, ErrorCode::InvalidState, "invalid commandId", false)
                    .await;
                return;
            }
        };
        let payload = match &cmd.action {
            ActionEnvelope::Prompt { payload, .. } => payload.clone(),
            _ => unreachable!("dispatch guarantees prompt"),
        };
        let started = std::time::Instant::now();
        match self
            .inner
            .prompt_delivery
            .execute(PromptDeliveryRequest {
                command_id,
                command_id_text: command_id_text.clone(),
                chat_id: chat_id.to_string(),
                payload,
                active_signal,
            })
            .await
        {
            PromptDeliveryOutcome::Committed { turn_id } => {
                self.send_committed(cmd, Some(&turn_id.to_string()), None)
                    .await;
                audit(
                    "command.committed",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    "ok",
                    started.elapsed(),
                    None,
                );
            }
            PromptDeliveryOutcome::Failed(failure) => {
                self.send_error(cmd, failure.code, &failure.message, failure.retryable)
                    .await;
            }
        }
    }
    /// Cancel through a durable writer-acknowledged notification lifecycle.
    pub(super) async fn exec_cancel(&self, chat_id: &str, cmd: &ExecCmd) {
        self.inner.mcp_apps_control.tear_down_chat(chat_id).await;
        let command_id_text = extract_command_id(&cmd.action).unwrap_or_default();
        let command_id = match Uuid::parse_str(&command_id_text) {
            Ok(command_id) => command_id,
            Err(_) => {
                self.send_error(cmd, ErrorCode::InvalidState, "invalid commandId", false)
                    .await;
                return;
            }
        };
        let started = std::time::Instant::now();
        match self
            .inner
            .turn_cancellation
            .execute(CancelTurnRequest {
                command_id,
                chat_id: chat_id.to_string(),
            })
            .await
        {
            Ok(()) => {
                audit(
                    "chat.cancel",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    "committed",
                    started.elapsed(),
                    None,
                );
                self.send_committed(cmd, None, None).await;
            }
            Err(error) => {
                audit(
                    "chat.cancel",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    error.audit_outcome,
                    started.elapsed(),
                    None,
                );
                self.send_error(cmd, error.code, &error.message, error.retryable)
                    .await;
            }
        }
    }
    /// close 执行（§4.3「关闭并 kill 对应 ACP 进程」；offline 语义 §7.6）。
    pub(super) async fn exec_close(&self, chat_id: &str, cmd: &ExecCmd) {
        self.inner.mcp_apps_control.tear_down_chat(chat_id).await;
        let command_id_str = extract_command_id(&cmd.action).unwrap_or_default();
        let command_id = match Uuid::parse_str(&command_id_str) {
            Ok(id) => id,
            Err(_) => {
                self.send_error(cmd, ErrorCode::InvalidState, "invalid commandId", false)
                    .await;
                return;
            }
        };
        let started = std::time::Instant::now();
        match self
            .inner
            .runtime_closure
            .execute(CloseRuntimeRequest {
                command_id,
                chat_id: chat_id.to_string(),
            })
            .await
        {
            Ok(()) => {
                audit(
                    "chat.close",
                    Some(&command_id_str),
                    Some(&cmd.ctx.token_id),
                    "committed",
                    started.elapsed(),
                    None,
                );
                self.send_committed(cmd, None, None).await;
            }
            Err(error) => {
                audit(
                    "chat.close",
                    Some(&command_id_str),
                    Some(&cmd.ctx.token_id),
                    error.audit_outcome,
                    started.elapsed(),
                    None,
                );
                self.send_error(cmd, error.code, &error.message, error.retryable)
                    .await;
            }
        }
    }

    /// resolve 执行（§7.4 规则 4：CAS 迁移成功后才下发 ACP）。
    pub(super) async fn exec_resolve(&self, chat_id: &str, cmd: &ExecCmd) {
        let command_id_text = extract_command_id(&cmd.action).unwrap_or_default();
        let command_id = match Uuid::parse_str(&command_id_text) {
            Ok(command_id) => command_id,
            Err(_) => {
                self.send_error(cmd, ErrorCode::InvalidState, "invalid commandId", false)
                    .await;
                return;
            }
        };
        let payload = match &cmd.action {
            ActionEnvelope::ResolvePermission { payload, .. } => payload,
            _ => unreachable!("dispatch guarantees resolve"),
        };
        let started = std::time::Instant::now();
        let result = self
            .inner
            .permission_resolution
            .execute(PermissionResolutionRequest {
                command_id,
                chat_id: chat_id.to_string(),
                permission_id: payload.permission_id.clone(),
                decision: payload.decision,
                option_id: payload.option_id.clone(),
            })
            .await;
        match result {
            Ok(PermissionResolutionOutcome::Committed) => {
                audit(
                    "permission.resolve",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    "ok",
                    started.elapsed(),
                    None,
                );
                self.send_committed(cmd, None, None).await;
            }
            Ok(PermissionResolutionOutcome::Duplicate) => {
                audit(
                    "permission.resolve",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    "duplicate",
                    started.elapsed(),
                    None,
                );
                let _ = cmd
                    .tx
                    .send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
                        command_id: command_id_text,
                        status: AckStatus::Duplicate,
                        turn_id: None,
                        chat_id: None,
                        project_id: None,
                        instance_id: None,
                        session_id: None,
                        acp_session_id: None,
                        committed_projection_version: None,
                        resource_result: None,
                    })))
                    .await;
            }
            Err(failure) => {
                audit(
                    "permission.resolve",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    failure.audit_outcome,
                    started.elapsed(),
                    None,
                );
                self.send_error(cmd, failure.code, &failure.message, failure.retryable)
                    .await;
            }
        }
    }

    pub(super) async fn exec_respond_elicitation(&self, _chat_id: &str, cmd: &ExecCmd) {
        let command_id_text = extract_command_id(&cmd.action).unwrap_or_default();
        let command_id = match Uuid::parse_str(&command_id_text) {
            Ok(command_id) => command_id,
            Err(_) => {
                self.send_error(cmd, ErrorCode::InvalidState, "invalid commandId", false)
                    .await;
                return;
            }
        };
        let payload = match &cmd.action {
            ActionEnvelope::RespondElicitation { payload, .. } => payload.clone(),
            _ => unreachable!("dispatch guarantees elicitation response"),
        };
        let started = std::time::Instant::now();
        match self
            .inner
            .elicitation_response
            .execute(ElicitationResponseRequest {
                command_id,
                payload,
            })
            .await
        {
            Ok(ElicitationResponseOutcome::Committed) => {
                audit(
                    "elicitation.respond",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    "ok",
                    started.elapsed(),
                    None,
                );
                self.send_committed(cmd, None, None).await;
            }
            Ok(ElicitationResponseOutcome::Duplicate) => {
                audit(
                    "elicitation.respond",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    "duplicate",
                    started.elapsed(),
                    None,
                );
                let _ = cmd
                    .tx
                    .send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
                        command_id: command_id_text,
                        status: AckStatus::Duplicate,
                        turn_id: None,
                        chat_id: None,
                        project_id: None,
                        instance_id: None,
                        session_id: None,
                        acp_session_id: None,
                        committed_projection_version: None,
                        resource_result: None,
                    })))
                    .await;
            }
            Err(failure) => {
                audit(
                    "elicitation.respond",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    failure.audit_outcome,
                    started.elapsed(),
                    None,
                );
                self.send_error(cmd, failure.code, &failure.message, failure.retryable)
                    .await;
            }
        }
    }

    pub(super) async fn exec_respond_question(&self, _chat_id: &str, cmd: &ExecCmd) {
        let command_id_text = extract_command_id(&cmd.action).unwrap_or_default();
        let command_id = match Uuid::parse_str(&command_id_text) {
            Ok(command_id) => command_id,
            Err(_) => {
                self.send_error(cmd, ErrorCode::InvalidState, "invalid commandId", false)
                    .await;
                return;
            }
        };
        let payload = match &cmd.action {
            ActionEnvelope::RespondQuestion { payload, .. } => payload.clone(),
            _ => unreachable!("dispatch guarantees question response"),
        };
        let started = std::time::Instant::now();
        match self
            .inner
            .question_response
            .execute(QuestionResponseRequest {
                command_id,
                payload,
            })
            .await
        {
            Ok(QuestionResponseOutcome::Committed) => {
                audit(
                    "question.respond",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    "ok",
                    started.elapsed(),
                    None,
                );
                self.send_committed(cmd, None, None).await;
            }
            Ok(QuestionResponseOutcome::Duplicate) => {
                audit(
                    "question.respond",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    "duplicate",
                    started.elapsed(),
                    None,
                );
                let _ = cmd
                    .tx
                    .send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
                        command_id: command_id_text,
                        status: AckStatus::Duplicate,
                        turn_id: None,
                        chat_id: None,
                        project_id: None,
                        instance_id: None,
                        session_id: None,
                        acp_session_id: None,
                        committed_projection_version: None,
                        resource_result: None,
                    })))
                    .await;
            }
            Err(failure) => {
                audit(
                    "question.respond",
                    Some(&command_id_text),
                    Some(&cmd.ctx.token_id),
                    failure.audit_outcome,
                    started.elapsed(),
                    None,
                );
                self.send_error(cmd, failure.code, &failure.message, failure.retryable)
                    .await;
            }
        }
    }
}
