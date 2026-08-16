//! Unix 进程组信号原语（§4.1：`libc::kill(-pgid, sig)`）。
//!
//! `libc` crate 未预填（见 f6-instance.md §12，由主管统一处理），本模块以
//! 自声明 FFI 落地同一 libSystem/libc 符号，后续可无感替换为 `libc::kill`。

pub use libc::{kill, SIGKILL, SIGTERM};

/// 向进程组发送信号：`kill(-pgid, sig)`。返回是否成功（失败含 ESRCH——
/// 组已不存在，幂等忽略）。
pub fn kill_group(pgid: i32, sig: i32) -> bool {
    // SAFETY: kill(2) 无内存安全问题；参数为合法 i32 信号号与进程组 id。
    unsafe { kill(-pgid, sig) == 0 }
}
