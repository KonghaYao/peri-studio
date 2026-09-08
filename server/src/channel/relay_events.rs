//! 规范化事件投递与流状态恢复（§6.1/§4.5.1/§7.3）：`submit`（delta 类
//! 入队即返、控制类挂 oneshot 等投递确认，含 #3 增量窗口续命）、
//! `observe_non_projected_frame`（无投影帧的水位推进）、`recover_from_gap`
//! （断链追平恢复）。
//!
//! 本文件是 [`RelayEventHandler`] 的实现段（结构拆分，行为语义不变）。

use tracing::info;

use crate::channel::relay_event_handler::{ConsumeResult, RelayEventHandler};
use crate::control::ChatState;
use crate::state::doc_manager::{DocCommand, SubmitError, SubmitResult};
use crate::state::normalized::{EventBody, NormalizedEvent, ToolJsonPatch};

impl RelayEventHandler {
    /// Advance transport ordering for a frame that was received but has no
    /// document projection. A semantic drop remains visible in drop metrics;
    /// it must not masquerade as a missing frame in the independent gap model.
    /// Private discovery runtimes intentionally have no chat writer and thus
    /// no stream state to advance.
    pub(super) async fn observe_non_projected_frame(
        &self,
        chat_id: &str,
        epoch: u64,
        seq: u64,
    ) -> bool {
        match self
            .inner
            .doc
            .submit_command(chat_id, DocCommand::ObserveStreamFrame { epoch, seq })
            .await
        {
            SubmitResult::Applied(result) => result.applied,
            SubmitResult::Rejected(SubmitError::ChatNotFound) => true,
            _ => false,
        }
    }

    /// 规范化事件投递（delta 类入队即返；控制类挂 oneshot 等投递确认）。
    pub(super) async fn submit(&self, chat_id: &str, mut nev: NormalizedEvent) -> ConsumeResult {
        self.decorate_callback_envelope(chat_id, &mut nev).await;
        let kind = nev.kind();
        let seq = nev.seq;
        let config_catalog = match &nev.body {
            EventBody::AgentConfig {
                config_options: Some(options),
                ..
            } => Some(options.clone()),
            _ => None,
        };
        let app_snapshot = mcp_app_patch_snapshot(&nev.body);
        let submitted = nev.clone();
        match self.inner.doc.submit_event(nev).await {
            SubmitResult::Applied(r) => {
                // #3 增量窗口续命（issue #3）：事件投递成功（聚合器接受）
                // → 刷新该 chat 的活动 turn 计时——exec_prompt L3 以「窗口
                // （l3_timeout）内无增量投递」判定 delivery_unknown，长流式
                // turn 的事件回流不得被 30s 硬超时误杀。
                if r.applied {
                    self.inner.chats.touch_active_turn(chat_id).await;
                    if let Some(options) = config_catalog {
                        self.inner.chats.set_config_catalog(chat_id, options).await;
                    }
                    if let Some((tool_call_id, result, arguments)) = app_snapshot {
                        if let Some(result) = result {
                            self.remember_mcp_app_tool_result(chat_id, &tool_call_id, result)
                                .await;
                        }
                        if let Some(arguments) = arguments {
                            self.remember_mcp_app_tool_input(chat_id, &tool_call_id, arguments)
                                .await;
                        }
                    }
                }
                let delivered = ConsumeResult::Delivered {
                    chat_id: chat_id.to_string(),
                    kind,
                    seq,
                    applied: r.applied,
                };
                self.after_event_submitted(chat_id, &submitted, &delivered).await;
                delivered
            }
            SubmitResult::Rejected(_) => ConsumeResult::Dropped {
                reason: "submit_rejected",
            },
            SubmitResult::PersistFailed => ConsumeResult::PersistFailed {
                chat_id: chat_id.to_string(),
            },
        }
    }

    /// 断链追平恢复（§7.3/§8.5）：补推/实时帧恢复投递成功后调用——清除
    /// 断链时置的 gap 标记（`set_chat_gap(Some(0))` 占位 → 追平清除）并
    /// 迁移 ChatState Gap → Accepting（§7.3「Gap 清除 → 恢复可用、可开
    /// 新 turn」）。
    ///
    /// 幂等：chat 非 Gap 状态直接返回（恢复后首帧即完成，后续帧跳过）；
    /// 判定在 writer 内（[`DocCommand::ResumeAfterGap`]）：**不可校准**
    /// （epoch 变化，§4.5.1）拒绝恢复——不可校准缺口只能经 `session/load`
    /// 显式重建消除，不得误标为已追平（视图假装完整）。
    pub(super) async fn recover_from_gap(&self, chat_id: &str) {
        let Some(entry) = self.inner.chats.entry(chat_id).await else {
            return;
        };
        if entry.state != ChatState::Gap {
            return;
        }
        match self
            .inner
            .doc
            .submit_command(chat_id, DocCommand::ResumeAfterGap)
            .await
        {
            SubmitResult::Applied(_)
                if self
                    .inner
                    .chats
                    .transition(chat_id, ChatState::Accepting)
                    .await
                    .is_ok() =>
            {
                info!(chat_id, "chat recovered from gap (stream caught up)");
            }
            _ => {
                // 拒绝（uncalibratable / chat 已关闭）或迁移失败：保持 gap。
            }
        }
    }
}

fn mcp_app_patch_snapshot(
    body: &EventBody,
) -> Option<(String, Option<serde_json::Value>, Option<serde_json::Value>)> {
    match body {
        EventBody::ToolCallPatched {
            tool_call_id,
            patch,
            ..
        } => {
            let result = match &patch.result {
                ToolJsonPatch::Set { value } => Some(value.clone()),
                _ => None,
            };
            let arguments = match &patch.arguments {
                ToolJsonPatch::Set { value } => Some(value.clone()),
                _ => None,
            };
            if result.is_none() && arguments.is_none() {
                return None;
            }
            Some((tool_call_id.clone(), result, arguments))
        }
        EventBody::ToolCallCompleted {
            tool_call_id,
            result: Some(value),
            ..
        } => Some((tool_call_id.clone(), Some(value.clone()), None)),
        _ => None,
    }
}
