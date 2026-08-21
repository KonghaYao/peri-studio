//! instance 指令下发（§4.5）：`send_command`（ack oneshot + 超时）、
//! `forward_rpc`/`forward_notification`（JSON-RPC 透传）、ack 路由与
//! 孤儿进程清理钩子（§7.5）。
//!
//! 本文件是 [`InstanceRegistry`](super::InstanceRegistry) 的实现段（结构
//! 拆分，行为语义不变）。

use tokio::sync::oneshot;
use tracing::{info, warn};

use super::*;

impl InstanceRegistry {
    /// 指令下发统一路径：登记 ack oneshot → 发送 → 等 ack（超时
    /// `cmd_timeout`）。
    pub(super) async fn send_command(
        &self,
        instance_id: &str,
        command_id: String,
        frame: Frame,
    ) -> Result<InstanceAck, InstanceError> {
        let (reply, rx) = oneshot::channel();
        let tx = {
            let mut instances = self.inner.instances.write().await;
            let Some(entry) = instances.get_mut(instance_id) else {
                return Err(InstanceError::UnknownInstance(instance_id.to_string()));
            };
            if !entry.state.can_serve() {
                return Err(InstanceError::Offline);
            }
            let Some(conn) = entry.conn.clone() else {
                return Err(InstanceError::Offline);
            };
            if entry.pending_acks.contains_key(&command_id) {
                // 重发（chat_id 幂等键，§4.5）：登记覆盖旧 oneshot。
                warn!(
                    instance_id,
                    command_id, "duplicate in-flight command ack slot replaced"
                );
            }
            entry.pending_acks.insert(command_id.clone(), reply);
            conn
        };
        if tx.send(OutboundMsg::Frame(frame)).await.is_err() {
            self.drop_pending_ack(instance_id, &command_id).await;
            return Err(InstanceError::ConnectionGone);
        }
        match tokio::time::timeout(self.inner.cmd_timeout, rx).await {
            Ok(Ok(ack)) => Ok(ack),
            Ok(Err(_)) => {
                self.drop_pending_ack(instance_id, &command_id).await;
                Err(InstanceError::ConnectionGone)
            }
            Err(_) => {
                self.drop_pending_ack(instance_id, &command_id).await;
                Err(InstanceError::Timeout)
            }
        }
    }

    /// ack 路由（spawn_ack/kill_ack，§4.5）：按 command_id 回填 oneshot。
    /// 返回是否匹配到在途命令。
    pub async fn on_ack(&self, instance_id: &str, command_id: &str, ack: InstanceAck) -> bool {
        let mut instances = self.inner.instances.write().await;
        let Some(entry) = instances.get_mut(instance_id) else {
            return false;
        };
        match entry.pending_acks.remove(command_id) {
            Some(tx) => {
                let _ = tx.send(ack);
                true
            }
            None => false,
        }
    }
    /// JSON-RPC 透传（initialize/session/new/prompt/cancel/resolve 出站；
    /// L1+L2 合并确认由 `instance/forward_ack` 承载，§4.4 M1 合并）。
    ///
    /// 【冲突 1 裁决】下行载体由裸 JSON-RPC 文本改为 `instance/forward` 帧
    /// （M1 instance 帧集新增；instance 写 ACP stdin 成功回 forward_ack）。
    /// `command_id` 取消息 `id`（rpcId，server 生成，`hub-{n}` 全局单调），
    /// ack 路由与 spawn/kill 同表。
    pub async fn forward_rpc(
        &self,
        instance_id: &str,
        chat_id: &str,
        msg: &serde_json::Value,
    ) -> Result<(), InstanceError> {
        // #1 官方 request_permission 响应帧的 id = agent request id 原样回显
        // （常为数字自增）——`as_str` 失败不得误判 ConnectionGone：string/
        // number 均提取（字符串化仅用于 instance 内部 ack 路由 command_id，
        // 不改变写 ACP stdin 的帧内容）。
        //
        // #2 id 缺失是**协议形态错误**（JSON-RPC 请求必须携带 id；server
        // 生成的消息恒带 `hub-{n}`，缺 id 说明帧构造异常），不是「连接
        // 消失」——ConnectionGone 会让上层走连接重建路径误导诊断。映射为
        // [`InstanceError::MalformedFrame`]：发送前即失败（未投递判定
        // `definitely_not_delivered` 成立），错误消息携带可定位细节，线级
        // 稳定映射为 `INVALID_STATE`（确定性失败）。
        let command_id = msg
            .get("id")
            .and_then(|v| match v {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .ok_or_else(|| {
                warn!(
                    chat_id,
                    "forward_rpc rejected: JSON-RPC frame missing id (malformed frame)"
                );
                InstanceError::MalformedFrame("JSON-RPC frame missing id".to_string())
            })?;
        let frame = Frame::InstanceForward(peri_studio_proto::instance::InstanceForward {
            command_id: command_id.to_string(),
            chat_id: chat_id.to_string(),
            frame: msg.clone(),
        });
        let ack = self
            .send_command(instance_id, command_id.to_string(), frame)
            .await?;
        match ack {
            InstanceAck::Forward(f) if f.ok => Ok(()),
            InstanceAck::Forward(f) => {
                Err(InstanceError::ForwardRejected(f.error.unwrap_or_default()))
            }
            _ => Err(InstanceError::ConnectionGone),
        }
    }

    /// 使用 server 自有 ack identity 透传 ACP response。线帧保留 Agent 原始
    /// request id，`command_id` 则保持 server 内全局唯一。
    pub async fn forward_rpc_response(
        &self,
        instance_id: &str,
        chat_id: &str,
        command_id: &str,
        msg: &serde_json::Value,
    ) -> Result<(), InstanceError> {
        self.forward_notification(instance_id, chat_id, command_id, msg)
            .await
    }

    /// Notification passthrough (`session/cancel` has no JSON-RPC id or ACP
    /// response). The outer instance envelope still carries the stable Hub
    /// command id so `forward_ack` proves that the instance writer accepted
    /// the frame for ACP stdin. JSON-RPC notification shape remains unchanged.
    pub async fn forward_notification(
        &self,
        instance_id: &str,
        chat_id: &str,
        command_id: &str,
        msg: &serde_json::Value,
    ) -> Result<(), InstanceError> {
        let frame = Frame::InstanceForward(peri_studio_proto::instance::InstanceForward {
            command_id: command_id.to_string(),
            chat_id: chat_id.to_string(),
            frame: msg.clone(),
        });
        let ack = self
            .send_command(instance_id, command_id.to_string(), frame)
            .await?;
        match ack {
            InstanceAck::Forward(forward) if forward.ok => Ok(()),
            InstanceAck::Forward(forward) => Err(InstanceError::ForwardRejected(
                forward.error.unwrap_or_default(),
            )),
            _ => Err(InstanceError::ConnectionGone),
        }
    }
    /// 孤儿进程清理钩子（§7.5）：hello 后对「server 已标记终态/未登记但
    /// instance 声称存活」的 chat 补发 kill（实际进程清理在 instance 侧；
    /// server 只负责下发与 ack 跟踪）。
    ///
    /// 返回已下发 kill 的 chat 清单。
    pub async fn cleanup_orphans(&self, instance_id: &str, outcome: &HelloOutcome) -> Vec<String> {
        let report = match self
            .inner
            .chats
            .reconcile_alive(instance_id, &outcome.alive_sessions)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                warn!(instance_id, error = ?e, "orphan cleanup reconcile failed");
                return Vec::new();
            }
        };
        self.kill_chats(instance_id, &report.to_kill).await
    }

    /// 心跳驱动的对账（§8.3 步骤 5）：alive_sessions 与 Registry 比对 →
    /// 摘要日志 + to_kill 逐个补发 kill（§7.5 意外存活裁决 + §7.6
    /// pending_close 补发）。
    pub async fn reconcile_and_kill(&self, instance_id: &str, alive: &[String]) {
        let report = match self.inner.chats.reconcile_alive(instance_id, alive).await {
            Ok(r) => r,
            Err(e) => {
                warn!(instance_id, error = ?e, "heartbeat reconciliation failed");
                return;
            }
        };
        self.kill_chats(instance_id, &report.to_kill).await;
    }

    /// kill 裁决下发（§7.5/§7.6）：对 `to_kill` 逐个补发 `instance/kill`
    /// （幂等，已死成功返回），成功后 chat 置 Closed（「Registry 标记已清理」）。
    async fn kill_chats(&self, instance_id: &str, to_kill: &[String]) -> Vec<String> {
        let mut killed = Vec::new();
        for sid in to_kill {
            let command_id = uuid::Uuid::new_v4().to_string();
            let cmd = InstanceKill {
                command_id: command_id.clone(),
                chat_id: sid.clone(),
                grace: None,
            };
            match self.send_kill(instance_id, cmd).await {
                Ok(_) => {
                    killed.push(sid.clone());
                    // 意外存活/终态清理完成 → chat 置 Closed（§7.5「Registry
                    // 标记已清理」；pending_close 集合在 transition(Closed)
                    // 中清除，§7.6）。
                    if let Ok(()) = self.inner.chats.transition(sid, ChatState::Closed).await {
                        // noop
                    }
                }
                Err(e) => warn!(instance_id, chat_id = sid, error = ?e, "orphan kill failed"),
            }
        }
        if !killed.is_empty() {
            info!(
                instance_id,
                killed = killed.len(),
                "orphan chats killed (§7.5)"
            );
        }
        killed
    }

    async fn drop_pending_ack(&self, instance_id: &str, command_id: &str) {
        let mut instances = self.inner.instances.write().await;
        if let Some(entry) = instances.get_mut(instance_id) {
            entry.pending_acks.remove(command_id);
        }
    }
}

#[cfg(test)]
#[path = "instance_commands_test.rs"]
mod instance_commands_test;
