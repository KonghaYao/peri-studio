//! 补推协调（§6.1/§6.2：先排空 buffer_sync 再恢复实时转发）。

use std::time::Duration;

use peri_studio_proto::instance::InstanceBufferSync;
use peri_studio_proto::Frame;

use crate::transport::TransportHandle;

use super::config::InstanceConfig;
use super::HubState;

/// buffer_sync 单批参数（§6.2【决策】：512KB / 256 帧，先达者）。
const SYNC_BATCH_MAX_FRAMES: usize = 256;
const SYNC_BATCH_MAX_BYTES: usize = 512 * 1024;

/// 补推循环：对每个 `buffered` session 从 pending 首帧起分批发
/// `instance/buffer_sync`（`from_seq = last_sent_seq + 1`）；发送成功 → commit
/// 并推进 `last_sent_seq`；发送中断 → rollback（重连后 from_seq 不变重发）。
/// 全部 pending 清空（或发送失败）→ 退出。
pub(super) async fn resync_loop(
    state: &HubState,
    handle: &TransportHandle,
    _config: &InstanceConfig,
) {
    loop {
        // 取一批（锁内同步段：清空标志 / 选 session / drain）。
        let job = {
            let mut chats = state.chats.lock().expect("chats mutex poisoned");
            let mut buffer = state.buffer.lock().expect("buffer mutex poisoned");
            let mut job = None;
            for (sid, entry) in chats.iter_mut() {
                if !entry.buffered {
                    continue;
                }
                if !buffer.has_pending(sid) {
                    entry.buffered = false; // 补推完成 → 该 session 转实时
                    continue;
                }
                if let Some((from_seq, frames)) =
                    buffer.drain_batch(sid, SYNC_BATCH_MAX_FRAMES, SYNC_BATCH_MAX_BYTES)
                {
                    job = Some((sid.clone(), from_seq, frames, entry.epoch));
                    break;
                }
            }
            job
        };

        let Some((sid, from_seq, frames, epoch)) = job else {
            // 无更多可推帧：若全部 session 已清 buffered → 退出（不持锁跨 await）。
            let all_clear = {
                let chats = state.chats.lock().expect("chats mutex poisoned");
                chats.values().all(|e| !e.buffered)
            };
            if all_clear {
                tracing::info!(target: "peri_studio::instance", "resync complete, all sessions live");
                return;
            }
            // 存在 buffered 但 pending 空（补推清空后新帧尚未到达）：短暂等待后重试。
            tokio::time::sleep(Duration::from_millis(20)).await;
            continue;
        };

        let frame = Frame::InstanceBufferSync(InstanceBufferSync {
            chat_id: sid.clone(),
            epoch,
            from_seq,
            frames: frames.clone(),
        });
        match handle.send_acked(frame).await {
            Ok(()) => {
                state
                    .buffer
                    .lock()
                    .expect("buffer mutex poisoned")
                    .commit(&sid);
                let last = frames.last().map(|bf| bf.seq).unwrap_or(from_seq);
                let mut chats = state.chats.lock().expect("chats mutex poisoned");
                if let Some(entry) = chats.get_mut(&sid) {
                    entry.last_sent_seq = last;
                }
                tracing::debug!(target: "peri_studio::instance", chat_id = %sid, from_seq,
                    frames = frames.len(), "buffer_sync batch sent");
            }
            Err(_) => {
                // 断线：未确认帧回置 pending（from_seq 不变，重连重发，§6.2）。
                state
                    .buffer
                    .lock()
                    .expect("buffer mutex poisoned")
                    .rollback(&sid);
                tracing::warn!(target: "peri_studio::instance", chat_id = %sid,
                    "buffer_sync send interrupted (disconnected), frames rolled back to pending");
                return;
            }
        }
    }
}
