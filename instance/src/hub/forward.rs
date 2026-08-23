//! 转发调度（§4.2：在线实时 / 断线缓冲）：child 帧分类、seq 分配、超限跳过、
//! 敏感瞬时帧在线直送、环形滑窗与断线缓冲写入。

use std::sync::atomic::Ordering;

use peri_studio_proto::instance::BufferedFrame;
use peri_studio_proto::Frame;

use crate::buffer::{PushOutcome, RingBuffer};
use crate::child::ChildOutput;
use crate::transport::TransportHandle;

use super::config::InstanceConfig;
use super::HubState;

/// 在线转发帧的借用版信封（wire 格式必须与 proto `Frame::InstanceEvent`
/// 完全一致：internally tagged `t` + camelCase chatId/epoch/seq/frame；仅用于
/// 免 clone 的序列化，P1-2）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InstanceEventPayload<'a> {
    /// 与 proto `Frame` 的 `#[serde(tag = "t")]` 一致（`instance/event`）。
    pub(super) t: &'static str,
    pub(super) chat_id: &'a str,
    pub(super) epoch: u64,
    pub(super) seq: u64,
    pub(super) frame: &'a serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ChildFrameDeliveryClass {
    Replayable,
    SensitiveEphemeral,
}

/// Fail-closed classification at the child stdout boundary.
///
/// OAuth notification 以 method 识别；response 没有 method，因此还要递归检查
/// 只有 OAuth 流才应出现的敏感字段。误判的安全后果只是该帧不能离线重放，
/// 漏判则会把 URL/state/token 写入 ring 或磁盘，故边界必须 fail-closed。
pub(super) fn child_frame_delivery_class(frame: &serde_json::Value) -> ChildFrameDeliveryClass {
    if frame.get("method").and_then(serde_json::Value::as_str) == Some("peri/oauth")
        || contains_oauth_secret(frame)
    {
        ChildFrameDeliveryClass::SensitiveEphemeral
    } else {
        ChildFrameDeliveryClass::Replayable
    }
}

fn contains_oauth_secret(value: &serde_json::Value) -> bool {
    const SENSITIVE_KEYS: [&str; 6] = [
        "authorizationUrl",
        "authorization_url",
        "accessToken",
        "refreshToken",
        "codeVerifier",
        "clientSecret",
    ];
    let mut pending = vec![value];
    while let Some(current) = pending.pop() {
        match current {
            serde_json::Value::Object(map) => {
                if map.keys().any(|key| SENSITIVE_KEYS.contains(&key.as_str())) {
                    return true;
                }
                pending.extend(map.values());
            }
            serde_json::Value::Array(items) => pending.extend(items),
            _ => {}
        }
    }
    false
}

fn count_sensitive_ephemeral_gap(state: &HubState, sid: &str, seq: u64, reason: &'static str) {
    let count = state
        .sensitive_ephemeral_gaps
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    tracing::warn!(
        target: "peri_studio::instance",
        chat_id = sid,
        seq,
        count,
        reason,
        "sensitive ephemeral frame not delivered (gap only, payload not retained)"
    );
}

pub(super) async fn forward_child_output(
    state: &HubState,
    handle: &TransportHandle,
    config: &InstanceConfig,
    out: ChildOutput,
    authenticated: bool,
) {
    match out {
        ChildOutput::Frame(evt) => {
            let sid = evt.session_id;
            let delivery_class = child_frame_delivery_class(&evt.frame);
            // seq 分配（锁内同步段，不跨 await；超限帧同样消耗 seq 保持流完整，
            // 缺口由 server 侧 gap 呈现——「不假装完整」，§8.5）。
            let (epoch, seq, buffered) = {
                let mut chats = state.chats.lock().expect("chats mutex poisoned");
                let Some(entry) = chats.get_mut(&sid) else {
                    tracing::debug!(target: "peri_studio::instance", chat_id = %sid,
                        "frame for unknown session (dropped)");
                    return;
                };
                if entry.acp.is_none() {
                    tracing::debug!(target: "peri_studio::instance", chat_id = %sid,
                        "frame for exited session (dropped)");
                    return;
                }
                let seq = entry.next_seq;
                entry.next_seq += 1;
                (entry.epoch, seq, entry.buffered)
            };

            let online = authenticated && !buffered;
            // 转发诊断（§9.3 脱敏：只记 method/type 与 seq，不记正文）。
            {
                let kind = evt
                    .frame
                    .get("method")
                    .and_then(|m| m.as_str())
                    .or_else(|| evt.frame.get("type").and_then(|t| t.as_str()))
                    .unwrap_or("?");
                tracing::debug!(target: "peri_studio::instance", chat_id = %sid, seq,
                    kind, buffered, "child frame forwarding");
            }
            // 单帧超限检查（在线/断线统一，§8.5：超限跳过 + gap，不做截断）。
            // 在线路径：借用序列化（零 clone），产物同时用于大小检查与发送
            // （P1-2，消除第 2 次序列化）。
            // 口径说明（问题 13）：在线与断线分别按**实际发送形态**检查——
            // `InstanceEventPayload` 比 `BufferedFrame` 多 ~60B 信封字段，
            // 判定随 wire 形态而非统一取小，避免发送超限帧；断线路径与
            // buffer::push 内部为同一 `BufferedFrame` 序列化产物，长度一致，
            // 不存在「hub 放行、buffer 判超」窗口。
            let payload = if online {
                serde_json::to_vec(&InstanceEventPayload {
                    t: "instance/event",
                    chat_id: &sid,
                    epoch,
                    seq,
                    frame: &evt.frame,
                })
            } else {
                // 离线路径不动（P1-2 范围外）：保持 BufferedFrame 独立序列化。
                serde_json::to_vec(&BufferedFrame {
                    seq,
                    frame: evt.frame.clone(),
                })
            };
            let payload = payload.expect("Value 恒可序列化（不可达）");
            if payload.len() > config.max_frame_bytes {
                if delivery_class == ChildFrameDeliveryClass::SensitiveEphemeral {
                    count_sensitive_ephemeral_gap(state, &sid, seq, "oversize");
                } else {
                    state.oversize_gaps.fetch_add(1, Ordering::Relaxed);
                }
                tracing::warn!(target: "peri_studio::instance", chat_id = %sid, seq,
                    bytes = payload.len(), max = config.max_frame_bytes,
                    "frame exceeds single-frame limit, skipped (gap count)");
                return;
            }

            if delivery_class == ChildFrameDeliveryClass::SensitiveEphemeral {
                if !online {
                    count_sensitive_ephemeral_gap(state, &sid, seq, "offline_or_backlog");
                    return;
                }
                // 敏感帧零 clone、零多余序列化（P1-2）：复用大小检查产物。
                match handle.send_acked_bytes(payload).await {
                    Ok(()) => {
                        let mut chats = state.chats.lock().expect("chats mutex poisoned");
                        if let Some(entry) = chats.get_mut(&sid) {
                            entry.last_sent_seq = seq;
                        }
                    }
                    Err(_) => {
                        // `SendError::Stopped` 在 instance 内无构造点（预留未接线，
                        // review L1），统一按发送失败计数。
                        count_sensitive_ephemeral_gap(state, &sid, seq, "send_failed");
                    }
                }
                return;
            }

            if online {
                // 字节发送（P1-2）：复用大小检查产物，免二次序列化 + 免 clone。
                match handle.send_acked_bytes(payload).await {
                    Ok(()) => {
                        // 写成功：推进 last_sent_seq + 写环形滑窗（§4.2）。
                        let mut chats = state.chats.lock().expect("chats mutex poisoned");
                        if let Some(entry) = chats.get_mut(&sid) {
                            entry.last_sent_seq = seq;
                        }
                        ring_push(state, &sid, seq, evt.frame, config.ring_capacity);
                    }
                    Err(_) => {
                        // 断线瞬间：帧未发出 → 入缓冲（seq 保持，补推不丢）。
                        // （`SendError::Stopped` 无构造点，预留未接线，review L1——
                        // 原「daemon 关闭中：丢弃」分支不可达，合并入本分支。）
                        buffer_push(state, &sid, seq, evt.frame.clone());
                        ring_push(state, &sid, seq, evt.frame, config.ring_capacity);
                    }
                }
            } else {
                // 断线缓冲（§8.3）。
                buffer_push(state, &sid, seq, evt.frame.clone());
                ring_push(state, &sid, seq, evt.frame, config.ring_capacity);
            }
        }
        ChildOutput::Exit {
            session_id,
            code,
            signal,
        } => {
            let sid = session_id;
            // 水位更新（epoch 保留供重建 +1；last_seq 诊断；pgid 置 0，§4.4.3）。
            {
                let mut chats = state.chats.lock().expect("chats mutex poisoned");
                if let Some(entry) = chats.get_mut(&sid) {
                    entry.acp = None;
                    let epoch = entry.epoch;
                    let last_seq = entry.last_sent_seq;
                    let mut wm = state.watermark.lock().expect("watermark mutex poisoned");
                    if let Err(e) = wm.record(&sid, epoch, last_seq, 0, None) {
                        tracing::error!(target: "peri_studio::instance", chat_id = %sid,
                            error = %e, "watermark write failed");
                    }
                }
            }
            // §8.5：session 结束同步删除缓冲文件与内存段；滑窗清理。
            state
                .buffer
                .lock()
                .expect("buffer mutex poisoned")
                .remove(&sid);
            state
                .rings
                .lock()
                .expect("rings mutex poisoned")
                .remove(&sid);
            if code != 0 {
                tracing::warn!(target: "peri_studio::instance", chat_id = %sid, code,
                    signal, "ACP process exited abnormally (stderr content discarded)");
            } else {
                tracing::info!(target: "peri_studio::instance", chat_id = %sid, code,
                    "ACP process exited (session entry retained for epoch+1 rebuild)");
            }

            if authenticated {
                let frame =
                    Frame::InstanceProcessExit(peri_studio_proto::instance::InstanceProcessExit {
                        chat_id: sid.clone(),
                        code,
                    });
                let _ = handle.send(frame).await;
            } else {
                // 断线期间不缓冲 process_exit【决策】：终态由重连后 hello 的
                // alive_sessions 对账呈现（§7.5 对账语义），缓冲补推只承载 ACP 帧。
                tracing::debug!(target: "peri_studio::instance", chat_id = %sid, code,
                    "process exited while disconnected (surfaced via reconciliation after reconnect)");
            }
        }
        ChildOutput::DroppedNoSessionId => {
            let count = state.dropped_no_sid.fetch_add(1, Ordering::Relaxed) + 1;
            tracing::warn!(target: "peri_studio::instance", count,
                "frame without sessionId dropped (local gap count)");
        }
        ChildOutput::OversizeLine => {
            let count = state.oversize_lines.fetch_add(1, Ordering::Relaxed) + 1;
            tracing::warn!(target: "peri_studio::instance", count,
                "oversized stdout line dropped (local gap count)");
        }
    }
}

fn ring_push(state: &HubState, sid: &str, seq: u64, frame: serde_json::Value, cap: usize) {
    let mut rings = state.rings.lock().expect("rings mutex poisoned");
    let ring = rings
        .entry(sid.to_string())
        .or_insert_with(|| RingBuffer::new(cap));
    ring.push(BufferedFrame { seq, frame });
}

fn buffer_push(state: &HubState, sid: &str, seq: u64, frame: serde_json::Value) {
    let mut buffer = state.buffer.lock().expect("buffer mutex poisoned");
    match buffer.push(sid, seq, frame) {
        PushOutcome::Buffered => {}
        // 单帧超限：计数归属本层（问题 13，单一入口 oversize_gaps）。
        PushOutcome::Oversize => {
            state.oversize_gaps.fetch_add(1, Ordering::Relaxed);
        }
        // 磁盘失败熔断（问题 5）：计数在 buffer 内（dropped_stats），
        // 本层不再重复计数。
        PushOutcome::DiskFailed => {}
    }
    let (bytes, frames) = buffer.water_level();
    if bytes > 0 {
        tracing::debug!(target: "peri_studio::instance", chat_id = sid, seq,
            buffer_bytes = bytes, buffer_frames = frames, "frame buffered");
    }
}
