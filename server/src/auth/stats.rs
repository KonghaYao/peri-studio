//! 认证失败计数（§17.1 / §4.8）：按 token_id + 全局计数。
//!
//! 审计事件携带 `auth_failed_total` 快照字段，结构化日志即聚合事实源
//! （§17.1：M1 不建独立指标系统）。未知 token 的 key 取 [`UNKNOWN_TOKEN_ID`]
//! （调用方传入）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

// ---------------------------------------------------------------------------

/// 认证失败计数：按 token_id（内存 `Mutex<HashMap>`）+ 全局 `AtomicU64`。
///
/// 审计事件携带 `auth_failed_total` 快照字段，结构化日志即聚合事实源
/// （§17.1：M1 不建独立指标系统）。未知 token 的 key 取 [`UNKNOWN_TOKEN_ID`]。
#[derive(Debug, Default)]
pub struct AuthStats {
    by_token: Mutex<HashMap<String, u64>>,
    total: AtomicU64,
}

impl AuthStats {
    /// 认证失败计数递增。
    pub fn record_failure(&self, token_id: &str) {
        *self
            .by_token
            .lock()
            .expect("AuthStats mutex poisoned")
            .entry(token_id.to_string())
            .or_insert(0) += 1;
        self.total.fetch_add(1, Ordering::Relaxed);
    }

    /// 某 token_id（或 `"<unknown>"`）的失败次数。
    pub fn failures_for(&self, token_id: &str) -> u64 {
        self.by_token
            .lock()
            .expect("AuthStats mutex poisoned")
            .get(token_id)
            .copied()
            .unwrap_or(0)
    }

    /// 全局失败次数。
    pub fn total_failures(&self) -> u64 {
        self.total.load(Ordering::Relaxed)
    }
}
