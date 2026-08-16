//! 应答交付的失败落库与线帧构造。
//!
//! 拆分动机：`execute` 主流程与交付前失败（`fail_before_delivery`）、
//! 交付未知（`delivery_unknown`）、响应帧构造（`response_frame`）及
//! instance 错误映射（`definitely_not_delivered` / `instance_error_code`）
//! 合计超 500 行，按"失败落库 + 线帧"主题拆出。既有 failure helper 的
//! 语义（retryable / audit_outcome 映射）与 JSON-RPC 帧形态保持不变；
//! 方法可见性提升为 `pub(super)` 仅为了跨子模块调用，对外 pub 面不变。

use std::collections::BTreeMap;
use std::sync::Arc;

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::{
    ElicitationAnswer, ElicitationResponseAction, RespondElicitationPayload,
};
use uuid::Uuid;

use crate::control::InstanceError;
use crate::persist::outbox::LastError;
use crate::persist::store::ChatStore;

use super::{failure, ElicitationResponse, ElicitationResponseFailure, ElicitationResponseOutcome};

impl ElicitationResponse {
    pub(super) async fn fail_before_delivery(
        &self,
        store: &Arc<ChatStore>,
        command_id: Uuid,
        code: ErrorCode,
        message: &str,
        audit_outcome: &'static str,
    ) -> Result<ElicitationResponseOutcome, ElicitationResponseFailure> {
        let mut error = LastError::from_error_code(code);
        error.retryable = false;
        if store
            .outbox()
            .lock()
            .await
            .mark_failed(command_id, error)
            .is_err()
        {
            return self
                .delivery_unknown(
                    store,
                    command_id,
                    "elicitation failure could not be persisted",
                    "failure_persist_unknown",
                )
                .await;
        }
        Err(failure(code, message, false, audit_outcome))
    }

    pub(super) async fn delivery_unknown(
        &self,
        store: &Arc<ChatStore>,
        command_id: Uuid,
        message: &str,
        audit_outcome: &'static str,
    ) -> Result<ElicitationResponseOutcome, ElicitationResponseFailure> {
        let _ = store
            .outbox()
            .lock()
            .await
            .mark_delivery_unknown(command_id);
        Err(failure(
            ErrorCode::DeliveryUnknown,
            message,
            false,
            audit_outcome,
        ))
    }
}

pub(super) fn response_frame(
    request_id: &serde_json::Value,
    payload: &RespondElicitationPayload,
) -> serde_json::Value {
    let result = match payload.action {
        ElicitationResponseAction::Accept => {
            let content = payload
                .answers
                .iter()
                .map(|(key, value)| {
                    let value = match value {
                        ElicitationAnswer::Text(value) => serde_json::json!(value),
                        ElicitationAnswer::Multiple(values) => serde_json::json!(values),
                    };
                    (key.clone(), value)
                })
                .collect::<BTreeMap<_, _>>();
            serde_json::json!({ "action": "accept", "content": content })
        }
        ElicitationResponseAction::Decline => serde_json::json!({ "action": "decline" }),
        ElicitationResponseAction::Cancel => serde_json::json!({ "action": "cancel" }),
    };
    serde_json::json!({ "jsonrpc": "2.0", "id": request_id, "result": result })
}

pub(super) fn definitely_not_delivered(error: &InstanceError) -> bool {
    matches!(
        error,
        InstanceError::Offline
            | InstanceError::UnknownInstance(_)
            | InstanceError::ForwardRejected(_)
    )
}

pub(super) fn instance_error_code(error: &InstanceError) -> ErrorCode {
    match error {
        InstanceError::Offline => ErrorCode::InstanceOffline,
        _ => ErrorCode::AgentUnavailable,
    }
}
