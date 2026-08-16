//! 权限决议的失败落库辅助（终态失败 / 交付未知）。
//!
//! 拆分动机：`terminal_failed`（确定性终态失败，非 retryable）与
//! `delivery_unknown`（交付结果未知，阻止自动重试）是 `execute` 与两条交付
//! 轨道收尾共用的失败样板，按"失败落库"主题拆出。既有 failure helper 的
//! 语义（retryable / audit_outcome 映射）保持不变；方法可见性提升为
//! `pub(super)` 仅为了跨子模块调用，对外 pub 面不变。

use std::sync::Arc;

use peri_studio_proto::ack::ErrorCode;
use uuid::Uuid;

use crate::channel::permission_resolution::{
    failure, PermissionResolution, PermissionResolutionFailure, PermissionResolutionOutcome,
};
use crate::persist::outbox::LastError;
use crate::persist::store::ChatStore;

impl PermissionResolution {
    pub(super) async fn terminal_failed(
        &self,
        store: &Arc<ChatStore>,
        command_id: Uuid,
        code: ErrorCode,
        message: &str,
        audit_outcome: &'static str,
    ) -> Result<PermissionResolutionOutcome, PermissionResolutionFailure> {
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
                    "permission terminal failure could not be persisted",
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
    ) -> Result<PermissionResolutionOutcome, PermissionResolutionFailure> {
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
