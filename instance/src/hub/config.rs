//! instance daemon 配置（§4.2；默认值对齐 §10/proto::Defaults）。

use std::fmt;
use std::path::PathBuf;
use std::time::Duration;

use peri_studio_proto::protocol::Defaults;

/// instance daemon 配置（§4.2；默认值对齐 §10/proto::Defaults）。
///
/// 脱敏 Debug（问题 6）：token 不进入 `{:?}` 输出（§9.3）——derive 会打印
/// 字段明文，此处手写实现以 `[REDACTED]` 占位。
#[derive(Clone)]
pub struct InstanceConfig {
    /// server ws 地址（`ws://host:port/instance`）。
    pub server_url: String,
    /// instance token（从 token 文件读入，不落日志）。
    pub token: String,
    /// 数据目录（`~/.local/share/peri-studio/instance/`，0600）。
    pub data_dir: PathBuf,
    /// 心跳间隔（proto::Defaults::HEARTBEAT_INTERVAL，5s）。
    pub heartbeat_interval: Duration,
    /// 重连退避起点（§7.1，1s）。
    pub reconnect_base: Duration,
    /// 重连退避上限（§7.1，60s）。
    pub reconnect_max: Duration,
    /// 握手超时（10s【决策】）。
    pub auth_timeout: Duration,
    /// 单帧写超时（TCP 背压 → 主动断线走缓冲语义，默认 10s【决策：P1-3】）。
    pub write_timeout: Duration,
    /// 缓冲合计上限字节（proto::Defaults::BUFFER_LIMIT_BYTES，10MB）。
    pub buffer_limit_bytes: usize,
    /// 缓冲合计上限条数（proto::Defaults::BUFFER_LIMIT_FRAMES，万条）。
    pub buffer_limit_frames: usize,
    /// 内存段字节预算（5MB【决策】= 合计口径半区，§8.5）。
    pub mem_buffer_bytes: usize,
    /// 单帧上限（proto::Defaults::MAX_FRAME_BYTES，1MB；超限跳过 + gap，§8.5）。
    pub max_frame_bytes: usize,
    /// 环形滑窗容量（proto::Defaults::RING_BUFFER_CAPACITY，500）。
    pub ring_capacity: usize,
    /// kill 宽限（3s【决策】；server 可经 `instance/kill.grace` 覆盖）。
    pub kill_grace: Duration,
}

impl InstanceConfig {
    /// 以必需项构建，其余取协议默认值（§10）。
    pub fn new(server_url: String, token: String, data_dir: PathBuf) -> Self {
        InstanceConfig {
            server_url,
            token,
            data_dir,
            heartbeat_interval: Defaults::HEARTBEAT_INTERVAL,
            reconnect_base: Duration::from_secs(1),
            reconnect_max: Duration::from_secs(60),
            auth_timeout: Duration::from_secs(10),
            write_timeout: Duration::from_secs(10),
            buffer_limit_bytes: Defaults::BUFFER_LIMIT_BYTES,
            buffer_limit_frames: Defaults::BUFFER_LIMIT_FRAMES,
            mem_buffer_bytes: Defaults::BUFFER_LIMIT_BYTES / 2,
            max_frame_bytes: Defaults::MAX_FRAME_BYTES,
            ring_capacity: Defaults::RING_BUFFER_CAPACITY,
            kill_grace: Duration::from_secs(3),
        }
    }
}

impl fmt::Debug for InstanceConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("InstanceConfig")
            .field("server_url", &self.server_url)
            .field("token", &"[REDACTED]")
            .field("data_dir", &self.data_dir)
            .field("heartbeat_interval", &self.heartbeat_interval)
            .field("reconnect_base", &self.reconnect_base)
            .field("reconnect_max", &self.reconnect_max)
            .field("auth_timeout", &self.auth_timeout)
            .field("write_timeout", &self.write_timeout)
            .field("buffer_limit_bytes", &self.buffer_limit_bytes)
            .field("buffer_limit_frames", &self.buffer_limit_frames)
            .field("mem_buffer_bytes", &self.mem_buffer_bytes)
            .field("max_frame_bytes", &self.max_frame_bytes)
            .field("ring_capacity", &self.ring_capacity)
            .field("kill_grace", &self.kill_grace)
            .finish()
    }
}
