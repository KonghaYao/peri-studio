//! 单 session 分桶缓冲（内存段 + 磁盘段 + 丢弃计数 + 补推 in-flight）。
//!
//! 预算核算在 [`crate::buffer::Buffer`] 级全局进行（问题 2）；本类型只维护
//! 自身计数。字段 `pub(super)` 仅对 `buffer` 模块（聚合层）可见。

use std::collections::VecDeque;
use std::time::Instant;

use peri_studio_proto::instance::BufferedFrame;

use crate::buffer::classify_frame;
use crate::buffer::disk::DiskSegment;
use crate::buffer::DRAIN_ERROR_LOG_INTERVAL;
use crate::buffer::FrameKind;

// ---------------------------------------------------------------------------
// SessionBuffer（单 session 分桶）
// ---------------------------------------------------------------------------

/// 单 session 分桶缓冲（内存段 + 磁盘段 + 丢弃计数 + 补推 in-flight）。
///
/// 预算核算在 [`Buffer`] 级全局进行（问题 2）；本类型只维护自身计数。
pub struct SessionBuffer {
    pub chat_id: String,
    pub(super) mem: VecDeque<(BufferedFrame, usize)>,
    pub(super) mem_bytes: usize,
    /// 内存段事件帧数（问题 14：evict 快速路径，免每帧线性扫描）。
    pub(super) mem_event_count: usize,
    pub(super) disk: Option<DiskSegment>,
    /// 磁盘段 open/append 失败熔断标记（问题 5）：首次失败记录后不再重试，
    /// 后续 push 直接按 [`PushOutcome::DiskFailed`] 丢弃（不重复打日志）。
    pub(super) disk_broken: bool,
    /// 总有效字节（mem + disk 未跳过段，push/consume 同步核算）。
    pub(super) total_bytes: usize,
    /// 总有效帧数（mem + disk 未跳过段）。
    pub(super) total_frames: usize,
    /// 补推 in-flight（已 drain 未 commit；发送失败 rollback 回置）。
    pub(super) in_flight: VecDeque<(BufferedFrame, usize)>,
    pub(super) dropped_event: u64,
    pub(super) dropped_control: u64,
    pub(super) dropped_disk_failed: u64,
    /// 最近一次磁盘读失败日志时刻（限频，review L5）。
    pub(super) last_drain_error_log: Option<Instant>,
}

impl SessionBuffer {
    pub(super) fn new(chat_id: &str) -> Self {
        SessionBuffer {
            chat_id: chat_id.to_string(),
            mem: VecDeque::new(),
            mem_bytes: 0,
            mem_event_count: 0,
            disk: None,
            disk_broken: false,
            total_bytes: 0,
            total_frames: 0,
            in_flight: VecDeque::new(),
            dropped_event: 0,
            dropped_control: 0,
            dropped_disk_failed: 0,
            last_drain_error_log: None,
        }
    }

    /// 记录一次磁盘段读取失败（限频 5s，review L5）。`drain_batch` 的读中断
    /// 会令 resync_loop 以空批次 20ms 空转重试——磁盘持续故障（如 ENOSPC/
    /// 文件损坏）时须有可见日志，但不可每秒刷 50 条。
    pub(super) fn log_drain_error(&mut self, e: &std::io::Error) {
        let now = Instant::now();
        if self
            .last_drain_error_log
            .is_none_or(|t| now.duration_since(t) >= DRAIN_ERROR_LOG_INTERVAL)
        {
            tracing::error!(target: "peri_studio::instance", chat_id = %self.chat_id, error = %e,
                "buffer disk segment read failed (resync paused; logged at most every 5s)");
            self.last_drain_error_log = Some(now);
        }
    }

    pub(super) fn first_seq(&mut self) -> Option<u64> {
        // from_seq = **本批**首帧 seq（调用方按批序发送并 commit，in-flight
        // 帧先于本批离流，不计入起点——见 drain_batch 契约与 buffer_test）。
        if let Some((bf, _)) = self.mem.front() {
            return Some(bf.seq);
        }
        if let Some((bf, _)) = self.in_flight.front() {
            return Some(bf.seq);
        }
        // 磁盘段首帧 seq 需读取（低频路径）。
        self.disk
            .as_mut()
            .and_then(|d| {
                let mut len = 0;
                d.peek_one(&mut len).ok().flatten()
            })
            .map(|bf| bf.seq)
    }

    /// 从内存段丢弃一条（预算超限）：优先「最旧事件帧」，无事件帧则最旧帧。
    ///
    /// 快速路径（问题 14）：队首即事件帧时 O(1) 直接出队；仅当队首为控制帧
    /// 且存在更早事件帧时才线性扫描（高频路径是事件帧占多数，队首即事件）。
    /// 返回被丢弃记录的 body 字节数（内存空 → None；调用方转磁盘段）。
    ///
    /// 本方法同步维护 entry 自身计数；Buffer 级全局计数由调用方
    /// （[`crate::buffer::Buffer::evict_one`]）按返回值同步（问题 2）。
    pub(super) fn evict_mem_one(&mut self) -> Option<usize> {
        if self.mem.is_empty() {
            return None;
        }
        let pos = if self.mem_event_count > 0 {
            match self.mem.front() {
                Some((bf, _)) if classify_frame(&bf.frame) == FrameKind::Event => 0,
                _ => self
                    .mem
                    .iter()
                    .position(|(bf, _)| classify_frame(&bf.frame) == FrameKind::Event)
                    .expect("mem_event_count > 0 必有事件帧"),
            }
        } else {
            // 无事件帧：直接丢弃最旧（控制类最后丢弃语义，§8.5）。
            self.dropped_control += 1;
            let (_, len) = self.mem.pop_front().expect("mem is not empty");
            self.mem_bytes -= len;
            self.total_bytes -= len;
            self.total_frames -= 1;
            return Some(len);
        };
        let (bf, len) = self.mem.remove(pos).expect("position already checked");
        if classify_frame(&bf.frame) == FrameKind::Event {
            self.mem_event_count -= 1;
            self.dropped_event += 1;
        } else {
            self.dropped_control += 1;
        }
        self.mem_bytes -= len;
        self.total_bytes -= len;
        self.total_frames -= 1;
        Some(len)
    }

    /// 丢弃一条：内存段优先（[`Self::evict_mem_one`]），内存空 → 磁盘段首
    /// （append-only 限制，最旧优先【决策】，见模块文档）。
    ///
    /// 返回 `(body 字节数, 是否来自内存段)`（无帧可丢 → None），供 Buffer
    /// 全局核算同步（问题 2）。
    pub(super) fn evict_any_one(&mut self) -> Option<(usize, bool)> {
        if let Some(len) = self.evict_mem_one() {
            return Some((len, true));
        }
        if let Some(disk) = self.disk.as_mut() {
            match disk.consume_one() {
                Ok(Some((bf, len))) => {
                    self.total_bytes -= len;
                    self.total_frames -= 1;
                    if classify_frame(&bf.frame) == FrameKind::Event {
                        self.dropped_event += 1;
                    } else {
                        self.dropped_control += 1;
                    }
                    return Some((len, false));
                }
                _ => return None,
            }
        }
        None
    }
}

