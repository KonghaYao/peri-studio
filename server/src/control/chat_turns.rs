//! 活动 turn 登记/续命/查询（§7.1 断链清理输入 + #3 增量窗口计时）：
//! `set_active_turn` / `touch_active_turn` / `active_turn_idle` /
//! `subscribe_active_turn_changes` / `clear_active_turn` / `active_turn`。
//!
//! 本文件是 [`ChatRegistry`](super::ChatRegistry) 的实现段（结构拆分，行为
//! 语义不变）。

use super::*;

impl ChatRegistry {
    /// 活动 turn 登记（coordinator prompt 执行登记；§7.1 断链清理输入）。
    /// last_activity 初始化为登记时刻（#3 增量窗口起点）。
    pub async fn set_active_turn(&self, chat_id: &str, turn_id: &str) {
        let (change_tx, _) = watch::channel(());
        self.inner.active_turns.write().await.insert(
            chat_id.to_string(),
            ActiveTurnEntry {
                turn_id: turn_id.to_string(),
                last_activity: Instant::now(),
                change_tx,
            },
        );
    }

    /// 活动 turn 续命（#3）：relay 事件投递成功（聚合器接受）后调用——
    /// 刷新 last_activity，exec_prompt L3 窗口据此判定「窗口内有增量」而
    /// 续等。表项不存在（无活动 turn）→ 幂等无操作。
    pub async fn touch_active_turn(&self, chat_id: &str) {
        if let Some(entry) = self.inner.active_turns.write().await.get_mut(chat_id) {
            entry.last_activity = Instant::now();
        }
    }

    /// 活动 turn 空闲时长（#3）：`now - last_activity`；表项不存在 → None
    /// （调用方按「无活动窗口」处理）。
    pub async fn active_turn_idle(&self, chat_id: &str) -> Option<Duration> {
        self.inner
            .active_turns
            .read()
            .await
            .get(chat_id)
            .map(|e| e.last_activity.elapsed())
    }

    /// 订阅指定 active turn 的移除或替换通知。若该 turn 已不活跃则返回已关闭
    /// receiver；通知只用于唤醒，调用方收到后仍须重新读取 `active_turn`。
    pub async fn subscribe_active_turn_changes(
        &self,
        chat_id: &str,
        turn_id: &str,
    ) -> watch::Receiver<()> {
        self.inner
            .active_turns
            .read()
            .await
            .get(chat_id)
            .filter(|entry| entry.turn_id == turn_id)
            .map(|entry| entry.change_tx.subscribe())
            .unwrap_or_else(|| watch::channel(()).1)
    }

    /// 活动 turn 清除（turn 终态 / chat 关闭 / 断链清理后）。
    pub async fn clear_active_turn(&self, chat_id: &str) {
        self.inner.active_turns.write().await.remove(chat_id);
    }

    /// 活动 turn 查询（断链清理：`MarkTurnInterrupted` 输入，§7.1）。
    pub async fn active_turn(&self, chat_id: &str) -> Option<String> {
        self.inner
            .active_turns
            .read()
            .await
            .get(chat_id)
            .map(|e| e.turn_id.clone())
    }
}
