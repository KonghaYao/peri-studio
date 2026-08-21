//! `Gateway` instance 连接路径拆分（结构拆分，行为不变）。
//!
//! 原 `gateway.rs` 超过 500 行，按主题拆为三个文件（同一 `impl Gateway`
//! 分散定义）：
//!
//! - `gateway_client_loop.rs`：客户端连接——认证 → 快照时序 + 帧循环 +
//!   心跳，以及 `apply_outcome`；
//! - `gateway_instance_loop.rs`（本文件）：instance 连接——双向认证 →
//!   auth_response 下发 → hello 注册（fencing）+ 视图 upsert + 孤儿清理 +
//!   resume 对账 → 帧循环（event/buffer_sync/heartbeat/ack/process_exit）
//!   → 断链清理（§8.2 matrix instance 行）；
//! - `gateway.rs`：装配入口、`connection_task`（角色分派）与连接收尾、
//!   自由辅助函数。
//!
//! 职责边界：本文件只处理 instance 角色的 hello/帧/断链语义（§9.2/§4.5），
//! 不涉及 client 角色的订阅/快照/心跳时序。

use std::net::SocketAddr;
use std::time::Duration;

use futures::{SinkExt as _, StreamExt as _};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, info, warn};

use peri_studio_proto::frame::Frame;
use peri_studio_proto::instance::InstanceHello;
use peri_studio_proto::schema::{InstanceStatus, InstanceView};
use peri_studio_proto::whitelist::{m1_check, Direction, Role};

use crate::auth::audit::audit;
use crate::channel::gateway::{close_code, send_frame, trace_consume, Gateway};
use crate::channel::{ConnId, OutboundMsg};
use crate::control::{InstanceAck, InstanceConn};

impl Gateway {
    /// instance 连接：双向认证 → hello 注册 → 帧循环。
    pub(super) async fn handle_instance_connection(
        &self,
        conn_id: ConnId,
        mut ws_sink: futures::stream::SplitSink<WebSocketStream<TcpStream>, Message>,
        mut ws_stream: futures::stream::SplitStream<WebSocketStream<TcpStream>>,
        peer: SocketAddr,
        hello: InstanceHello,
    ) {
        let (out_tx, mut out_rx) = mpsc::channel::<OutboundMsg>(256);
        // 双向认证（§9.2 步骤 1–2）。
        let (ctx, auth_response) = {
            let mut auth_service = self.auth.lock().await;
            match auth_service.authenticate_instance(&hello, peer).await {
                Ok(ok) => (ok.ctx, ok.response),
                Err(e) => {
                    warn!(peer = %peer, error = ?e, "instance auth failed");
                    let reason =
                        if matches!(e, crate::auth::AuthError::ProtocolVersionMismatch { .. }) {
                            "instance protocol version mismatch"
                        } else {
                            "instance authentication failed"
                        };
                    let _ = ws_sink
                        .send(Message::Close(Some(CloseFrame {
                            code: close_code(4502),
                            reason: reason.into(),
                        })))
                        .await;
                    self.conns.unregister(conn_id);
                    return;
                }
            }
        };
        self.conns.upgrade(conn_id, ctx.clone());
        // 下发 auth_response（§9.2 步骤 2：server 身份证明；instance 校验通过
        // 前不执行任何 spawn/kill）。
        if send_frame(&mut ws_sink, &Frame::AuthResponse(auth_response))
            .await
            .is_err()
        {
            debug!(conn_id, "auth_response send failed");
            self.conns.unregister(conn_id);
            return;
        }
        let instance_id = ctx.name.clone();
        // hello 注册（§4.5 幂等替换：fencing 旧连接）。
        let outcome = self
            .deps
            .instance
            .on_hello(
                &instance_id,
                &ctx.token_id,
                InstanceConn { tx: out_tx.clone() },
                &hello,
            )
            .await;
        audit(
            "instance.hello",
            None,
            Some(&ctx.token_id),
            "ok",
            Duration::ZERO,
            None,
        );
        info!(
            conn_id, instance_id = %instance_id, hostname = %hello.hostname,
            fenced = outcome.fenced_previous,
            "instance connected"
        );
        // hello 注册成功 → Registry instances 视图 upsert（§7.1/§12.4：机器
        // 列表唯一权威源；registered_at 以本次 hello 时刻为准，后续心跳
        // 复用首值）。
        let registered_at = chrono::Utc::now().to_rfc3339();
        let view = InstanceView {
            id: instance_id.clone(),
            hostname: hello.hostname.clone(),
            status: InstanceStatus::Online,
            token_id: ctx.token_id.clone(),
            registered_at: registered_at.clone(),
            last_heartbeat: registered_at.clone(),
            chat_count: 0,
        };
        if let Err(e) = self.registry.upsert_instance(view).await {
            warn!(instance_id = %instance_id, error = ?e, "registry instance upsert failed (hello)");
        }
        // 孤儿清理钩子（§7.5：已中断/终态但 instance 声称存活 → 补发 kill）。
        self.deps
            .instance
            .cleanup_orphans(&instance_id, &outcome)
            .await;
        // §4 恢复路径（live chat）：instance 重连（hello）后对其非终态 chat
        // 批量发起 session/resume——ACP 进程在 server 崩溃期间继续运行，
        // 从 ThreadStore 重放历史重建 server 视图（不阻塞 hello 帧循环；
        // 失败由客户端显式 load 兜底）。
        self.deps
            .coordinator
            .resume_instance_chats(&instance_id)
            .await;
        // §8.4.1 不变量 4：instance 重连（hello）对账后开门——Restarting →
        // Healthy（或 Degraded，若其他条件仍活跃；幂等）。
        if let Err(e) = self.registry.clear_restarting().await {
            warn!(instance_id = %instance_id, error = ?e, "clear_restarting failed (registry write)");
        }

        let mut auth_ticker = tokio::time::interval(self.heartbeat_interval);
        auth_ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        auth_ticker.tick().await;

        let close_code = loop {
            tokio::select! {
                _ = auth_ticker.tick() => {
                    if self.auth.lock().await.revalidate_instance_identity(&ctx.token_id).is_err() { break 4502; }
                }
                msg = ws_stream.next() => {
                    let Some(msg) = msg else { break 1011 };
                    match msg {
                        Ok(Message::Text(text)) => {
                            let frame = match Frame::parse(&text) {
                                Ok(f) => f,
                                Err(e) => {
                                    warn!(instance_id = %instance_id, error = ?e, "malformed instance frame");
                                    continue;
                                }
                            };
                            if !matches!(m1_check(frame.tag(), Role::Instance, Direction::Inbound),
                                peri_studio_proto::whitelist::M1Check::Allowed)
                            {
                                warn!(instance_id = %instance_id, tag = %frame.tag(),
                                    "instance frame rejected (whitelist)");
                                continue;
                            }
                            match frame {
                                Frame::InstanceEvent(ev) => {
                                    let r = self.relay.on_instance_event(&instance_id, &ev).await;
                                    if let crate::channel::relay_event_handler::ConsumeResult::OAuthStatus { chat_id, frame } = &r {
                                        self.deps.broadcast.fan_out_ephemeral_chat(
                                            chat_id,
                                            Frame::McpOAuth(frame.clone()),
                                        ).await;
                                    }
                                    trace_consume(&r);
                                }
                                Frame::InstanceBufferSync(sync) => {
                                    let r = self.relay.on_buffer_sync(&instance_id, &sync).await;
                                    trace_consume(&r);
                                }
                                Frame::InstanceHeartbeat(hb) => {
                                    if let Err(e) = self.deps.instance.on_heartbeat(&instance_id, &hb).await {
                                        debug!(instance_id = %instance_id, error = ?e, "heartbeat rejected");
                                    }
                                    // 心跳 → Registry instances 视图更新（§4.5：
                                    // last_heartbeat 刷新 + 存活会话计数；失败仅降级
                                    // 记录，不打断帧循环）。
                                    let now = chrono::Utc::now().to_rfc3339();
                                    let view = InstanceView {
                                        id: instance_id.clone(),
                                        hostname: hello.hostname.clone(),
                                        status: InstanceStatus::Online,
                                        token_id: ctx.token_id.clone(),
                                        registered_at: registered_at.clone(),
                                        last_heartbeat: now,
                                        chat_count: hb.alive_sessions.len() as u32,
                                    };
                                    if let Err(e) = self.registry.upsert_instance(view).await {
                                        debug!(instance_id = %instance_id, error = ?e, "registry heartbeat upsert failed");
                                    }
                                }
                                Frame::InstanceSpawnAck(ack) => {
                                    let cid = ack.command_id.clone();
                                    self.deps.instance.on_ack(&instance_id, &cid,
                                        InstanceAck::Spawn(ack)).await;
                                }
                                Frame::InstanceKillAck(ack) => {
                                    let cid = ack.command_id.clone();
                                    self.deps.instance.on_ack(&instance_id, &cid,
                                        InstanceAck::Kill(ack)).await;
                                }
                                Frame::InstanceForwardAck(ack) => {
                                    let cid = ack.command_id.clone();
                                    self.deps.instance.on_ack(&instance_id, &cid,
                                        InstanceAck::Forward(ack)).await;
                                }
                                Frame::InstanceProcessExit(exit) => {
                                    let r = self.relay.on_process_exit(&instance_id, &exit).await;
                                    trace_consume(&r);
                                }
                                _ => {
                                    warn!(instance_id = %instance_id, tag = %frame.tag(),
                                        "unexpected instance inbound frame");
                                }
                            }
                        }
                        Ok(Message::Close(_)) => break 1000,
                        Ok(_) => {}
                        Err(e) => {
                            debug!(conn_id, error = ?e, "instance ws read error");
                            break 1011;
                        }
                    }
                }
                out = out_rx.recv() => {
                    match out {
                        Some(OutboundMsg::Frame(f)) => {
                            if send_frame(&mut ws_sink, &f).await.is_err() {
                                break 1011;
                            }
                        }
                        Some(OutboundMsg::JsonRpc(v)) => {
                            // 透传 JSON-RPC（prompt/cancel/resolve/initialize/
                            // session/new；instance 保持 dumb，§4.5）。
                            let bytes = v.to_string().into();
                            if ws_sink.send(Message::Text(bytes)).await.is_err() {
                                break 1011;
                            }
                        }
                        Some(OutboundMsg::Close(code)) => break code,
                        None => break 1011,
                    }
                }
            }
        };

        // 断链语义（§8.2 matrix instance 行）：立即 OFFLINE + 断链清理。
        // conn 句柄比对：hello fencing 后旧连接滞后断开不触碰新连接状态
        // （§4.5 幂等替换）。
        let was_online = self
            .deps
            .instance
            .on_disconnect(&instance_id, &InstanceConn { tx: out_tx.clone() })
            .await;
        if was_online {
            if let Err(e) = self.relay.on_instance_disconnect(&instance_id).await {
                warn!(instance_id = %instance_id, error = ?e, "instance disconnect cleanup failed");
            }
        }
        // conn.close 审计统一由 finish_connection 记录（review #19：避免
        // instance 路径与 client 路径重复审计、统计口径不一致）。
        self.finish_connection(
            conn_id,
            &mut ws_sink,
            close_code,
            "instance connection closed",
        )
        .await;
    }
}
