//! 帧读写循环（writer + reader 双任务，§3.1/§4.3）与入站校验/写原语。
//!
//! - **writer**：消费发送队列（有界 `mpsc`，§8.6 硬阈值）；断线时先 close
//!   队列（挡住新发送）再 drain——所有未写入的 `Acked` 帧以
//!   `SendError::Disconnected` 回执（hub 转缓冲路径）；
//! - **reader**：解析入站帧 → `whitelist::m1_check`（防异常帧）→ 事件上报；
//!   关闭码 4502 → `Stopped(ConfigFatal)`（§4.7）；
//! - **写原语**：单帧写超时（`TransportConfig.write_timeout`）——超时 == 写
//!   失败，复用断线路径；`AckedBytes` 原样写入（P1-2，免二次序列化）。

use std::time::Duration;

use anyhow::Context;
use futures::{SinkExt, StreamExt};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use peri_studio_proto::conn::CLOSE_CONFIG_FATAL;
use peri_studio_proto::frame::{Frame, ProtoError};
use peri_studio_proto::whitelist::{m1_check, Direction, M1Check, Role};

use super::{Outbound, SendError, StoppedReason, TransportEvent, TransportHandle};

/// 帧读写循环的退出原因（内部）。
pub(super) enum LoopExit {
    Disconnected,
    Stopped(StoppedReason),
}

/// 入站帧问题计数（未知 tag / 畸形 / 方向拒绝，不 panic，§4.3）。
pub(super) fn count_inbound_problem(err: &ProtoError) {
    match err {
        ProtoError::Unsupported(tag) => {
            tracing::warn!(target: "peri_studio::instance", tag, "inbound unknown/non-M1 frame (counted, dropped)");
        }
        ProtoError::Malformed(e) => {
            tracing::warn!(target: "peri_studio::instance", error = %e, "inbound malformed frame (counted, dropped)");
        }
        ProtoError::DirectionRejected(tag) => {
            tracing::warn!(target: "peri_studio::instance", tag, "inbound frame direction violation (counted, dropped)");
        }
    }
}

/// 帧读写循环：writer（消费发送队列）+ reader（解析入站帧）双任务。
///
/// writer 断线时：先 close 队列（挡住新发送）再 drain 清空——所有未写入的
/// `Acked` 帧以 `SendError::Disconnected` 回执（hub 转缓冲路径）。writer 的
/// 清理在 frame_loop 返回后由「channel close」驱动完成（挂起的 `send_acked`
/// 会被回执唤醒，不会悬挂）。
pub(super) async fn frame_loop(
    ws: WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    events: &mpsc::Sender<TransportEvent>,
    handle: &TransportHandle,
    cancel: &mut watch::Receiver<bool>,
    write_timeout: Duration,
) -> LoopExit {
    let (mut write_half, mut read_half) = ws.split();
    let mut out_rx = {
        let mut guard = handle.tx.lock().await;
        let (tx, rx) = mpsc::channel(handle.queue_cap);
        *guard = Some(tx);
        rx
    };

    let (fail_tx, mut fail_rx) = mpsc::channel::<LoopExit>(1);
    let w_cancel = cancel.clone();

    // writer task（channel close 或 cancel 时退出并清理队列）。
    let writer = tokio::spawn(async move {
        let mut local_cancel = w_cancel;
        loop {
            tokio::select! {
                out = out_rx.recv() => {
                    match out {
                        Some(Outbound::Frame(f)) => {
                            if write_frame(&mut write_half, &f, write_timeout).await.is_err() {
                                break;
                            }
                        }
                        Some(Outbound::Acked(f, ack)) => {
                            match write_frame(&mut write_half, &f, write_timeout).await {
                                Ok(()) => { let _ = ack.send(Ok(())); }
                                Err(_) => {
                                    let _ = ack.send(Err(SendError::Disconnected));
                                    break;
                                }
                            }
                        }
                        Some(Outbound::AckedBytes(bytes, ack)) => {
                            // 字节原样写入：不得再序列化/再解析（P1-2）；
                            // owned Vec 直接 move（review M3：免 to_vec 拷贝）。
                            match write_bytes(&mut write_half, bytes, write_timeout).await {
                                Ok(()) => { let _ = ack.send(Ok(())); }
                                Err(_) => {
                                    let _ = ack.send(Err(SendError::Disconnected));
                                    break;
                                }
                            }
                        }
                        None => break,
                    }
                }
                _ = local_cancel.changed() => break,
            }
        }
        // 断线清理：close 队列（新发送立即 Err）→ drain 未写入帧（ack 回执 Err）。
        // 正确性关键：AckedBytes 必须同步回执，否则 oneshot 悬挂 → send_acked_bytes
        // await 永不返回 → hub 主循环挂起（P1-2 §4.2 风险）。
        out_rx.close();
        while let Ok(out) = out_rx.try_recv() {
            if let Outbound::Acked(_, ack) | Outbound::AckedBytes(_, ack) = out {
                let _ = ack.send(Err(SendError::Disconnected));
            }
        }
        let _ = fail_tx.send(LoopExit::Disconnected).await;
    });

    // reader：主任务（同时监听 writer 失败与取消）。
    let exit = loop {
        tokio::select! {
            msg = read_half.next() => {
                match msg {
                    Some(Ok(Message::Text(t))) => {
                        match Frame::parse(&t) {
                            Ok(frame) => {
                                if m1_check(frame.tag(), Role::Instance, Direction::Outbound) == M1Check::Allowed {
                                    if events.send(TransportEvent::Frame(Box::new(frame))).await.is_err() {
                                        break LoopExit::Stopped(StoppedReason::Shutdown);
                                    }
                                } else {
                                    count_inbound_problem(&ProtoError::DirectionRejected(frame.tag().0.to_string()));
                                }
                            }
                            Err(e) => count_inbound_problem(&e),
                        }
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let code = frame.as_ref().map(|f| u16::from(f.code));
                        break match code {
                            Some(c) if c == CLOSE_CONFIG_FATAL => {
                                LoopExit::Stopped(StoppedReason::ConfigFatal)
                            }
                            _ => LoopExit::Disconnected,
                        };
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => break LoopExit::Disconnected,
                }
            }
            exit = fail_rx.recv() => {
                break exit.unwrap_or(LoopExit::Disconnected);
            }
            _ = cancel.changed() => {
                break LoopExit::Stopped(StoppedReason::Shutdown);
            }
        }
    };

    // 关闭发送队列：writer 退出并回执所有未写入的 Acked（不等待，回执异步完成）。
    {
        let mut guard = handle.tx.lock().await;
        *guard = None;
    }
    drop(writer); // 分离 writer task（清理在后台完成）
    exit
}

/// 写入已序列化字节（文本消息）。写超时/失败 → `Err`（调用方断开重连；
/// 超时后 sink 状态不可复用，不得继续写）。`timeout` 为单帧写超时
/// （P1-3：由 `TransportConfig.write_timeout` 注入，默认 10s）。
///
/// 消费式转换（review M1/M3）：收 owned `Vec<u8>`，`String::from_utf8`
/// 零拷贝转换（省 `to_vec` 全量拷贝 + 分配）；非法 UTF-8 走 `Err` 断线
/// 路径，不 panic——panic 会杀死 writer task 且 ack oneshot 无人回执，
/// 连接静默挂死（`send_acked_bytes` 契约）。
async fn write_bytes<S>(sink: &mut S, bytes: Vec<u8>, timeout: Duration) -> anyhow::Result<()>
where
    S: futures::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    // 字节为 JSON 序列化产物，必然合法 UTF-8（serde_json 紧凑输出）；显式
    // Text 帧（tungstenite 0.30 `Message::from(Vec<u8>)` 生成 Binary 帧，不适用）。
    let text = String::from_utf8(bytes)
        .map_err(|_| anyhow::anyhow!("bytes are not valid UTF-8 (JSON text frame)"))?;
    tokio::time::timeout(timeout, sink.send(Message::Text(text.into())))
        .await
        .map_err(|_| anyhow::anyhow!("ws write timed out ({timeout:?})"))?
        .context("ws write failed")
}

/// 序列化并写入一帧（文本消息）。写超时/失败 → `Err`（调用方断开重连；
/// 超时后 sink 状态不可复用，不得继续写）。
async fn write_frame<S>(sink: &mut S, frame: &Frame, timeout: Duration) -> anyhow::Result<()>
where
    S: futures::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    // String → Vec 零成本（into_bytes），write_bytes 内消费式转回 String，
    // 全链路无拷贝（review M3/cross#1：心跳/ack/process_exit/buffer_sync 批次）。
    let text = serde_json::to_string(frame).context("frame serialization failed")?;
    write_bytes(sink, text.into_bytes(), timeout).await
}
