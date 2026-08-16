//! 连接循环（§3.1/§4.3/§7.1/§9.2）：outbound 连 server → 指数退避重连 →
//! 双向认证握手编排 → 移交帧读写循环（[`super::frame_loop`]）。
//!
//! 职责要点：
//! - **指数退避重连**（§7.1）：base 起 ×2 → max 上限；连接成功且认证通过后
//!   重置为 base；不引入随机抖动【决策】（单机场景无惊群问题）；
//! - **握手**（§9.2）：每次连接新 nonce 的 `instance/hello` → `auth_response`
//!   校验（HMAC）；超时 → `Stopped(AuthFailed)` 不自动重连（防冒充 server
//!   反复投毒）；握手阶段收到非 auth_response 帧/关闭 → 断开重连；
//! - **关闭码策略**（§4.7）：握手阶段收到 4502 → `Stopped(ConfigFatal)`。

use std::sync::atomic::Ordering;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use peri_studio_proto::conn::CLOSE_CONFIG_FATAL;
use peri_studio_proto::frame::Frame;
use peri_studio_proto::instance::InstanceHello;

use crate::auth::{AuthError, AuthSession};

use super::frame_loop::{count_inbound_problem, frame_loop, LoopExit};
use super::{next_backoff, StoppedReason, TransportConfig, TransportEvent, TransportHandle};

/// transport 主循环：连接 → 握手 → 帧读写 → 断线退避重连，直至停止。
///
/// `make_hello` 每次连接调用：返回 (认证会话, hello)——**每次连接新 nonce**
/// （§9.2 重连重新握手）；认证会话的 nonce 与 hello 绑定，用于校验随后的
/// `auth_response`。
pub async fn run<F>(
    config: TransportConfig,
    make_hello: F,
    events: mpsc::Sender<TransportEvent>,
    handle: TransportHandle,
    mut cancel: watch::Receiver<bool>,
) -> anyhow::Result<()>
where
    F: Fn() -> (AuthSession, InstanceHello) + Send + Sync + 'static,
{
    let mut backoff = config.reconnect_base;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        // 连接（失败 → 退避重试，不发事件：从未建立连接）。
        let ws = match tokio_tungstenite::connect_async(&config.url).await {
            Ok((ws, _)) => ws,
            Err(e) => {
                tracing::warn!(target: "peri_studio::instance", error = %e,
                    backoff_ms = backoff.as_millis(), "failed to connect to server, backing off and retrying");
                if sleep_cancellable(&mut cancel, backoff).await.is_err() {
                    return Ok(());
                }
                backoff = next_backoff(backoff, config.reconnect_max);
                continue;
            }
        };

        handle.connected.store(true, Ordering::Relaxed);
        let _ = events.send(TransportEvent::Connected).await;

        // 握手（§9.2）：hello（新 nonce）→ auth_response 校验（超时 → 停止）。
        let ws = match handshake(ws, &config, &make_hello, &events, &handle, &mut cancel).await {
            HandshakeOutcome::Authenticated(ws) => {
                tracing::info!(target: "peri_studio::instance", "authentication passed");
                backoff = config.reconnect_base;
                Some(*ws)
            }
            HandshakeOutcome::Stopped(reason) => {
                handle.connected.store(false, Ordering::Relaxed);
                let _ = events.send(TransportEvent::Stopped(reason)).await;
                return Ok(());
            }
            HandshakeOutcome::Retry => {
                handle.connected.store(false, Ordering::Relaxed);
                let _ = events.send(TransportEvent::Disconnected).await;
                if sleep_cancellable(&mut cancel, backoff).await.is_err() {
                    return Ok(());
                }
                backoff = next_backoff(backoff, config.reconnect_max);
                continue;
            }
        };
        let Some(ws) = ws else {
            unreachable!("Authenticated 分支必有 ws")
        };

        // 帧读写循环（writer + reader 双任务）。
        let exit = frame_loop(ws, &events, &handle, &mut cancel, config.write_timeout).await;

        handle.connected.store(false, Ordering::Relaxed);
        handle.authenticated.store(false, Ordering::Relaxed);
        {
            let mut guard = handle.tx.lock().await;
            *guard = None;
        }
        let _ = events.send(TransportEvent::Disconnected).await;

        match exit {
            LoopExit::Stopped(reason) => {
                let _ = events.send(TransportEvent::Stopped(reason)).await;
                return Ok(());
            }
            LoopExit::Disconnected => {}
        }

        if sleep_cancellable(&mut cancel, backoff).await.is_err() {
            return Ok(());
        }
        backoff = next_backoff(backoff, config.reconnect_max);
    }
}

/// 可取消的退避等待。
async fn sleep_cancellable(cancel: &mut watch::Receiver<bool>, d: Duration) -> Result<(), ()> {
    if *cancel.borrow() {
        return Err(());
    }
    tokio::select! {
        _ = tokio::time::sleep(d) => Ok(()),
        _ = cancel.changed() => Err(()),
    }
}

enum HandshakeOutcome {
    /// 认证通过，进入帧循环。
    Authenticated(Box<WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>>),
    /// 停止（AuthFailed / ConfigFatal）。
    Stopped(StoppedReason),
    /// 断开重连（连接建立但握手未完成：畸形帧/关闭）。
    Retry,
}

async fn handshake<F>(
    mut ws: WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    config: &TransportConfig,
    make_hello: &F,
    events: &mpsc::Sender<TransportEvent>,
    handle: &TransportHandle,
    cancel: &mut watch::Receiver<bool>,
) -> HandshakeOutcome
where
    F: Fn() -> (AuthSession, InstanceHello) + Send + Sync,
{
    let (session, hello) = make_hello();
    let hello_frame = Frame::InstanceHello(hello);
    let text = match serde_json::to_string(&hello_frame) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(target: "peri_studio::instance", "hello serialization failed: {e}");
            return HandshakeOutcome::Retry;
        }
    };
    // 发送挂起（server 不读 TCP）或写失败：视为握手失败，断开重连。
    let sent = match tokio::time::timeout(config.auth_timeout, ws.send(Message::Text(text.into())))
        .await
    {
        Ok(Ok(())) => true,
        Ok(Err(_)) | Err(_) => false,
    };
    if !sent {
        tracing::warn!(target: "peri_studio::instance", "hello send failed/timed out, reconnecting");
        return HandshakeOutcome::Retry;
    }

    // 等待 auth_response（超时 → 审计 + 停止，不重连，§9.2 步骤 3）。
    let timeout = config.auth_timeout;
    let wait = tokio::time::timeout(timeout, wait_auth_response(&mut ws, cancel)).await;
    match wait {
        Err(_elapsed) => {
            tracing::error!(target: "peri_studio::instance", "handshake timed out ({timeout:?}), disconnecting without reconnect");
            let _ = events.send(TransportEvent::AuthTimeout).await;
            close_with_timeout(&mut ws, "auth_timeout").await;
            HandshakeOutcome::Stopped(StoppedReason::AuthFailed)
        }
        Ok(AuthWait::Response(resp)) => match session.verify_auth_response(&resp) {
            Ok(()) => {
                handle.authenticated.store(true, Ordering::Relaxed);
                let _ = events.send(TransportEvent::Authenticated).await;
                HandshakeOutcome::Authenticated(Box::new(ws))
            }
            Err(e) => {
                audit_auth_failure(&e);
                close_with_timeout(&mut ws, "auth_failed").await;
                HandshakeOutcome::Stopped(StoppedReason::AuthFailed)
            }
        },
        Ok(AuthWait::ProtocolViolation) => {
            tracing::warn!(target: "peri_studio::instance",
                "non-auth_response frame/close received during handshake, reconnecting");
            HandshakeOutcome::Retry
        }
        Ok(AuthWait::CloseConfigFatal) => {
            tracing::error!(target: "peri_studio::instance",
                "server closed with 4502 during handshake (config fatal), stopping reconnect");
            HandshakeOutcome::Stopped(StoppedReason::ConfigFatal)
        }
        Ok(AuthWait::Cancelled) => HandshakeOutcome::Stopped(StoppedReason::Shutdown),
    }
}

/// 主动关闭（4502 语义）：tungstenite `close` 等待对端 Close 应答，加超时保护
/// 防止对端不响应时握手失败路径挂起。
async fn close_with_timeout(
    ws: &mut WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    reason: &str,
) {
    let _ = tokio::time::timeout(
        Duration::from_secs(1),
        ws.close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame {
            code: CLOSE_CONFIG_FATAL.into(),
            reason: reason.into(),
        })),
    )
    .await;
}

/// 握手等待结果。
enum AuthWait {
    /// 收到合法 auth_response。
    Response(peri_studio_proto::conn::AuthResponse),
    /// 收到非 auth_response 帧 / 畸形帧 / 关闭（重连）。
    ProtocolViolation,
    /// server 以 4502 关闭（配置性永久失败，§4.7）——握手阶段同样识别。
    CloseConfigFatal,
    /// 优雅关闭信号。
    Cancelled,
}

/// 审计日志（token_id 级别，不含 token 本体，§9.2 步骤 3 / §9.3）。
fn audit_auth_failure(err: &AuthError) {
    tracing::error!(target: "peri_studio::instance", auth_failed_total = 1, reason = %err,
        "authentication failed (HMAC verification), disconnecting without reconnect (audit counter)");
}

/// 读取并解析 auth_response（任何其他帧/关闭 → 协议违反）。
async fn wait_auth_response(
    ws: &mut WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    cancel: &mut watch::Receiver<bool>,
) -> AuthWait {
    loop {
        tokio::select! {
            biased;
            _ = cancel.changed() => return AuthWait::Cancelled,
            msg = ws.next() => {
                match msg {
                    Some(Ok(Message::Text(t))) => match Frame::parse(&t) {
                        Ok(Frame::AuthResponse(r)) => return AuthWait::Response(r),
                        Ok(_) => return AuthWait::ProtocolViolation,
                        Err(e) => {
                            count_inbound_problem(&e);
                            return AuthWait::ProtocolViolation;
                        }
                    },
                    Some(Ok(Message::Close(frame))) => {
                        let code = frame.as_ref().map(|f| u16::from(f.code));
                        return if code == Some(CLOSE_CONFIG_FATAL) {
                            AuthWait::CloseConfigFatal
                        } else {
                            AuthWait::ProtocolViolation
                        };
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => return AuthWait::ProtocolViolation,
                }
            }
        }
    }
}
