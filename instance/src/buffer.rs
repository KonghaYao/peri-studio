//! 断线缓冲（§8.3/§8.5）：per-session 分桶（内存 + 磁盘两级）、分类丢弃、
//! 环形滑窗 500、水位文件（epoch/last_seq/pgid）、启动清理。
//!
//! - **两级存储**：内存 `VecDeque` 优先（预算 `mem_buffer_bytes` 与条数上限的
//!   一半）；达限后新帧追加磁盘 append 日志（`{data_dir}/buffer/{sid}.buf`，
//!   0600，u32 长度前缀 + [`BufferedFrame`] 序列化，无 CRC【决策】——崩溃即弃
//!   的临时溢出文件，§3.3「缓冲不跨重启保留」）；
//! - **预算与丢弃**（§8.5）：总预算 = 内存 + 磁盘合计（10MB/万条默认，任一
//!   超限触发），**全局口径核算**（问题 2：N 个 session 共享同一预算，而非
//!   per-session 各 10MB）；跨 session 丢弃按插入顺序 round-robin 公平轮转
//!   （HashMap 迭代不稳定，轮转保证行为可预测）；单帧超限跳过（gap，计数
//!   归调用方统一计 `oversize_gaps`，问题 13）；超预算事件类优先丢弃、控制
//!   类最后丢弃；分类规则为**信封结构性分类**【决策】（instance 是 dumb
//!   pipe，§3.3 禁止语义解析）：JSON-RPC 包裹且含 `id` → 控制类；通知/原始
//!   帧 → 事件类；
//! - **磁盘失败熔断**（问题 5）：磁盘段 open/append 失败后该 session 熔断
//!   （`disk_broken`），后续帧按 [`PushOutcome::DiskFailed`] 丢弃——不无边界
//!   重试、不每帧 error 日志（磁盘满/权限错时防日志风暴）；重启或 session
//!   重建后自动恢复；
//! - **补推**：`drain_batch`（peek，不移除）→ 发送成功 → `commit`（移除）；
//!   发送中断 → `rollback`（帧回置队首 + 预算补查，问题 15）——保证「未确认
//!   不移出」；
//! - **环形滑窗**：每 session 常驻内存最后 500 条（在线与断线均写入），兜底
//!   server 崩溃前已收未落盘段（`ring_snapshot` 查询接口备用，冲突 2）；
//! - **水位**：`{data_dir}/watermark.json`（0600）：epoch 跨重启单调（§4.5.1
//!   判定正确性前提）、pgid + leader 出生指纹 + data-dir 身份供可证明
//!   所有权的启动清理，last_seq 仅作诊断参考（权威在 server）。

mod disk;
mod ring;
mod session;
mod watermark;

pub use disk::DiskSegment;
pub use ring::RingBuffer;
pub use watermark::{
    DataDirIdentity, ProcessFingerprint, SessionWatermark, Watermark, WatermarkError, WatermarkFile,
};

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use peri_studio_proto::instance::BufferedFrame;

use crate::buffer::session::SessionBuffer;

/// 磁盘段读取失败日志限频间隔（review L5：resync_loop 以 20ms 空转重试，
/// 全量记录会形成 50 条/秒的日志风暴）。
const DRAIN_ERROR_LOG_INTERVAL: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------
// 帧分类（§4.4.1 第 3 条：信封结构性分类【决策】）
// ---------------------------------------------------------------------------

/// 帧分类（丢弃优先级依据，§8.5「delta 类帧优先丢弃、控制帧/终态帧最后丢弃」
/// 的 instance 侧可执行近似）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    /// 事件类（无 `id` 的通知 / 原始 `{type,payload}` 帧）——优先丢弃。
    Event,
    /// 控制类（JSON-RPC 请求/响应，含 `"jsonrpc"` 键且有 `"id"`）——最后丢弃。
    Control,
}

/// 信封结构性分类（不解析事件语义，§3.3）：
/// JSON-RPC 包裹（含 `"jsonrpc"` 键）且有 `"id"` → 控制类；其余 → 事件类。
pub fn classify_frame(frame: &serde_json::Value) -> FrameKind {
    if frame.get("jsonrpc").is_some() && frame.get("id").is_some() {
        FrameKind::Control
    } else {
        FrameKind::Event
    }
}

/// 入缓冲结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushOutcome {
    /// 已入缓冲（或入缓冲后被预算丢弃——丢弃计数在 buffer 内）。
    Buffered,
    /// 序列化后超单帧上限：不入缓冲、不转发，跳过 + gap（§8.5）。
    ///
    /// 计数归属（问题 13）：**调用方统一计** `oversize_gaps`——hub 在 push 前
    /// 已用同一 `BufferedFrame` 序列化产物做过大小检查，本分支在其下不可达，
    /// 属防御兜底；调用方不得重复计数。
    Oversize,
    /// 磁盘段打开/写入失败（熔断，问题 5）：帧未入缓冲；该 session 后续
    /// push 在修复前一律返回本结果（丢弃计数在 buffer 内）。
    DiskFailed,
}

// ---------------------------------------------------------------------------
// Buffer（聚合，全局预算核算）
// ---------------------------------------------------------------------------

/// 全局缓冲：`chat_id → SessionBuffer` 分桶 + **全局预算核算**（§8.5 合计
/// 口径：内存 + 磁盘合计 10MB/万条，任一超限触发，N 个 session 共享，问题 2）。
pub struct Buffer {
    chats: HashMap<String, SessionBuffer>,
    mem_bytes_limit: usize,
    mem_frames_limit: usize,
    total_bytes_limit: usize,
    total_frames_limit: usize,
    max_frame_bytes: usize,
    dir: PathBuf,
    // 全局核算（问题 2）：push/drain/commit/rollback/remove 同步增减。
    total_bytes: usize,
    total_frames: usize,
    mem_bytes: usize,
    mem_frames: usize,
    /// bucket 插入顺序（evict 轮转公平性：HashMap 迭代不稳定，round-robin
    /// 保证跨 session 公平丢弃且行为可预测、可测试）。
    bucket_order: Vec<String>,
    evict_cursor: usize,
}

impl Buffer {
    /// 构建缓冲池。
    ///
    /// - `mem_bytes_limit`：内存段字节预算（默认 5MB = 合计口径的内存半区【决策】）；
    /// - `mem_frames_limit`：内存段条数预算（默认合计上限的一半【决策】）；
    /// - `total_bytes_limit` / `total_frames_limit`：内存 + 磁盘合计（默认 10MB/万条）；
    /// - `max_frame_bytes`：单帧上限（超限跳过 + gap，§8.5）；
    /// - `dir`：磁盘溢出文件目录（`{data_dir}/buffer/`）。
    pub fn new(
        mem_bytes_limit: usize,
        mem_frames_limit: usize,
        total_bytes_limit: usize,
        total_frames_limit: usize,
        max_frame_bytes: usize,
        dir: PathBuf,
    ) -> Self {
        Buffer {
            chats: HashMap::new(),
            mem_bytes_limit,
            mem_frames_limit,
            total_bytes_limit,
            total_frames_limit,
            max_frame_bytes,
            dir,
            total_bytes: 0,
            total_frames: 0,
            mem_bytes: 0,
            mem_frames: 0,
            bucket_order: Vec::new(),
            evict_cursor: 0,
        }
    }

    /// 入缓冲（断线路径）。
    ///
    /// - 单帧超限 → [`PushOutcome::Oversize`]（跳过 + gap）。**seq 由调用方
    ///   在 push 前分配且不可回收**（问题 11 注释修正），本帧的 seq 成为
    ///   显式缺口，由调用方按 `Oversize` 计数呈现；
    /// - 磁盘失败 → [`PushOutcome::DiskFailed`]（熔断，问题 5）；
    /// - 其余 → 入缓冲（内存段优先，全局内存预算满转磁盘段；入缓冲后按
    ///   **全局**预算丢弃，任一超限触发）。
    pub fn push(&mut self, chat_id: &str, seq: u64, frame: serde_json::Value) -> PushOutcome {
        let bf = BufferedFrame { seq, frame };
        let bytes = match serde_json::to_vec(&bf) {
            Ok(b) => b,
            Err(_) => return PushOutcome::Oversize, // 理论不可达（Value 恒可序列化）
        };
        if bytes.len() > self.max_frame_bytes {
            // 单帧超限：不入缓冲、不转发。计数归调用方统一（见 Oversize 文档）。
            tracing::warn!(target: "peri_studio::instance", chat_id, seq, bytes = bytes.len(),
                max = self.max_frame_bytes,
                "buffered frame exceeds single-frame limit, skipped (gap)");
            return PushOutcome::Oversize;
        }
        let size = bytes.len();
        let entry = self.chats.entry(chat_id.to_string()).or_insert_with(|| {
            self.bucket_order.push(chat_id.to_string());
            SessionBuffer::new(chat_id)
        });
        if entry.disk_broken {
            // 熔断（问题 5）：磁盘已失败，帧无处可去 → 丢弃计数，不重试、
            // 不重复打日志（首次失败日志在熔断点已记录）。
            entry.dropped_disk_failed += 1;
            return PushOutcome::DiskFailed;
        }
        if self.mem_bytes + size <= self.mem_bytes_limit && self.mem_frames < self.mem_frames_limit
        {
            entry.mem_bytes += size;
            entry.mem.push_back((bf, size));
            if classify_frame(&entry.mem.back().expect("just pushed").0.frame) == FrameKind::Event {
                entry.mem_event_count += 1;
            }
            self.mem_bytes += size;
            self.mem_frames += 1;
        } else {
            // 全局内存段满 → 磁盘溢出段（懒创建 0600）。
            if entry.disk.is_none() {
                match DiskSegment::open(&self.dir, chat_id) {
                    Ok(d) => entry.disk = Some(d),
                    Err(e) => {
                        entry.disk_broken = true;
                        entry.dropped_disk_failed += 1;
                        tracing::error!(target: "peri_studio::instance", chat_id,
                            "buffer disk segment open failed (fused for this session): {e}");
                        return PushOutcome::DiskFailed;
                    }
                }
            }
            if let Some(disk) = entry.disk.as_mut() {
                if let Err(e) = disk.append(&bytes) {
                    entry.disk_broken = true;
                    entry.dropped_disk_failed += 1;
                    tracing::error!(target: "peri_studio::instance", chat_id,
                        "buffer disk segment append failed (fused for this session): {e}");
                    return PushOutcome::DiskFailed;
                }
            }
        }
        entry.total_bytes += size;
        entry.total_frames += 1;
        self.total_bytes += size;
        self.total_frames += 1;

        // 预算丢弃（§8.5 全局合计口径：任一超限触发，round-robin 跨 session）。
        while self.total_bytes > self.total_bytes_limit
            || self.total_frames > self.total_frames_limit
        {
            if !self.evict_one(false) {
                break;
            }
        }
        PushOutcome::Buffered
    }

    /// round-robin 轮转选择一个有可丢弃帧的 bucket 并丢弃一条。`mem_only`
    /// 限制只丢弃内存段帧（内存预算超限时磁盘帧无法缓解）。
    ///
    /// 全局核算同步（问题 2）：entry 计数在 [`SessionBuffer`] 内维护，本层按
    /// evict 返回值同步全局 `total_*`/`mem_*`——否则预算循环会重复 evict
    /// 直至清空（entry 与全局计数不同步）。
    fn evict_one(&mut self, mem_only: bool) -> bool {
        let n = self.bucket_order.len();
        if n == 0 {
            return false;
        }
        for offset in 0..n {
            let idx = (self.evict_cursor + offset) % n;
            let sid = &self.bucket_order[idx];
            let Some(entry) = self.chats.get_mut(sid) else {
                continue; // bucket 已 remove（bucket_order 惰性清理）
            };
            let dropped = if mem_only {
                entry.evict_mem_one().map(|len| (len, true))
            } else {
                entry.evict_any_one()
            };
            if let Some((len, from_mem)) = dropped {
                self.total_bytes = self.total_bytes.saturating_sub(len);
                self.total_frames -= 1;
                if from_mem {
                    self.mem_bytes = self.mem_bytes.saturating_sub(len);
                    self.mem_frames -= 1;
                }
                self.evict_cursor = (idx + 1) % n;
                return true;
            }
        }
        false
    }

    /// 该 session 是否有待补推帧。**含 in-flight**（问题 11 注释修正：drain
    /// 是 peek 语义，未确认不移出，commit 前帧仍计入 `total_frames`）。
    pub fn has_pending(&self, chat_id: &str) -> bool {
        self.chats
            .get(chat_id)
            .map(|e| e.total_frames > 0)
            .unwrap_or(false)
    }

    /// 任一 session 有待补推帧（`hello.buffered`，§6.3）。
    pub fn has_any_pending(&self) -> bool {
        self.chats.values().any(|e| e.total_frames > 0)
    }

    /// 补推批次：从 pending 首部（内存优先，跨磁盘段）取最多 `max_frames` 帧、
    /// 合计序列化 ≤ `max_bytes` 字节（§6.2 分批【决策】：256 帧 / 512KB 先达者）。
    ///
    /// **peek 语义**：帧移入 in-flight 但未消费；发送成功须 [`Buffer::commit`]，
    /// 失败须 [`Buffer::rollback`]——保证「未确认不移出」（§6.1/§6.2）。
    ///
    /// 返回 `(from_seq, frames)`；无 pending → `None`。
    pub fn drain_batch(
        &mut self,
        chat_id: &str,
        max_frames: usize,
        max_bytes: usize,
    ) -> Option<(u64, Vec<BufferedFrame>)> {
        let entry = self.chats.get_mut(chat_id)?;
        if entry.total_frames == 0 {
            return None;
        }
        let from_seq = entry.first_seq()?;
        let mut out = Vec::new();
        let mut bytes = 0usize;
        while out.len() < max_frames {
            // 内存段优先（队首即全局最旧）。
            if let Some((_, len)) = entry.mem.front() {
                if bytes + *len > max_bytes {
                    break;
                }
                let (bf, len) = entry.mem.pop_front().expect("front already checked");
                if classify_frame(&bf.frame) == FrameKind::Event {
                    entry.mem_event_count -= 1;
                }
                entry.mem_bytes -= len;
                self.mem_bytes -= len;
                self.mem_frames -= 1;
                bytes += len;
                out.push((bf, len));
                continue;
            }
            // 内存空 → 磁盘段（body 字节口径与内存一致：不含 4B 长度前缀）。
            if let Some(disk) = entry.disk.as_mut() {
                let mut len = 0;
                match disk.peek_one(&mut len) {
                    Ok(Some(bf)) => {
                        let body_len = len.saturating_sub(4);
                        if bytes + body_len > max_bytes {
                            break;
                        }
                        match disk.consume_one() {
                            Ok(_) => {}
                            // consume 失败（读错误/文件损坏）：本批中断，已
                            // peek 帧不可用。break 而非 `?` 提前返回——保留已
                            // 收集批（进 in-flight），避免已 pop 帧静默丢失。
                            Err(e) => {
                                entry.log_drain_error(&e);
                                break;
                            }
                        }
                        bytes += body_len;
                        out.push((bf, body_len));
                        continue;
                    }
                    Ok(None) => break,
                    // 磁盘读失败：本批中断（无帧移入 in-flight），resync_loop
                    // 以空批次 20ms 空转重试。限频记录 error，避免磁盘持续
                    // 故障时静默空转（review L5）。
                    Err(e) => {
                        entry.log_drain_error(&e);
                        break;
                    }
                }
            } else {
                break;
            }
        }
        if out.is_empty() {
            return None;
        }
        // 移入 in-flight（顺序保持；未确认不移出，§6.1）。
        entry.in_flight.extend(out.iter().cloned());
        Some((from_seq, out.into_iter().map(|(bf, _)| bf).collect()))
    }

    /// 确认补推批次已发送成功：in-flight 帧正式出流（该 session 补推串行，
    /// 一次 commit 清空整批）。
    pub fn commit(&mut self, chat_id: &str) {
        if let Some(entry) = self.chats.get_mut(chat_id) {
            let mut drained_bytes = 0usize;
            let mut drained_frames = 0usize;
            while let Some((_, len)) = entry.in_flight.pop_front() {
                drained_bytes += len;
                drained_frames += 1;
            }
            entry.total_bytes = entry.total_bytes.saturating_sub(drained_bytes);
            entry.total_frames = entry.total_frames.saturating_sub(drained_frames);
            self.total_bytes = self.total_bytes.saturating_sub(drained_bytes);
            self.total_frames = self.total_frames.saturating_sub(drained_frames);
        }
    }

    /// 补推发送中断（断线）：in-flight 帧回置 pending 队首（顺序保持，§6.2
    /// 「未发帧保留在 pending，重连后重发，from_seq 不变」）。
    ///
    /// 回置后补一次内存预算 evict 循环（问题 15）：drain 期间新帧可能已占用
    /// 内存空位，回置会使 `mem_bytes/mem_frames` 瞬时超限——与 push 共用
    /// 预算口径，避免 `water_level` 与内存不变量失真。
    pub fn rollback(&mut self, chat_id: &str) {
        if let Some(entry) = self.chats.get_mut(chat_id) {
            let frames: Vec<_> = entry.in_flight.drain(..).collect();
            for (bf, len) in frames.into_iter().rev() {
                if classify_frame(&bf.frame) == FrameKind::Event {
                    entry.mem_event_count += 1;
                }
                entry.mem.push_front((bf, len));
                entry.mem_bytes += len;
                self.mem_bytes += len;
                self.mem_frames += 1;
            }
            while self.mem_bytes > self.mem_bytes_limit || self.mem_frames > self.mem_frames_limit {
                if !self.evict_one(true) {
                    break;
                }
            }
        }
    }

    /// 全部分桶回置（resync 任务被中断时调用——abort 可能发生在持锁/发送
    /// 之间，孤儿 in-flight 帧必须回置 pending，否则重连后 from_seq 错位）。
    pub fn rollback_all(&mut self) {
        let ids: Vec<String> = self
            .chats
            .iter()
            .filter(|(_, e)| !e.in_flight.is_empty())
            .map(|(sid, _)| sid.clone())
            .collect();
        for sid in ids {
            self.rollback(&sid);
        }
    }

    /// 会话清理：删除缓冲文件与内存段（§8.5「session 结束/清理时同步删除」），
    /// 全局核算同步扣减（问题 2）。
    pub fn remove(&mut self, chat_id: &str) {
        if let Some(entry) = self.chats.remove(chat_id) {
            if let Some(disk) = entry.disk {
                let _ = fs::remove_file(&disk.path);
            }
            self.total_bytes = self.total_bytes.saturating_sub(entry.total_bytes);
            self.total_frames = self.total_frames.saturating_sub(entry.total_frames);
            self.mem_bytes = self.mem_bytes.saturating_sub(entry.mem_bytes);
            self.mem_frames = self.mem_frames.saturating_sub(entry.mem.len());
            self.bucket_order.retain(|s| s != chat_id);
        }
    }

    /// 清空全部分桶（daemon 启动时，§3.3 缓冲不跨重启）+ 删除目录内文件。
    pub fn clear_all(&mut self) {
        let dir = self.dir.clone();
        self.chats.clear();
        self.bucket_order.clear();
        self.evict_cursor = 0;
        self.total_bytes = 0;
        self.total_frames = 0;
        self.mem_bytes = 0;
        self.mem_frames = 0;
        let _ = fs::remove_dir_all(&dir);
    }

    /// 丢弃计数合计（§17.1 指标：事件 / 控制 / 磁盘失败分类；单帧超限计数
    /// 归调用方 `oversize_gaps`，问题 13）。
    pub fn dropped_stats(&self) -> (u64, u64, u64) {
        let mut e = 0;
        let mut c = 0;
        let mut d = 0;
        for s in self.chats.values() {
            e += s.dropped_event;
            c += s.dropped_control;
            d += s.dropped_disk_failed;
        }
        (e, c, d)
    }

    /// 缓冲水位（字节/条数合计，§17.1 指标，全局口径）。
    pub fn water_level(&self) -> (usize, usize) {
        (self.total_bytes, self.total_frames)
    }
}

#[cfg(test)]
#[path = "buffer_test.rs"]
mod buffer_test;

#[cfg(test)]
#[path = "buffer_watermark_test.rs"]
mod buffer_watermark_test;
