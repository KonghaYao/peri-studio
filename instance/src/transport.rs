//! ws 传输层（F6）：outbound 连 server、单连接多路复用、指数退避重连、
//! 双向认证握手编排、帧读写（§3.1/§4.3/§7.1/§9.2）。
//!
//! - **连接**：`tokio_tungstenite::connect_async`（URL 路径 `/instance`）；发送/
//!   接收拆双任务，共用有界 `mpsc` 发送队列——单连接多路复用由 `Frame` 枚举
//!   天然承载（§3.1）；
//! - **指数退避重连**（§7.1）：base 起 ×2 → max 上限（默认 1s→60s）；连接成功
//!   且认证通过后重置为 base；不引入随机抖动【决策】（单机场景无惊群问题）；
//! - **心跳**：定时器在 hub（§4.2），transport 只负责帧收发；
//! - **关闭码策略**（§4.7）：收到 4502（配置性永久失败）→ `Stopped(ConfigFatal)`；
//!   认证失败（HMAC 校验失败，§9.2）→ `Stopped(AuthFailed)`；其余关闭码/网络
//!   错误 → `Disconnected` → 退避重连（4500/4501 是 server→client 关闭码，
//!   instance 侧不适用【决策】）；
//! - **入站校验**：每帧 `Frame::parse`（未知 tag → 计数，不 panic）+
//!   `whitelist::m1_check(tag, Role::Instance, Direction::Outbound)`（防异常帧）；
//! - **发送确认**：`send_acked` 等待 writer 实际写入成功（hub 据此推进
//!   `last_sent_seq`）；断线时队列中未写入帧的确认全部以 `SendError` 返回
//!   （帧未发出，hub 转缓冲路径，不丢帧）。
//!
//! 模块拆分（问题 8）：连接循环/握手在 [`conn`]，帧读写循环/写原语在
//! [`frame_loop`]；本文件保留公共类型（事件/错误/配置/句柄）。

mod conn;
mod frame_loop;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, oneshot, watch};

use peri_studio_proto::frame::Frame;

pub use conn::run;

// ---------------------------------------------------------------------------
// 事件与错误
// ---------------------------------------------------------------------------

/// 停止自动重连的原因（§3 步骤 7 / §4.7 关闭码策略）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoppedReason {
    /// 认证失败（HMAC 校验失败 / 握手超时，§9.2 步骤 3）：不自动重连（防冒充
    /// server 反复投毒）。
    AuthFailed,
    /// server 以 4502 关闭（配置性永久失败，§4.7）：不自动重连。
    ConfigFatal,
    /// 调用方请求优雅关闭。
    Shutdown,
}

/// transport → hub 的事件流。
#[derive(Debug)]
pub enum TransportEvent {
    /// ws 建立（认证前）。
    Connected,
    /// 认证通过（hub 才进入 READY/补推）。
    Authenticated,
    /// 断线（hub 切缓冲模式）。
    Disconnected,
    /// 停止自动重连（hub 应记录错误与审计日志后结束）。
    Stopped(StoppedReason),
    /// 入站帧（解析 + M1 校验通过后）。
    Frame(Box<Frame>),
    /// 握手超时（诊断信号；随后以 `Stopped(AuthFailed)` 结束）。
    AuthTimeout,
}

/// 发送错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SendError {
    /// transport 已停止（停止重连或优雅关闭）。
    #[error("transport stopped")]
    Stopped,
    /// 发送队列已满（背压，§8.6 硬阈值）。由 [`TransportHandle::dispatch`]
    /// 处置为关闭通道 + [`SendError::Disconnected`]（走断线重连补推），
    /// 不直接暴露给 hub。
    #[error("outbound queue full")]
    QueueFull,
    /// 连接已断开（帧未写入）。
    #[error("connection dropped")]
    Disconnected,
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/// transport 配置（hub 从 `InstanceConfig` 派生，§10）。
#[derive(Debug, Clone)]
pub struct TransportConfig {
    /// server ws 地址（`ws://host:port/instance`）。
    pub url: String,
    /// 握手超时（auth_response 等待，默认 10s【决策】）。
    pub auth_timeout: Duration,
    /// 重连退避起点（§7.1，默认 1s）。
    pub reconnect_base: Duration,
    /// 重连退避上限（§7.1，默认 60s）。
    pub reconnect_max: Duration,
    /// 单帧写超时（TCP 背压 → 主动断线走缓冲语义，默认 10s【决策：P1-3】；
    /// 超时 == 写失败，复用既有断线路径）。
    pub write_timeout: Duration,
}

/// 指数退避：×2 递增至 `max` 封顶（§7.1 序列 1s→2s→4s→…→60s，无抖动【决策】）。
pub fn next_backoff(current: Duration, max: Duration) -> Duration {
    let doubled = current.saturating_mul(2);
    if doubled >= max {
        max
    } else if doubled > current {
        doubled
    } else {
        max // 溢出防御（current 为 0 或 saturating 退化）
    }
}

// ---------------------------------------------------------------------------
// 发送队列 / 句柄
// ---------------------------------------------------------------------------

/// 入队一帧（非阻塞，`try_send` 语义）：
/// channel 满 → [`SendError::QueueFull`]（由 [`TransportHandle::dispatch`]
/// 处置：drop sender 关闭通道 → writer 退出 → 断线重连 → 已入缓冲帧经
/// buffer_sync 补推）；通道已关 → Disconnected。不用 `send().await`——否则
/// writer 被 TCP 背压阻塞时 hub 主循环会无限挂起（心跳停发）。
fn try_dispatch(tx: &mpsc::Sender<Outbound>, out: Outbound) -> Result<(), SendError> {
    match tx.try_send(out) {
        Ok(()) => Ok(()),
        Err(mpsc::error::TrySendError::Full(_)) => Err(SendError::QueueFull),
        Err(mpsc::error::TrySendError::Closed(_)) => Err(SendError::Disconnected),
    }
}

/// 发送队列条目：普通帧（fire-and-forget）或需写入确认的帧。
enum Outbound {
    Frame(Frame),
    Acked(Frame, oneshot::Sender<Result<(), SendError>>),
    /// 已序列化字节 + 写入确认（P1-2：hub 在线转发复用大小检查产物，免二次序列化）。
    AckedBytes(Vec<u8>, oneshot::Sender<Result<(), SendError>>),
}

/// 向 transport 发送帧的句柄（hub 持有；克隆共享同一队列）。
#[derive(Clone)]
pub struct TransportHandle {
    tx: Arc<tokio::sync::Mutex<Option<mpsc::Sender<Outbound>>>>,
    connected: Arc<AtomicBool>,
    authenticated: Arc<AtomicBool>,
    cancel: watch::Sender<bool>,
    /// 发送队列上限（帧循环创建 channel 时使用）。
    queue_cap: usize,
}

impl TransportHandle {
    /// 创建句柄（`frame_queue` 为有界发送队列上限）。
    pub fn new(frame_queue: usize) -> (Self, watch::Receiver<bool>) {
        let (cancel, _rx) = watch::channel(false);
        (
            TransportHandle {
                tx: Arc::new(tokio::sync::Mutex::new(None)),
                connected: Arc::new(AtomicBool::new(false)),
                authenticated: Arc::new(AtomicBool::new(false)),
                cancel,
                queue_cap: frame_queue,
            },
            _rx,
        )
    }

    /// 发送帧（不等待写入确认；hello/heartbeat/ack 用）。
    pub async fn send(&self, frame: Frame) -> Result<(), SendError> {
        self.dispatch(Outbound::Frame(frame)).await
    }

    /// 发送帧并等待 writer 实际写入成功（instance/event 与 buffer_sync 批次用；
    /// hub 据此推进 `last_sent_seq`）。断线时返回 `SendError`（帧未发出）。
    pub async fn send_acked(&self, frame: Frame) -> Result<(), SendError> {
        let (ack_tx, ack_rx) = oneshot::channel();
        self.dispatch(Outbound::Acked(frame, ack_tx)).await?;
        ack_rx.await.map_err(|_| SendError::Disconnected)?
    }

    /// 发送已序列化字节并等待 writer 实际写入成功（语义与 `send_acked` 完全
    /// 一致；P1-2：instance/event 在线转发用，复用大小检查的序列化产物，免
    /// 二次序列化）。payload 须为合法 UTF-8 JSON 文本（wire 与 send_acked 逐位
    /// 相同），writer 原样写入、不再序列化。
    pub async fn send_acked_bytes(&self, bytes: Vec<u8>) -> Result<(), SendError> {
        let (ack_tx, ack_rx) = oneshot::channel();
        self.dispatch(Outbound::AckedBytes(bytes, ack_tx)).await?;
        ack_rx.await.map_err(|_| SendError::Disconnected)?
    }

    async fn dispatch(&self, out: Outbound) -> Result<(), SendError> {
        let mut guard = self.tx.lock().await;
        let Some(tx) = guard.as_ref() else {
            return Err(SendError::Disconnected);
        };
        match try_dispatch(tx, out) {
            Ok(()) => Ok(()),
            // §8.6 硬背压：drop 唯一 sender → 通道关闭 → writer 退出 → 断线
            // 重连 → 已入缓冲帧经 buffer_sync 补推。不用 `send().await`：
            // 否则 writer 被 TCP 背压阻塞时 hub 主循环会无限挂起（心跳停发）。
            Err(SendError::QueueFull) => {
                tracing::warn!(target: "peri_studio::instance",
                    "outbound queue full (hard backpressure §8.6), closing connection for reconnect+resync");
                *guard = None;
                Err(SendError::Disconnected)
            }
            Err(e) => Err(e),
        }
    }

    /// ws 是否已建立（hub 据此决定实时/缓冲）。
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    /// 认证是否通过。
    pub fn is_authenticated(&self) -> bool {
        self.authenticated.load(Ordering::Relaxed)
    }

    /// 请求优雅停止（transport 循环退出）。
    pub fn shutdown(&self) {
        let _ = self.cancel.send(true);
    }
}

#[cfg(test)]
#[path = "transport_test.rs"]
mod transport_test;

#[cfg(test)]
#[path = "transport_test_common.rs"]
mod transport_test_common;

#[cfg(test)]
#[path = "transport_handle_test.rs"]
mod transport_handle_test;
