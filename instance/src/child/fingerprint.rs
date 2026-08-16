//! 进程组 leader 出生身份（§7.5/§8：启动清理所有权验证）。
//!
//! `process_fingerprint(pgid)` 读取进程组 leader 的出生身份并验证其仍拥有
//! `pgid`；任何不可用或含糊的平台证据一律 fail closed 返回 `None`（不发送
//! SIGKILL）。指纹写入水位文件（`ProcessFingerprint`），下次启动比对。

use crate::buffer::ProcessFingerprint;

/// Read the process-group leader's birth identity and verify it still owns `pgid`.
/// Any unavailable or ambiguous platform evidence fails closed with `None`.
#[cfg(target_os = "macos")]
pub fn process_fingerprint(pgid: i32) -> Option<ProcessFingerprint> {
    if pgid <= 0 {
        return None;
    }
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    // SAFETY: buffer is valid for `size`; proc_pidinfo initializes it on exact-size success.
    let read = unsafe {
        libc::proc_pidinfo(
            pgid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if read != size {
        return None;
    }
    // SAFETY: exact-size success above initialized the full struct.
    let info = unsafe { info.assume_init() };
    if info.pbi_pid != pgid as u32 || info.pbi_pgid != pgid as u32 {
        return None;
    }
    Some(ProcessFingerprint {
        platform: "macos-proc-bsdinfo-v1".to_string(),
        birth: format!("{}:{}", info.pbi_start_tvsec, info.pbi_start_tvusec),
    })
}

#[cfg(target_os = "linux")]
pub fn process_fingerprint(pgid: i32) -> Option<ProcessFingerprint> {
    if pgid <= 0 {
        return None;
    }
    let stat = std::fs::read_to_string(format!("/proc/{pgid}/stat")).ok()?;
    let boot_id = std::fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?;
    linux_process_fingerprint(&stat, pgid, &boot_id)
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn linux_process_fingerprint(
    stat: &str,
    pgid: i32,
    boot_id: &str,
) -> Option<ProcessFingerprint> {
    let tail = stat.rsplit_once(") ")?.1;
    let fields: Vec<&str> = tail.split_whitespace().collect();
    let process_group: i32 = fields.get(2)?.parse().ok()?;
    let start_ticks = fields.get(19)?;
    if process_group != pgid || boot_id.trim().is_empty() {
        return None;
    }
    Some(ProcessFingerprint {
        platform: "linux-proc-stat-v1".to_string(),
        birth: format!("{}:{}", boot_id.trim(), start_ticks),
    })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn process_fingerprint(_pgid: i32) -> Option<ProcessFingerprint> {
    None
}
