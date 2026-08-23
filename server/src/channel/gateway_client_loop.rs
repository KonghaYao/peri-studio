//! `Gateway` 客户端连接路径拆分（结构拆分，行为不变）。
//!
//! 原 `gateway.rs` 超过 500 行，按主题拆为三个文件（同一 `impl Gateway`
//! 分散定义）：
//!
//! - `gateway_client_loop.rs`（本文件）：客户端连接——认证 →
//!   `handle_authenticated_client_connection` 快照时序 + 帧循环 + 心跳
//!   （client 帧循环），以及分派结果副作用 `apply_outcome`；
//! - `gateway_instance_loop.rs`：instance 连接——双向认证 → hello 注册 →
//!   帧循环（instance 帧循环）→ 断链清理；
//! - `gateway.rs`：装配入口（`new`/`run`）、`connection_task`（回环检查/
//!   HTTP 分支/配额/握手/角色分派）与连接收尾 `finish_connection`、自由
//!   辅助函数（`send_frame`/`close_code`/`doc_cid`/`unsupported_error` 等）。
//!
//! 职责边界：本文件只处理 client 角色的入站帧（§4.6/§4.8 时序）与
//! `DispatchOutcome` 副作用，不涉及 instance 角色的 hello/ack 路径。

use std::net::SocketAddr;
use std::time::Duration;

use base64::Engine as _;
use futures::{SinkExt as _, StreamExt as _};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, info, warn};

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::conn::Auth;
use peri_studio_proto::frame::{Frame, ProtoError};
use peri_studio_proto::resource::{ResourceErrorCode, ResourceFailure, ResourceResult};
use peri_studio_proto::whitelist::{m1_allows_action_type, m1_check, Direction, Role};

use crate::auth::audit::audit;
use crate::channel::command_coordinator::extract_command_id;
use crate::channel::gateway::{close_code, doc_cid, send_frame, unsupported_error, Gateway};
use crate::channel::mutation_admission::MutationAdmission;
use crate::channel::{ChatChannel, DispatchOutcome};
use crate::channel::{ConnId, OutboundMsg};
use crate::control::HeartbeatDriver;

impl Gateway {
    /// 客户端连接：认证 → 快照时序 → 帧循环 + 心跳。
    pub(super) async fn handle_client_connection(
        &self,
        conn_id: ConnId,
        mut ws_sink: futures::stream::SplitSink<WebSocketStream<TcpStream>, Message>,
        ws_stream: futures::stream::SplitStream<WebSocketStream<TcpStream>>,
        peer: SocketAddr,
        auth: Auth,
    ) {
        // 认证（§4.6 步骤 3；失败断开 + 计数在 AuthService 内，§9.2）。
        let ctx = {
            let mut auth_service = self.auth.lock().await;
            match auth_service.authenticate_client(&auth, peer).await {
                Ok(ctx) => ctx,
                Err(e) => {
                    warn!(peer = %peer, error = ?e, "client auth failed");
                    let _ = ws_sink
                        .send(Message::Close(Some(CloseFrame {
                            code: close_code(4502),
                            reason: "authentication failed".into(),
                        })))
                        .await;
                    self.conns.unregister(conn_id);
                    return;
                }
            }
        };
        self.handle_authenticated_client_connection(conn_id, ws_sink, ws_stream, ctx, None, None)
            .await;
    }

    pub(super) async fn handle_authenticated_client_connection(
        &self,
        conn_id: ConnId,
        mut ws_sink: futures::stream::SplitSink<WebSocketStream<TcpStream>, Message>,
        mut ws_stream: futures::stream::SplitStream<WebSocketStream<TcpStream>>,
        ctx: crate::auth::ConnectionCtx,
        browser_session: Option<String>,
        first_frame: Option<Frame>,
    ) {
        let peer = ctx.peer;
        let (out_tx, mut out_rx) = mpsc::channel::<OutboundMsg>(256);
        self.conns.upgrade(conn_id, ctx.clone());
        audit(
            "conn.open",
            None,
            Some(&ctx.token_id),
            "ok",
            Duration::ZERO,
            None,
        );
        info!(conn_id, token_id = %ctx.token_id, peer = %peer, "client connected");

        let mut channel = ChatChannel::new(ctx.clone());
        let mut heartbeat = HeartbeatDriver::new(self.heartbeat_interval, self.heartbeat_timeout);
        let mut ticker = tokio::time::interval(self.heartbeat_interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        ticker.tick().await;

        if let Some(frame) = first_frame {
            let outcome = channel.dispatch(frame, &self.deps, out_tx.clone()).await;
            if let Some(code) = self
                .apply_outcome(&mut channel, &out_tx, conn_id, outcome)
                .await
            {
                self.finish_connection(conn_id, &mut ws_sink, code, "client connection closed")
                    .await;
                return;
            }
        }

        let deps = self.deps.clone();
        let close_code = loop {
            tokio::select! {
                msg = ws_stream.next() => {
                    let Some(msg) = msg else { break 1011 };
                    match msg {
                        Ok(Message::Text(text)) => {
                            let frame = match Frame::parse(&text) {
                                Ok(f) => f,
                                Err(e) => {
                                    // §4.8：未知/畸形帧 → UNSUPPORTED_FRAME
                                    // （不静默，不 panic；脱敏：不回显正文）。
                                    let _ = out_tx.send(OutboundMsg::Frame(
                                        unsupported_error(&e))).await;
                                    continue;
                                }
                            };
                            // M1 白名单 + 方向（§4.8；Pong 已放行——心跳回执）。
                            if !matches!(frame, Frame::Pong(_))
                                && !matches!(m1_check(frame.tag(), Role::Client, Direction::Inbound),
                                    peri_studio_proto::whitelist::M1Check::Allowed)
                            {
                                let _ = out_tx.send(OutboundMsg::Frame(
                                    unsupported_error(&ProtoError::DirectionRejected(
                                        frame.tag().0.to_string())))).await;
                                continue;
                            }
                            if let Frame::Pong(_) = frame {
                                heartbeat.on_pong();
                                continue;
                            }
                            // M1 action type 收窄（§4.8：`session/load`（M2）、
                            // `events/*`（M3）类型保留但白名单外 → UNSUPPORTED_FRAME，
                            // 不静默）。先于 §17.2 Degraded 检查（协议层检查先于
                            // 资源状态检查——Degraded 拒绝是 retryable 语义，而
                            // 方法不支持是确定语义，二者不可混淆）。
                            if let Frame::Action(action) = &frame {
                                if !m1_allows_action_type(action.type_str()) {
                                    let command_id =
                                        extract_command_id(action).unwrap_or_default();
                                    let _ = out_tx
                                        .send(OutboundMsg::Frame(Frame::ActionError(
                                            ActionError {
                                                command_id,
                                                code: ErrorCode::UnsupportedFrame,
                                                message: format!(
                                                    "unsupported action type: {}",
                                                    action.type_str()
                                                ),
                                                retryable: false,
                                                retry_after_ms: None,
                                            },
                                        )))
                                        .await;
                                    continue;
                                }
                            }
                            // §17.2/§8.4：Degraded/Restarting 拒绝所有 committed
                            // 承诺。Action 与 Git mutation 共用一处分类，避免新增
                            // 写入口绕过恢复屏障；资源读取始终保持可用。
                            if let Some(rejection) = MutationAdmission::rejection(
                                &frame,
                                self.can_accept_committed(),
                            ) {
                                let _ = out_tx.send(OutboundMsg::Frame(rejection)).await;
                                continue;
                            }
                            if let Frame::ResourceQuery(query) = frame {
                                let result = self.resources.handle(
                                    &channel.ctx.token_id,
                                    channel.ctx.role == crate::auth::TokenRole::Full,
                                    query,
                                ).await;
                                let _ = out_tx.send(OutboundMsg::Frame(
                                    Frame::ResourceResult(result))).await;
                                continue;
                            }
                            let outcome = channel.dispatch(frame, &deps, out_tx.clone()).await;
                            if let Some(code) = self.apply_outcome(&mut channel, &out_tx, conn_id, outcome).await {
                                break code;
                            }
                        }
                        Ok(Message::Pong(_)) => heartbeat.on_pong(),
                        Ok(Message::Close(_)) => break 1000,
                        Ok(Message::Binary(_)) => {
                            let _ = out_tx.send(OutboundMsg::Frame(
                                unsupported_error(&ProtoError::DirectionRejected(
                                    "binary not supported".into())))).await;
                        }
                        Ok(_) => {}
                        Err(e) => {
                            debug!(conn_id, error = ?e, "ws read error");
                            break 1011;
                        }
                    }
                }
                _ = ticker.tick() => {
                    let valid = if let Some(sid) = browser_session.as_deref() {
                        self.auth.lock().await.validate_browser_session(sid, peer).map(|_| ())
                    } else {
                        self.auth.lock().await.revalidate_client_identity(&ctx.token_id, ctx.role)
                    };
                    if valid.is_err() { break 4502; }
                    // keep_alive（§4.7：每 interval 下发；pong 超时 → 4501）。
                    let now = std::time::Instant::now();
                    if heartbeat.should_send_keepalive(now) {
                        heartbeat.note_sent();
                        let _ = out_tx.send(OutboundMsg::Frame(Frame::KeepAlive(
                            peri_studio_proto::conn::KeepAlive {}))).await;
                    }
                    if heartbeat.check_timeout(now) {
                        warn!(conn_id, "keep_alive pong timeout");
                        break 4501;
                    }
                }
                out = out_rx.recv() => {
                    match out {
                        Some(OutboundMsg::Frame(f)) => {
                            if send_frame(&mut ws_sink, &f).await.is_err() {
                                break 1011;
                            }
                        }
                        Some(OutboundMsg::JsonRpc(_)) => break 1011,
                        Some(OutboundMsg::Close(code)) => break code,
                        None => break 1011,
                    }
                }
            }
        };

        self.finish_connection(
            conn_id,
            &mut ws_sink,
            close_code,
            "client connection closed",
        )
        .await;
    }

    /// 分派结果副作用执行（gateway 侧：打开 doc + 快照 + ready + flush）。
    /// 返回 Some(close_code) = 连接需关闭。
    async fn apply_outcome(
        &self,
        channel: &mut ChatChannel,
        out_tx: &mpsc::Sender<OutboundMsg>,
        conn_id: ConnId,
        outcome: DispatchOutcome,
    ) -> Option<u16> {
        match outcome {
            DispatchOutcome::Send(msgs) => {
                for m in msgs {
                    if out_tx.send(m).await.is_err() {
                        return Some(1011);
                    }
                }
                None
            }
            DispatchOutcome::Subscribe { docs, first } => {
                let mut versions = std::collections::HashMap::new();
                for doc in &docs {
                    if doc.as_str().starts_with("resource:")
                        && !self
                            .resources
                            .projection()
                            .subscribe(&channel.ctx.token_id, conn_id, doc)
                            .await
                    {
                        let _ = out_tx
                            .send(OutboundMsg::Frame(Frame::ResourceResult(ResourceResult {
                                request_id: String::new(),
                                result: None,
                                error: Some(ResourceFailure {
                                    code: ResourceErrorCode::Forbidden,
                                    message: "resource view is not authorized".into(),
                                    retryable: false,
                                }),
                            })))
                            .await;
                        continue;
                    }
                    // 打开/恢复 Doc（§4.6 步骤 2：DocManager::open_chat 幂等；
                    // instance_id/title 来自 ChatRegistry，未登记 → 空值）。
                    if let Some(cid) = doc_cid(doc) {
                        let (instance_id, title) = match self.deps.chats.entry(cid).await {
                            Some(e) => (e.instance_id.clone(), e.title.clone()),
                            None => (String::new(), String::new()),
                        };
                        if let Err(e) = self
                            .doc
                            .open_chat(cid, &instance_id, Some(&title), None, None)
                            .await
                        {
                            warn!(conn_id, chat_id = cid, error = ?e, "open chat failed");
                        }
                    }
                    // 全量快照（§4.6 步骤 3：StoreSink 镜像 + projection_version）。
                    if let Some((state, version)) = self.sink.snapshot(doc).await {
                        let frame = Frame::YsyncUpdate(peri_studio_proto::ysync::YsyncUpdate {
                            doc: doc.clone(),
                            update: base64::engine::general_purpose::STANDARD.encode(&state),
                            projection_version: Some(version),
                        });
                        if out_tx.send(OutboundMsg::Frame(frame)).await.is_err() {
                            return Some(1011);
                        }
                        versions.insert(doc.clone(), version);
                    }
                    // broadcaster 接线（§4.2 订阅）。
                    if let Err(e) = self
                        .deps
                        .broadcast
                        .subscribe(conn_id, vec![doc.clone()], out_tx.clone())
                        .await
                    {
                        warn!(conn_id, error = ?e, "broadcast subscribe failed");
                    }
                }
                if first {
                    // ready 握手（§4.6 步骤 4）→ mark_ready → flush 缓冲。
                    let ready = Frame::Ready(peri_studio_proto::conn::Ready {
                        projection_versions: versions,
                        negotiated_capabilities: channel.negotiated_capabilities(),
                    });
                    if out_tx.send(OutboundMsg::Frame(ready)).await.is_err() {
                        return Some(1011);
                    }
                    let flushed = channel.mark_ready();
                    // flush 缓冲 Action（§4.6 步骤 4；ready 后正常 submit 路径）。
                    for action in flushed {
                        match channel
                            .dispatch(Frame::Action(action), &self.deps, out_tx.clone())
                            .await
                        {
                            DispatchOutcome::Send(msgs) => {
                                for m in msgs {
                                    if out_tx.send(m).await.is_err() {
                                        return Some(1011);
                                    }
                                }
                            }
                            DispatchOutcome::Disconnect(code) => return Some(code),
                            _ => {}
                        }
                    }
                }
                None
            }
            DispatchOutcome::Unsubscribe { docs } => {
                self.resources
                    .projection()
                    .unsubscribe(conn_id, &docs)
                    .await;
                self.deps.broadcast.unsubscribe(conn_id, docs).await;
                None
            }
            DispatchOutcome::Disconnect(code) => Some(code),
            DispatchOutcome::None => None,
        }
    }
}
