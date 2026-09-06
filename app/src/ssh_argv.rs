//! OpenSSH argv 构造（ssh-machine-mount §6.4）。
//!
//! 所有调用方须使用参数数组（`Command::new("ssh").args(&argv)`），禁止 `sh -c`。

use std::path::Path;

use peri_studio_server::protocol::{validate_identity_file_path, validate_ssh_destination};

/// 单次 SSH/SCP 调用的连接参数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshConnectOptions<'a> {
    pub data_dir: &'a Path,
    pub config_dir: &'a Path,
    pub destination: &'a str,
    pub port: Option<u16>,
    pub identity_file: Option<&'a str>,
}

/// `<data_dir>/ssh/known_hosts` 路径。
pub fn known_hosts_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("ssh").join("known_hosts")
}

/// 忽略系统全局 known_hosts 的占位路径。
pub fn global_known_hosts_file() -> &'static str {
    #[cfg(unix)]
    {
        "/dev/null"
    }
    #[cfg(not(unix))]
    {
        "NUL"
    }
}

/// 交互式 exec 会话（probe、start 等）；不含 `ExitOnForwardFailure`。
pub fn build_ssh_argv(
    opts: &SshConnectOptions<'_>,
    remote_command: &[&str],
) -> Result<Vec<String>, String> {
    let mut argv = Vec::new();
    push_common_options(&mut argv, opts, false)?;
    argv.push("--".into());
    argv.push(opts.destination.to_string());
    argv.extend(remote_command.iter().map(|part| (*part).to_string()));
    Ok(argv)
}

/// 反向隧道进程（`-N -R`）；含 `ExitOnForwardFailure=yes`。
pub fn build_tunnel_argv(opts: &SshConnectOptions<'_>, listen_port: u16) -> Result<Vec<String>, String> {
    let mut argv = Vec::new();
    push_common_options(&mut argv, opts, true)?;
    argv.push("-N".into());
    argv.push("-R".into());
    argv.push(format!("127.0.0.1:0:127.0.0.1:{listen_port}"));
    argv.push("--".into());
    argv.push(opts.destination.to_string());
    Ok(argv)
}

/// SCP 传输；`remote_target` 形如 `user@host:/path`，放在 `--` 之后。
pub fn build_scp_argv(
    opts: &SshConnectOptions<'_>,
    sources: &[&str],
    remote_target: &str,
) -> Result<Vec<String>, String> {
    if sources.is_empty() {
        return Err("scp requires at least one source path".into());
    }
    validate_ssh_destination(opts.destination)?;
    if !remote_target.starts_with(opts.destination) {
        return Err("remote scp target must begin with the validated destination".into());
    }
    let mut argv = Vec::new();
    push_common_options(&mut argv, opts, false)?;
    argv.extend(sources.iter().map(|source| (*source).to_string()));
    argv.push("--".into());
    argv.push(remote_target.to_string());
    Ok(argv)
}

/// host key 采集（ssh-keyscan；非 BatchMode ssh，§6.4）。
pub fn build_keyscan_argv(
    destination: &str,
    port: Option<u16>,
) -> Result<Vec<String>, String> {
    validate_ssh_destination(destination)?;
    let mut argv = Vec::new();
    if let Some(port) = port {
        argv.push("-p".into());
        argv.push(port.to_string());
    }
    push_ssh_option(&mut argv, "HostKeyAlgorithms=ssh-ed25519,ecdsa-sha2-nistp256,rsa-sha2-512,rsa-sha2-256,ssh-rsa");
    argv.push("-t".into());
    argv.push("ed25519,ecdsa,rsa".into());
    argv.push(destination.to_string());
    Ok(argv)
}

fn push_common_options(
    argv: &mut Vec<String>,
    opts: &SshConnectOptions<'_>,
    exit_on_forward_failure: bool,
) -> Result<(), String> {
    validate_ssh_destination(opts.destination)?;
    validate_identity_file_for_ssh(opts.identity_file, opts.config_dir, opts.data_dir)?;

    if let Some(port) = opts.port {
        argv.push("-p".into());
        argv.push(port.to_string());
    }

    push_ssh_option(argv, "BatchMode=yes");
    push_ssh_option(argv, "StrictHostKeyChecking=yes");
    push_ssh_option(
        argv,
        &format!(
            "UserKnownHostsFile={}",
            known_hosts_path(opts.data_dir).display()
        ),
    );
    push_ssh_option(
        argv,
        &format!("GlobalKnownHostsFile={}", global_known_hosts_file()),
    );
    push_ssh_option(argv, "ControlMaster=no");
    push_ssh_option(argv, "ControlPath=none");
    if exit_on_forward_failure {
        push_ssh_option(argv, "ExitOnForwardFailure=yes");
    }

    if let Some(identity) = opts.identity_file {
        push_ssh_option(argv, "IdentitiesOnly=yes");
        argv.push("-i".into());
        argv.push(identity.to_string());
    }

    Ok(())
}

fn push_ssh_option(argv: &mut Vec<String>, value: &str) {
    argv.push("-o".into());
    argv.push(value.to_string());
}

/// identity 路径不得落在 Peri config/data 目录内，防止误用 token 文件。
fn validate_identity_file_for_ssh(
    path: Option<&str>,
    config_dir: &Path,
    data_dir: &Path,
) -> Result<(), String> {
    validate_identity_file_path(path)?;
    if let Some(path) = path {
        let path = Path::new(path);
        if path.starts_with(config_dir) || path.starts_with(data_dir) {
            return Err(
                "identity file must not be located under Peri config or data directory".into(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "ssh_argv_test.rs"]
mod ssh_argv_test;
