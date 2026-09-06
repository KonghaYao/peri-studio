//! CommandCoordinator 的现有 runtime 会话操作面（review #3 结构拆分）：
//! chat/load 与 chat/session-new 的直通执行——经 `SessionRuntimeOperations`
//! 获取 per-chat lease + runtime_transition_guard（P0 review #1），异步回投
//! committed/error 终态。
//!
//! 本文件是 [`CommandCoordinator`] 的实现段（结构拆分，行为语义不变）。

use std::time::Instant;

use tokio::sync::mpsc;

use peri_studio_proto::ack::{AckStatus, ActionAck};
use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::frame::Frame;

use crate::auth::audit::audit;
use crate::auth::ConnectionCtx;
use crate::channel::broadcaster::OutboundMsg;
use crate::channel::command_coordinator::{CommandCoordinator, SubmitAck};
use crate::channel::coordinator_helpers::action_error;
use crate::channel::session_runtime_operations::SessionOperationOutcome;

impl CommandCoordinator {
    /// chat/load 会话切换执行（§8.5）：在当前对话（其 ACP 进程）内把
    /// 目标历史会话加载为进程的当前会话——**不新建 chat/进程**（会话是
    /// 进程内实体，随进程消亡；进程可先后持有多个会话，load 即切换）。
    ///
    /// 流程：chat record 解析 (instance_id, cwd) → 开回放窗口
    /// （BeginLoadReplay，清空旧内容重放目标会话）→ 复用 L3 匹配
    /// （register_rpc + forward_rpc `session/load`）→ 成功更新 chat 的
    /// 当前会话（switch_session，relay 逐帧 binding 校验需要命中新
    /// sessionId）→ committed；失败回 `action_error`。低频直通（同
    /// session/list），不走 chat 队列/outbox；submit 层面返回 Accepted，
    /// 终态帧异步回投。
    pub(super) async fn exec_load_chat(
        &self,
        ctx: &ConnectionCtx,
        action: &ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
        command_id: &str,
    ) -> SubmitAck {
        let payload = match action {
            ActionEnvelope::Load { payload, .. } => payload,
            _ => unreachable!("dispatch guarantees chat/load"),
        };
        let run = match self
            .inner
            .session_operations
            .start_load(command_id, &payload.chat_id, &payload.acp_session_id)
            .await
        {
            Ok(run) => run,
            Err(failure) => {
                return SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    failure.code,
                    &failure.message,
                    failure.retryable,
                ));
            }
        };

        let cmd_id = command_id.to_string();
        let token_id = ctx.token_id.clone();
        tokio::spawn(async move {
            let started = Instant::now();
            match run.execute().await {
                Ok(SessionOperationOutcome::Loaded { chat_id }) => {
                    audit(
                        "chat.load",
                        Some(&cmd_id),
                        Some(&token_id),
                        "ok",
                        started.elapsed(),
                        None,
                    );
                    let _ = tx
                        .send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
                            command_id: cmd_id,
                            status: AckStatus::Committed,
                            turn_id: None,
                            chat_id: Some(chat_id),
                            project_id: None,
                            instance_id: None,
                            session_id: None,
                            acp_session_id: None,
                            committed_projection_version: None,
                            resource_result: None,
                        })))
                        .await;
                }
                Ok(SessionOperationOutcome::Created { .. }) => {
                    unreachable!("load operation cannot create an ACP session")
                }
                Err(failure) => {
                    audit(
                        "chat.load",
                        Some(&cmd_id),
                        Some(&token_id),
                        failure.audit_outcome,
                        started.elapsed(),
                        None,
                    );
                    let _ = tx
                        .send(OutboundMsg::Frame(Frame::ActionError(action_error(
                            cmd_id,
                            failure.code,
                            &failure.message,
                            failure.retryable,
                        ))))
                        .await;
                }
            }
        });
        SubmitAck::Accepted {
            command_id: command_id.to_string(),
        }
    }

    /// chat/session-new（§8.5）：当前对话内新建 ACP 会话——等价 create
    /// 序列的 `session/new` 一步（进程已存在，无 spawn/initialize）。
    /// 低频直通（同 load），不走 chat 队列/outbox；submit 层面返回
    /// Accepted，终态帧异步回投。
    pub(super) async fn exec_session_new(
        &self,
        ctx: &ConnectionCtx,
        action: &ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
        command_id: &str,
    ) -> SubmitAck {
        let payload = match action {
            ActionEnvelope::SessionNew { payload, .. } => payload,
            _ => unreachable!("dispatch guarantees chat/session-new"),
        };
        let run = match self
            .inner
            .session_operations
            .start_new(command_id, &payload.chat_id)
            .await
        {
            Ok(run) => run,
            Err(failure) => {
                return SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    failure.code,
                    &failure.message,
                    failure.retryable,
                ));
            }
        };

        let cmd_id = command_id.to_string();
        let token_id = ctx.token_id.clone();
        tokio::spawn(async move {
            let started = Instant::now();
            match run.execute().await {
                Ok(SessionOperationOutcome::Created {
                    chat_id,
                    acp_session_id,
                }) => {
                    audit(
                        "chat.session_new",
                        Some(&cmd_id),
                        Some(&token_id),
                        "ok",
                        started.elapsed(),
                        None,
                    );
                    let _ = tx
                        .send(OutboundMsg::Frame(Frame::ActionAck(ActionAck {
                            command_id: cmd_id,
                            status: AckStatus::Committed,
                            turn_id: None,
                            chat_id: Some(chat_id),
                            project_id: None,
                            instance_id: None,
                            session_id: None,
                            acp_session_id: Some(acp_session_id),
                            committed_projection_version: None,
                            resource_result: None,
                        })))
                        .await;
                }
                Ok(SessionOperationOutcome::Loaded { .. }) => {
                    unreachable!("session/new operation cannot load an ACP session")
                }
                Err(failure) => {
                    audit(
                        "chat.session_new",
                        Some(&cmd_id),
                        Some(&token_id),
                        failure.audit_outcome,
                        started.elapsed(),
                        None,
                    );
                    let _ = tx
                        .send(OutboundMsg::Frame(Frame::ActionError(action_error(
                            cmd_id,
                            failure.code,
                            &failure.message,
                            failure.retryable,
                        ))))
                        .await;
                }
            }
        });
        SubmitAck::Accepted {
            command_id: command_id.to_string(),
        }
    }

    /// server 重启恢复：对 instance 下全部非终态且已绑定会话的 chat 发起
    /// `session/resume`（实现见 `session_resume`，`SessionRuntimeOperations`
    /// 实现段）。
    #[cfg(test)]
    pub(super) async fn resume_instance_chats(&self, instance_id: &str) -> usize {
        self.inner
            .session_operations
            .resume_instance_chats(instance_id)
            .await
    }

    pub(super) async fn resume_instance_chats_and_wait(
        &self,
        instance_id: &str,
    ) -> super::session_resume::ResumeSummary {
        self.inner
            .session_operations
            .resume_instance_chats_and_wait(instance_id)
            .await
    }
}
