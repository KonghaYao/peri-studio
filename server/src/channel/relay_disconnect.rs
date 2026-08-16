//! instance 断链清理与进程退出终态（§8.2 matrix instance 行 + §7.1 离线
//! 即刻生效 + §4.5 process_exit）：活动 turn 中断、gap 标记、pending 表
//! 清理、终态写视图。
//!
//! 本文件是 [`RelayEventHandler`] 的实现段（结构拆分，行为语义不变）。

use tracing::{info, warn};

use peri_studio_proto::instance::InstanceProcessExit;

use crate::channel::relay_event_handler::{ConsumeResult, RelayError, RelayEventHandler};
use crate::control::ChatState;
use crate::state::doc_manager::{DocCommand, SubmitError, SubmitResult};
use crate::state::registry::DegradeCause;

impl RelayEventHandler {
    /// 断链清理（§8.2 matrix instance 行 + §7.1 离线即刻生效）：
    /// 该 instance 全部活 chat：活动 turn → `MarkTurnInterrupted`（DocCommand）、
    /// chat 置 gap 标记（registry；缺口数量由补推时聚合器精确计算）、
    /// 状态迁移 Gap。
    pub async fn on_instance_disconnect(&self, instance_id: &str) -> Result<(), RelayError> {
        let chats = self.inner.chats.chats_for_instance(instance_id).await;
        let mut interrupted = 0usize;
        let mut gapped = 0usize;
        for (chat_id, state) in &chats {
            // oauth 流状态清理对终态/非终态 chat 同样必要（review #13：
            // 原实现两分支重复书写，等效于循环体顶部一次调用）。
            self.inner.oauth.clear_chat(chat_id).await;
            if state.is_terminal() {
                continue;
            }
            // 活动 turn → interrupted（§7.1；turn_id 由 coordinator 登记）。
            if let Some(turn_id) = self.inner.chats.active_turn(chat_id).await {
                let result = self
                    .inner
                    .doc
                    .submit_command(
                        chat_id,
                        DocCommand::MarkTurnInterrupted {
                            turn_id: turn_id.clone(),
                        },
                    )
                    .await;
                if matches!(result, SubmitResult::Applied(_)) {
                    interrupted += 1;
                } else if matches!(result, SubmitResult::Rejected(SubmitError::ChatNotFound)) {
                    // chat writer 未打开：仅记录（视图缺失由 gap 呈现）。
                    warn!(chat_id, "turn interrupt skipped: chat writer absent");
                }
                // 表项清理（§7.2）：turn 已置 interrupted 终态，登记表不得
                // 滞留——否则永久阻塞后续 load「有活动 turn」校验。
                self.inner.chats.clear_active_turn(chat_id).await;
            }
            // 断链时该 chat 全部 pending 权限批量 expired（对齐参考实现
            // expireTurnPermissions：断链即会话失效，未决议权限全部过期）。
            self.inner
                .doc
                .submit_command(chat_id, DocCommand::ExpirePendingPermissions)
                .await;
            // #1 官方 pending_permissions 表同源清理（§7.1 语义对齐：
            // 断链即会话失效，回投数据不再有效）。
            self.inner
                .pending_permissions
                .write()
                .await
                .retain(|_, v| v.chat_id != *chat_id);
            self.inner
                .pending_elicitations
                .write()
                .await
                .retain(|_, v| v.chat_id != *chat_id);
            self.inner
                .doc
                .submit_command(
                    chat_id,
                    DocCommand::ExpirePendingElicitations {
                        updated_at: chrono::Utc::now().to_rfc3339(),
                    },
                )
                .await;
            // gap 标记（§8.2/§7.3：补推完成、seq 追平后清除）。
            let _ = self.inner.registry.set_chat_gap(chat_id, Some(0)).await;
            let _ = self
                .inner
                .registry
                .report_condition(DegradeCause::ChatGap)
                .await;
            if self
                .inner
                .chats
                .transition(chat_id, ChatState::Gap)
                .await
                .is_ok()
            {
                gapped += 1;
            }
        }
        info!(
            instance_id,
            chats = chats.len(),
            interrupted,
            gapped,
            "instance disconnect cleanup complete"
        );
        Ok(())
    }

    /// `instance/process_exit` 消费（§4.5）：终态写视图（F4 `SetChatTerminal`）、
    /// chat 状态迁移（ended/crashed，§7.3）；不再接受新事件（聚合器终态
    /// 守卫，§8.2）。
    pub async fn on_process_exit(
        &self,
        instance_id: &str,
        exit: &InstanceProcessExit,
    ) -> ConsumeResult {
        let _ = instance_id;
        // 信封 chat_id = instance 进程归属（hub chat id，spawn 时确立，
        // §4.5.1），无 binding 翻译（进程生命周期事件不携带 ACP 帧）。
        let hub_chat_id = exit.chat_id.clone();
        if self.inner.chats.entry(&hub_chat_id).await.is_none() {
            self.count_dropped("binding_missing");
            return ConsumeResult::Dropped {
                reason: "binding_missing",
            };
        }
        // status 与 state 同源（review #14）：退出码 0 → ended（正常退出），
        // 非 0 → crashed（进程崩溃）。
        let (status, state) = if exit.code == 0 {
            (peri_studio_proto::schema::ChatStatus::Ended, ChatState::Ended)
        } else {
            (
                peri_studio_proto::schema::ChatStatus::Crashed,
                ChatState::Crashed,
            )
        };
        let _ = self
            .inner
            .doc
            .submit_command(&hub_chat_id, DocCommand::SetChatTerminal { status })
            .await;
        let _ = self.inner.chats.transition(&hub_chat_id, state).await;
        self.inner.chats.clear_active_turn(&hub_chat_id).await;
        self.inner.oauth.clear_chat(&hub_chat_id).await;
        // #1 官方 pending_permissions 表清理（进程退出即会话失效）。
        self.inner
            .pending_permissions
            .write()
            .await
            .retain(|_, v| v.chat_id != hub_chat_id);
        self.inner
            .pending_elicitations
            .write()
            .await
            .retain(|_, v| v.chat_id != hub_chat_id);
        let _ = self
            .inner
            .doc
            .submit_command(
                &hub_chat_id,
                DocCommand::ExpirePendingElicitations {
                    updated_at: chrono::Utc::now().to_rfc3339(),
                },
            )
            .await;
        ConsumeResult::Delivered {
            chat_id: hub_chat_id,
            kind: "process_exit",
            seq: 0,
            applied: true,
        }
    }
}
