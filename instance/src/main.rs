//! peri-instance —— instance daemon（F6，docs/architecture.md §3.2/§12）
//!
//! 每台机器一个 daemon：outbound ws 连 server（`/instance`），收 spawn/kill
//! 指令、管理 ACP 进程树、透明转发 + 断线缓冲（§4.5/§8.5）。
//!
//! 配置优先级：CLI > 环境变量 > 默认值（§9）。不引入配置文件（Cargo.toml 无
//! toml 依赖，M1 instance 侧最小面【决策】，f6-instance.md §9）。

use std::path::PathBuf;

use anyhow::Context;
use clap::Parser;
use tracing_subscriber::EnvFilter;

/// 默认 server 地址（§9【决策】：路径 `/instance` 便于 server 侧路由）。
const DEFAULT_SERVER_URL: &str = "ws://127.0.0.1:8456/instance";

/// 默认数据目录：`~/.local/share/peri-studio/instance/`（§10/§16 语义）。
fn default_data_dir() -> PathBuf {
    dirs_next::home_dir()
        .map(|h| {
            h.join(".local")
                .join("share")
                .join("peri-studio")
                .join("instance")
        })
        .unwrap_or_else(|| PathBuf::from("."))
}

#[derive(Parser)]
#[command(
    name = "peri-instance",
    about = "peri-studio instance daemon: outbound connect to server, manage ACP process tree, transparent forwarding + offline buffering",
    version
)]
struct Cli {
    /// server ws address (e.g. ws://127.0.0.1:8456/instance)
    #[arg(long, env = "PERI_STUDIO_SERVER_URL")]
    server_url: Option<String>,

    /// path to the instance token file (required; 44-char base64, 0600)
    #[arg(long, env = "PERI_STUDIO_TOKEN_FILE")]
    token_file: Option<PathBuf>,

    /// data directory (watermark/buffer)
    #[arg(long)]
    data_dir: Option<PathBuf>,

    /// log level (trace/debug/info/warn/error)
    #[arg(long, default_value = "info")]
    log_level: String,

    /// JSON-formatted logs (default human-readable)
    #[arg(long)]
    json_log: bool,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // 日志初始化（输出到 stderr，target 统一 peri_studio::instance）。
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("peri_studio::instance={}", cli.log_level)));
    if cli.json_log {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(env_filter)
            .with_target(true)
            .with_writer(std::io::stderr)
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(false)
            .with_writer(std::io::stderr)
            .init();
    }

    // 配置（CLI > env（clap env 特性）> 默认）。
    let server_url = cli
        .server_url
        .unwrap_or_else(|| DEFAULT_SERVER_URL.to_string());
    let token_file = cli
        .token_file
        .context("missing --token-file (or env PERI_STUDIO_TOKEN_FILE)")?;
    let token = std::fs::read_to_string(&token_file)
        .with_context(|| format!("failed to read token file: {}", token_file.display()))?
        .trim()
        .to_string();
    let data_dir = cli.data_dir.unwrap_or_else(default_data_dir);

    let config = peri_instance::hub::InstanceConfig::new(server_url, token, data_dir);

    tracing::info!(target: "peri_studio::instance", data_dir = %config.data_dir.display(),
        "peri-instance starting");

    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()?;
    rt.block_on(peri_instance::hub::run(config))?;
    Ok(())
}
