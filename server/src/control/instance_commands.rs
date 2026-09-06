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
    /// 当前生产连接完成 fencing 清理后，允许其承载 terminal 指令与回调。
    pub async fn activate_terminal_connection(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
    ) -> Result<(), InstanceError> {
        let mut instances = self.inner.instances.write().await;
        let Some(entry) = instances.get_mut(instance_id) else {
            return Err(InstanceError::UnknownInstance(instance_id.to_string()));
        };
        if !entry
            .conn
            .as_ref()
            .is_some_and(|current| current.same_channel(&conn.tx))
        {
            return Err(InstanceError::ConnectionGone);
        }
        entry.terminal_ready = true;
        Ok(())
    }

    /// 返回当前且已完成 fencing 清理的 terminal 连接句柄。
    pub async fn current_terminal_connection(&self, instance_id: &str) -> Option<InstanceConn> {
        self.inner
            .instances
            .read()
            .await
            .get(instance_id)
            .filter(|entry| entry.terminal_ready)
            .and_then(|entry| entry.conn.clone())
            .map(|tx| InstanceConn { tx })
    }

    /// terminal 上行帧必须来自当前且已完成 fencing 清理的 instance 连接。
    pub async fn is_current_terminal_connection(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
    ) -> bool {
        self.inner
            .instances
            .read()
            .await
            .get(instance_id)
            .is_some_and(|entry| {
                entry.terminal_ready
                    && entry
                        .conn
                        .as_ref()
                        .is_some_and(|current| current.same_channel(&conn.tx))
            })
    }

    /// 向指定 instance 发出有界资源查询，并以 `request_id` 等待对应结果。
    pub async fn query_resource(
        &self,
        instance_id: &str,
        query: peri_studio_proto::resource::InstanceResourceQuery,
    ) -> Result<peri_studio_proto::resource::InstanceResourceResult, InstanceError> {
        {
            let instances = self.inner.instances.read().await;
            let Some(entry) = instances.get(instance_id) else {
                return Err(InstanceError::UnknownInstance(instance_id.to_string()));
            };
            if entry.resource_protocol_version
                != Some(peri_studio_proto::resource::RESOURCE_PROTOCOL_VERSION)
            {
                return Err(InstanceError::ResourceUnsupported);
            }
            if matches!(
                query.query,
                peri_studio_proto::resource::InstanceResourceQueryKind::WriteFile(_)
            ) && !entry.resource_write
            {
                return Err(InstanceError::ResourceUnsupported);
            }
        }
        let request_id = query.request_id.clone();
        let ack = self
            .send_command(
                instance_id,
                request_id.clone(),
                Frame::InstanceResourceQuery(query),
            )
            .await?;
        match ack {
            InstanceAck::Resource(result) if result.request_id == request_id => Ok(result),
            _ => Err(InstanceError::ConnectionGone),
        }
    }

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

    /// 恢复协调器使用的低延迟 seam：同步提交 authoritative 对账（因此
    /// runtime_confirmed/Gap 在返回时已经可见），耗时的 kill ack 等待在后台
    /// 完成，不能阻塞 heartbeat 帧循环或 session/resume。
    pub async fn reconcile_authoritative_alive(
        &self,
        instance_id: &str,
        alive: &[String],
    ) -> Result<(), crate::control::ChatError> {
        let report = self.inner.chats.reconcile_alive(instance_id, alive).await?;
        if !report.to_kill.is_empty() {
            let me = self.clone();
            let instance_id = instance_id.to_string();
            tokio::spawn(async move {
                me.kill_chats(&instance_id, &report.to_kill).await;
            });
        }
        Ok(())
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

    /// 打开 PTY；完成结果由 `TerminalService::on_instance_opened` 独立消费。
    pub async fn send_terminal_open(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
        open: peri_studio_proto::terminal::InstanceTerminalOpen,
    ) -> Result<(), InstanceError> {
        self.send_terminal_fire_and_forget(
            instance_id,
            conn,
            Frame::InstanceTerminalOpen(open),
            true,
        )
        .await
    }

    /// 终端输入（有界 fire-and-forget）。
    pub async fn send_terminal_input(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
        input: peri_studio_proto::terminal::InstanceTerminalInput,
    ) -> Result<(), InstanceError> {
        self.send_terminal_fire_and_forget(
            instance_id,
            conn,
            Frame::InstanceTerminalInput(input),
            true,
        )
        .await
    }

    pub async fn send_terminal_resize(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
        resize: peri_studio_proto::terminal::InstanceTerminalResize,
    ) -> Result<(), InstanceError> {
        self.send_terminal_fire_and_forget(
            instance_id,
            conn,
            Frame::InstanceTerminalResize(resize),
            true,
        )
        .await
    }

    pub async fn send_terminal_close(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
        terminal_id: String,
    ) -> Result<(), InstanceError> {
        self.send_terminal_fire_and_forget(
            instance_id,
            conn,
            Frame::InstanceTerminalClose(peri_studio_proto::terminal::InstanceTerminalClose {
                terminal_id,
            }),
            false,
        )
        .await
    }

    async fn send_terminal_fire_and_forget(
        &self,
        instance_id: &str,
        expected_conn: &InstanceConn,
        frame: Frame,
        require_serving: bool,
    ) -> Result<(), InstanceError> {
        let (tx, disconnect) = {
            let instances = self.inner.instances.read().await;
            let Some(entry) = instances.get(instance_id) else {
                return Err(InstanceError::UnknownInstance(instance_id.to_string()));
            };
            if entry.terminal_protocol_version
                != Some(peri_studio_proto::terminal::TERMINAL_PROTOCOL_VERSION)
            {
                return Err(InstanceError::TerminalUnsupported);
            }
            if !entry.terminal_ready {
                return Err(InstanceError::ConnectionGone);
            }
            if require_serving && !entry.state.can_serve() {
                return Err(InstanceError::Offline);
            }
            let Some(current) = entry.conn.as_ref() else {
                return Err(InstanceError::Offline);
            };
            if !current.same_channel(&expected_conn.tx) {
                return Err(InstanceError::ConnectionGone);
            }
            (entry.conn.clone(), entry.disconnect.clone())
        };
        let Some(tx) = tx else {
            return Err(InstanceError::Offline);
        };
        match tx.try_send(OutboundMsg::Frame(frame)) {
            Ok(()) => Ok(()),
            Err(tokio::sync::mpsc::error::TrySendError::Full(_))
            | Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                if !require_serving {
                    if let Some(disconnect) = disconnect {
                        disconnect.cancel();
                    }
                }
                Err(InstanceError::ConnectionGone)
            }
        }
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
