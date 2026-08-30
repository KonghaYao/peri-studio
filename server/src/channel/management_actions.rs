//! CommandCoordinator 的管理面（直通）动作（review #3 结构拆分）：不经
//! per-chat 队列/outbox 的低频或只读命令——workspace 管理、session/list
//! 按需查询、MCP 控制、config、rewind、prompt-status、session discover、
//! chat/load、session/new。`submit_management_action` 是 submit 的直通面
//! 入口（command_id 已由 submit 校验）。
//!
//! 本文件是 [`CommandCoordinator`] 的实现段；字段经 `pub(super)` 在 channel
//! 模块内共享（结构拆分，行为语义不变）。

use tokio::sync::mpsc;
use uuid::Uuid;

use peri_studio_proto::ack::{AckStatus, ActionAck, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::frame::Frame;
use peri_studio_proto::session::PromptStatusFrame;

use crate::auth::audit::audit;
use crate::auth::ConnectionCtx;
use crate::channel::broadcaster::OutboundMsg;
use crate::channel::command_coordinator::{CommandCoordinator, ExecCmd, SubmitAck};
use crate::channel::coordinator_helpers::{action_error, extract_command_id};
use crate::channel::prompt_recovery::{PromptRecovery, PromptRecoveryError};
use crate::channel::session_discovery::DiscoveryStartError;
use crate::channel::workspace_compatibility::WorkspaceCommandOutcome;

impl CommandCoordinator {
    /// 直通面分发（review #3：submit 双入口之一）：workspace/session-list/
    /// mcp/config/rewind/rewind-query/prompt-status/discover/load/session-new
    /// ——低频或只读，直接执行后回终态（无两阶段队列语义）。
    pub(super) async fn submit_management_action(
        &self,
        ctx: &ConnectionCtx,
        action: ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
        command_id_str: &str,
    ) -> SubmitAck {
        // workspace 管理命令（独立于 chat 的上层概念）：不占 chat 队列/outbox/
        // reserve——管理面低频操作，直接执行后回 committed（无两阶段队列语义）。
        if matches!(
            action,
            ActionEnvelope::WorkspaceCreate { .. } | ActionEnvelope::WorkspaceRemove { .. }
        ) {
            return self
                .exec_workspace_command(ctx, &action, tx, command_id_str)
                .await;
        }

        // session/list 按需查询（§6.3）：无副作用只读查询，同样不走 chat
        // 队列/outbox——直接向 agent 侧发 session/list RPC，结果经
        // session_list 下行帧回投（agent 侧是真实数据源，非轮询投影过滤）。
        if let ActionEnvelope::SessionList { .. } = &action {
            return self
                .exec_session_list(ctx, &action, tx, command_id_str)
                .await;
        }

        if matches!(
            action,
            ActionEnvelope::McpList { .. }
                | ActionEnvelope::McpOAuthStart { .. }
                | ActionEnvelope::McpOAuthAuthorization { .. }
                | ActionEnvelope::McpOAuthCancel { .. }
                | ActionEnvelope::McpAppOpen { .. }
                | ActionEnvelope::McpAppResource { .. }
                | ActionEnvelope::McpAppCall { .. }
        ) {
            return self
                .exec_mcp_control(&action, tx, command_id_str, !ctx.can_send_action())
                .await;
        }

        if let ActionEnvelope::ConfigSet { payload, .. } = &action {
            return match self
                .inner
                .session_configuration
                .set(command_id_str, payload, tx)
                .await
            {
                Ok(()) => SubmitAck::Handled,
                Err(error) => SubmitAck::Failed(error),
            };
        }

        if let ActionEnvelope::Rewind { payload, .. } = &action {
            return match self
                .inner
                .rewind_execution
                .submit(command_id_str, payload, tx)
                .await
            {
                Ok(()) => SubmitAck::Handled,
                Err(error) => SubmitAck::Failed(error),
            };
        }

        if matches!(
            action,
            ActionEnvelope::RewindCandidates { .. } | ActionEnvelope::RewindPreview { .. }
        ) {
            return self.exec_rewind_query(&action, tx, command_id_str).await;
        }

        if let ActionEnvelope::PersistedSessionPromptStatus { .. } = &action {
            return self
                .exec_prompt_status(ctx, &action, tx, command_id_str)
                .await;
        }

        if let ActionEnvelope::PersistedSessionDiscover { .. } = &action {
            return self.exec_project_session_discover(ctx, action, tx).await;
        }

        // chat/load 会话切换（§8.5）：在当前对话（其 ACP 进程）内把目标
        // 历史会话加载为进程的当前会话——会话是进程内实体，**不新建
        // chat/进程**（点击 SessionList 历史会话 = 当前对话内 load）。
        // 低频直通（同 workspace/session-list 管理面），不走 chat 队列。
        if let ActionEnvelope::Load { .. } = &action {
            return self.exec_load_chat(ctx, &action, tx, command_id_str).await;
        }

        // chat/session-new（§8.5）：当前对话内新建 ACP 会话——等价 create
        // 序列的 `session/new` 一步（进程已存在，无 spawn/initialize）。
        // 低频直通（同 load），不走 chat 队列。
        if let ActionEnvelope::SessionNew { .. } = &action {
            return self
                .exec_session_new(ctx, &action, tx, command_id_str)
                .await;
        }

        unreachable!("dispatch guarantees management action")
    }

    /// Legacy workspace adapter. Compatibility mutation/projection semantics
    /// live in `WorkspaceCompatibility`; this method only preserves the
    /// existing synchronous-rejection versus Accepted+terminal transport.
    async fn exec_workspace_command(
        &self,
        ctx: &ConnectionCtx,
        action: &ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
        command_id: &str,
    ) -> SubmitAck {
        let cmd = ExecCmd {
            ctx: ctx.clone(),
            chat_id: String::new(),
            action: action.clone(),
            tx,
        };
        match self
            .inner
            .workspace_compatibility
            .execute(ctx, action)
            .await
        {
            WorkspaceCommandOutcome::Committed => {
                self.send_committed(&cmd, None, None).await;
            }
            WorkspaceCommandOutcome::Failed(error) => {
                self.send_error(&cmd, error.code, &error.message, error.retryable)
                    .await;
            }
            WorkspaceCommandOutcome::Rejected(error) => return SubmitAck::Failed(error),
        }
        SubmitAck::Accepted {
            command_id: command_id.to_string(),
        }
    }

    /// session/list 按需查询执行（§6.3 workspace 扩展）：agent 侧是真实
    /// 数据源——不依赖轮询投影的前端过滤。
    ///
    /// 流程：chat record 解析 (instance_id, cwd) → 复用 L3 匹配
    /// （register_rpc + forward_rpc + 响应匹配）→ 结果经 `session_list`
    /// 下行帧回投客户端连接。只读查询：无 outbox/队列/副作用，失败回
    /// `action_error`（不静默）。submit 层面返回 Accepted（chat_channel 发
    /// accepted ack），结果帧随后异步到达。
    async fn exec_session_list(
        &self,
        ctx: &ConnectionCtx,
        action: &ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
        command_id: &str,
    ) -> SubmitAck {
        let payload = match action {
            ActionEnvelope::SessionList { payload, .. } => payload,
            _ => unreachable!("dispatch guarantees session/list"),
        };
        match self
            .inner
            .session_catalog
            .query(ctx, payload, tx, command_id)
            .await
        {
            Ok(()) => SubmitAck::Accepted {
                command_id: command_id.to_string(),
            },
            Err(error) => SubmitAck::Failed(error),
        }
    }

    async fn exec_mcp_control(
        &self,
        action: &ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
        command_id: &str,
        read_only: bool,
    ) -> SubmitAck {
        let result = match action {
            ActionEnvelope::McpList { payload, .. } => {
                self.inner
                    .mcp_control
                    .list(command_id, &payload.chat_id, tx)
                    .await
            }
            ActionEnvelope::McpOAuthStart { payload, .. } => {
                self.inner.mcp_control.start(command_id, payload, tx).await
            }
            ActionEnvelope::McpOAuthAuthorization { payload, .. } => {
                self.inner
                    .mcp_control
                    .authorization(command_id, payload, tx)
                    .await
            }
            ActionEnvelope::McpOAuthCancel { payload, .. } => {
                self.inner.mcp_control.cancel(command_id, payload, tx).await
            }
            ActionEnvelope::McpAppOpen { payload, .. } => {
                self.inner
                    .mcp_apps_control
                    .open(command_id, payload, tx, read_only)
                    .await
            }
            ActionEnvelope::McpAppResource { payload, .. } => {
                self.inner
                    .mcp_apps_control
                    .resource(command_id, payload, tx, read_only)
                    .await
            }
            ActionEnvelope::McpAppCall { payload, .. } => {
                self.inner
                    .mcp_apps_control
                    .call(command_id, payload, tx, read_only)
                    .await
            }
            _ => unreachable!("dispatch guarantees MCP control action"),
        };
        match result {
            Ok(()) => SubmitAck::Handled,
            Err(error) => SubmitAck::Failed(error),
        }
    }

    async fn exec_rewind_query(
        &self,
        action: &ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
        command_id: &str,
    ) -> SubmitAck {
        let run = match action {
            ActionEnvelope::RewindCandidates { payload, .. } => {
                self.inner
                    .session_rewind
                    .start_candidates(command_id, payload)
                    .await
            }
            ActionEnvelope::RewindPreview { payload, .. } => {
                self.inner
                    .session_rewind
                    .start_preview(command_id, payload)
                    .await
            }
            _ => unreachable!("dispatch guarantees rewind query action"),
        };
        let run = match run {
            Ok(run) => run,
            Err(error) => return SubmitAck::Failed(error),
        };
        tokio::spawn(async move {
            let frame = match run.execute().await {
                Ok(frame) => frame,
                Err(error) => Frame::ActionError(error),
            };
            let _ = tx.send(OutboundMsg::Frame(frame)).await;
        });
        SubmitAck::Accepted {
            command_id: command_id.to_string(),
        }
    }

    /// Read-only, body-free recovery view for a logical session. Authorization
    /// begins at the catalog identity; historical chat ids are resolved only
    /// from server-owned provenance.
    async fn exec_prompt_status(
        &self,
        _ctx: &ConnectionCtx,
        action: &ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
        command_id: &str,
    ) -> SubmitAck {
        let ActionEnvelope::PersistedSessionPromptStatus { payload, .. } = action else {
            unreachable!("dispatch guarantees session/prompt-status")
        };
        let Some(projects) = self.inner.projects.read().await.clone() else {
            return SubmitAck::Failed(action_error(
                command_id.to_string(),
                ErrorCode::AgentUnavailable,
                "project catalog unavailable",
                true,
            ));
        };
        let recovery = PromptRecovery::new(
            self.inner.store.clone(),
            projects,
            self.inner.history_sink.read().await.clone(),
        );
        let prepared = match recovery.prepare_status(&payload.session_id).await {
            Ok(prepared) => prepared,
            Err(PromptRecoveryError::SessionNotFound) => {
                return SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::InvalidState,
                    "session not found",
                    false,
                ));
            }
            Err(_) => {
                return SubmitAck::Failed(action_error(
                    command_id.to_string(),
                    ErrorCode::AgentUnavailable,
                    "session runtime history unavailable",
                    true,
                ));
            }
        };
        let response_command_id = command_id.to_string();
        tokio::spawn(async move {
            let report = prepared.execute().await;
            let _ = tx
                .send(OutboundMsg::Frame(Frame::PromptStatus(PromptStatusFrame {
                    command_id: response_command_id,
                    session_id: report.session_id,
                    runtime_restored: false,
                    truncated: report.truncated,
                    evidence_incomplete: report.evidence_incomplete,
                    prompts: report.prompts,
                })))
                .await;
        });
        SubmitAck::Accepted {
            command_id: command_id.to_string(),
        }
    }

    /// Project-scoped ACP session discovery. Unlike legacy `session/list`, the
    /// caller does not need an already-active logical session. A live runtime
    /// for the same project is reused when available; otherwise a private
    /// initialize/list/kill process is created without registering a normal
    /// runtime chat or logical session in Registry/SQLite. It receives only a
    /// private heartbeat-ownership lease in ChatRegistry.
    async fn exec_project_session_discover(
        &self,
        ctx: &ConnectionCtx,
        action: ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> SubmitAck {
        let (command_id, project_id) = match action {
            ActionEnvelope::PersistedSessionDiscover {
                command_id,
                payload,
            } => (command_id, payload.project_id),
            _ => unreachable!("dispatch guarantees session/discover"),
        };
        if Uuid::parse_str(&command_id).is_err() {
            return SubmitAck::Failed(action_error(
                command_id,
                ErrorCode::InvalidState,
                "invalid commandId",
                false,
            ));
        }
        let run = match self.inner.session_discovery.start(&project_id).await {
            Ok(run) => run,
            Err(DiscoveryStartError::CatalogUnavailable) => {
                return SubmitAck::Failed(action_error(
                    command_id,
                    ErrorCode::AgentUnavailable,
                    "metadata catalog unavailable",
                    true,
                ));
            }
            Err(DiscoveryStartError::ActiveProjectNotFound) => {
                return SubmitAck::Failed(action_error(
                    command_id,
                    ErrorCode::InvalidState,
                    "active project not found",
                    false,
                ));
            }
            Err(DiscoveryStartError::AlreadyInProgress) => {
                return SubmitAck::Failed(action_error(
                    command_id,
                    ErrorCode::InvalidState,
                    "session discovery already in progress for this project",
                    true,
                ));
            }
        };
        let cmd = ExecCmd {
            ctx: ctx.clone(),
            chat_id: String::new(),
            action: ActionEnvelope::PersistedSessionDiscover {
                command_id: command_id.clone(),
                payload: peri_studio_proto::action::ProjectArchivePayload {
                    project_id: project_id.clone(),
                },
            },
            tx,
        };
        self.send_discovery_ack(
            &cmd,
            AckStatus::Accepted,
            Some(&project_id),
            None,
            None,
            None,
        )
        .await;
        let me = self.clone();
        tokio::spawn(async move {
            let result = run.execute().await;
            match result {
                Ok(_) => {
                    audit(
                        "session.discover",
                        Some(&command_id),
                        Some(&cmd.ctx.token_id),
                        "ok",
                        std::time::Duration::ZERO,
                        None,
                    );
                    me.send_discovery_ack(
                        &cmd,
                        AckStatus::Committed,
                        Some(&project_id),
                        None,
                        None,
                        None,
                    )
                    .await;
                }
                Err(message) => {
                    me.send_error(&cmd, ErrorCode::AgentUnavailable, &message, true)
                        .await;
                }
            }
        });
        SubmitAck::Handled
    }

    async fn send_discovery_ack(
        &self,
        cmd: &ExecCmd,
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
}
