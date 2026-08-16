//! 环形滑窗（§4.4.2）：常驻内存最后 `cap` 条（在线 = 已发送帧；断线 =
//! 缓冲帧）。
//!
//! 兜底「server 崩溃前已收未落盘段」：server 发现缺口时请求滑窗重发
//! （冲突 2 无线帧，本类型仅提供查询接口备用）。满则淘汰最旧。

use std::collections::VecDeque;

use peri_studio_proto::instance::BufferedFrame;

#[derive(Debug, Clone)]
pub struct RingBuffer {
    frames: VecDeque<BufferedFrame>,
    cap: usize,
}

impl RingBuffer {
    pub fn new(cap: usize) -> Self {
        RingBuffer {
            frames: VecDeque::new(),
            cap,
        }
    }

    /// 入窗（满则淘汰最旧）。
    pub fn push(&mut self, bf: BufferedFrame) {
        if self.frames.len() == self.cap {
            self.frames.pop_front();
        }
        self.frames.push_back(bf);
    }

    /// 快照（seq 升序，备用查询接口）。
    pub fn snapshot(&self) -> Vec<BufferedFrame> {
        self.frames.iter().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }
}
