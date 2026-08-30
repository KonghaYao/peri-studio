//! `RuntimeCreation` 的执行路径拆分（结构拆分，行为不变）。
//!
//! 原 `runtime_creation.rs` 超过 500 行，按主题拆为四个文件（同一
//! `impl RuntimeCreation` 分散定义）：
//!
//! - 本文件：`execute_inner` 串行执行主路径 + `fail` 出口——负责跨每个
//!   持久化投递屏障（intent → barrier → dispatched → delivery_confirmed）
//!   与 spawn/initialize RPC 转发，失败统一收敛到 `fail` → `adjudicate`；
//! - `runtime_creation_bind.rs`：`bind_session`（session/load 与 session/new
//!   双路径的 ACP 会话绑定与投影提交）；
//! - `runtime_creation_cleanup.rs`：`adjudicate` 失败裁决（清理证明、持久化
//!   标记、本地回滚）与 `unknown`/`instance_error_code`/`extract_session_id`
//!   纯辅助函数。
//!
//! 职责边界：本文件只做「驱动与屏障推进」，不持有失败裁决语义（裁决在
//! cleanup 模块）也不持有会话绑定语义（绑定在 bind 模块）。

use chrono::Utc;
use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::instance::InstanceSpawn;
use crate::channel::spawn_env::default_acp_spawn_env;
use tracing::warn;
use uuid::Uuid;

use crate::channel::command_coordinator::{extract_command_id, ExecCmd};
use crate::channel::runtime_creation::{
    CreateFailureBoundary, CreateFailureRequest, CreateTerminal, RuntimeCreation,
    RuntimeCreationTerminalPort, SessionBindingRun,
};
use crate::channel::runtime_creation_cleanup::{instance_error_code, unknown};
use crate::channel::DEFAULT_INSTANCE_ID;
use crate::control::{InstanceError, SpawnOutcome};
use crate::protocol::negotiated_peri_extensions;
use crate::state::doc_manager::{DocCommand, SubmitResult};

impl RuntimeCreation {
    pub(super) async fn execute_inner(
        &self,
        command: &ExecCmd,
        terminal: &dyn RuntimeCreationTerminalPort,
    ) {
        let command_id_text = extract_command_id(&command.action).unwrap_or_default();
        let command_id = match Uuid::parse_str(&command_id_text) {
            Ok(command_id) => command_id,
            Err(_) => {
                terminal
                    .error(
                        command,
                        CreateTerminal {
                            code: ErrorCode::InvalidState,
                            message: "invalid commandId".into(),
                            retryable: false,
                        },
                    )
                    .await;
                return;
            }
        };
        let chat_id = command.chat_id.clone();
        let payload = match &command.action {
            ActionEnvelope::Create { payload, .. } => payload,
            _ => unreachable!("RuntimeCreation queue accepts only chat/create"),
        };
        let instance_id = payload
            .instance_id
            .clone()
            .unwrap_or_else(|| DEFAULT_INSTANCE_ID.to_string());
        let Some(entry) = self.chats.entry(&chat_id).await else {
            self.fail(
                terminal,
                command,
                CreateFailureRequest {
                    chat_id: &chat_id,
                    instance_id: &instance_id,
                    command_id,
                    code: ErrorCode::ChatNotFound,
                    message: "chat not found",
                    boundary: CreateFailureBoundary::LocalOnly,
                },
            )
            .await;
            return;
        };
        let cwd = entry.cwd;
        let Some(store) = Uuid::parse_str(&chat_id)
            .ok()
            .and_then(|chat_id| self.store.chat(chat_id))
        else {
            terminal
                .error(
                    command,
                    unknown("create evidence is unavailable; automatic retry is blocked"),
                )
                .await;
            return;
        };
        if let Err(error) = store.outbox().lock().await.mark_intent_durable(command_id) {
            warn!(chat_id, ?error, "mark_intent_durable failed");
            self.fail(
                terminal,
                command,
                CreateFailureRequest {
                    chat_id: &chat_id,
                    instance_id: &instance_id,
                    command_id,
                    code: ErrorCode::AgentUnavailable,
                    message: "create intent could not be persisted",
                    boundary: CreateFailureBoundary::LocalOnly,
                },
            )
            .await;
            return;
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_no_redelivery_barrier(command_id, Utc::now())
        {
            warn!(chat_id, ?error, "create dispatch barrier record failed");
            self.fail(
                terminal,
                command,
                CreateFailureRequest {
                    chat_id: &chat_id,
                    instance_id: &instance_id,
                    command_id,
                    code: ErrorCode::AgentUnavailable,
                    message: "create dispatch barrier could not be persisted",
                    boundary: CreateFailureBoundary::LocalOnly,
                },
            )
            .await;
            return;
        }

        let spawn = InstanceSpawn {
            command_id: command_id_text.clone(),
            chat_id: chat_id.clone(),
            cmd: self.acp_cmd.clone(),
            cwd: cwd.clone(),
            env: default_acp_spawn_env(),
        };
        let spawn_ack = match tokio::time::timeout(
            self.spawn_timeout,
            self.instance.send_spawn(&instance_id, spawn),
        )
        .await
        {
            Ok(Ok(SpawnOutcome::Acked(ack))) => ack,
            Ok(Err(error)) => {
                let boundary = match error {
                    InstanceError::UnknownInstance(_) | InstanceError::Offline => {
                        CreateFailureBoundary::LocalOnly
                    }
                    InstanceError::Timeout
                    | InstanceError::ConnectionGone
                    | InstanceError::ForwardRejected(_) => {
                        CreateFailureBoundary::RuntimeCleanupRequired
                    }
                    // spawn 不会产生 MalformedFrame（防御分支）：协议 bug 属
                    // 本地失败，无需 runtime 清理。
                    InstanceError::MalformedFrame(_) | InstanceError::ResourceUnsupported => {
                        CreateFailureBoundary::LocalOnly
                    }
                };
                let code = instance_error_code(&error);
                self.fail(
                    terminal,
                    command,
                    CreateFailureRequest {
                        chat_id: &chat_id,
                        instance_id: &instance_id,
                        command_id,
                        code,
                        message: "spawn failed",
                        boundary,
                    },
                )
                .await;
                return;
            }
            Err(_) => {
                self.fail(
                    terminal,
                    command,
                    CreateFailureRequest {
                        chat_id: &chat_id,
                        instance_id: &instance_id,
                        command_id,
                        code: ErrorCode::AgentUnavailable,
                        message: "spawn timeout (10s)",
                        boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                    },
                )
                .await;
                return;
            }
        };
        if !spawn_ack.ok {
            self.fail(
                terminal,
                command,
                CreateFailureRequest {
                    chat_id: &chat_id,
                    instance_id: &instance_id,
                    command_id,
                    code: ErrorCode::AgentUnavailable,
                    message: "agent spawn failed",
                    boundary: CreateFailureBoundary::LocalOnly,
                },
            )
            .await;
            return;
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_dispatched(command_id, Utc::now())
        {
            warn!(chat_id, ?error, "mark_dispatched failed");
            self.fail(
                terminal,
                command,
                CreateFailureRequest {
                    chat_id: &chat_id,
                    instance_id: &instance_id,
                    command_id,
                    code: ErrorCode::AgentUnavailable,
                    message: "spawn succeeded but dispatch state was not persisted",
                    boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                },
            )
            .await;
            return;
        }
        if let Err(error) = store
            .outbox()
            .lock()
            .await
            .mark_delivery_confirmed(command_id)
        {
            warn!(chat_id, ?error, "mark_delivery_confirmed failed");
            self.fail(
                terminal,
                command,
                CreateFailureRequest {
                    chat_id: &chat_id,
                    instance_id: &instance_id,
                    command_id,
                    code: ErrorCode::AgentUnavailable,
                    message: "spawn succeeded but delivery state was not persisted",
                    boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                },
            )
            .await;
            return;
        }

        let (initialize_id, initialize_message) = self.translator.initialize_rpc(&cwd);
        let initialize_response = self
            .relay
            .register_rpc(&initialize_id, command_id_text.clone())
            .await;
        if let Err(error) = self
            .instance
            .forward_rpc(&instance_id, &chat_id, &initialize_message)
            .await
        {
            self.relay.cancel_rpc(&initialize_id).await;
            self.fail(
                terminal,
                command,
                CreateFailureRequest {
                    chat_id: &chat_id,
                    instance_id: &instance_id,
                    command_id,
                    code: instance_error_code(&error),
                    message: "initialize forward failed",
                    boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                },
            )
            .await;
            return;
        }
        let negotiated_extensions =
            match tokio::time::timeout(self.initialize_timeout, initialize_response).await {
                Ok(Ok(response)) if response.get("error").is_none() => {
                    negotiated_peri_extensions(&response)
                }
                Ok(Ok(_)) => {
                    self.relay.cancel_rpc(&initialize_id).await;
                    self.fail(
                        terminal,
                        command,
                        CreateFailureRequest {
                            chat_id: &chat_id,
                            instance_id: &instance_id,
                            command_id,
                            code: ErrorCode::AgentUnavailable,
                            message: "initialize rejected",
                            boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                        },
                    )
                    .await;
                    return;
                }
                Ok(Err(_)) | Err(_) => {
                    self.relay.cancel_rpc(&initialize_id).await;
                    self.fail(
                        terminal,
                        command,
                        CreateFailureRequest {
                            chat_id: &chat_id,
                            instance_id: &instance_id,
                            command_id,
                            code: ErrorCode::AgentUnavailable,
                            message: "initialize timeout (10s)",
                            boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                        },
                    )
                    .await;
                    return;
                }
            };
        if !matches!(
            self.doc
                .submit_command(
                    &chat_id,
                    DocCommand::SetAgentExtensions {
                        extensions: negotiated_extensions.clone(),
                    },
                )
                .await,
            SubmitResult::Applied(_)
        ) {
            self.fail(
                terminal,
                command,
                CreateFailureRequest {
                    chat_id: &chat_id,
                    instance_id: &instance_id,
                    command_id,
                    code: ErrorCode::AgentUnavailable,
                    message: "agent extension projection failed",
                    boundary: CreateFailureBoundary::RuntimeCleanupRequired,
                },
            )
            .await;
            return;
        }
        self.chats
            .set_extensions(&chat_id, &negotiated_extensions)
            .await;

        self.bind_session(
            terminal,
            SessionBindingRun {
                command,
                command_id,
                command_id_text: &command_id_text,
                chat_id: &chat_id,
                instance_id: &instance_id,
                cwd: &cwd,
                payload,
                store,
            },
        )
        .await;
    }

    pub(super) async fn fail(
        &self,
        terminal: &dyn RuntimeCreationTerminalPort,
        command: &ExecCmd,
        request: CreateFailureRequest<'_>,
    ) {
        let verdict = self.adjudicate(request).await;
        terminal.error(command, verdict).await;
    }
}
