//! 配置文件面：`FileConfig` 形态 + 加载 + 与 [`Config`](super::Config) 的
//! 逐层合并（架构 §16：默认 < 配置文件 < env <
//! CLI 显式）。
//!
//! `merge_file`/`merge_cli` 为显式字段级 if-let 合并（不引入宏隐式映射）：
//! 字段一一对应，评审可逐行核对；`deny_unknown_fields` 已保证未知键在
//! 解析期失败。

use std::collections::BTreeSet;
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::config::duration::{deserialize_opt_duration, serialize_opt_duration};
use crate::config::{CliOverrides, Config, ConfigError};

/// 配置文件形态：全 `Option` + `deny_unknown_fields`（未知键 → 启动失败，§3.4）。
///
/// Duration 字段经 `duration.rs` 自定义 serde（可读字符串形态，§3.1【决策】）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FileConfig {
    pub(crate) listen_addr: Option<IpAddr>,
    pub(crate) listen_port: Option<u16>,
    pub(crate) data_dir: Option<PathBuf>,
    pub(crate) config_dir: Option<PathBuf>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_duration",
        serialize_with = "serialize_opt_duration"
    )]
    pub(crate) heartbeat_interval: Option<Duration>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_duration",
        serialize_with = "serialize_opt_duration"
    )]
    pub(crate) offline_timeout: Option<Duration>,
    pub(crate) buffer_limit_bytes: Option<usize>,
    pub(crate) buffer_limit_frames: Option<usize>,
    pub(crate) max_frame_bytes: Option<usize>,
    pub(crate) ring_buffer_capacity: Option<usize>,
    pub(crate) command_queue_cap: Option<usize>,
    pub(crate) connection_quota: Option<usize>,
    pub(crate) backpressure_soft_bytes: Option<usize>,
    pub(crate) backpressure_hard_bytes: Option<usize>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_duration",
        serialize_with = "serialize_opt_duration"
    )]
    pub(crate) microbatch_window: Option<Duration>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_duration",
        serialize_with = "serialize_opt_duration"
    )]
    pub(crate) replay_window: Option<Duration>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_duration",
        serialize_with = "serialize_opt_duration"
    )]
    pub(crate) permission_timeout: Option<Duration>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_duration",
        serialize_with = "serialize_opt_duration"
    )]
    pub(crate) cancel_timeout: Option<Duration>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_duration",
        serialize_with = "serialize_opt_duration"
    )]
    pub(crate) spawn_timeout: Option<Duration>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_duration",
        serialize_with = "serialize_opt_duration"
    )]
    pub(crate) initialize_timeout: Option<Duration>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_duration",
        serialize_with = "serialize_opt_duration"
    )]
    pub(crate) binding_timeout: Option<Duration>,
    pub(crate) spawn_env_allowlist: Option<BTreeSet<String>>,
    pub(crate) allow_non_loopback: Option<bool>,
    pub(crate) acp_cmd: Option<Vec<String>>,
    pub(crate) log_level: Option<String>,
}

/// 读取配置文件（不存在 → [`ConfigError::MissingConfig`]；非法 → ParseConfig）。
pub(crate) fn load_file(path: &Path) -> Result<FileConfig, ConfigError> {
    if !path.exists() {
        return Err(ConfigError::MissingConfig(path.to_path_buf()));
    }
    let content = fs::read_to_string(path).map_err(|source| ConfigError::ReadConfig {
        path: path.to_path_buf(),
        source,
    })?;
    let file: FileConfig = toml::from_str(&content).map_err(|source| ConfigError::ParseConfig {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(file)
}

impl Config {
    /// 配置文件层合并（优先级高于默认值，低于 env/CLI 显式，§3.2）。
    pub(super) fn merge_file(&mut self, f: &FileConfig) {
        if let Some(v) = f.listen_addr {
            self.listen_addr = v;
        }
        if let Some(v) = f.listen_port {
            self.listen_port = v;
        }
        if let Some(v) = &f.data_dir {
            self.data_dir = v.clone();
        }
        if let Some(v) = &f.config_dir {
            self.config_dir = v.clone();
        }
        if let Some(v) = f.heartbeat_interval {
            self.heartbeat_interval = v;
        }
        if let Some(v) = f.offline_timeout {
            self.offline_timeout = v;
        }
        if let Some(v) = f.buffer_limit_bytes {
            self.buffer_limit_bytes = v;
        }
        if let Some(v) = f.buffer_limit_frames {
            self.buffer_limit_frames = v;
        }
        if let Some(v) = f.max_frame_bytes {
            self.max_frame_bytes = v;
        }
        if let Some(v) = f.ring_buffer_capacity {
            self.ring_buffer_capacity = v;
        }
        if let Some(v) = f.command_queue_cap {
            self.command_queue_cap = v;
        }
        if let Some(v) = f.connection_quota {
            self.connection_quota = v;
        }
        if let Some(v) = f.backpressure_soft_bytes {
            self.backpressure_soft_bytes = v;
        }
        if let Some(v) = f.backpressure_hard_bytes {
            self.backpressure_hard_bytes = v;
        }
        if let Some(v) = f.microbatch_window {
            self.microbatch_window = v;
        }
        if let Some(v) = f.replay_window {
            self.replay_window = v;
        }
        if let Some(v) = f.permission_timeout {
            self.permission_timeout = v;
        }
        if let Some(v) = f.cancel_timeout {
            self.cancel_timeout = v;
        }
        if let Some(v) = f.spawn_timeout {
            self.spawn_timeout = v;
        }
        if let Some(v) = f.initialize_timeout {
            self.initialize_timeout = v;
        }
        if let Some(v) = f.binding_timeout {
            self.binding_timeout = v;
        }
        if let Some(v) = &f.spawn_env_allowlist {
            self.spawn_env_allowlist = v.clone();
        }
        if let Some(v) = &f.acp_cmd {
            self.acp_cmd = v.clone();
        }
        if let Some(v) = f.allow_non_loopback {
            self.allow_non_loopback = v;
        }
        if let Some(v) = &f.log_level {
            self.log_level = v.clone();
        }
    }

    /// CLI/env 层合并（clap `env` 注入的值已落入 `CliOverrides`，§3.2）。
    pub(super) fn merge_cli(&mut self, cli: &CliOverrides) {
        if let Some(v) = cli.listen_addr {
            self.listen_addr = v;
        }
        if let Some(v) = cli.listen_port {
            self.listen_port = v;
        }
        if let Some(v) = &cli.data_dir {
            self.data_dir = v.clone();
        }
        if let Some(v) = &cli.config_dir {
            self.config_dir = v.clone();
        }
        if let Some(v) = &cli.log_level {
            self.log_level = v.clone();
        }
        if let Some(v) = &cli.acp_cmd {
            // 空格拆分 argv（验收路径无空格；含空格路径请走 config.toml 数组）。
            self.acp_cmd = v.split_whitespace().map(ToOwned::to_owned).collect();
        }
    }
}
