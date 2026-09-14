//! orphan kill 有界重试（S-04）：`send_kill` 失败进入指数退避待重试集合，
//! 由 heartbeat 对账周期补发（§7.5/§7.6 与 pending_close 同源）。

use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, OwnedMutexGuard};
use tracing::warn;

use super::*;

/// 单次 kill_chats 调用内的即时重试上限（禁止无界重试）。
pub(crate) const ORPHAN_KILL_MAX_ATTEMPTS: u32 = 5;
const ORPHAN_KILL_INITIAL_BACKOFF: Duration = Duration::from_millis(100);
const ORPHAN_KILL_MAX_BACKOFF: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub(super) struct OrphanKillRetry {
    instance_id: String,
    attempts: u32,
    next_retry_at: Instant,
}

/// 指数退避（attempt 从 1 起计；封顶 ORPHAN_KILL_MAX_BACKOFF）。
pub(crate) fn orphan_kill_backoff(attempt: u32) -> Duration {
    let shift = attempt.saturating_sub(1).min(16);
    let scaled = ORPHAN_KILL_INITIAL_BACKOFF.saturating_mul(1u32 << shift);
    scaled.min(ORPHAN_KILL_MAX_BACKOFF)
}

impl ChatRegistry {
    /// 同一 chat 的 orphan kill 串行闸门（heartbeat 后台 kill 与补发可能并发）。
    pub(crate) async fn orphan_kill_gate(&self, chat_id: &str) -> OwnedMutexGuard<()> {
        let gate = {
            let mut gates = self.inner.orphan_kill_gates.lock().await;
            gates.retain(|_, gate| gate.strong_count() > 0);
            if let Some(gate) = gates.get(chat_id).and_then(Weak::upgrade) {
                gate
            } else {
                let gate = Arc::new(Mutex::new(()));
                gates.insert(chat_id.to_string(), Arc::downgrade(&gate));
                gate
            }
        };
        gate.lock_owned().await
    }

    /// 是否应在本轮尝试 orphan kill（未登记或退避窗口已到期）。
    pub async fn orphan_kill_ready(&self, chat_id: &str) -> bool {
        let pending = self.inner.pending_orphan_kill.read().await;
        match pending.get(chat_id) {
            None => true,
            Some(entry) => Instant::now() >= entry.next_retry_at,
        }
    }

    /// 记录 orphan kill 失败，进入待重试集合（下次 heartbeat 对账补发）。
    pub async fn record_orphan_kill_failure(&self, chat_id: &str, instance_id: &str) {
        let mut pending = self.inner.pending_orphan_kill.write().await;
        let attempts = pending
            .get(chat_id)
            .map(|e| e.attempts.saturating_add(1))
            .unwrap_or(1);
        let backoff = orphan_kill_backoff(attempts);
        pending.insert(
            chat_id.to_string(),
            OrphanKillRetry {
                instance_id: instance_id.to_string(),
                attempts,
                next_retry_at: Instant::now() + backoff,
            },
        );
        warn!(
            chat_id,
            instance_id,
            attempts,
            backoff_ms = backoff.as_millis(),
            "orphan kill deferred for heartbeat retry"
        );
    }

    /// kill 成功后清除待重试条目。
    pub async fn clear_orphan_kill_pending(&self, chat_id: &str) {
        self.inner.pending_orphan_kill.write().await.remove(chat_id);
    }

    /// pending orphan kill 快照（诊断/测试）。
    pub async fn pending_orphan_kill_chats(&self) -> Vec<String> {
        self.inner
            .pending_orphan_kill
            .read()
            .await
            .keys()
            .cloned()
            .collect()
    }

    /// 合并已到退避窗口的 orphan kill 重试到 to_kill（§7.5/§7.6 补发同源）。
    pub(super) async fn merge_orphan_kill_retries(
        &self,
        instance_id: &str,
        to_kill: &mut Vec<String>,
    ) {
        let now = Instant::now();
        let pending = self.inner.pending_orphan_kill.read().await;
        for (chat_id, entry) in pending.iter() {
            if entry.instance_id != instance_id || now < entry.next_retry_at {
                continue;
            }
            if !to_kill.contains(chat_id) {
                to_kill.push(chat_id.clone());
            }
        }
    }

    /// reconcile 失败时仍可补发已到窗口的 orphan kill（不依赖本次对账报告）。
    pub async fn orphan_kill_retry_ready(&self, instance_id: &str) -> Vec<String> {
        let now = Instant::now();
        self.inner
            .pending_orphan_kill
            .read()
            .await
            .iter()
            .filter(|(_, entry)| entry.instance_id == instance_id && now >= entry.next_retry_at)
            .map(|(chat_id, _)| chat_id.clone())
            .collect()
    }
}

#[cfg(test)]
mod orphan_kill_backoff_test {
    use super::*;

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(orphan_kill_backoff(1), Duration::from_millis(100));
        assert_eq!(orphan_kill_backoff(2), Duration::from_millis(200));
        assert_eq!(orphan_kill_backoff(3), Duration::from_millis(400));
        assert!(orphan_kill_backoff(20) <= ORPHAN_KILL_MAX_BACKOFF);
        assert_eq!(orphan_kill_backoff(20), ORPHAN_KILL_MAX_BACKOFF);
    }
}
