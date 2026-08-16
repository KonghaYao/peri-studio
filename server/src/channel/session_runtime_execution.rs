//! session/load 与 session/new 的 RPC 执行段（与 prepare/lease 分离）：
//! 切换 binding、回放窗口（BeginLoadReplay/EndLoadReplay）、L3 匹配
//! （register_rpc + forward_rpc + 响应匹配）与失败回滚。
//!
//! 本文件与 `session_runtime_operations.rs`（租赁/准备）同属
//! [`SessionRuntimeOperations`] 的实现；字段经 `pub(super)` 在 channel 模块
//! 内共享（结构拆分，行为语义不变）。

use tracing::warn;

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::{ActionEnvelope, SessionNewChatPayload};

use crate::channel::session_runtime_operations::{
    SessionOperationFailure, SessionOperationOutcome, SessionRuntimeOperations,
};
use crate::control::{ChatError, InstanceError};
use crate::protocol::{normalize_agent_config, OutboundCtx, OutboundMessage};
use crate::state::doc_manager::{DocCommand, SubmitResult};

impl SessionRuntimeOperations {
    pub(super) async fn execute_load(
        &self,
        command_id: &str,
        chat_id: &str,
        instance_id: &str,
        cwd: &str,
        target_session_id: &str,
        previous_session_id: &str,
    ) -> Result<SessionOperationOutcome, SessionOperationFailure> {
        if let Err(error) = self.chats.switch_session(chat_id, target_session_id).await {
            let message = match error {
                ChatError::BindingConflict(existing) => format!(
                    "ACP session is already open in chat {existing}; switch from the session list"
                ),
                other => format!("pre-bind failed: {other}"),
            };
            return Err(failure(
                ErrorCode::InvalidState,
                message,
                false,
                "pre_bind_failed",
            ));
        }
        if !matches!(
            self.doc
                .submit_command(
                    chat_id,
                    DocCommand::BeginLoadReplay {
                        acp_session_id: target_session_id.to_string(),
                    },
                )
                .await,
            SubmitResult::Applied(_)
        ) {
            self.restore_load(chat_id, previous_session_id).await;
            return Err(failure(
                ErrorCode::AgentUnavailable,
                "begin replay failed",
                true,
                "begin_replay_rejected",
            ));
        }

        let (rpc_id, message) = self.translator.session_load_rpc(cwd, target_session_id);
        let rx = self
            .relay
            .register_rpc(&rpc_id, command_id.to_string())
            .await;
        if let Err(error) = self
            .instance
            .forward_rpc(instance_id, chat_id, &message)
            .await
        {
            self.relay.cancel_rpc(&rpc_id).await;
            self.restore_load(chat_id, previous_session_id).await;
            return Err(failure(
                ErrorCode::InstanceOffline,
                format!("session load forward failed: {error}"),
                true,
                "forward_failed",
            ));
        }
        match tokio::time::timeout(self.load_timeout, rx).await {
            Ok(Ok(response)) if response.get("error").is_none() => {
                if !matches!(
                    self.doc
                        .submit_command(chat_id, DocCommand::EndLoadReplay)
                        .await,
                    SubmitResult::Applied(_)
                ) {
                    return Err(failure(
                        ErrorCode::AgentUnavailable,
                        "end replay failed",
                        true,
                        "end_replay_failed",
                    ));
                }
                Ok(SessionOperationOutcome::Loaded {
                    chat_id: chat_id.to_string(),
                })
            }
            Ok(Ok(_)) => {
                self.relay.cancel_rpc(&rpc_id).await;
                self.restore_load(chat_id, previous_session_id).await;
                Err(failure(
                    ErrorCode::AgentUnavailable,
                    "session/load rejected",
                    true,
                    "rejected",
                ))
            }
            _ => {
                self.relay.cancel_rpc(&rpc_id).await;
                self.restore_load(chat_id, previous_session_id).await;
                Err(failure(
                    ErrorCode::AgentUnavailable,
                    "session/load timeout",
                    true,
                    "timeout",
                ))
            }
        }
    }

    async fn restore_load(&self, chat_id: &str, previous_session_id: &str) {
        if !matches!(
            self.doc
                .submit_command(chat_id, DocCommand::EndLoadReplay)
                .await,
            SubmitResult::Applied(_)
        ) {
            warn!(chat_id, "load failure: end replay restoration failed");
        }
        if let Err(error) = self
            .chats
            .switch_session(chat_id, previous_session_id)
            .await
        {
            warn!(chat_id, error = ?error, "load failure: restore session failed");
        }
        if !matches!(
            self.doc
                .submit_command(
                    chat_id,
                    DocCommand::SetAgentSessionId {
                        acp_session_id: previous_session_id.to_string(),
                    },
                )
                .await,
            SubmitResult::Applied(_)
        ) {
            warn!(chat_id, "load failure: restore session projection failed");
        }
    }

    pub(super) async fn execute_new(
        &self,
        command_id: &str,
        chat_id: &str,
        instance_id: &str,
        cwd: &str,
    ) -> Result<SessionOperationOutcome, SessionOperationFailure> {
        let action = ActionEnvelope::SessionNew {
            command_id: command_id.to_string(),
            payload: SessionNewChatPayload {
                chat_id: chat_id.to_string(),
            },
        };
        let message = match self.translator.translate(
            &action,
            &OutboundCtx {
                cwd: cwd.to_string(),
                acp_session_id: String::new(),
            },
        ) {
            Ok(OutboundMessage::JsonRpc(message)) => message,
            _ => {
                return Err(failure(
                    ErrorCode::InvalidState,
                    "translate failed",
                    false,
                    "translate_failed",
                ))
            }
        };
        let rpc_id = message["id"].as_str().unwrap_or_default().to_string();
        let rx = self
            .relay
            .register_rpc(&rpc_id, command_id.to_string())
            .await;
        if let Err(error) = self
            .instance
            .forward_rpc(instance_id, chat_id, &message)
            .await
        {
            self.relay.cancel_rpc(&rpc_id).await;
            return Err(match error {
                InstanceError::Timeout | InstanceError::ConnectionGone => failure(
                    ErrorCode::DeliveryUnknown,
                    "session/new may have reached ACP; automatic retry is blocked",
                    false,
                    "forward_unknown",
                ),
                other => failure(
                    ErrorCode::InstanceOffline,
                    format!("session new forward failed: {other}"),
                    true,
                    "forward_failed",
                ),
            });
        }

        match tokio::time::timeout(self.new_timeout, rx).await {
            Ok(Ok(response)) if response.get("error").is_none() => {
                let Some(new_session_id) = extract_session_id(&response) else {
                    self.relay.cancel_rpc(&rpc_id).await;
                    return Err(failure(
                        ErrorCode::DeliveryUnknown,
                        "session/new succeeded without a recoverable sessionId; automatic retry is blocked",
                        false,
                        "missing_session_id",
                    ));
                };
                if let Err(error) = self.chats.bind(chat_id, &new_session_id, true).await {
                    let detail = match error {
                        ChatError::BindingConflict(existing) => format!(
                            "ACP session was created but is already bound to chat {existing}; automatic retry is blocked"
                        ),
                        other => format!(
                            "ACP session was created but binding failed ({other}); automatic retry is blocked"
                        ),
                    };
                    return Err(failure(
                        ErrorCode::DeliveryUnknown,
                        detail,
                        false,
                        "bind_failed",
                    ));
                }
                if !matches!(
                    self.doc
                        .submit_command(
                            chat_id,
                            DocCommand::SetAgentSessionId {
                                acp_session_id: new_session_id.clone(),
                            },
                        )
                        .await,
                    SubmitResult::Applied(_)
                ) {
                    return Err(failure(
                        ErrorCode::DeliveryUnknown,
                        "ACP session was created but its projection could not be persisted; automatic retry is blocked",
                        false,
                        "session_projection_failed",
                    ));
                }
                if let Some(config) = response
                    .get("result")
                    .and_then(serde_json::Value::as_object)
                    .and_then(|result| result.get("configOptions"))
                    .and_then(serde_json::Value::as_array)
                {
                    if let Ok(config) = normalize_agent_config(config) {
                        let crate::protocol::AgentConfigSnapshot {
                            model,
                            effort,
                            options,
                        } = config;
                        self.chats
                            .set_config_catalog(chat_id, options.clone())
                            .await;
                        if !matches!(
                            self.doc
                                .submit_command(
                                    chat_id,
                                    DocCommand::SetAgentConfig {
                                        model,
                                        effort,
                                        config_options: Some(options),
                                    },
                                )
                                .await,
                            SubmitResult::Applied(_)
                        ) {
                            warn!(chat_id, "session/new config projection failed");
                        }
                    }
                }
                Ok(SessionOperationOutcome::Created {
                    chat_id: chat_id.to_string(),
                    acp_session_id: new_session_id,
                })
            }
            Ok(Ok(_)) => {
                self.relay.cancel_rpc(&rpc_id).await;
                Err(failure(
                    ErrorCode::AgentUnavailable,
                    "session/new rejected",
                    true,
                    "rejected",
                ))
            }
            _ => {
                self.relay.cancel_rpc(&rpc_id).await;
                Err(failure(
                    ErrorCode::DeliveryUnknown,
                    "session/new response was not confirmed; automatic retry is blocked",
                    false,
                    "timeout_unknown",
                ))
            }
        }
    }
}

fn failure(
    code: ErrorCode,
    message: impl Into<String>,
    retryable: bool,
    audit_outcome: &'static str,
) -> SessionOperationFailure {
    SessionOperationFailure {
        code,
        message: message.into(),
        retryable,
        audit_outcome,
    }
}

fn extract_session_id(response: &serde_json::Value) -> Option<String> {
    let result = response.get("result")?;
    if let Some(value) = result.get("sessionId").and_then(serde_json::Value::as_str) {
        return Some(value.to_string());
    }
    if let Some(value) = result.get("session_id").and_then(serde_json::Value::as_str) {
        return Some(value.to_string());
    }
    result.as_str().map(str::to_string)
}
