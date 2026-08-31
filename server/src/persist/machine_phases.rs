//! SSH 机器 `machines.phase` 常量与阶段判定（ssh-machine-mount §6.1 / §8.1）。

/// 本机内置行；不由 SSH 管道写入。
pub const PHASE_ONLINE: &str = "online";
/// 隧道已拆或从未连上；可手动 Connect。
pub const PHASE_OFFLINE: &str = "offline";
/// 管道或动作失败；可 Retry。
pub const PHASE_FAILED: &str = "failed";
/// admit 后初始阶段。
pub const PHASE_PENDING: &str = "pending";
/// 等待用户 Trust host key。
pub const PHASE_AWAITING_HOST_KEY: &str = "awaiting_host_key";
/// 等待用户确认替换远端已有 peri-studio 二进制。
pub const PHASE_AWAITING_REPLACE: &str = "awaiting_replace";

/// 管道步骤阶段（与 §6.1 顺序一致）。
pub const PHASE_HOST_KEY_PROBE: &str = "host_key_probe";
pub const PHASE_SSH_CONNECT: &str = "ssh_connect";
pub const PHASE_PROBE: &str = "probe";
pub const PHASE_INSTALL: &str = "install";
pub const PHASE_PROVISION: &str = "provision";
pub const PHASE_TUNNEL: &str = "tunnel";
pub const PHASE_START: &str = "start";
pub const PHASE_CONNECTING: &str = "connecting";

/// 唯一性键用的 destination 规范化（§7.1）。
/// 审计日志用规范化 hostname（不含 `user@` 前缀）。
pub fn normalize_ssh_hostname(destination: &str) -> String {
    let trimmed = destination.trim();
    if let Some((_, host)) = trimmed.rsplit_once('@') {
        host.trim().to_ascii_lowercase()
    } else {
        trimmed.to_ascii_lowercase()
    }
}

/// 唯一性键用的 destination 规范化（§7.1）。
pub fn normalize_ssh_destination(destination: &str) -> String {
    let trimmed = destination.trim();
    if let Some((user, host)) = trimmed.rsplit_once('@') {
        format!(
            "{}@{}",
            user.trim().to_ascii_lowercase(),
            host.trim().to_ascii_lowercase()
        )
    } else {
        trimmed.to_ascii_lowercase()
    }
}

/// 是否处于进行中的供应管道（server 重启须收敛为 failed）。
pub fn is_in_progress(phase: &str) -> bool {
    matches!(
        phase,
        PHASE_PENDING
            | PHASE_HOST_KEY_PROBE
            |         PHASE_AWAITING_HOST_KEY
            | PHASE_AWAITING_REPLACE
            | PHASE_SSH_CONNECT
            | PHASE_PROBE
            | PHASE_INSTALL
            | PHASE_PROVISION
            | PHASE_TUNNEL
            | PHASE_START
            | PHASE_CONNECTING
    )
}

/// 是否已到达可重试的失败终态。
pub fn is_terminal_failure(phase: &str) -> bool {
    phase == PHASE_FAILED
}

/// Connect / 自动重连管道入口阶段（从 tunnel 起跑，§6.1）。
pub fn connect_entry_phase() -> &'static str {
    PHASE_TUNNEL
}
