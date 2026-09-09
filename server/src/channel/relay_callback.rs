//! O-001：relay 持有 per-chat `callback_entry_id`（§6.5 无 turn 单写例外）。

use uuid::Uuid;

use crate::channel::relay_event_handler::RelayEventHandler;
use crate::state::normalized::{EventBody, NormalizedEvent};

impl RelayEventHandler {
    /// 新 prompt 或显式清理时丢弃 callback 流状态（不泄漏跨 turn）。
    pub async fn clear_callback_stream(&self, chat_id: &str) {
        let mut guard = self.inner.callback_entry_by_chat.write().await;
        guard.remove(chat_id);
    }

    pub(super) async fn decorate_callback_envelope(
        &self,
        chat_id: &str,
        nev: &mut NormalizedEvent,
    ) {
        if matches!(&nev.body, EventBody::TurnTerminal { .. }) {
            self.clear_callback_stream(chat_id).await;
            return;
        }

        let needs_callback = match &nev.body {
            EventBody::UserMessage { turn_id, .. } => turn_id.is_empty(),
            EventBody::MessageDelta { turn_id, .. } | EventBody::ReasoningDelta { turn_id, .. } => {
                turn_id.is_empty()
            }
            _ => false,
        };
        if !needs_callback {
            return;
        }

        match &nev.body {
            EventBody::UserMessage { .. } => {
                // 经 chat writer 读取，使判定严格排在 BeginLoadReplay 之后、当前
                // 事件入队之前；未协商或缺 marker 的标准回放同样不会误归位。
                match self.inner.doc.read_load_replay_active(chat_id).await {
                    Some(false) => {}
                    Some(true) | None => {
                        self.clear_callback_stream(chat_id).await;
                        return;
                    }
                }
            }
            EventBody::MessageDelta { .. } | EventBody::ReasoningDelta { .. } => {
                let entry = self
                    .inner
                    .callback_entry_by_chat
                    .read()
                    .await
                    .get(chat_id)
                    .cloned();
                let Some(entry) = entry else {
                    return;
                };
                match self.inner.doc.read_load_replay_active(chat_id).await {
                    Some(false) => {
                        nev.callback_entry_id = Some(entry);
                    }
                    Some(true) | None => {
                        self.clear_callback_stream(chat_id).await;
                    }
                }
                return;
            }
            _ => unreachable!("needs_callback only accepts callback stream events"),
        }

        let mut guard = self.inner.callback_entry_by_chat.write().await;
        let entry = match &nev.body {
            EventBody::UserMessage { .. } => guard
                .entry(chat_id.to_string())
                .or_insert_with(|| format!("callback_{}", Uuid::new_v4()))
                .clone(),
            _ => unreachable!("delta callback events return above"),
        };
        guard.insert(chat_id.to_string(), entry.clone());
        nev.callback_entry_id = Some(entry);
    }
}
