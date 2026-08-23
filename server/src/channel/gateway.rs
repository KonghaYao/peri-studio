//! Gateway：ws 生命周期（架构 §4.6/§4.7/§9.2/§9.5）。
//!
//! ws 入口：accept → 回环检查（§9.5）→ 静态分流（非 ws 的 HTTP GET 交
//! `crate::web` 验证台，§web）→ 配额（§8.6）→ 认证 → 角色分派 → 快照时序
//! （client）/机器会话（instance）→ 心跳接线 → 断链清理。
//!
//! 客户端时序（§4.6）：配额 → `auth` → 订阅（`ysync.subscribe`）→ 打开/恢复
//! Doc（`DocManager::open_chat` 幂等）→ 推全量快照（StoreSink 镜像，
//! 携带 `projection_version`）→ `ready` 握手 → `mark_ready` → flush 缓冲
//! Action → 帧循环 + 心跳（`HeartbeatDriver`，pong 超时 4501）。
//!
//! instance 时序（§9.2/§4.5）：首帧 `instance/hello` → 双向认证 →
//! `auth_response` 下发 → `InstanceRegistry::on_hello`（fencing + 注册）→
//! 帧循环（event/buffer_sync/heartbeat/ack/process_exit）→ 断开 →
//! `on_disconnect` + `RelayEventHandler::on_instance_disconnect`（§8.2）。
//!
//! # 拆分说明（结构拆分，行为不变）
//!
//! 本文件原超过 500 行，按主题拆为三个文件（同一 `impl Gateway` 分散
//! 定义，均注册于 `channel/mod.rs`）：
//!
//! - 本文件：装配入口（`new`/`can_accept_committed`/`run`）、
//!   `connection_task`（回环检查/HTTP 分支/配额/握手/角色分派）、连接收尾
//!   `finish_connection` 与自由辅助函数（`send_frame`/`close_code`/
//!   `doc_cid`/`unsupported_error` 等）；
//! - `gateway_client_loop.rs`：客户端帧循环（`handle_client_connection` /
//!   `handle_authenticated_client_connection`）与 `apply_outcome`；
//! - `gateway_instance_loop.rs`：instance 帧循环（`handle_instance_connection`）。
//!
//! 对外 pub 面（`Gateway`/`GatewayError`/`FIRST_FRAME_TIMEOUT`）保持不变。

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures::{SinkExt as _, StreamExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::accept_hdr_async_with_config;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, info, warn};

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::action::ActionEnvelope;
use peri_studio_proto::frame::{Frame, ProtoError};
use peri_studio_proto::resource::MAX_RESOURCE_WS_MESSAGE_BYTES;

use crate::auth::audit::audit;
use crate::auth::AuthService;
use crate::channel::command_coordinator::extract_command_id;
use crate::channel::instance_recovery::RecoveryCoordinator;
use crate::channel::RelayEventHandler;
use crate::channel::{ChannelDeps, ConnId, ConnectionRegistry};
use crate::config::Config;
use crate::control::{ResourceService, StoreSink};

use crate::state::doc_manager::DocManager;
use crate::state::registry::RegistryState;

/// 首帧等待超时（§4.6 步骤 1 前：10s 无首帧断开）。
pub const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(10);

/// HTTP 头部窥探补齐上限（§web：首段未含 `\r\n\r\n` 时短等碎片；超过即按
/// 非 ws 处理。正常 GET/升级请求首段即完整，该上限只兜底慢发包场景）。
const HEAD_PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// 认证前占位 token_id（§5「认证前占位」；认证成功后 upgrade 替换）。
const PENDING_TOKEN_ID: &str = "<pending-auth>";

/// gateway 错误。
#[derive(Debug, thiserror::Error)]
pub enum GatewayError {
    /// accept 循环错误。
    #[error("accept error: {0}")]
    Accept(std::io::Error),
}

/// ws 入口：accept → 配额/回环检查 → 认证 → 角色分派 → 快照时序/机器会话。
#[derive(Clone)]
pub struct Gateway {
    // 字段 `pub(super)`：拆分子模块（gateway_client_loop / gateway_instance_loop）
    // 的同一 impl 块需要访问（crate 外 pub 面不变）。
    pub(super) cfg: Arc<Config>,
    pub(super) auth: Arc<Mutex<AuthService>>,
    pub(super) conns: Arc<ConnectionRegistry>,
    pub(super) deps: ChannelDeps,
    pub(super) relay: Arc<RelayEventHandler>,
    pub(super) doc: Arc<DocManager>,
    pub(super) sink: Arc<StoreSink>,
    pub(super) resources: Arc<ResourceService>,
    pub(super) registry: RegistryState,
    pub(super) recovery: RecoveryCoordinator,
    pub(super) heartbeat_interval: Duration,
    pub(super) heartbeat_timeout: Duration,
    pub(super) auth_setup: crate::web::BrowserAuthSetup,
}

impl Gateway {
    /// 装配（hub 调用；心跳参数取 §16 默认 5s，pong 超时 = 3×interval）。
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        cfg: Arc<Config>,
        auth: Arc<Mutex<AuthService>>,
        conns: Arc<ConnectionRegistry>,
        deps: ChannelDeps,
        relay: Arc<RelayEventHandler>,
        doc: Arc<DocManager>,
        sink: Arc<StoreSink>,
        resources: Arc<ResourceService>,
        registry: RegistryState,
        recovery_instances: HashSet<String>,
    ) -> Self {
        let heartbeat_interval = cfg.heartbeat_interval;
        let heartbeat_timeout = heartbeat_interval * 3;
        let auth_setup = crate::web::BrowserAuthSetup::from_config(&cfg);
        let recovery = RecoveryCoordinator::new(
            recovery_instances,
            deps.instance.clone(),
            deps.coordinator.clone(),
            registry.clone(),
        );
        Gateway {
            cfg,
            auth,
            conns,
            deps,
            relay,
            doc,
            sink,
            resources,
            registry,
            recovery,
            heartbeat_interval,
            heartbeat_timeout,
            auth_setup,
        }
    }

    /// Degraded 判定（§17.2）：非 Healthy 时拒绝新 committed 承诺（gateway
    /// 分派 action 前检查；hub 也暴露同一入口）。
    pub fn can_accept_committed(&self) -> bool {
        matches!(
            self.registry.global_status(),
            peri_studio_proto::schema::GlobalStatus::Healthy
        )
    }

    /// accept 循环（hub 装配调用）。
    pub async fn run(&self, listener: TcpListener) -> Result<(), GatewayError> {
        loop {
            let (stream, peer) = match listener.accept().await {
                Ok(x) => x,
                Err(e) => {
                    warn!(error = ?e, "accept failed");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            };
            let this = self.clone();
            tokio::spawn(async move {
                this.connection_task(stream, peer).await;
            });
        }
    }

    /// 连接任务（每连接一个）。
    #[allow(clippy::result_large_err)] // tungstenite handshake callback fixes the public error shape.
    async fn connection_task(&self, stream: TcpStream, peer: SocketAddr) {
        // 1. 非回环拒绝（§9.5：Config::allow_peer；不进注册表）。
        if !self.cfg.allow_peer(&peer) {
            warn!(
                peer = %peer,
                "connection rejected: non-loopback (allow_non_loopback=false, §9.5)"
            );
            drop(stream);
            return;
        }
        // 2. HTTP 分支（内嵌 Web + cookie auth bootstrap）：非 ws 升级请求
        // 交给 bounded HTTP surface；ws 升级
        //    请求原样走后续握手。窥探（peek 不消费数据，握手字节不受影响）
        //    首段：定位 `\r\n\r\n` 后查 `upgrade: websocket`；头部碎片未齐时
        //    短等补齐（HEAD_PROBE_TIMEOUT），避免把碎片到达的 ws 握手误判。
        let mut peeked = [0u8; 4096];
        let mut head_len;
        let head_end = {
            let deadline = tokio::time::Instant::now() + HEAD_PROBE_TIMEOUT;
            loop {
                head_len = match stream.peek(&mut peeked).await {
                    Ok(n) => n,
                    Err(e) => {
                        debug!(peer = %peer, error = ?e, "peek failed");
                        drop(stream);
                        return;
                    }
                };
                match crate::web::header_end(&peeked[..head_len]) {
                    Some(end) => break Some(end),
                    // EOF / 缓冲已满 / 超时仍未齐 → 按非 ws 处理（serve 兜底）。
                    None if head_len == 0
                        || head_len == peeked.len()
                        || tokio::time::Instant::now() >= deadline =>
                    {
                        break None;
                    }
                    None => tokio::time::sleep(Duration::from_millis(20)).await,
                }
            }
        };
        let is_ws = match head_end {
            Some(end) => crate::web::is_ws_upgrade(&peeked[..end]),
            None => false,
        };
        if !is_ws {
            // HTTP 分支：不进配额/注册表（§8.6 只面向 ws 连接）。
            let health =
                crate::web::HealthSnapshot::from_global_status(self.registry.global_status());
            if let Err(e) = crate::web::serve_http_with_resources(
                stream,
                peer,
                self.auth.clone(),
                self.auth_setup.clone(),
                health,
                self.resources.clone(),
            )
            .await
            {
                debug!(peer = %peer, error = ?e, "static serve failed");
            }
            return;
        }
        // 3. 配额检查（认证**前**占位，§8.6：防未认证连接占满配额）。
        let pending_ctx = crate::auth::ConnectionCtx {
            token_id: PENDING_TOKEN_ID.to_string(),
            role: crate::auth::TokenRole::Full,
            name: String::new(),
            peer,
            hostname: None,
            established_at: chrono::Utc::now(),
        };
        let conn_id = match self.conns.register(pending_ctx) {
            Ok(h) => h.id,
            // 配额超限：ws 握手前无法发 close 帧，只能 drop(stream)——
            // 客户端只会看到 TCP 断开，靠 §4.7 退避重连（1013 应用码在
            // 握手后才可能下发，此处不适用）。
            Err(_) => {
                drop(stream);
                return;
            }
        };

        // 4. ws 握手。
        let cookie_principal = Arc::new(std::sync::Mutex::new(None::<String>));
        let captured = cookie_principal.clone();
        let allow_non_loopback = self.cfg.allow_non_loopback;
        // 默认 tungstenite 允许 64 MiB message；这里显式收紧到资源中继契约，
        // 同时保留管理员显式调大的 ACP frame 配置。
        let ws_message_limit = MAX_RESOURCE_WS_MESSAGE_BYTES.max(self.cfg.max_frame_bytes + 4096);
        let ws_config = WebSocketConfig::default()
            .max_message_size(Some(ws_message_limit))
            .max_frame_size(Some(ws_message_limit));
        let ws = match accept_hdr_async_with_config(
            stream,
            move |req: &tokio_tungstenite::tungstenite::handshake::server::Request,
                  resp: tokio_tungstenite::tungstenite::handshake::server::Response| {
                let host = req
                    .headers()
                    .get("host")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or_default();
                let origin = req.headers().get("origin").and_then(|v| v.to_str().ok());
                if !crate::web::valid_ws_host(host, allow_non_loopback)
                    || !crate::web::valid_ws_origin(origin, host)
                {
                    return Err(
                        tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(
                            Some("forbidden".into()),
                        ),
                    );
                }
                if let Some(cookie) = req
                    .headers()
                    .get("cookie")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| crate::web::cookie_value(v, crate::auth::BROWSER_COOKIE))
                {
                    *captured.lock().unwrap() = Some(cookie);
                }
                Ok(resp)
            },
            Some(ws_config),
        )
        .await
        {
            Ok(ws) => ws,
            Err(e) => {
                debug!(peer = %peer, error = ?e, "ws handshake failed");
                self.conns.unregister(conn_id);
                return;
            }
        };
        let (mut ws_sink, mut ws_stream) = ws.split();

        let captured_cookie = { cookie_principal.lock().unwrap().clone() };
        let cookie_ctx = match captured_cookie {
            Some(sid) => match self.auth.lock().await.validate_browser_session(&sid, peer) {
                Ok(ctx) => Some((sid, ctx)),
                Err(_) => {
                    self.finish_connection(conn_id, &mut ws_sink, 4502, "invalid browser session")
                        .await;
                    return;
                }
            },
            None => None,
        };

        // 5. Cookie-authenticated clients may start directly with subscribe/action.
        let first = match tokio::time::timeout(FIRST_FRAME_TIMEOUT, ws_stream.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => match Frame::parse(&text) {
                Ok(f) => f,
                Err(_) => {
                    self.finish_connection(conn_id, &mut ws_sink, 1011, "malformed first frame")
                        .await;
                    return;
                }
            },
            Ok(Some(Ok(_))) => {
                self.finish_connection(conn_id, &mut ws_sink, 1011, "first frame must be text")
                    .await;
                return;
            }
            Ok(Some(Err(e))) => {
                debug!(peer = %peer, error = ?e, "first frame read error");
                self.conns.unregister(conn_id);
                return;
            }
            Ok(None) | Err(_) => {
                self.finish_connection(conn_id, &mut ws_sink, 1011, "first frame timeout (10s)")
                    .await;
                return;
            }
        };

        // 6. 角色分派。
        if let Some((sid, ctx)) = cookie_ctx {
            self.handle_authenticated_client_connection(
                conn_id,
                ws_sink,
                ws_stream,
                ctx,
                Some(sid),
                Some(first),
            )
            .await;
            return;
        }
        match first {
            Frame::Auth(auth) => {
                self.handle_client_connection(conn_id, ws_sink, ws_stream, peer, auth)
                    .await;
            }
            Frame::InstanceHello(hello) => {
                self.handle_instance_connection(conn_id, ws_sink, ws_stream, peer, hello)
                    .await;
            }
            _ => {
                self.finish_connection(
                    conn_id,
                    &mut ws_sink,
                    1011,
                    "first frame must be auth or instance/hello",
                )
                .await;
            }
        }
    }

    /// 连接收尾：关闭 ws + 释放配额 + 广播订阅清理。
    pub(super) async fn finish_connection(
        &self,
        conn_id: ConnId,
        ws_sink: &mut futures::stream::SplitSink<WebSocketStream<TcpStream>, Message>,
        code: u16,
        reason: &str,
    ) {
        if let Some(ctx) = self.conns.ctx(conn_id) {
            audit(
                "conn.close",
                None,
                Some(&ctx.token_id),
                "ok",
                Duration::ZERO,
                None,
            );
        }
        let _ = ws_sink
            .send(Message::Close(Some(CloseFrame {
                code: close_code(code),
                reason: reason.to_string().into(),
            })))
            .await;
        self.resources.projection().disconnect(conn_id).await;
        self.deps.broadcast.unsubscribe_all(conn_id).await;
        self.conns.unregister(conn_id);
        info!(conn_id, code, reason, "connection closed");
    }
}
/// 发送业务帧（serde JSON → 文本消息）。
pub(super) async fn send_frame(
    ws_sink: &mut futures::stream::SplitSink<WebSocketStream<TcpStream>, Message>,
    frame: &Frame,
) -> Result<(), ()> {
    let text = serde_json::to_string(frame).map_err(|_| ())?;
    ws_sink
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| ())
}

/// u16 关闭码 → tungstenite CloseCode（§4.7 应用码 4500–4502 属保留区）。
pub(super) fn close_code(
    code: u16,
) -> tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode {
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode as C;
    match code {
        1000 => C::Normal,
        1011 => C::Error,
        1013 => C::Again,
        n => C::Reserved(n),
    }
}

/// DocId → cid 提取（`chat:{cid}` / `session:{cid}`）。
///
/// `hub:registry` 不是 chat doc，不得提取 cid（否则订阅 registry 会误开
/// 一个名为 "registry" 的假 chat 并污染 Registry Doc）。`control:` 为死前缀
/// （代码实际无 `DocId::control` 构造，#4 前缀面统一为 session:）。
pub(super) fn doc_cid(doc: &peri_studio_proto::conn::DocId) -> Option<&str> {
    let s = doc.as_str();
    if !(s.starts_with("chat:") || s.starts_with("session:")) {
        return None;
    }
    s.split_once(':').map(|(_, cid)| cid)
}

/// Degraded/Restarting 期间拒绝新 committed 承诺（§17.2/§8.4：与投递失败
/// 语义同源，retryable；§9.3 脱敏——不回显 payload）。
pub(super) fn action_error_committed_rejected(action: &ActionEnvelope) -> ActionError {
    let command_id = extract_command_id(action).unwrap_or_default();
    ActionError {
        command_id,
        code: ErrorCode::AgentUnavailable,
        message: "server degraded/restarting; retry later".to_string(),
        retryable: true,
        retry_after_ms: None,
    }
}

/// 未知/畸形帧 → UNSUPPORTED_FRAME error（§4.8 不静默；脱敏：不回显正文）。
pub(super) fn unsupported_error(e: &ProtoError) -> Frame {
    Frame::ActionError(peri_studio_proto::ack::ActionError {
        command_id: String::new(),
        code: ErrorCode::UnsupportedFrame,
        message: match e {
            ProtoError::Unsupported(t) => format!("unsupported frame type: {t}"),
            ProtoError::DirectionRejected(t) => format!("frame rejected: {t}"),
            ProtoError::Malformed(_) => "malformed frame".to_string(),
        },
        retryable: false,
        retry_after_ms: None,
    })
}

/// 消费结果脱敏日志（§9.3：只记 kind/seq/reason）。
pub(super) fn trace_consume(r: &crate::channel::relay_event_handler::ConsumeResult) {
    use crate::channel::relay_event_handler::ConsumeResult as C;
    match r {
        C::Delivered {
            chat_id,
            kind,
            seq,
            applied,
        } => debug!(chat_id, kind, seq, applied, "instance event consumed"),
        C::RpcConfirmed { command_id, .. } => debug!(command_id, "rpc confirmed (L3)"),
        C::OAuthStatus { chat_id, .. } => debug!(chat_id, "OAuth status consumed"),
        C::Dropped { reason } | C::BatchRejected { reason } => {
            debug!(reason, "instance frame dropped")
        }
        C::PersistFailed { chat_id } => warn!(chat_id, "event sink failed (degraded)"),
    }
}

#[cfg(test)]
#[path = "gateway_test.rs"]
mod gateway_test;
