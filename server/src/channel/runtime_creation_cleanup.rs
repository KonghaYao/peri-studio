//! `RuntimeCreation` 的失败裁决与回滚拆分（结构拆分，行为不变）。
//!
//! 原 `runtime_creation.rs` 超过 500 行，按主题拆为四个文件（同一
//! `impl RuntimeCreation` 分散定义）：
//!
//! - `runtime_creation_exec.rs`：`execute_inner` 串行执行主路径 + `fail` 出口；
//! - `runtime_creation_bind.rs`：`bind_session`（session/load 与 session/new
//!   双路径的 ACP 会话绑定与投影提交）；
//! - 本文件：`adjudicate` 失败裁决（清理证明、持久化标记、本地回滚）与
//!   `rollback_prepared`/`confirm_runtime_absent`/`close_local` 回滚原语，
//!   以及 `unknown`/`instance_error_code`/`extract_session_id` 纯辅助函数。
//!
//! 职责边界：本文件是唯一可清除 create no-redelivery 屏障的裁决者
//! （cleanup 必须被证明，否则结果 fail-closed），并持有全部本地回滚原语。

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::instance::InstanceKill;
use tracing::warn;
use uuid::Uuid;

use crate::channel::runtime_creation::{
    CreateFailureBoundary, CreateFailureRequest, CreateTerminal, RuntimeCreation,
};
use crate::control::{ChatState, InstanceError, KillOutcome};
use crate::persist::outbox::LastError;

impl RuntimeCreation {
    pub async fn adjudicate(&self, request: CreateFailureRequest<'_>) -> CreateTerminal {
        let Some(store) = Uuid::parse_str(request.chat_id)
            .ok()
            .and_then(|chat_id| self.store.chat(chat_id))
        else {
            return unknown("create evidence is unavailable; automatic retry is blocked");
        };

        let cleanup_confirmed = match request.boundary {
            CreateFailureBoundary::LocalOnly => true,
            CreateFailureBoundary::RuntimeCleanupRequired
            | CreateFailureBoundary::DurableSessionUnknown => {
                self.confirm_runtime_absent(request.chat_id, request.instance_id)
                    .await
            }
        };

        if matches!(
            request.boundary,
            CreateFailureBoundary::DurableSessionUnknown
        ) {
            let durable = store
                .outbox()
                .lock()
                .await
                .mark_delivery_unknown(request.command_id)
                .is_ok();
            if cleanup_confirmed {
                self.close_local(request.chat_id, false).await;
            }
            if !durable {
                warn!(
                    chat_id = request.chat_id,
                    command_id = %request.command_id,
                    "create delivery-unknown record failed"
                );
            }
            return unknown("ACP session creation may have occurred; automatic retry is blocked");
        }

        if !cleanup_confirmed {
            let durable = store
                .outbox()
                .lock()
                .await
                .mark_delivery_unknown(request.command_id)
                .is_ok();
            if !durable {
                warn!(
                    chat_id = request.chat_id,
                    command_id = %request.command_id,
                    "ambiguous create cleanup could not be persisted"
                );
            }
            return unknown("runtime cleanup was not confirmed; automatic retry is blocked");
        }

        let barrier_present = store
            .outbox_get(request.command_id)
            .await
            .is_some_and(|record| record.dispatch_barrier_at.is_some());
        if barrier_present
            && store
                .outbox()
                .lock()
                .await
                .mark_create_cleanup_confirmed(
                    request.command_id,
                    LastError::from_error_code(request.code),
                )
                .is_err()
        {
            let _ = store
                .outbox()
                .lock()
                .await
                .mark_delivery_unknown(request.command_id);
            return unknown("runtime cleanup succeeded but durable proof failed; retry is blocked");
        }

        if store
            .outbox()
            .lock()
            .await
            .mark_failed(request.command_id, LastError::from_error_code(request.code))
            .is_err()
        {
            let _ = store
                .outbox()
                .lock()
                .await
                .mark_delivery_unknown(request.command_id);
            return unknown("create failure could not be durably finalized; retry is blocked");
        }
        self.close_local(request.chat_id, true).await;
        CreateTerminal {
            code: request.code,
            message: request.message.to_string(),
            retryable: request.code.default_retryable(),
        }
    }

    /// Roll back preparation before any outbox record or instance child exists.
    pub async fn rollback_prepared(&self, chat_id: &str) {
        self.close_local(chat_id, true).await;
    }

    async fn confirm_runtime_absent(&self, chat_id: &str, instance_id: &str) -> bool {
        let kill = InstanceKill {
            command_id: Uuid::new_v4().to_string(),
            chat_id: chat_id.to_string(),
            grace: None,
        };
        match self.instance.send_kill(instance_id, kill).await {
            Ok(KillOutcome::Acked(ack)) if ack.ok => true,
            Ok(KillOutcome::Acked(_)) => {
                warn!(chat_id, "create cleanup kill was rejected");
                false
            }
            Err(error) => {
                warn!(chat_id, error = ?error, "create cleanup kill was not confirmed");
                false
            }
        }
    }

    async fn close_local(&self, chat_id: &str, remove_store: bool) {
        let _ = self.chats.transition(chat_id, ChatState::Closed).await;
        let _ = self.doc.close_chat(chat_id).await;
        if remove_store {
            if let Ok(chat_id) = Uuid::parse_str(chat_id) {
                let _ = self.store.remove_chat(chat_id);
            }
        }
    }
}

pub(super) fn unknown(message: &str) -> CreateTerminal {
    CreateTerminal {
        code: ErrorCode::DeliveryUnknown,
        message: message.to_string(),
        retryable: false,
    }
}

pub(super) fn instance_error_code(error: &InstanceError) -> ErrorCode {
    match error {
        InstanceError::Offline => ErrorCode::InstanceOffline,
        InstanceError::Timeout
        | InstanceError::ForwardRejected(_)
        | InstanceError::UnknownInstance(_)
        | InstanceError::ConnectionGone => ErrorCode::AgentUnavailable,
        // 协议形态错误：确定性失败（非 retryable，与 default_retryable 一致）。
        InstanceError::MalformedFrame(_) | InstanceError::ResourceUnsupported => {
            ErrorCode::InvalidState
        }
    }
}

pub(super) fn extract_session_id(response: &serde_json::Value) -> Option<String> {
    let result = response.get("result")?;
    if let Some(session_id) = result.get("sessionId").and_then(serde_json::Value::as_str) {
        return Some(session_id.to_string());
    }
    if let Some(session_id) = result.get("session_id").and_then(serde_json::Value::as_str) {
        return Some(session_id.to_string());
    }
    result.as_str().map(str::to_string)
}
