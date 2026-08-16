//! peri-studio-server 二进制：CLI + 装配（Feature F2，架构 §16 配置优先级）。
//!
//! ```
//! peri-studio-server [run] [--listen <addr>] [--listen-port <port>] [--config <path>]
//!                [--data-dir <dir>] [--config-dir <dir>] [--log-level <lvl>] [--json-log]
//! peri-studio-server token list
//! peri-studio-server token generate --name <name> [--role instance|full|read-only]
//! peri-studio-server token revoke <token_id>
//! peri-studio-server status [--ready] [--json]
//! ```
//!
//! `run` 为默认子命令（常驻进程主形态）；`token` 子命令组管理凭据（直写
//! `<config_dir>/tokens.toml`，0600）。

use std::io::{IsTerminal as _, Read as _, Write as _};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use clap::{Args, FromArgMatches, Parser, Subcommand};

use peri_studio_server::auth::audit::audit;
use peri_studio_server::auth::{AuthService, TokenRole, TokenStore, TOKENS_FILE};
use peri_studio_server::config::{self, CliOverrides, Config};
use peri_studio_server::persist::{PersistConfig, Store};
use peri_studio_server::web::HealthSnapshot;

const STATUS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const MAX_STATUS_RESPONSE: u64 = 32 * 1024;

#[derive(Parser)]
#[command(
    name = "peri-studio-server",
    about = "peri-studio 中心控制面（认证、控制面、ACPChannel、聚合器、DocManager）",
    version,
    subcommand_required = false
)]
struct Cli {
    /// 配置文件路径（覆盖默认 ~/.config/peri-studio/config.toml；仅 CLI 提供，无 env）
    #[arg(long)]
    config: Option<PathBuf>,
    /// JSON 格式日志（默认人类可读）
    #[arg(long)]
    json_log: bool,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// 启动服务（默认子命令）
    Run(CliOverrides),
    /// token 凭据管理（直写 <config_dir>/tokens.toml）
    #[command(subcommand)]
    Token(TokenArgs),
    /// 查询本机 server 存活/就绪状态（无需 token）
    Status(StatusArgs),
}

#[derive(Debug, Args)]
struct StatusArgs {
    #[command(flatten)]
    overrides: CliOverrides,
    /// 要求 ready=true；degraded/restarting 时返回非零
    #[arg(long)]
    ready: bool,
    /// 输出稳定 JSON；默认输出单行人类可读状态
    #[arg(long)]
    json: bool,
}

#[derive(Subcommand)]
enum TokenArgs {
    /// 列出全部 token（视图对象，无 token 本体，§9.2.1）
    List,
    /// 生成新 token（完整 token 仅 stdout 打印一次；审计只含 token_id）
    Generate {
        /// token 名称（instance：hostname；client：运维命名）
        #[arg(long)]
        name: String,
        /// 角色：instance|full|read-only（默认 full）
        #[arg(long, default_value = "full")]
        role: TokenRole,
        /// 将完整 token 安全写入一个必须不存在的 0600 文件，不打印凭据
        #[arg(long)]
        output_file: Option<PathBuf>,
    },
    /// 吊销 token（即刻生效）
    Revoke {
        /// token_id
        token_id: String,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let Cli {
        config,
        json_log,
        command,
    } = cli;
    match command {
        None => run(config, json_log),
        Some(Command::Run(overrides)) => run_with(config, json_log, overrides),
        Some(Command::Token(args)) => token_command(config, json_log, args),
        Some(Command::Status(args)) => status_command(config, args),
    }
}

fn status_command(config: Option<PathBuf>, args: StatusArgs) -> anyhow::Result<()> {
    let cfg = Config::load(&args.overrides, config.as_deref())?;
    let addr = status_target(&cfg)?;
    let health = query_health(addr)?;
    if args.json {
        println!("{}", serde_json::to_string(&health)?);
    } else {
        println!(
            "{} ready={} protocol={} server={}",
            health.status.as_str(),
            health.ready,
            health.protocol_version,
            health.server_version
        );
    }
    if args.ready && !health.ready {
        anyhow::bail!(
            "peri-studio-server is live but not ready ({})",
            health.status.as_str()
        );
    }
    Ok(())
}

fn status_target(cfg: &Config) -> anyhow::Result<SocketAddr> {
    let ip = match cfg.listen_addr {
        IpAddr::V4(ip) if ip.is_loopback() => IpAddr::V4(ip),
        IpAddr::V6(ip) if ip.is_loopback() => IpAddr::V6(ip),
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        other => anyhow::bail!(
            "status probe is local-only; configured listen address {other} is not loopback"
        ),
    };
    Ok(SocketAddr::new(ip, cfg.listen_port))
}

fn query_health(addr: SocketAddr) -> anyhow::Result<HealthSnapshot> {
    let mut stream = TcpStream::connect_timeout(&addr, STATUS_TIMEOUT)
        .map_err(|error| anyhow::anyhow!("cannot connect to peri-studio-server at {addr}: {error}"))?;
    stream.set_read_timeout(Some(STATUS_TIMEOUT))?;
    stream.set_write_timeout(Some(STATUS_TIMEOUT))?;
    let host = match addr.ip() {
        IpAddr::V4(ip) => format!("{ip}:{}", addr.port()),
        IpAddr::V6(ip) => format!("[{ip}]:{}", addr.port()),
    };
    write!(
        stream,
        "GET /api/health HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    )?;
    stream.flush()?;
    let mut bytes = Vec::new();
    (&mut stream)
        .take(MAX_STATUS_RESPONSE + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_STATUS_RESPONSE {
        anyhow::bail!("health response exceeds {MAX_STATUS_RESPONSE} bytes");
    }
    parse_health_response(&bytes)
}

fn parse_health_response(bytes: &[u8]) -> anyhow::Result<HealthSnapshot> {
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| anyhow::anyhow!("malformed health response"))?;
    let head = std::str::from_utf8(&bytes[..split])?;
    let mut lines = head.split("\r\n");
    if lines.next() != Some("HTTP/1.1 200 OK") {
        anyhow::bail!("health endpoint returned a non-200 response");
    }
    let mut content_length = None;
    let mut content_type_ok = false;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            anyhow::bail!("malformed health response header");
        };
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                anyhow::bail!("duplicate health content-length");
            }
            content_length = Some(value.trim().parse::<usize>()?);
        }
        if name.eq_ignore_ascii_case("content-type") {
            content_type_ok = value
                .trim()
                .split(';')
                .next()
                .is_some_and(|value| value.eq_ignore_ascii_case("application/json"));
        }
    }
    if !content_type_ok {
        anyhow::bail!("health response is not JSON");
    }
    let body = &bytes[split + 4..];
    if content_length != Some(body.len()) {
        anyhow::bail!("health response body length mismatch");
    }
    Ok(serde_json::from_slice(body)?)
}

/// `run`（默认）：加载配置 → 初始化日志 → 目录/token bootstrap → 启动横幅。
///
/// clap `env` 注入只在子命令（`Run(CliOverrides)`）解析路径生效；无子命令
/// 时 `Cli::parse` 不会解析 `CliOverrides`，`default()` 即丢失全部
/// `PERI_STUDIO_*` env 覆盖（E2 根因：目录/端口覆盖静默失效）。此处以空 argv
/// 经 `augment_args` 重新注入 env 后再加载配置。
fn run(config: Option<PathBuf>, json_log: bool) -> anyhow::Result<()> {
    let cmd = <CliOverrides as clap::Args>::augment_args(clap::Command::new("peri-studio-server"));
    let overrides = CliOverrides::from_arg_matches(&cmd.get_matches_from([""]))
        .map_err(|e| anyhow::anyhow!("run 参数解析失败: {e}"))?;
    run_with(config, json_log, overrides)
}

fn run_with(
    config: Option<PathBuf>,
    json_log: bool,
    overrides: CliOverrides,
) -> anyhow::Result<()> {
    let cfg = Config::load(&overrides, config.as_deref())?;
    config::init_tracing(&cfg.log_level, json_log)?;
    cfg.ensure_dirs()?;

    // 启动 bootstrap（§3.3/§4.3.4）：无未吊销 instance token → 自动生成并
    // 打印到 stderr（token 本体只进终端一次，不进日志）。
    let mut token_store = TokenStore::load(&cfg.config_dir.join(TOKENS_FILE))?;
    if let Some(rec) = token_store.ensure_instance_token()? {
        eprintln!(
            "{}",
            bootstrap_token_notice(&cfg.config_dir, &rec.token, std::io::stderr().is_terminal())
        );
        audit(
            "token.generate",
            None,
            Some(&rec.id),
            "ok",
            std::time::Duration::ZERO,
            None,
        );
    }

    let listen = std::net::SocketAddr::new(cfg.listen_addr, cfg.listen_port);
    eprintln!(
        "[peri-studio-server] starting: listening on {listen}, allow_non_loopback={}, data_dir={}",
        cfg.allow_non_loopback,
        cfg.data_dir.display()
    );

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        // 内存 Store（无落盘；`data_dir` 供 metadata.sqlite3 定位，§无状态
        // 投影：yrs docs/outbox 永不持久化，无恢复编排）。
        let persist_cfg = PersistConfig::from(&cfg);
        let store = Arc::new(Store::open(&persist_cfg)?);
        // AuthService（instance 双向 / client 单向认证）。
        let auth = Arc::new(tokio::sync::Mutex::new(AuthService::new(token_store)));
        // 控制面装配（F5：全部组件实例化与接线）。
        let hub = peri_studio_server::control::Hub::assemble(&cfg, store, auth).await?;
        // 优雅关闭信号（SIGINT/SIGTERM，§8.6）。
        let signal = async {
            #[cfg(unix)]
            {
                use tokio::signal::unix::{signal, SignalKind};
                let mut sigint = signal(SignalKind::interrupt()).expect("install SIGINT handler");
                let mut sigterm = signal(SignalKind::terminate()).expect("install SIGTERM handler");
                tokio::select! {
                    _ = sigint.recv() => {}
                    _ = sigterm.recv() => {}
                }
            }
            #[cfg(not(unix))]
            {
                let _ = tokio::signal::ctrl_c().await;
            }
        };
        hub.run_server(&cfg, signal).await
    })
}

fn bootstrap_token_notice(config_dir: &std::path::Path, token: &str, interactive: bool) -> String {
    if interactive {
        format!(
            "[peri-studio-server] 已自动生成 bootstrap instance token（仅本次打印，请妥善保存）:\n{token}"
        )
    } else {
        format!(
            "[peri-studio-server] 已生成 bootstrap instance token；stderr 非交互终端，密钥未写入日志。记录保存在 {}",
            config_dir.join(TOKENS_FILE).display()
        )
    }
}

/// token 子命令：加载配置（定位 config_dir）→ 操作 tokens.toml。
///
/// 目录语义与 `run` 一致：`PERI_STUDIO_CONFIG_DIR`/`PERI_STUDIO_DATA_DIR` env 与
/// `--config-dir` 同样生效（clap env 注入）——避免「run 用临时目录、
/// token 子命令写默认目录」的错位（E2 目录一致性根因）。
fn token_command(config: Option<PathBuf>, json_log: bool, args: TokenArgs) -> anyhow::Result<()> {
    // clap `env` feature 需经 Args 解析才注入（`Default` 不会读 env）；
    // 以空 argv（仅 program name）经 augment_args 解析拿到全部 env 覆盖。
    let cmd = <CliOverrides as clap::Args>::augment_args(clap::Command::new("peri-studio-server"));
    let overrides = CliOverrides::from_arg_matches(&cmd.get_matches_from([""]))
        .map_err(|e| anyhow::anyhow!("token 子命令参数解析失败: {e}"))?;
    let cfg = Config::load(&overrides, config.as_deref())?;
    config::init_tracing(&cfg.log_level, json_log)?;
    cfg.ensure_dirs()?;

    let mut store = TokenStore::load(&cfg.config_dir.join(TOKENS_FILE))?;
    match args {
        TokenArgs::List => {
            for info in store.list() {
                println!("{info}");
            }
        }
        TokenArgs::Generate {
            name,
            role,
            output_file,
        } => {
            let start = Instant::now();
            let rec = if let Some(path) = output_file.as_deref() {
                let rec = store.generate_to_file(role, &name, path)?;
                println!("created {} at {}", rec.id, path.display());
                rec
            } else {
                let rec = store.generate(role, &name)?;
                // 完整 token 仅 stdout 打印一次（供复制到 instance/TUI 配置）。
                println!("{}", rec.token);
                rec
            };
            audit(
                "token.generate",
                None,
                Some(&rec.id),
                "ok",
                start.elapsed(),
                None,
            );
        }
        TokenArgs::Revoke { token_id } => {
            let start = Instant::now();
            match store.revoke(&token_id)? {
                Some(rec) => {
                    println!("revoked {}", rec.id);
                    audit(
                        "token.revoke",
                        None,
                        Some(&rec.id),
                        "ok",
                        start.elapsed(),
                        None,
                    );
                }
                None => {
                    eprintln!("[peri-studio-server] token {token_id} 不存在或已吊销（幂等）");
                    audit(
                        "token.revoke",
                        None,
                        Some(&token_id),
                        "not_found",
                        start.elapsed(),
                        None,
                    );
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_cli_parses_readiness_json_and_config_overrides() {
        let cli = Cli::try_parse_from([
            "peri-studio-server",
            "status",
            "--ready",
            "--json",
            "--listen",
            "127.0.0.1",
            "--listen-port",
            "9123",
        ])
        .unwrap();
        let Some(Command::Status(args)) = cli.command else {
            panic!("expected status command");
        };
        assert!(args.ready);
        assert!(args.json);
        assert_eq!(args.overrides.listen_addr, Some(Ipv4Addr::LOCALHOST.into()));
        assert_eq!(args.overrides.listen_port, Some(9123));
    }

    #[test]
    fn health_response_parser_requires_exact_bounded_http_json_contract() {
        let body =
            r#"{"status":"healthy","ready":true,"protocolVersion":1,"serverVersion":"0.2.0"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let parsed = parse_health_response(response.as_bytes()).unwrap();
        assert!(parsed.ready);
        assert_eq!(parsed.status.as_str(), "healthy");
        assert_eq!(parsed.protocol_version, 1);

        let wrong_length = response.replace(
            &format!("Content-Length: {}", body.len()),
            "Content-Length: 1",
        );
        assert!(parse_health_response(wrong_length.as_bytes())
            .unwrap_err()
            .to_string()
            .contains("length mismatch"));
        assert!(
            parse_health_response(b"HTTP/1.1 503 Service Unavailable\r\n\r\n")
                .unwrap_err()
                .to_string()
                .contains("non-200")
        );
    }

    #[test]
    fn status_target_is_local_only_and_normalizes_unspecified_bind() {
        let mut cfg = Config::defaults();
        cfg.listen_port = 9123;
        cfg.listen_addr = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
        assert_eq!(
            status_target(&cfg).unwrap(),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 9123)
        );
        cfg.listen_addr = "192.0.2.10".parse().unwrap();
        assert!(status_target(&cfg)
            .unwrap_err()
            .to_string()
            .contains("local-only"));
    }
}

#[cfg(test)]
mod bootstrap_notice_tests {
    use super::bootstrap_token_notice;

    #[test]
    fn redirected_bootstrap_notice_never_contains_the_token() {
        let secret = "bootstrap-secret-must-not-reach-logs";
        let notice = bootstrap_token_notice(std::path::Path::new("/tmp/peri studio"), secret, false);

        assert!(!notice.contains(secret));
        assert!(notice.contains("/tmp/peri studio/tokens.toml"));
        assert!(notice.contains("密钥未写入日志"));
    }

    #[test]
    fn interactive_bootstrap_notice_keeps_the_one_time_recovery_path() {
        let secret = "terminal-only-bootstrap-secret";
        let notice = bootstrap_token_notice(std::path::Path::new("/unused"), secret, true);

        assert!(notice.contains(secret));
        assert!(notice.contains("仅本次打印"));
    }
}
