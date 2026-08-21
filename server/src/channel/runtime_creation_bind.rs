//! `RuntimeCreation` 的会话绑定路径拆分（结构拆分，行为不变）。
//!
//! 原 `runtime_creation.rs` 超过 500 行，按主题拆为四个文件（同一
//! `impl RuntimeCreation` 分散定义）：
//!
//! - `runtime_creation_exec.rs`：`execute_inner` 串行执行主路径 + `fail` 出口；
//! - 本文件：`bind_session`——session/load 与 session/new 双路径：
//!   pre-bind 接管（bind_recovering）/新建绑定（bind）、RPC 注册与转发、
//!   响应解析（sessionId/configOptions）、投影提交（SetAgentConfig /
//!   SetAgentSessionId / BeginLoadReplay / EndLoadReplay）、outbox 终态
//!   标记（projection_committed/completed）与 committed 通知；
//! - `runtime_creation_cleanup.rs`：`adjudicate` 失败裁决与本地回滚原语。
//!
//! 职责边界：本文件只做「ACP 会话的绑定与提交」，屏障推进在 exec 模块，
//! 失败裁决在 cleanup 模块；双路径分支（load vs new）的语义差异仅存在于
//! 本文件。

use peri_studio_proto::ack::ErrorCode;
use tracing::warn;

use crate::auth::audit::audit;
use crate::channel::runtime_creation::{
    CreateFailureBoundary, CreateFailureRequest, RuntimeCreation, RuntimeCreationTerminalPort,
    SessionBindingRun,
};
use crate::channel::runtime_creation_cleanup::{extract_session_id, instance_error_code};
use crate::control::{ChatError, ChatState, InstanceError};
use crate::protocol::normalize_agent_config;
use crate::state::doc_manager::{DocCommand, SubmitResult};

impl RuntimeCreation {
    pub(super) async fn bind_session(
        &self,
        terminal: &dyn RuntimeCreationTerminalPort,
        run: SessionBindingRun<'_>,
    ) {
        let load_session = run.payload.acp_session_id.clone();
        let (rpc_id, message) = if let Some(session_id) = &load_session {
            // 恢复 open（spawn + session/load）：pre-bind 使用接管语义——
            // 重启后视图重建 + 对账 missing 残留的 stale binding 无存活
            // 证据（runtime_confirmed=false），必须允许迁移到新 runtime
            // chat；否则 BindingConflict → create 失败 → instance/kill
            // 杀掉刚 spawn 的进程（§8.3 恢复场景回归）。
            if let Err(error) = self
                .chats
                .bind_recovering(run.chat_id, session_id, true)
                .await
            {
                let message = match error {
                    ChatError::BindingConflict(existing) => format!(
                        "ACP session is already open in chat {existing}; switch from the session list"
                    ),
                    other => format!("pre-bind failed: {other}"),
                };
                self.fail(
                    terminal,
                    run.command,
                    CreateFailureRequest {
                        chat_id: run.chat_id,
                        instance_id: run.instance_id,
                        command_id: run.command_id,
                        code: ErrorCode::InvalidState,
                        message: &message,
                        boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                    },
                )
                .await;
                return;
            }
            if !matches!(
                self.doc
                    .submit_command(
                        run.chat_id,
                        DocCommand::BeginLoadReplay {
                            acp_session_id: session_id.clone(),
                        },
                    )
                    .await,
                SubmitResult::Applied(_)
            ) {
                self.fail(
                    terminal,
                    run.command,
                    CreateFailureRequest {
                        chat_id: run.chat_id,
                        instance_id: run.instance_id,
                        command_id: run.command_id,
                        code: ErrorCode::AgentUnavailable,
                        message: "begin replay failed",
                        boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                    },
                )
                .await;
                return;
            }
            self.translator.session_load_rpc(run.cwd, session_id)
        } else {
            self.translator
                .session_new_rpc(run.cwd, run.payload.title.as_deref())
        };
        let response = self
            .relay
            .register_rpc(&rpc_id, run.command_id_text.to_string())
            .await;
        if let Err(error) = self
            .instance
            .forward_rpc(run.instance_id, run.chat_id, &message)
            .await
        {
            self.relay.cancel_rpc(&rpc_id).await;
            let operation = if load_session.is_some() {
                "session/load"
            } else {
                "session/new"
            };
            let boundary =
                if load_session.is_some() || matches!(error, InstanceError::ForwardRejected(_)) {
                    CreateFailureBoundary::RuntimeCleanupRequired
                } else {
                    CreateFailureBoundary::DurableSessionUnknown
                };
            let failure_message = format!("{operation} forward failed");
            self.fail(
                terminal,
                run.command,
                CreateFailureRequest {
                    chat_id: run.chat_id,
                    instance_id: run.instance_id,
                    command_id: run.command_id,
                    code: instance_error_code(&error),
                    message: &failure_message,
                    boundary,
                },
            )
            .await;
            return;
        }

        let session_id = match &load_session {
            Some(session_id) => match tokio::time::timeout(self.binding_timeout, response).await {
                Ok(Ok(response)) if response.get("error").is_none() => session_id.clone(),
                Ok(Ok(_)) => {
                    self.relay.cancel_rpc(&rpc_id).await;
                    self.fail(
                        terminal,
                        run.command,
                        CreateFailureRequest {
                            chat_id: run.chat_id,
                            instance_id: run.instance_id,
                            command_id: run.command_id,
                            code: ErrorCode::AgentUnavailable,
                            message: "session/load rejected",
                            boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                        },
                    )
                    .await;
                    return;
                }
                Ok(Err(_)) | Err(_) => {
                    self.relay.cancel_rpc(&rpc_id).await;
                    self.fail(
                        terminal,
                        run.command,
                        CreateFailureRequest {
                            chat_id: run.chat_id,
                            instance_id: run.instance_id,
                            command_id: run.command_id,
                            code: ErrorCode::AgentUnavailable,
                            message: "binding timeout (30s)",
                            boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                        },
                    )
                    .await;
                    return;
                }
            },
            None => match tokio::time::timeout(self.binding_timeout, response).await {
                Ok(Ok(response)) if response.get("error").is_none() => {
                    let Some(session_id) = extract_session_id(&response) else {
                        self.fail(
                            terminal,
                            run.command,
                            CreateFailureRequest {
                                chat_id: run.chat_id,
                                instance_id: run.instance_id,
                                command_id: run.command_id,
                                code: ErrorCode::AgentUnavailable,
                                message: "session/new returned no session id",
                                boundary: CreateFailureBoundary::DurableSessionUnknown,
                            },
                        )
                        .await;
                        return;
                    };
                    if let Some(options) = response
                        .get("result")
                        .and_then(serde_json::Value::as_object)
                        .and_then(|result| result.get("configOptions"))
                        .and_then(serde_json::Value::as_array)
                    {
                        let Ok(config) = normalize_agent_config(options) else {
                            self.fail(
                                terminal,
                                run.command,
                                CreateFailureRequest {
                                    chat_id: run.chat_id,
                                    instance_id: run.instance_id,
                                    command_id: run.command_id,
                                    code: ErrorCode::AgentUnavailable,
                                    message: "agent returned an invalid config catalog",
                                    boundary: CreateFailureBoundary::DurableSessionUnknown,
                                },
                            )
                            .await;
                            return;
                        };
                        let crate::protocol::AgentConfigSnapshot {
                            model,
                            effort,
                            options,
                        } = config;
                        self.chats
                            .set_config_catalog(run.chat_id, options.clone())
                            .await;
                        if !matches!(
                            self.doc
                                .submit_command(
                                    run.chat_id,
                                    DocCommand::SetAgentConfig {
                                        model,
                                        effort,
                                        config_options: Some(options),
                                    },
                                )
                                .await,
                            SubmitResult::Applied(_)
                        ) {
                            self.fail(
                                terminal,
                                run.command,
                                CreateFailureRequest {
                                    chat_id: run.chat_id,
                                    instance_id: run.instance_id,
                                    command_id: run.command_id,
                                    code: ErrorCode::AgentUnavailable,
                                    message: "agent config projection failed",
                                    boundary: CreateFailureBoundary::DurableSessionUnknown,
                                },
                            )
                            .await;
                            return;
                        }
                    }
                    session_id
                }
                Ok(Ok(_)) => {
                    self.relay.cancel_rpc(&rpc_id).await;
                    self.fail(
                        terminal,
                        run.command,
                        CreateFailureRequest {
                            chat_id: run.chat_id,
                            instance_id: run.instance_id,
                            command_id: run.command_id,
                            code: ErrorCode::AgentUnavailable,
                            message: "session/new rejected",
                            boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                        },
                    )
                    .await;
                    return;
                }
                Ok(Err(_)) | Err(_) => {
                    self.relay.cancel_rpc(&rpc_id).await;
                    self.fail(
                        terminal,
                        run.command,
                        CreateFailureRequest {
                            chat_id: run.chat_id,
                            instance_id: run.instance_id,
                            command_id: run.command_id,
                            code: ErrorCode::AgentUnavailable,
                            message: "binding timeout (30s)",
                            boundary: CreateFailureBoundary::DurableSessionUnknown,
                        },
                    )
                    .await;
                    return;
                }
            },
        };

        if load_session.is_none() {
            if let Err(error) = self.chats.bind(run.chat_id, &session_id, true).await {
                warn!(chat_id = run.chat_id, ?error, "bind failed");
                self.fail(
                    terminal,
                    run.command,
                    CreateFailureRequest {
                        chat_id: run.chat_id,
                        instance_id: run.instance_id,
                        command_id: run.command_id,
                        code: ErrorCode::AgentUnavailable,
                        message: "bind failed",
                        boundary: CreateFailureBoundary::DurableSessionUnknown,
                    },
                )
                .await;
                return;
            }
            if !matches!(
                self.doc
                    .submit_command(
                        run.chat_id,
                        DocCommand::SetAgentSessionId {
                            acp_session_id: session_id.clone(),
                        },
                    )
                    .await,
                SubmitResult::Applied(_)
            ) {
                self.fail(
                    terminal,
                    run.command,
                    CreateFailureRequest {
                        chat_id: run.chat_id,
                        instance_id: run.instance_id,
                        command_id: run.command_id,
                        code: ErrorCode::AgentUnavailable,
                        message: "agent session projection failed",
                        boundary: CreateFailureBoundary::DurableSessionUnknown,
                    },
                )
                .await;
                return;
            }
        } else if !matches!(
            self.doc
                .submit_command(run.chat_id, DocCommand::EndLoadReplay)
                .await,
            SubmitResult::Applied(_)
        ) {
            self.fail(
                terminal,
                run.command,
                CreateFailureRequest {
                    chat_id: run.chat_id,
                    instance_id: run.instance_id,
                    command_id: run.command_id,
                    code: ErrorCode::DeliveryUnknown,
                    message: "session loaded but replay completion projection failed",
                    boundary: CreateFailureBoundary::DurableSessionUnknown,
                },
            )
            .await;
            return;
        }

        if let Err(error) = run
            .store
            .outbox()
            .lock()
            .await
            .mark_projection_committed(run.command_id)
        {
            warn!(
                chat_id = run.chat_id,
                ?error,
                "mark_projection_committed failed"
            );
            self.fail(
                terminal,
                run.command,
                CreateFailureRequest {
                    chat_id: run.chat_id,
                    instance_id: run.instance_id,
                    command_id: run.command_id,
                    code: ErrorCode::DeliveryUnknown,
                    message: "runtime created but projection commit was not persisted",
                    boundary: CreateFailureBoundary::DurableSessionUnknown,
                },
            )
            .await;
            return;
        }
        if let Err(error) = run
            .store
            .outbox()
            .lock()
            .await
            .mark_completed(run.command_id)
        {
            warn!(chat_id = run.chat_id, ?error, "mark_completed failed");
            self.fail(
                terminal,
                run.command,
                CreateFailureRequest {
                    chat_id: run.chat_id,
                    instance_id: run.instance_id,
                    command_id: run.command_id,
                    code: ErrorCode::DeliveryUnknown,
                    message: "runtime created but terminal state was not persisted",
                    boundary: CreateFailureBoundary::DurableSessionUnknown,
                },
            )
            .await;
            return;
        }
        // 防御：spawn 前心跳对账可能已把本 chat 置 Gap（missing 窗口）；
        // spawn + initialize + load 全部成功后进程确已存活，显式恢复
        // 「运行中」呈现（幂等：非 Gap 状态保持；新 chat 无缺口历史，
        // 不涉及 ResumeAfterGap 校准）。
        let _ = self
            .chats
            .transition(run.chat_id, ChatState::Accepting)
            .await;
        terminal.committed(run.command, run.chat_id).await;
        audit(
            "command.committed",
            Some(run.command_id_text),
            Some(&run.command.ctx.token_id),
            "ok",
            std::time::Duration::ZERO,
            None,
        );
    }
}
