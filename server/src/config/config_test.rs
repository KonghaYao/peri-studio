//! config 模块测试（C1–C9）。
//!
//! env 注入类用例用 `serial_test` 防并行污染；目录权限断言仅 unix。

use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::time::Duration;

use serial_test::serial;
use tempfile::tempdir;

use crate::config::duration::{format_duration, parse_duration, DurationParseError};
use crate::config::{
    default_config_dir, default_data_dir, CliOverrides, Config, ConfigError, CONFIG_FILE_NAME,
    ENV_ALLOWLIST_BASE,
};

/// 构造覆盖默认 config/data 目录的 CliOverrides（测试不碰真实 HOME）。
fn cli_with_dirs(home: &std::path::Path) -> CliOverrides {
    CliOverrides {
        config_dir: Some(home.join("config")),
        data_dir: Some(home.join("data")),
        ..Default::default()
    }
}

fn write_config(dir: &std::path::Path, content: &str) -> PathBuf {
    let path = dir.join(CONFIG_FILE_NAME);
    std::fs::write(&path, content).unwrap();
    path
}

// ---------------------------------------------------------------------------
// C1 优先级：默认 < 配置文件 < env（clap 注入结果，以 CliOverrides 字段模拟）
//    < CLI 显式
// ---------------------------------------------------------------------------
#[test]
#[serial]
fn c1_priority_default_file_env_cli() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();

    // 1. 全默认
    let cfg = Config::load(&cli_with_dirs(home.path()), None).unwrap();
    assert_eq!(cfg.listen_addr, IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert_eq!(cfg.listen_port, 8456);
    assert_eq!(cfg.heartbeat_interval, Duration::from_secs(5));
    assert_eq!(cfg.log_level, "info");

    // 2. 配置文件覆盖
    write_config(
        &cfg_dir,
        "listen_port = 9000\nheartbeat_interval = \"7s\"\nlog_level = \"debug\"\n",
    );
    let cfg = Config::load(&cli_with_dirs(home.path()), None).unwrap();
    assert_eq!(cfg.listen_port, 9000);
    assert_eq!(cfg.heartbeat_interval, Duration::from_secs(7));
    assert_eq!(cfg.log_level, "debug");

    // 3. env（模拟 clap env 注入后的 CliOverrides 值）覆盖配置文件
    let cli = CliOverrides {
        listen_port: Some(10001),
        log_level: Some("warn".to_string()),
        ..cli_with_dirs(home.path())
    };
    let cfg = Config::load(&cli, None).unwrap();
    assert_eq!(cfg.listen_port, 10001);
    assert_eq!(cfg.log_level, "warn");
    // 未覆盖项保持配置文件值
    assert_eq!(cfg.heartbeat_interval, Duration::from_secs(7));

    // 4. CLI 显式覆盖 env
    let cli = CliOverrides {
        listen_port: Some(20002),
        ..cli
    };
    let cfg = Config::load(&cli, None).unwrap();
    assert_eq!(cfg.listen_port, 20002);
}

/// C1 补充：`--config` 显式路径覆盖默认配置文件路径。
#[test]
#[serial]
fn c1_explicit_config_path() {
    let home = tempdir().unwrap();
    let alt_dir = tempdir().unwrap();
    write_config(alt_dir.path(), "listen_port = 7777\n");
    let cli = cli_with_dirs(home.path());
    let cfg = Config::load(&cli, Some(&alt_dir.path().join(CONFIG_FILE_NAME))).unwrap();
    assert_eq!(cfg.listen_port, 7777);
}

/// C1 补充：显式 `--config` 指向不存在的文件 → 启动错误。
#[test]
#[serial]
fn c1_explicit_config_missing() {
    let home = tempdir().unwrap();
    let cli = cli_with_dirs(home.path());
    let err = Config::load(
        &cli,
        Some(PathBuf::from("/nonexistent/config.toml").as_path()),
    )
    .unwrap_err();
    assert!(matches!(err, ConfigError::MissingConfig(_)));
}

// ---------------------------------------------------------------------------
// C2 toml 全表：§16 全项 round-trip；缺省文件 → 全默认；空文件 → 全默认
// ---------------------------------------------------------------------------
#[test]
#[serial]
fn c2_toml_full_table_roundtrip() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();

    let content = r#"
listen_addr = "0.0.0.0"
listen_port = 9999
data_dir = "/tmp/data"
config_dir = "/tmp/config"
heartbeat_interval = "5s"
offline_timeout = "30s"
buffer_limit_bytes = 10485760
buffer_limit_frames = 10000
max_frame_bytes = 1048576
ring_buffer_capacity = 500
command_queue_cap = 64
connection_quota = 200
backpressure_soft_bytes = 65536
backpressure_hard_bytes = 131072
microbatch_window = "16ms"
replay_window = "10s"
permission_timeout = "5m"
cancel_timeout = "10s"
spawn_timeout = "10s"
initialize_timeout = "10s"
binding_timeout = "30s"
spawn_env_allowlist = ["PERI_MODEL", "PERI_TMP"]
allow_non_loopback = true
log_level = "debug"
"#;
    write_config(&cfg_dir, content);
    // 仅覆盖 config_dir（定位配置文件）；data_dir 不设，使配置文件值生效。
    let cli = CliOverrides {
        config_dir: Some(cfg_dir.clone()),
        ..Default::default()
    };
    let cfg = Config::load(&cli, None).unwrap();

    assert_eq!(cfg.listen_addr, IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    assert_eq!(cfg.listen_port, 9999);
    assert_eq!(
        cfg.data_dir,
        PathBuf::from("/tmp/data"),
        "CLI 未覆盖 → 文件生效"
    );
    assert_eq!(
        cfg.config_dir,
        home.path().join("config"),
        "config_dir 被 CLI 覆盖（用于定位配置文件），CLI > 文件"
    );
    assert_eq!(cfg.heartbeat_interval, Duration::from_secs(5));
    assert_eq!(cfg.offline_timeout, Duration::from_secs(30));
    assert_eq!(cfg.buffer_limit_bytes, 10 * 1024 * 1024);
    assert_eq!(cfg.buffer_limit_frames, 10_000);
    assert_eq!(cfg.max_frame_bytes, 1024 * 1024);
    assert_eq!(cfg.ring_buffer_capacity, 500);
    assert_eq!(cfg.command_queue_cap, 64);
    assert_eq!(cfg.connection_quota, 200);
    assert_eq!(cfg.backpressure_soft_bytes, 64 * 1024);
    assert_eq!(cfg.backpressure_hard_bytes, 128 * 1024);
    assert_eq!(cfg.microbatch_window, Duration::from_millis(16));
    assert_eq!(cfg.replay_window, Duration::from_secs(10));
    assert_eq!(cfg.permission_timeout, Duration::from_secs(5 * 60));
    assert_eq!(cfg.cancel_timeout, Duration::from_secs(10));
    assert_eq!(cfg.spawn_timeout, Duration::from_secs(10));
    assert_eq!(cfg.initialize_timeout, Duration::from_secs(10));
    assert_eq!(cfg.binding_timeout, Duration::from_secs(30));
    assert_eq!(
        cfg.spawn_env_allowlist,
        BTreeSet::from(["PERI_MODEL".to_string(), "PERI_TMP".to_string()])
    );
    assert!(cfg.allow_non_loopback);
    assert_eq!(cfg.log_level, "debug");
}

/// C2：缺失配置文件 → 全默认。
#[test]
#[serial]
fn c2_missing_file_defaults() {
    let home = tempdir().unwrap();
    let cfg = Config::load(&cli_with_dirs(home.path()), None).unwrap();
    assert_eq!(cfg.listen_port, 8456);
    assert!(!cfg.allow_non_loopback);
    assert!(cfg.spawn_env_allowlist.is_empty());
}

/// C2：空文件 → 全默认。
#[test]
#[serial]
fn c2_empty_file_defaults() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();
    write_config(&cfg_dir, "");
    let cfg = Config::load(&cli_with_dirs(home.path()), None).unwrap();
    assert_eq!(cfg.listen_port, 8456);
    assert_eq!(cfg.heartbeat_interval, Duration::from_secs(5));
}

// ---------------------------------------------------------------------------
// C3 未知键 → 启动失败，错误信息含键名
// ---------------------------------------------------------------------------
#[test]
#[serial]
fn c3_unknown_key_fails() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();
    write_config(&cfg_dir, "foo = 1\n");
    let err = Config::load(&cli_with_dirs(home.path()), None).unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("foo"), "错误信息应包含未知键名: {msg}");
}

// ---------------------------------------------------------------------------
// C4 坏输入
// ---------------------------------------------------------------------------
#[test]
#[serial]
fn c4_bad_toml() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();
    write_config(&cfg_dir, "not toml {{{");
    let err = Config::load(&cli_with_dirs(home.path()), None).unwrap_err();
    assert!(matches!(err, ConfigError::ParseConfig { .. }));
}

#[test]
#[serial]
fn c4_type_error() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();
    write_config(&cfg_dir, "listen_port = \"abc\"\n");
    let err = Config::load(&cli_with_dirs(home.path()), None).unwrap_err();
    assert!(matches!(err, ConfigError::ParseConfig { .. }));
}

#[test]
#[serial]
fn c4_bad_duration_string() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();
    write_config(&cfg_dir, "heartbeat_interval = \"abc\"\n");
    let err = Config::load(&cli_with_dirs(home.path()), None).unwrap_err();
    assert!(matches!(err, ConfigError::ParseConfig { .. }));
}

// ---------------------------------------------------------------------------
// C5 时长解析矩阵
// ---------------------------------------------------------------------------
#[test]
fn c5_duration_parse_matrix() {
    assert_eq!(parse_duration("500ms").unwrap(), Duration::from_millis(500));
    assert_eq!(parse_duration("5s").unwrap(), Duration::from_secs(5));
    assert_eq!(parse_duration("16ms").unwrap(), Duration::from_millis(16));
    assert_eq!(
        parse_duration("24h").unwrap(),
        Duration::from_secs(24 * 3600)
    );
    assert_eq!(
        parse_duration("90d").unwrap(),
        Duration::from_secs(90 * 86_400)
    );
    assert_eq!(parse_duration("1ns").unwrap(), Duration::from_nanos(1));
    assert_eq!(parse_duration("1us").unwrap(), Duration::from_micros(1));
    assert_eq!(parse_duration("1m").unwrap(), Duration::from_secs(60));
    assert_eq!(
        parse_duration(" 5s ").unwrap(),
        Duration::from_secs(5),
        "允许首尾空白"
    );
}

#[test]
fn c5_duration_parse_errors() {
    for bad in [
        "5x", "abc", "", "5", "-5s", "5.5s", "s", "1d2h", "1 0s", "1e3ms",
    ] {
        assert!(
            matches!(parse_duration(bad), Err(DurationParseError::Format(_))),
            "{bad:?} 应报格式错误"
        );
    }
    assert!(matches!(
        parse_duration("99999999999999999999d"),
        Err(DurationParseError::Overflow(_))
    ));
}

#[test]
fn c5_duration_format_roundtrip() {
    for d in [
        Duration::from_nanos(1),
        Duration::from_micros(2),
        Duration::from_millis(16),
        Duration::from_secs(30),
        Duration::from_secs(5 * 60),
        Duration::from_secs(24 * 3600),
        Duration::from_secs(90 * 86_400),
    ] {
        assert_eq!(parse_duration(&format_duration(d)).unwrap(), d);
    }
}

// ---------------------------------------------------------------------------
// C6 权限：目录 0700、tokens.toml 0600（unix）
// ---------------------------------------------------------------------------
#[cfg(unix)]
#[test]
#[serial]
fn c6_dir_and_token_file_permissions() {
    use std::os::unix::fs::PermissionsExt;

    use crate::auth::{TokenRole, TokenStore};

    let home = tempdir().unwrap();
    let cli = cli_with_dirs(home.path());
    let cfg = Config::load(&cli, None).unwrap();
    cfg.ensure_dirs().unwrap();

    let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&cfg.config_dir), 0o700, "config 目录应为 0700");
    assert_eq!(mode(&cfg.data_dir), 0o700, "data 目录应为 0700");

    let mut store = TokenStore::load(&cfg.config_dir.join("tokens.toml")).unwrap();
    store.generate(TokenRole::Instance, "m1").unwrap();
    let token_path = cfg.config_dir.join("tokens.toml");
    assert_eq!(mode(&token_path), 0o600, "tokens.toml 应为 0600");

    // 已存在目录不强制改权限（§3.5）
    let existing = tempdir().unwrap();
    let existing_cfg = Config {
        config_dir: existing.path().to_path_buf(),
        data_dir: existing.path().to_path_buf(),
        ..Config::defaults()
    };
    std::fs::set_permissions(existing.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    existing_cfg.ensure_dirs().unwrap();
    assert_eq!(mode(existing.path()), 0o755, "已存在目录不应被改权限");
}

// ---------------------------------------------------------------------------
// C7 不变量
// ---------------------------------------------------------------------------
#[test]
#[serial]
fn c7_backpressure_invariant() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();
    write_config(
        &cfg_dir,
        "backpressure_soft_bytes = 200\nbackpressure_hard_bytes = 100\n",
    );
    let err = Config::load(&cli_with_dirs(home.path()), None).unwrap_err();
    assert!(
        matches!(err, ConfigError::Invariant(_)),
        "soft > hard 应报不变量错误: {err}"
    );
}

#[test]
#[serial]
fn c7_quota_invariant() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();
    write_config(&cfg_dir, "connection_quota = 0\n");
    let err = Config::load(&cli_with_dirs(home.path()), None).unwrap_err();
    assert!(matches!(err, ConfigError::Invariant(_)));
}

#[test]
#[serial]
fn c7_zero_timeout_invariant() {
    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();
    write_config(&cfg_dir, "heartbeat_interval = \"0s\"\n");
    let err = Config::load(&cli_with_dirs(home.path()), None).unwrap_err();
    assert!(matches!(err, ConfigError::Invariant(_)));
}

// ---------------------------------------------------------------------------
// C8 allow_peer：回环恒放行；非回环默认拒绝；显式开启后放行（含 IPv6）
// ---------------------------------------------------------------------------
#[test]
fn c8_allow_peer() {
    let mut cfg = Config::defaults();
    let loopback_v4 = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 12345);
    let loopback_v6 = SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 12345);
    let lan = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 5)), 12345);

    assert!(cfg.allow_peer(&loopback_v4));
    assert!(cfg.allow_peer(&loopback_v6));
    assert!(!cfg.allow_peer(&lan), "非回环默认拒绝");

    cfg.allow_non_loopback = true;
    assert!(cfg.allow_peer(&lan));
    assert!(cfg.allow_peer(&loopback_v4), "回环恒放行");
}

// ---------------------------------------------------------------------------
// C9 env 白名单：基集恒允许；增补生效；表外拒绝；大小写敏感
// ---------------------------------------------------------------------------
#[test]
fn c9_env_allowlist() {
    let mut cfg = Config::defaults();
    for base in ENV_ALLOWLIST_BASE {
        assert!(cfg.is_env_key_allowed(base), "{base} 应恒允许");
    }
    assert!(!cfg.is_env_key_allowed("PERI_MODEL"), "表外默认拒绝");

    cfg.spawn_env_allowlist.insert("PERI_MODEL".to_string());
    assert!(cfg.is_env_key_allowed("PERI_MODEL"));
    assert!(!cfg.is_env_key_allowed("peri_model"), "大小写敏感");
    assert!(!cfg.is_env_key_allowed("Path"), "基集大小写敏感");
    assert!(!cfg.is_env_key_allowed("PERI_LD_PRELOAD"));
}

// ---------------------------------------------------------------------------
// 目录解析（XDG 语义）
// ---------------------------------------------------------------------------
#[test]
#[serial]
fn xdg_dir_resolution() {
    let home = tempdir().unwrap();
    std::env::set_var("HOME", home.path());
    std::env::remove_var("XDG_CONFIG_HOME");
    std::env::remove_var("XDG_DATA_HOME");
    assert_eq!(
        default_config_dir(),
        home.path().join(".config").join("peri-studio")
    );
    assert_eq!(
        default_data_dir(),
        home.path().join(".local").join("share").join("peri-studio")
    );

    std::env::set_var("XDG_CONFIG_HOME", "/tmp/xdg-config");
    std::env::set_var("XDG_DATA_HOME", "/tmp/xdg-data");
    assert_eq!(
        default_config_dir(),
        PathBuf::from("/tmp/xdg-config/peri-studio")
    );
    assert_eq!(
        default_data_dir(),
        PathBuf::from("/tmp/xdg-data/peri-studio")
    );
}

#[test]
#[serial]
fn realtime_voice_clap_reads_env() {
    use crate::config::SecretString;
    use clap::{Args, Command, FromArgMatches};

    std::env::set_var(
        "PERI_REALTIME_VOICE_BASE_URL",
        "https://from-process-env.example/v1",
    );
    std::env::set_var("PERI_REALTIME_VOICE_API_KEY", "process-env-secret");
    let command = <CliOverrides as Args>::augment_args(Command::new("test"));
    let matches = command.try_get_matches_from(["test"]).unwrap();
    let cli = CliOverrides::from_arg_matches(&matches).unwrap();
    std::env::remove_var("PERI_REALTIME_VOICE_BASE_URL");
    std::env::remove_var("PERI_REALTIME_VOICE_API_KEY");

    let home = tempdir().unwrap();
    let cfg = Config::load(
        &CliOverrides {
            config_dir: Some(home.path().join("config")),
            data_dir: Some(home.path().join("data")),
            realtime_voice_base_url: cli.realtime_voice_base_url,
            realtime_voice_api_key: cli.realtime_voice_api_key,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let voice = cfg.realtime_voice_client_config().expect("voice config");
    assert_eq!(
        voice.endpoint().unwrap(),
        "wss://from-process-env.example/v1"
    );
    assert_eq!(voice.token.as_deref(), Some("process-env-secret"));
    assert_eq!(
        format!("{:?}", SecretString::new("process-env-secret")),
        "<redacted>"
    );
}

#[test]
fn realtime_voice_env_injects_base_url_and_redacts_api_key() {
    use crate::config::SecretString;

    let home = tempdir().unwrap();
    let cli = CliOverrides {
        realtime_voice_base_url: Some("https://voice.example/v1/realtime".into()),
        realtime_voice_api_key: Some(SecretString::new("super-secret")),
        ..cli_with_dirs(home.path())
    };
    let cfg = Config::load(&cli, None).unwrap();
    assert!(cfg.realtime_voice_enabled());
    let voice = cfg.realtime_voice_client_config().expect("voice config");
    assert_eq!(voice.endpoint().unwrap(), "wss://voice.example/v1/realtime");
    assert_eq!(voice.token.as_deref(), Some("super-secret"));
    let leaked = format!("{cfg:?}");
    assert!(
        !leaked.contains("super-secret"),
        "api key must not appear in Debug: {leaked}"
    );
    assert_eq!(
        format!("{:?}", SecretString::new("super-secret")),
        "<redacted>"
    );
}

#[test]
#[serial]
fn realtime_voice_file_then_cli_env() {
    use crate::config::SecretString;

    let home = tempdir().unwrap();
    let cfg_dir = home.path().join("config");
    std::fs::create_dir_all(&cfg_dir).unwrap();
    write_config(
        &cfg_dir,
        r#"
realtime_voice_base_url = "https://from-file.example/v1"
realtime_voice_api_key = "file-secret"
"#,
    );
    let from_file = Config::load(&cli_with_dirs(home.path()), None).unwrap();
    assert_eq!(
        from_file.realtime_voice_base_url.as_deref(),
        Some("https://from-file.example/v1")
    );
    assert_eq!(
        from_file
            .realtime_voice_api_key
            .as_ref()
            .map(SecretString::as_str),
        Some("file-secret")
    );

    let cli = CliOverrides {
        realtime_voice_base_url: Some("https://from-env.example/v1".into()),
        realtime_voice_api_key: Some(SecretString::new("env-secret")),
        ..cli_with_dirs(home.path())
    };
    let cfg = Config::load(&cli, None).unwrap();
    let voice = cfg.realtime_voice_client_config().expect("voice config");
    assert_eq!(voice.endpoint().unwrap(), "wss://from-env.example/v1");
    assert_eq!(voice.token.as_deref(), Some("env-secret"));
}
