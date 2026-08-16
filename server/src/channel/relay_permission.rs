//! 官方 `session/request_permission` / elicitation 请求的登记、拒绝与
//! 响应回投材料（#1 / review #17）：pending 表维护、投影投递、唯一投递权
//! 申领（claim）、投递确认后移除。
//!
//! 本文件是 [`RelayEventHandler`] 的实现段（结构拆分，行为语义不变）。

use peri_studio_proto::action::PermissionDecision;
use peri_studio_proto::schema::{ElicitationProjection, ElicitationStatus, PermissionOptions};

use crate::channel::relay_event_handler::{
    ClientRequestRejection, ConsumeResult, PendingElicitationReq, PendingPermissionReq,
    RelayEventHandler,
};
use crate::protocol::{ElicitationRequestFields, PermissionRequestFields, PERMISSION_TIMEOUT};
use crate::state::doc_manager::{DocCommand, SubmitResult};
use crate::state::normalized::{EventBody, EventProvenance, NormalizedEvent};

impl RelayEventHandler {
    /// 登记官方 request_permission（#1）：记 pending_permissions 表 +
    /// 投递 `PermissionRequested` 事件。
    ///
    /// turn_id 从 active_turns 表注入（官方帧无 turnId；聚合器
    /// aggregator.rs:1042 要求 turn_id == control doc active_turn_id 才推进
    /// awaitingPermission——必须注入）；无活动 turn → 空串（投影仍写，仅
    /// 状态不推进，功能不丢）。
    pub(super) async fn register_permission_request(
        &self,
        chat_id: &str,
        epoch: u64,
        seq: u64,
        now: &str,
        req: &PermissionRequestFields,
    ) -> ConsumeResult {
        // TTL 剪枝（review #17）：register 时顺带清理本 chat 已过期表项
        // （O(1) 摊销）——长期在线连接上持续产生的未决议权限不驻留至断链
        // （断链清理仍兜底整 chat 移除）。
        {
            let mut pending = self.inner.pending_permissions.write().await;
            pending.retain(|_, value| {
                if value.chat_id != chat_id {
                    return true;
                }
                chrono::DateTime::parse_from_rfc3339(&value.expires_at)
                    .map(|expires| expires > chrono::Utc::now())
                    .unwrap_or(true)
            });
            pending.insert(
                req.permission_id.clone(),
                PendingPermissionReq {
                    request_id: req.request_id.clone(),
                    options: req.options.clone(),
                    chat_id: chat_id.to_string(),
                    expires_at: expires_at(now),
                    resolving_command_id: None,
                    resolving_decision: None,
                },
            );
        }
        let turn_id = self
            .inner
            .chats
            .active_turn(chat_id)
            .await
            .unwrap_or_default();
        let nev = NormalizedEvent {
            chat_id: chat_id.to_string(),
            seq,
            epoch,
            ts: now.to_string(),
            provenance: EventProvenance::Unspecified,
            body: EventBody::PermissionRequested {
                permission_id: req.permission_id.clone(),
                turn_id,
                tool_call_id: req.tool_call_id.clone(),
                tool: Some(req.tool.clone()),
                title: req.title.clone(),
                description: req.description.clone(),
                options: permission_option_kinds(&req.options),
                expires_at: expires_at(now),
            },
        };
        self.submit(chat_id, nev).await
    }

    pub(super) async fn register_elicitation_request(
        &self,
        instance_id: &str,
        chat_id: &str,
        epoch: u64,
        seq: u64,
        now: &str,
        req: &ElicitationRequestFields,
    ) -> ConsumeResult {
        if !matches!(self.inner.chats.resolve(&req.session_id).await, Some(mapped) if mapped == chat_id)
        {
            let _ = self.observe_non_projected_frame(chat_id, epoch, seq).await;
            self.count_dropped("elicitation_binding_mismatch");
            return ConsumeResult::Dropped {
                reason: "elicitation_binding_mismatch",
            };
        }
        {
            let mut pending = self.inner.pending_elicitations.write().await;
            if pending
                .values()
                .filter(|value| value.chat_id == chat_id)
                .count()
                >= 4
            {
                drop(pending);
                self.count_dropped("elicitation_limit");
                return self
                    .reject_client_request(
                        instance_id,
                        chat_id,
                        epoch,
                        seq,
                        ClientRequestRejection {
                            request_id: req.request_id.clone(),
                            code: -32000,
                            message: "too many pending elicitation forms",
                        },
                    )
                    .await;
            }
            pending.insert(
                req.elicitation_id.clone(),
                PendingElicitationReq {
                    request_id: req.request_id.clone(),
                    chat_id: chat_id.to_string(),
                    fields: req.fields.clone(),
                    resolving_command_id: None,
                    response_fingerprint: None,
                },
            );
        }
        let projection = ElicitationProjection {
            elicitation_id: req.elicitation_id.clone(),
            message: req.message.clone(),
            fields: req.fields.clone(),
            status: ElicitationStatus::Pending,
            response_action: None,
            created_at: now.to_string(),
            updated_at: now.to_string(),
        };
        let result = self
            .inner
            .doc
            .submit_command(
                chat_id,
                DocCommand::RegisterElicitation {
                    elicitation: projection,
                    epoch,
                    seq,
                },
            )
            .await;
        match result {
            SubmitResult::Applied(applied) if applied.applied => ConsumeResult::Delivered {
                chat_id: chat_id.to_string(),
                kind: "elicitation_requested",
                seq,
                applied: true,
            },
            SubmitResult::PersistFailed => {
                self.remove_pending_elicitation(&req.elicitation_id).await;
                ConsumeResult::PersistFailed {
                    chat_id: chat_id.to_string(),
                }
            }
            _ => {
                self.remove_pending_elicitation(&req.elicitation_id).await;
                ConsumeResult::Dropped {
                    reason: "submit_rejected",
                }
            }
        }
    }

    pub(super) async fn reject_client_request(
        &self,
        instance_id: &str,
        chat_id: &str,
        epoch: u64,
        seq: u64,
        rejection: ClientRequestRejection,
    ) -> ConsumeResult {
        if !self.observe_non_projected_frame(chat_id, epoch, seq).await {
            return ConsumeResult::Dropped {
                reason: "client_request_stream_rejected",
            };
        }
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": rejection.request_id,
            "error": { "code": rejection.code, "message": rejection.message },
        });
        match self
            .inner
            .instance
            .forward_rpc(instance_id, chat_id, &response)
            .await
        {
            Ok(()) => ConsumeResult::Delivered {
                chat_id: chat_id.to_string(),
                kind: "client_request_rejected",
                seq,
                applied: true,
            },
            Err(_) => ConsumeResult::Dropped {
                reason: "client_request_reject_delivery_failed",
            },
        }
    }

    /// 读取官方 request 回投材料。发送成功前不得移除：明确未送达时，同一
    /// decision + commandId 需要复用它恢复；相反 decision 不得消费它。
    pub async fn pending_permission(&self, permission_id: &str) -> Option<PendingPermissionReq> {
        self.inner
            .pending_permissions
            .read()
            .await
            .get(permission_id)
            .cloned()
    }

    /// 申领官方 permission response 的唯一投递权。
    ///
    /// 首次决策会将 `(commandId, decision)` 绑定到 request；后续只有
    /// 完全相同的命令才能在明确未送达后恢复。其他 commandId 或相反
    /// decision 均不得获取响应材料。
    pub async fn claim_pending_permission(
        &self,
        permission_id: &str,
        command_id: &str,
        decision: PermissionDecision,
    ) -> Option<PendingPermissionReq> {
        let mut pending = self.inner.pending_permissions.write().await;
        let request = pending.get_mut(permission_id)?;
        match (&request.resolving_command_id, request.resolving_decision) {
            (None, None) => {
                request.resolving_command_id = Some(command_id.to_string());
                request.resolving_decision = Some(decision);
            }
            (Some(existing_id), Some(existing_decision))
                if existing_id == command_id && existing_decision == decision => {}
            _ => return None,
        }
        Some(request.clone())
    }

    /// 投递确认后移除表项；幂等无害。未确认前必须保留，
    /// 以便原 `(commandId, decision)` 在明确未送达时恢复。
    pub async fn remove_pending_permission(&self, permission_id: &str) {
        self.inner
            .pending_permissions
            .write()
            .await
            .remove(permission_id);
    }

    pub async fn claim_pending_elicitation(
        &self,
        elicitation_id: &str,
        command_id: &str,
        response_fingerprint: &str,
    ) -> Option<PendingElicitationReq> {
        let mut pending = self.inner.pending_elicitations.write().await;
        let request = pending.get_mut(elicitation_id)?;
        match (&request.resolving_command_id, &request.response_fingerprint) {
            (None, None) => {
                request.resolving_command_id = Some(command_id.to_string());
                request.response_fingerprint = Some(response_fingerprint.to_string());
            }
            (Some(existing_id), Some(existing_fingerprint))
                if existing_id == command_id && existing_fingerprint == response_fingerprint => {}
            _ => return None,
        }
        Some(request.clone())
    }

    pub async fn pending_elicitation(&self, elicitation_id: &str) -> Option<PendingElicitationReq> {
        self.inner
            .pending_elicitations
            .read()
            .await
            .get(elicitation_id)
            .cloned()
    }

    pub async fn remove_pending_elicitation(&self, elicitation_id: &str) {
        self.inner
            .pending_elicitations
            .write()
            .await
            .remove(elicitation_id);
    }
}

/// 官方 options kind → 内部投影枚举（#1，3 值投影层；§5.4）。
/// `allow_once→AllowOnce`、`allow_always→AllowSession`、
/// `reject_once|reject_always→Deny`；兼容 camelCase 别名
/// （`allowOnce`/`allowSession`，对齐 acp_channel.rs `permission_options`
/// 的兼容先例；reject 类官方无 camel 形态，防御性同兼容）。
/// 未识别 kind → 跳过（与 permission_options 同语义，§5.4 投影层宽容）。
fn permission_option_kinds(options: &[serde_json::Value]) -> Vec<PermissionOptions> {
    options
        .iter()
        .filter_map(|v| {
            Some(match v.get("kind")?.as_str()? {
                "allow_once" | "allowOnce" => PermissionOptions::AllowOnce,
                "allow_always" | "allowSession" => PermissionOptions::AllowSession,
                "reject_once" | "rejectOnce" | "reject_always" | "rejectAlways" => {
                    PermissionOptions::Deny
                }
                _ => return None,
            })
        })
        .collect()
}

/// 权限请求过期时刻（#1：#1 复用 acp_channel.rs `PERMISSION_TIMEOUT`（5min）
/// 常量逻辑，与 map_raw permission_request 同源注入；server 权威时钟
/// §4.7）。now 非 RFC3339 → 原样回退。
fn expires_at(now: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(now) {
        Ok(t) => (t + chrono::Duration::from_std(PERMISSION_TIMEOUT)
            .unwrap_or(chrono::Duration::minutes(5)))
        .to_rfc3339(),
        Err(_) => now.to_string(),
    }
}
