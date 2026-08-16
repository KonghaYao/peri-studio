//! 权限决策的官方 / legacy 两条交付轨道终态收尾。
//!
//! 拆分动机：`execute` 主流程（intent 持久化 → CAS 投影 → 交付）与交付后的
//! 终态收尾逻辑合计超 500 行，按"官方 ACP 轨道（recovery 证据 + 实例 RPC
//! 直接交付）"与"legacy ACP 轨道（action 翻译 + L3 等待）"的职责边界拆出。
//! 本文件只提取 `finish_official` / `finish_legacy` 两个方法，分支语义、错误
//! 消息与 outbox 状态迁移顺序保持不变；方法可见性提升为 `pub(super)` 仅为了
//! 跨子模块调用，对外 pub 面不变。

use std::sync::Arc;

use chrono::Utc;

use peri_studio_proto::ack::ErrorCode;
use peri_studio_proto::action::{ActionEnvelope, ResolvePermissionPayload};

use crate::channel::permission_resolution::{
    definitely_not_delivered, instance_error_code, PermissionResolution,
    PermissionResolutionFailure, PermissionResolutionOutcome, PermissionResolutionRequest,
};
use crate::persist::store::ChatStore;
use crate::protocol::{OutboundCtx, OutboundMessage};

impl PermissionResolution {
    pub(super) async fn finish_official(
        &self,
        store: &Arc<ChatStore>,
        request: &PermissionResolutionRequest,
    ) -> Result<PermissionResolutionOutcome, PermissionResolutionFailure> {
        let mut outbox = store.outbox().lock().await;
        if outbox
            .mark_dispatched(request.command_id, Utc::now())
            .and_then(|_| outbox.mark_delivery_confirmed(request.command_id))
            .and_then(|_| outbox.clear_recovery(request.command_id))
            .and_then(|_| outbox.mark_projection_committed(request.command_id))
            .and_then(|_| outbox.mark_completed(request.command_id))
            .is_err()
        {
            drop(outbox);
            return self
                .delivery_unknown(
                    store,
                    request.command_id,
                    "permission reached ACP but its durable terminal state is incomplete",
                    "terminal_persist_failed",
                )
                .await;
        }
        drop(outbox);
        self.relay
            .remove_pending_permission(&request.permission_id)
            .await;
        Ok(PermissionResolutionOutcome::Committed)
    }

    pub(super) async fn finish_legacy(
        &self,
        store: &Arc<ChatStore>,
        entry: &crate::control::ChatRecord,
        request: &PermissionResolutionRequest,
    ) -> Result<PermissionResolutionOutcome, PermissionResolutionFailure> {
        let Some(acp_session_id) = entry.session_id.clone() else {
            return self
                .delivery_unknown(
                    store,
                    request.command_id,
                    "permission runtime has no ACP session binding",
                    "binding_missing",
                )
                .await;
        };
        let action = ActionEnvelope::ResolvePermission {
            command_id: request.command_id.to_string(),
            payload: ResolvePermissionPayload {
                chat_id: request.chat_id.clone(),
                permission_id: request.permission_id.clone(),
                decision: request.decision,
            },
        };
        let message = match self.translator.translate(
            &action,
            &OutboundCtx {
                cwd: entry.cwd.clone(),
                acp_session_id,
            },
        ) {
            Ok(OutboundMessage::JsonRpc(message)) => message,
            _ => {
                return self
                    .terminal_failed(
                        store,
                        request.command_id,
                        ErrorCode::InvalidState,
                        "permission response translation failed",
                        "translate_failed",
                    )
                    .await
            }
        };
        let rpc_id = message["id"].as_str().unwrap_or_default().to_string();
        let response = self
            .relay
            .register_rpc(&rpc_id, request.command_id.to_string())
            .await;
        match self
            .instance
            .forward_rpc(&entry.instance_id, &request.chat_id, &message)
            .await
        {
            Ok(()) => {}
            Err(error) if definitely_not_delivered(&error) => {
                self.relay.cancel_rpc(&rpc_id).await;
                return self
                    .terminal_failed(
                        store,
                        request.command_id,
                        instance_error_code(&error),
                        "legacy permission response was not delivered; retry is not safe",
                        "legacy_not_delivered",
                    )
                    .await;
            }
            Err(_) => {
                self.relay.cancel_rpc(&rpc_id).await;
                return self
                    .delivery_unknown(
                        store,
                        request.command_id,
                        "legacy permission response may have reached ACP; automatic retry is blocked",
                        "legacy_forward_unknown",
                    )
                    .await;
            }
        }
        if store
            .outbox()
            .lock()
            .await
            .mark_dispatched(request.command_id, Utc::now())
            .is_err()
        {
            self.relay.cancel_rpc(&rpc_id).await;
            return self
                .delivery_unknown(
                    store,
                    request.command_id,
                    "legacy permission reached ACP but dispatch could not be persisted",
                    "legacy_dispatch_persist_failed",
                )
                .await;
        }
        match tokio::time::timeout(self.l3_timeout, response).await {
            Ok(Ok(frame)) if frame.get("error").is_none() => {
                let mut outbox = store.outbox().lock().await;
                if outbox
                    .mark_delivery_confirmed(request.command_id)
                    .and_then(|_| outbox.mark_projection_committed(request.command_id))
                    .and_then(|_| outbox.mark_completed(request.command_id))
                    .is_err()
                {
                    drop(outbox);
                    return self
                        .delivery_unknown(
                            store,
                            request.command_id,
                            "legacy permission terminal state could not be persisted",
                            "legacy_terminal_persist_failed",
                        )
                        .await;
                }
                Ok(PermissionResolutionOutcome::Committed)
            }
            Ok(Ok(_)) => {
                self.relay.cancel_rpc(&rpc_id).await;
                self.terminal_failed(
                    store,
                    request.command_id,
                    ErrorCode::AgentUnavailable,
                    "legacy permission response was rejected",
                    "legacy_rejected",
                )
                .await
            }
            _ => {
                self.relay.cancel_rpc(&rpc_id).await;
                self.delivery_unknown(
                    store,
                    request.command_id,
                    "legacy permission response was not confirmed; automatic retry is blocked",
                    "legacy_l3_unknown",
                )
                .await
            }
        }
    }
}
