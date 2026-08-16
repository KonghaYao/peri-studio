//! rpcId 登记/撤销/L3 匹配（§4.4）与丢弃计数指标（§17.1）：pending_rpc
//! 表与 coordinator 共享（coordinator 登记、本模块匹配），丢弃计数按原因
//! 分桶供日志与测试断言。
//!
//! 本文件是 [`RelayEventHandler`] 的实现段（结构拆分，行为语义不变）。

use std::collections::HashMap;

use tokio::sync::oneshot;

use crate::channel::relay_event_handler::{ConsumeResult, PendingRpc, RelayEventHandler};

impl RelayEventHandler {
    /// rpcId 登记（coordinator 调用；返回等待侧 oneshot）。
    pub async fn register_rpc(
        &self,
        rpc_id: &str,
        command_id: String,
    ) -> oneshot::Receiver<serde_json::Value> {
        let (tx, rx) = oneshot::channel();
        self.inner.pending_rpc.write().await.insert(
            rpc_id.to_string(),
            PendingRpc {
                command_id,
                notify: Some(tx),
            },
        );
        rx
    }

    /// rpcId 撤销（coordinator L3 超时后调用，§4.4 路径 B）：移除表项，防
    /// 永不回应的 rpc 累积泄漏。若 response 恰好在撤销前已匹配（表项已取走）
    /// → 无操作（幂等）。
    pub async fn cancel_rpc(&self, rpc_id: &str) {
        self.inner.pending_rpc.write().await.remove(rpc_id);
    }

    /// L3 匹配：`RpcResponse{id}` → pending_rpc 命中 → 通知 coordinator →
    /// 移除表项。
    pub(super) async fn confirm_rpc(
        &self,
        rpc_id: &str,
        response: serde_json::Value,
        _is_error: bool,
    ) -> ConsumeResult {
        let entry = self.inner.pending_rpc.write().await.remove(rpc_id);
        match entry {
            Some(pending) => {
                if let Some(tx) = pending.notify {
                    let _ = tx.send(response.clone());
                }
                ConsumeResult::RpcConfirmed {
                    command_id: pending.command_id,
                    response,
                }
            }
            None => ConsumeResult::Dropped {
                reason: "rpc_id_unknown",
            },
        }
    }

    /// 丢弃计数（§17.1 指标；供日志与测试断言）。
    pub fn dropped_total(&self) -> u64 {
        self.inner
            .dropped
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .values()
            .sum()
    }

    /// 按原因分桶的丢弃计数（§17.1 指标；供 metrics/测试断言）。
    pub fn dropped_by_reason(&self) -> HashMap<&'static str, u64> {
        self.inner
            .dropped
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    /// pending_rpc 表大小（诊断/测试）。
    pub async fn pending_rpc_len(&self) -> usize {
        self.inner.pending_rpc.read().await.len()
    }

    pub(super) fn count_dropped(&self, reason: &'static str) {
        let mut counts = self
            .inner
            .dropped
            .write()
            .unwrap_or_else(|error| error.into_inner());
        *counts.entry(reason).or_insert(0) += 1;
    }
}
