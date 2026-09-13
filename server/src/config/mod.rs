//! 配置模块（Feature F2）：§16 全表配置项的加载管线与目录/权限/日志初始化。
//!
//! 加载管线（架构 §16 优先级）：
//! 默认值表 → 配置文件（`~/.config/peri-studio/config.toml`，存在才读，未知键
//! 启动失败）→ 环境变量（clap `env` feature 注入，仅 CLI 暴露的标量集）→
//! CLI 显式参数，逐层 `Option::or` 合并。加载后校验不变量（fail-fast）。

pub mod duration;

use std::collections::BTreeSet;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::Args;
use thiserror::Error;
use tracing_subscriber::EnvFilter;

use peri_studio_proto::protocol::Defaults;

/// 默认监听端口（§16）。
pub const DEFAULT_LISTEN_PORT: u16 = 8456;

/// 默认 ACP 启动命令（架构 §11「默认 `peri acp`，可配置」）。
pub const DEFAULT_ACP_CMD: [&str; 2] = ["peri", "acp"];

/// spawn.env 白名单基集（§9.6「如 PATH/HOME/LANG 示例」；`spawn_env_allowlist`
/// 是**增补**集合，键名匹配大小写敏感）。与 instance 侧基集
/// （`instance/src/hub.rs` `ENV_BASE_ALLOWLIST`）保持**双端一致**
/// （§9.6 双端校验对称，SHELL 为 §9.6 基集项）。
pub const ENV_ALLOWLIST_BASE: [&str; 5] = ["PATH", "HOME", "LANG", "SHELL", "PERI_MCP_APPS"];

/// 默认配置文件相对路径（`~/.config/peri-studio/config.toml`，§16）。
pub const CONFIG_FILE_NAME: &str = "config.toml";

/// 可进 Config 的密钥：`Debug` 恒为 `<redacted>`，禁止把真值打进日志。
#[derive(Clone, PartialEq, Eq)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::str::FromStr for SecretString {
    type Err = std::convert::Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self::new(s))
    }
}

impl std::fmt::Debug for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("<redacted>")
    }
}

/// 配置错误（启动期 fail-fast 面）。
#[derive(Debug, Error)]
pub enum ConfigError {
    /// 显式 `--config` 路径不存在。
    #[error("配置文件不存在: {0}")]
    MissingConfig(PathBuf),
    /// 配置文件不可读。
    #[error("配置文件 {path} 不可读: {source}")]
    ReadConfig {
        path: PathBuf,
        source: std::io::Error,
    },
    /// 配置文件解析失败（非法 toml / 类型错误 / 非法时长 / 未知键）。
    #[error("配置文件 {path} 解析失败: {source}")]
    ParseConfig {
        path: PathBuf,
        source: toml::de::Error,
    },
    /// 加载后不变量校验失败（§3.2 验证不变量）。
    #[error("配置不变量校验失败: {0}")]
    Invariant(String),
    /// 目录创建失败。
    #[error("目录创建失败 {path}: {source}")]
    EnsureDir {
        path: PathBuf,
        source: std::io::Error,
    },
    /// tracing 初始化失败（多为重复初始化）。
    #[error("tracing 初始化失败: {0}")]
    Tracing(String),
}

/// `run` 子命令 CLI 覆盖项（clap `Args`；全 `Option`，无 `default_value`）。
///
/// 环境变量回退由 clap `env` feature 注入（`PERI_STUDIO_LISTEN_ADDR` 等），
/// 天然保证 **CLI 显式 > env > 无**（架构 §16 优先级）。
/// 列表/表结构与 Duration 类项仅走配置文件。
#[derive(Debug, Clone, Default, Args)]
pub struct CliOverrides {
    /// 监听地址（覆盖配置文件与默认 127.0.0.1）
    #[arg(
        long = "listen",
        env = "PERI_STUDIO_LISTEN_ADDR",
        help = "Server listen address"
    )]
    pub listen_addr: Option<IpAddr>,
    /// 监听端口（覆盖配置文件与默认 8456）
    #[arg(long, env = "PERI_STUDIO_LISTEN_PORT", help = "Server listen port")]
    pub listen_port: Option<u16>,
    /// 数据目录（覆盖配置文件与 XDG 默认）
    #[arg(long, env = "PERI_STUDIO_DATA_DIR", help = "Runtime data directory")]
    pub data_dir: Option<PathBuf>,
    /// 配置/token 目录（覆盖配置文件与 XDG 默认）
    #[arg(
        long,
        env = "PERI_STUDIO_CONFIG_DIR",
        help = "Configuration and token directory"
    )]
    pub config_dir: Option<PathBuf>,
    /// 日志级别（trace/debug/info/warn/error；覆盖配置文件，RUST_LOG 仍优先）
    #[arg(
        long,
        env = "PERI_STUDIO_LOG_LEVEL",
        help = "Log level when RUST_LOG is unset"
    )]
    pub log_level: Option<String>,
    /// ACP 启动命令（空格拆分 argv；§11 默认 `peri acp`，M1 起可配置——
    /// 无 peri 环境可用 test-child 等替身充当 ACP 进程做验收）
    #[arg(
        long,
        env = "PERI_STUDIO_ACP_CMD",
        help = "ACP command and arguments, split on spaces"
    )]
    pub acp_cmd: Option<String>,
    /// Realtime voice upstream base URL (http(s) or ws(s))
    #[arg(
        long = "realtime-voice-base-url",
        env = "PERI_REALTIME_VOICE_BASE_URL",
        help = "Realtime voice base URL"
    )]
    pub realtime_voice_base_url: Option<String>,
    /// Realtime voice API key (Bearer). Never logged.
    #[arg(
        long = "realtime-voice-api-key",
        env = "PERI_REALTIME_VOICE_API_KEY",
        hide_env_values = true,
        help = "Realtime voice API key"
    )]
    pub realtime_voice_api_key: Option<SecretString>,
}

/// §16 全表项。字段一律 snake_case（配置文件为内部格式，非线协议，不强制
/// camelCase）。默认值表见 [`Config::defaults`]。
#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    // ---- 网络（§16）----
    /// 监听地址，默认 127.0.0.1（M1 本机；M2 显式改 0.0.0.0）。
    pub listen_addr: IpAddr,
    /// 监听端口，默认 8456。
    pub listen_port: u16,
    // ---- 目录（§16）----
    /// 数据目录，默认 `~/.local/share/peri-studio/`（XDG 语义，§3.5）。
    pub data_dir: PathBuf,
    /// 配置/token 目录，默认 `~/.config/peri-studio/`（XDG 语义，§3.5）。
    pub config_dir: PathBuf,
    // ---- 协议参数（默认值引自 proto::Defaults，server 可覆盖）----
    /// 心跳间隔（§16/§7.1，默认 5s）。
    pub heartbeat_interval: Duration,
    /// 离线判定超时（§16/§7.1，默认 30s）。
    pub offline_timeout: Duration,
    /// 缓冲上限（内存+磁盘合计，§16/§8.5，默认 10MB）。
    pub buffer_limit_bytes: usize,
    /// 缓冲上限（条数，§16/§8.5，默认万条）。
    pub buffer_limit_frames: usize,
    /// 单帧大小上限（§16/§8.5，默认 1MB）。
    pub max_frame_bytes: usize,
    /// 缓冲环形滑窗（§16/§8.5，默认 500 条）。
    pub ring_buffer_capacity: usize,
    // ---- server 运维配置（§16 其余项）----
    /// 命令队列上限（§16/§7.4，默认 64）。
    pub command_queue_cap: usize,
    /// 连接配额（§16/§8.6，默认 200）。
    pub connection_quota: usize,
    /// 发送背压软阈值（§16/§8.6，默认 64KB）。
    pub backpressure_soft_bytes: usize,
    /// 发送背压硬阈值（§16/§8.6，默认 128KB；校验 soft <= hard）。
    pub backpressure_hard_bytes: usize,
    /// 微批次窗口（§16/§6.4，默认 16ms）。
    pub microbatch_window: Duration,
    /// 回放窗口（§16/§8.6，默认 10s）。
    pub replay_window: Duration,
    /// 权限请求超时（§16/§7.1，默认 5min）。
    pub permission_timeout: Duration,
    /// 取消超时（§16/§7.1，默认 10s）。
    pub cancel_timeout: Duration,
    /// spawn 超时（§16/§6.2，默认 10s）。
    pub spawn_timeout: Duration,
    /// initialize 超时（§16/§6.2，默认 10s）。
    pub initialize_timeout: Duration,
    /// binding 超时（§16/§6.2，默认 30s）。
    pub binding_timeout: Duration,
    /// spawn env 白名单增补集（§16/§9.6，默认空 = 仅继承基集）。
    pub spawn_env_allowlist: BTreeSet<String>,
    /// 非回环监听开关（§16/§9.5，默认 false——显式声明才接受非回环连接）。
    pub allow_non_loopback: bool,
    /// ACP 启动命令（§11「默认 `peri acp`，可配置」：config.toml `acp_cmd`
    /// 数组或 `PERI_STUDIO_ACP_CMD` 空格拆分；验收可用 test-child 替身）。
    pub acp_cmd: Vec<String>,
    // ---- 日志（非 §16 表项，server 本地默认）----
    /// 日志级别，默认 "info"。
    pub log_level: String,
    /// 实时语音上游 base URL（环境变量 `PERI_REALTIME_VOICE_BASE_URL`）。
    pub realtime_voice_base_url: Option<String>,
    /// 实时语音 API key（环境变量 `PERI_REALTIME_VOICE_API_KEY`，不得入日志）。
    pub realtime_voice_api_key: Option<SecretString>,
}

impl Config {
    /// §16 默认值表（协议参数引用 [`Defaults`]；目录按 XDG 语义解析）。
    pub fn defaults() -> Self {
        Config {
            listen_addr: IpAddr::V4(Ipv4Addr::LOCALHOST),
            listen_port: DEFAULT_LISTEN_PORT,
            data_dir: default_data_dir(),
            config_dir: default_config_dir(),
            heartbeat_interval: Defaults::HEARTBEAT_INTERVAL,
            offline_timeout: Defaults::OFFLINE_TIMEOUT,
            buffer_limit_bytes: Defaults::BUFFER_LIMIT_BYTES,
            buffer_limit_frames: Defaults::BUFFER_LIMIT_FRAMES,
            max_frame_bytes: Defaults::MAX_FRAME_BYTES,
            ring_buffer_capacity: Defaults::RING_BUFFER_CAPACITY,
            command_queue_cap: 64,
            connection_quota: 200,
            backpressure_soft_bytes: 64 * 1024,
            backpressure_hard_bytes: 128 * 1024,
            microbatch_window: Duration::from_millis(16),
            replay_window: Duration::from_secs(10),
            permission_timeout: Duration::from_secs(5 * 60),
            cancel_timeout: Duration::from_secs(10),
            spawn_timeout: Duration::from_secs(10),
            initialize_timeout: Duration::from_secs(10),
            binding_timeout: Duration::from_secs(30),
            spawn_env_allowlist: BTreeSet::new(),
            allow_non_loopback: false,
            acp_cmd: DEFAULT_ACP_CMD.iter().map(|s| s.to_string()).collect(),
            log_level: "info".to_string(),
            realtime_voice_base_url: None,
            realtime_voice_api_key: None,
        }
    }

    pub fn realtime_voice_enabled(&self) -> bool {
        self.realtime_voice_base_url
            .as_deref()
            .is_some_and(|url| !url.trim().is_empty())
    }

    pub fn realtime_voice_client_config(&self) -> Option<peri_realtime_voice::VoiceConfig> {
        let url = self.realtime_voice_base_url.as_deref()?.trim();
        if url.is_empty() {
            return None;
        }
        let mut config = peri_realtime_voice::VoiceConfig::new().with_url(url);
        if let Some(key) = self
            .realtime_voice_api_key
            .as_ref()
            .map(|key| key.as_str().trim())
            .filter(|key| !key.is_empty())
        {
            config = config.with_token(key);
        }
        Some(config)
    }

    /// 加载管线：默认 < 配置文件 < env（clap 注入的 `CliOverrides` 值）< CLI 显式。
    ///
    /// `config_file` 为显式 `--config` 路径（不存在 → 错误）；`None` 时读
    /// 默认 `<config_dir>/config.toml`（存在才读；config_dir 先应用 CLI 覆盖
    /// ——`--config-dir` 重定向后从新目录找配置文件）。加载后校验不变量。
    pub fn load(cli: &CliOverrides, config_file: Option<&Path>) -> Result<Config, ConfigError> {
        let mut cfg = Config::defaults();
        if let Some(v) = &cli.config_dir {
            cfg.config_dir = v.clone();
        }
        let file = match config_file {
            Some(p) => Some(load_file(p)?),
            None => {
                let p = cfg.config_dir.join(CONFIG_FILE_NAME);
                if p.exists() {
                    Some(load_file(&p)?)
                } else {
                    None
                }
            }
        };
        if let Some(f) = &file {
            cfg.merge_file(f);
        }
        cfg.merge_cli(cli);
        cfg.validate()?;
        Ok(cfg)
    }

    /// §9.5 非回环拒绝：回环地址恒放行；非回环仅在 `allow_non_loopback` 为真时放行。
    pub fn allow_peer(&self, peer: &SocketAddr) -> bool {
        peer.ip().is_loopback() || self.allow_non_loopback
    }

    /// §9.6 env 白名单：键在基集（PATH/HOME/LANG）内或增补 allowlist 内才允许。
    ///
    /// 键名匹配大小写敏感。
    pub fn is_env_key_allowed(&self, key: &str) -> bool {
        ENV_ALLOWLIST_BASE.contains(&key) || self.spawn_env_allowlist.contains(key)
    }

    /// 创建数据/配置目录（权限 0700，仅新建时收紧——已存在目录不强制改权限，
    /// §3.5【决策】）。秘密文件（tokens.toml）的 0600 由 auth 模块写入时保证。
    pub fn ensure_dirs(&self) -> Result<(), ConfigError> {
        ensure_dir_0700(&self.data_dir)?;
        ensure_dir_0700(&self.config_dir)?;
        Ok(())
    }

    /// 加载后不变量（§3.2 第 3 点）：backpressure soft<=hard、connection_quota>0、
    /// 端口非 0、超时组全部 > 0、目录非空。违反 → 启动错误（fail-fast）。
    fn validate(&self) -> Result<(), ConfigError> {
        if self.backpressure_soft_bytes > self.backpressure_hard_bytes {
            return Err(ConfigError::Invariant(format!(
                "backpressure_soft_bytes ({}) 必须 <= backpressure_hard_bytes ({})",
                self.backpressure_soft_bytes, self.backpressure_hard_bytes
            )));
        }
        if self.connection_quota == 0 {
            return Err(ConfigError::Invariant(
                "connection_quota 必须 > 0".to_string(),
            ));
        }
        if self.listen_port == 0 {
            return Err(ConfigError::Invariant("listen_port 必须非 0".to_string()));
        }
        for (name, d) in [
            ("heartbeat_interval", self.heartbeat_interval),
            ("offline_timeout", self.offline_timeout),
            ("microbatch_window", self.microbatch_window),
            ("replay_window", self.replay_window),
            ("permission_timeout", self.permission_timeout),
            ("cancel_timeout", self.cancel_timeout),
            ("spawn_timeout", self.spawn_timeout),
            ("initialize_timeout", self.initialize_timeout),
            ("binding_timeout", self.binding_timeout),
        ] {
            if d.is_zero() {
                return Err(ConfigError::Invariant(format!("{name} 必须 > 0")));
            }
        }
        if self.data_dir.as_os_str().is_empty() {
            return Err(ConfigError::Invariant(
                "data_dir 不能为空（无法解析 HOME）".to_string(),
            ));
        }
        if self.config_dir.as_os_str().is_empty() {
            return Err(ConfigError::Invariant(
                "config_dir 不能为空（无法解析 HOME）".to_string(),
            ));
        }
        if self.acp_cmd.is_empty() {
            return Err(ConfigError::Invariant(
                "acp_cmd 不能为空（至少一个可执行项）".to_string(),
            ));
        }
        Ok(())
    }
}

/// 配置文件形态与逐层合并（`file.rs`）。
mod file;
use file::load_file;

/// XDG 语义数据目录（§3.5【决策】）：`XDG_DATA_HOME` 优先，否则
/// `$HOME/.local/share/peri-studio`。
pub fn default_data_dir() -> PathBuf {
    if let Some(x) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(x).join("peri-studio");
    }
    dirs_next::home_dir()
        .map(|h| h.join(".local").join("share").join("peri-studio"))
        .unwrap_or_default()
}

/// XDG 语义配置目录（§3.5【决策】）：`XDG_CONFIG_HOME` 优先，否则
/// `$HOME/.config/peri-studio`。
pub fn default_config_dir() -> PathBuf {
    if let Some(x) = std::env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(x).join("peri-studio");
    }
    dirs_next::home_dir()
        .map(|h| h.join(".config").join("peri-studio"))
        .unwrap_or_default()
}

/// 目录 0700（§3.5【决策】：「0600」按「仅属主可访问」语义落地——目录 0700、
/// 秘密文件严格 0600）。已存在目录不强制改权限，仅新建时收紧。
fn ensure_dir_0700(path: &Path) -> Result<(), ConfigError> {
    if path.exists() {
        return Ok(());
    }
    fs::create_dir_all(path).map_err(|source| ConfigError::EnsureDir {
        path: path.to_path_buf(),
        source,
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|source| {
            ConfigError::EnsureDir {
                path: path.to_path_buf(),
                source,
            }
        })?;
    }
    Ok(())
}

/// 初始化 tracing。
///
/// 优先级：`RUST_LOG` env（`EnvFilter::try_from_default_env`）> CLI `--log-level`
/// （已合并进 `cfg.log_level`）> 配置 `log_level` > `info`。输出到 stderr，
/// fmt 或 json 形态与 instance/main.rs 一致。`try_init` 防测试双初始化。
///
/// 脱敏纪律（§9.3）：tracing 字段只记关联 ID/状态/耗时/大小，token/正文/
/// 参数永不落日志（见 auth/audit.rs 与测试断言）。
pub fn init_tracing(log_level: &str, json_log: bool) -> Result<(), ConfigError> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("peri_studio={log_level}")));
    let result = if json_log {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .with_target(true)
            .with_writer(std::io::stderr)
            .try_init()
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(false)
            .with_writer(std::io::stderr)
            .try_init()
    };
    result.map_err(|e| ConfigError::Tracing(e.to_string()))
}

#[cfg(test)]
#[path = "config_test.rs"]
mod config_test;
