//! SSH 供应管道步骤执行（§6.1）。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use peri_studio_proto::version::PROTOCOL_VERSION;
use peri_studio_server::auth::{TokenStore, TOKENS_FILE};
use peri_studio_server::control::{PipelineEvent, PipelineSpec, PipelineStep};
use sha2::{Digest as _, Sha256};
use tokio::io::{AsyncBufReadExt as _, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::ssh_argv::{
    build_keyscan_argv, build_scp_argv, build_ssh_argv, build_tunnel_argv, known_hosts_path,
    SshConnectOptions,
};
use crate::ssh_backend::SshBackend;
use crate::ssh_release_checksums::{self, ReleaseAsset};

const HELLO_TIMEOUT: Duration = Duration::from_secs(60);
const REMOTE_BIN: &str = ".local/share/peri-studio/bin/peri-studio";
const REMOTE_SHARE: &str = ".local/share/peri-studio";

/// 供应管道主循环：按步骤边界上报 `PipelineEvent`。
pub async fn run_pipeline(
    backend: Arc<SshBackend>,
    spec: PipelineSpec,
    generation: u64,
    from_step: PipelineStep,
    events: mpsc::Sender<PipelineEvent>,
    cancel: CancellationToken,
) {
    backend.store_spec(spec.clone()).await;
    let instance_id = spec.instance_id.clone();
    let mut step = from_step;
    loop {
        if cancel.is_cancelled() {
            tracing::debug!(instance_id = %instance_id, generation, "SSH pipeline canceled");
            return;
        }
        let result = match step {
            PipelineStep::HostKeyProbe => run_host_key_probe(&backend, &spec, &events, &cancel).await,
            PipelineStep::AwaitingHostKey => return,
            PipelineStep::SshConnect => run_ssh_connect(&backend, &spec, &events, &cancel).await,
            PipelineStep::Probe => run_probe(&backend, &spec, &events, &cancel).await,
            PipelineStep::Install => run_install(&backend, &spec, &events, &cancel).await,
            PipelineStep::AwaitingReplace => return,
            PipelineStep::Provision => run_provision(&backend, &spec, &events, &cancel).await,
            PipelineStep::Tunnel => run_tunnel(&backend, &spec, &events, &cancel).await,
            PipelineStep::Start => run_start(&backend, &spec, &events, &cancel).await,
            PipelineStep::Connecting => {
                run_connecting(&backend, &spec, &events, &cancel).await
            }
            PipelineStep::Online => return,
        };
        match result {
            Ok(next) => {
                if let Err(error) = events.send(PipelineEvent::StepComplete(step)).await {
                    tracing::warn!(instance_id = %instance_id, ?error, "pipeline event send failed");
                    return;
                }
                step = next;
            }
            Err((failed_step, error_code)) => {
                let _ = events
                    .send(PipelineEvent::StepFailed {
                        step: failed_step,
                        error_code,
                    })
                    .await;
                return;
            }
        }
    }
}

type StepResult = Result<PipelineStep, (PipelineStep, String)>;

async fn run_host_key_probe(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    events: &mpsc::Sender<PipelineEvent>,
    cancel: &CancellationToken,
) -> StepResult {
    let argv = build_keyscan_argv(&spec.ssh_destination, spec.ssh_port.map(|p| p as u16))
        .map_err(|_| (PipelineStep::HostKeyProbe, "ssh_connect_failed".into()))?;
    let output = run_capture(backend, &backend.programs().keyscan, &argv, cancel)
        .await
        .map_err(|_| (PipelineStep::HostKeyProbe, "ssh_connect_failed".into()))?;
    let line = parse_keyscan_line(&output)
        .ok_or((PipelineStep::HostKeyProbe, "ssh_connect_failed".into()))?;
    let fingerprint = host_key_fingerprint_sha256(&line)
        .map_err(|_| (PipelineStep::HostKeyProbe, "ssh_connect_failed".into()))?;
    if let Some(trusted) = spec.host_key_sha256.as_deref() {
        if trusted != fingerprint {
            return Err((PipelineStep::HostKeyProbe, "ssh_host_key_mismatch".into()));
        }
    }
    if known_hosts_has_line(&known_hosts_path(&backend.config().data_dir), &line) {
        return Ok(PipelineStep::SshConnect);
    }
    if let Err(error) = events
        .send(PipelineEvent::AwaitingTrust {
            fingerprint: fingerprint.clone(),
            known_hosts_line: line,
        })
        .await
    {
        tracing::warn!(instance_id = %spec.instance_id, ?error, "awaiting trust event failed");
    }
  Ok(PipelineStep::AwaitingHostKey)
}

async fn run_ssh_connect(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    _events: &mpsc::Sender<PipelineEvent>,
    cancel: &CancellationToken,
) -> StepResult {
    if let Some(line) = spec.pending_host_key_line.as_deref() {
        backend
            .append_known_hosts_line(&spec.instance_id, line)
            .await
            .map_err(|_| (PipelineStep::SshConnect, "ssh_connect_failed".into()))?;
    }
    let opts = backend.connect_options(spec);
    let argv = build_ssh_argv(&opts, &["true"])
        .map_err(|_| (PipelineStep::SshConnect, "ssh_connect_failed".into()))?;
    let status = run_status(backend, &backend.programs().ssh, &argv, cancel)
        .await
        .map_err(|_| (PipelineStep::SshConnect, classify_ssh_error(&argv)))?;
    if !status.success() {
        return Err((PipelineStep::SshConnect, classify_ssh_error(&argv)));
    }
    Ok(PipelineStep::Probe)
}

async fn run_probe(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    _events: &mpsc::Sender<PipelineEvent>,
    cancel: &CancellationToken,
) -> StepResult {
    let opts = backend.connect_options(spec);
    let uname_s = remote_exec(backend, &opts, &["uname", "-s"], cancel)
        .await
        .map_err(|_| (PipelineStep::Probe, "ssh_exec_failed".into()))?;
    let uname_m = remote_exec(backend, &opts, &["uname", "-m"], cancel)
        .await
        .map_err(|_| (PipelineStep::Probe, "ssh_exec_failed".into()))?;
    if !remote_os_supported(&uname_s, &uname_m) {
        return Err((PipelineStep::Probe, "remote_os_unsupported".into()));
    }
    let remote_bin = remote_bin_path();
    let version_argv = build_ssh_argv(
        &opts,
        &[&remote_bin, "protocol-version"],
    )
    .map_err(|_| (PipelineStep::Probe, "ssh_exec_failed".into()))?;
    let remote_version = run_capture(backend, &backend.programs().ssh, &version_argv, cancel).await;
    match remote_version {
        Ok(text) => {
            let trimmed = text.trim();
            if !trimmed.is_empty() && trimmed != PROTOCOL_VERSION.to_string() {
                return Ok(PipelineStep::Install);
            }
            if trimmed.is_empty() {
                return Ok(PipelineStep::Install);
            }
            Ok(PipelineStep::Provision)
        }
        Err(_) => Ok(PipelineStep::Install),
    }
}

async fn run_install(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    events: &mpsc::Sender<PipelineEvent>,
    cancel: &CancellationToken,
) -> StepResult {
    let opts = backend.connect_options(spec);
    let remote_bin = remote_bin_path();
    if !spec.replace_confirmed {
        let test_argv = build_ssh_argv(&opts, &["test", "-f", &remote_bin])
            .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
        let remote_exists = run_status(backend, &backend.programs().ssh, &test_argv, cancel)
            .await
            .map(|status| status.success())
            .unwrap_or(false);
        if remote_exists {
            if let Err(error) = events.send(PipelineEvent::AwaitingReplace).await {
                tracing::warn!(instance_id = %spec.instance_id, ?error, "awaiting replace event failed");
            }
            return Ok(PipelineStep::AwaitingReplace);
        }
    }
    let local_os = std::env::consts::OS;
    let local_arch = std::env::consts::ARCH;
    let remote_os = remote_exec(backend, &opts, &["uname", "-s"], cancel)
        .await
        .map_err(|_| (PipelineStep::Install, "ssh_exec_failed".into()))?;
    let remote_arch = remote_exec(backend, &opts, &["uname", "-m"], cancel)
        .await
        .map_err(|_| (PipelineStep::Install, "ssh_exec_failed".into()))?;
    let local_binary = if same_platform(local_os, local_arch, &remote_os, &remote_arch) {
        spec.current_exe.clone()
    } else {
        let platform = ssh_release_checksums::platform_key(&remote_os, &remote_arch).ok_or((
            PipelineStep::Install,
            "instance_binary_unavailable".into(),
        ))?;
        let asset = ssh_release_checksums::lookup(platform).ok_or((
            PipelineStep::Install,
            "instance_binary_unavailable".into(),
        ))?;
        prepare_cross_arch_binary(backend, &asset, cancel)
            .await
            .map_err(|_| (PipelineStep::Install, "instance_binary_unavailable".into()))?
    };
    stop_remote_owner_before_install(backend, spec, &opts, cancel).await?;
    atomic_remote_install(backend, spec, &opts, &local_binary, cancel).await
}

/// 跨 arch：定位或下载 release 归档，校验 SHA256，解压 `bin/peri-studio` 到本机临时路径。
async fn prepare_cross_arch_binary(
    backend: &Arc<SshBackend>,
    asset: &ReleaseAsset,
    cancel: &CancellationToken,
) -> Result<PathBuf, ()> {
    let archive = locate_or_download_release(backend.data_dir(), asset, cancel).await?;
    if !verify_file_sha256(&archive, asset.sha256_hex) {
        tracing::warn!(
            platform = asset.platform,
            file = %asset.file_name,
            "release archive checksum mismatch"
        );
        return Err(());
    }
    let staging = backend
        .data_dir()
        .join("ssh")
        .join(format!("{}.extracted", asset.platform));
    if let Some(parent) = staging.parent() {
        std::fs::create_dir_all(parent).map_err(|_| ())?;
    }
    let root = ssh_release_checksums::archive_root_dir(asset);
    extract_binary_from_archive(&archive, &root, &staging, cancel).await?;
    Ok(staging)
}

async fn locate_or_download_release(
    data_dir: &Path,
    asset: &ReleaseAsset,
    cancel: &CancellationToken,
) -> Result<PathBuf, ()> {
    for candidate in release_archive_candidates(data_dir, &asset.file_name) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    let cache_dir = data_dir.join("releases");
    std::fs::create_dir_all(&cache_dir).map_err(|_| ())?;
    let dest = cache_dir.join(&asset.file_name);
    let url = release_download_url(&asset.file_name);
    download_release_archive(&url, &dest, cancel).await?;
    Ok(dest)
}

fn release_archive_candidates(data_dir: &Path, file_name: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(dir) = std::env::var("PERI_STUDIO_RELEASE_DIR") {
        paths.push(PathBuf::from(dir).join(file_name));
    }
    paths.push(data_dir.join("releases").join(file_name));
    paths
}

fn release_download_url(file_name: &str) -> String {
    let tag = format!("peri-studio-v{}", ssh_release_checksums::PRODUCT_VERSION);
    let base = std::env::var("PERI_STUDIO_RELEASE_BASE_URL").unwrap_or_else(|_| {
        format!("https://github.com/KonghaYao/peri-studio/releases/download/{tag}")
    });
    format!("{base}/{file_name}")
}

async fn download_release_archive(
    url: &str,
    dest: &Path,
    cancel: &CancellationToken,
) -> Result<(), ()> {
    let status = tokio::select! {
        _ = cancel.cancelled() => return Err(()),
        result = tokio::process::Command::new("curl")
            .args(["-fsSL", "-o"])
            .arg(dest)
            .arg(url)
            .status() => result,
    }
    .map_err(|_| ())?;
    if status.success() {
        Ok(())
    } else {
        Err(())
    }
}

fn verify_file_sha256(path: &Path, expected_hex: &str) -> bool {
    use std::io::Read as _;
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let Ok(read) = file.read(&mut buf) else {
            return false;
        };
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    let digest = format!("{:x}", hasher.finalize());
    digest.eq_ignore_ascii_case(expected_hex)
}

async fn extract_binary_from_archive(
    archive: &Path,
    root: &str,
    dest: &Path,
    cancel: &CancellationToken,
) -> Result<(), ()> {
    let member = format!("{root}/bin/peri-studio");
    let output = tokio::select! {
        _ = cancel.cancelled() => return Err(()),
        result = tokio::process::Command::new("tar")
            .args(["-xzf"])
            .arg(archive)
            .args(["-O", &member])
            .output() => result,
    }
    .map_err(|_| ())?;
    if !output.status.success() {
        return Err(());
    }
    tokio::fs::write(dest, &output.stdout).await.map_err(|_| ())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        tokio::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o755))
            .await
            .map_err(|_| ())?;
    }
    Ok(())
}

/// 替换运行中二进制前经 owner shutdown（§7.3 stop → rename → start）。
async fn stop_remote_owner_before_install(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    opts: &SshConnectOptions<'_>,
    cancel: &CancellationToken,
) -> Result<(), (PipelineStep, String)> {
    let remote_data = remote_data_dir(&spec.instance_id);
    let lock_path = format!("{remote_data}/instance.owner.lock");
    let test_argv = build_ssh_argv(opts, &["test", "-f", &lock_path])
        .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    let has_owner = run_status(backend, &backend.programs().ssh, &test_argv, cancel)
        .await
        .map(|status| status.success())
        .unwrap_or(false);
    if has_owner {
        stop_remote_agents(backend, spec)
            .await
            .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    }
    Ok(())
}

/// scp 到 `.tmp` → rename → `chmod 0755`（同 arch 与跨 arch 共用）。
async fn atomic_remote_install(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    opts: &SshConnectOptions<'_>,
    local_binary: &Path,
    cancel: &CancellationToken,
) -> StepResult {
    let remote_bin = remote_bin_path();
    let remote_tmp = format!("{remote_bin}.tmp");
    let remote_dir = format!("~/{REMOTE_SHARE}/bin");
    let mkdir_argv = build_ssh_argv(opts, &["mkdir", "-p", &remote_dir])
        .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    run_status(backend, &backend.programs().ssh, &mkdir_argv, cancel)
        .await
        .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    let local_source = local_binary
        .to_str()
        .ok_or((PipelineStep::Install, "instance_binary_install_failed".into()))?;
    let remote_target = format!("{}:{}", spec.ssh_destination, remote_tmp);
    let scp_argv = build_scp_argv(opts, &[local_source], &remote_target)
        .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    let status = run_status(backend, &backend.programs().scp, &scp_argv, cancel)
        .await
        .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    if !status.success() {
        return Err((PipelineStep::Install, "instance_binary_install_failed".into()));
    }
    let mv_argv = build_ssh_argv(opts, &["mv", &remote_tmp, &remote_bin])
        .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    run_status(backend, &backend.programs().ssh, &mv_argv, cancel)
        .await
        .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    let chmod_argv = build_ssh_argv(opts, &["chmod", "0755", &remote_bin])
        .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    run_status(backend, &backend.programs().ssh, &chmod_argv, cancel)
        .await
        .map_err(|_| (PipelineStep::Install, "instance_binary_install_failed".into()))?;
    Ok(PipelineStep::Provision)
}

async fn run_provision(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    _events: &mpsc::Sender<PipelineEvent>,
    cancel: &CancellationToken,
) -> StepResult {
    let token_dir = backend.data_dir().join("ssh");
    std::fs::create_dir_all(&token_dir).ok();
    let local_token = token_dir.join(format!("{}.provision.token", spec.instance_id));
    let mut store = TokenStore::load(&backend.config().config_dir.join(TOKENS_FILE))
        .map_err(|_| (PipelineStep::Provision, "token_provision_failed".into()))?;
    store
        .ensure_instance_credential_to_file(&spec.instance_id, &local_token)
        .map_err(|_| (PipelineStep::Provision, "token_provision_failed".into()))?;
  let remote_data = remote_data_dir(&spec.instance_id);
    let remote_token = format!("{remote_data}/instance.token");
    let opts = backend.connect_options(spec);
    let mkdir_argv = build_ssh_argv(&opts, &["mkdir", "-p", &remote_data])
        .map_err(|_| (PipelineStep::Provision, "token_provision_failed".into()))?;
    run_status(backend, &backend.programs().ssh, &mkdir_argv, cancel)
        .await
        .map_err(|_| (PipelineStep::Provision, "token_provision_failed".into()))?;
    let remote_target = format!("{}:{}", spec.ssh_destination, remote_token);
    let scp_argv = build_scp_argv(
        &opts,
        &[local_token.to_str().unwrap_or("token")],
        &remote_target,
    )
    .map_err(|_| (PipelineStep::Provision, "token_provision_failed".into()))?;
    let status = run_status(backend, &backend.programs().scp, &scp_argv, cancel)
        .await
        .map_err(|_| (PipelineStep::Provision, "token_provision_failed".into()))?;
    let _ = std::fs::remove_file(&local_token);
    if !status.success() {
        return Err((PipelineStep::Provision, "token_provision_failed".into()));
    }
    let chmod_argv = build_ssh_argv(&opts, &["chmod", "0600", &remote_token])
        .map_err(|_| (PipelineStep::Provision, "token_provision_failed".into()))?;
    run_status(backend, &backend.programs().ssh, &chmod_argv, cancel)
        .await
        .map_err(|_| (PipelineStep::Provision, "token_provision_failed".into()))?;
    Ok(PipelineStep::Tunnel)
}

async fn run_tunnel(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    events: &mpsc::Sender<PipelineEvent>,
    cancel: &CancellationToken,
) -> StepResult {
    let opts = backend.connect_options(spec);
    let argv = build_tunnel_argv(&opts, spec.listen_port)
        .map_err(|_| (PipelineStep::Tunnel, "tunnel_failed".into()))?;
    let mut child = Command::new(&backend.programs().ssh)
        .args(&argv)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| (PipelineStep::Tunnel, "tunnel_failed".into()))?;
    let stderr = child.stderr.take().ok_or((PipelineStep::Tunnel, "tunnel_failed".into()))?;
    let port = parse_tunnel_port(stderr, cancel.clone())
        .await
        .ok_or((PipelineStep::Tunnel, "tunnel_failed".into()))?;
    if let Err(error) = events.send(PipelineEvent::TunnelReady { port }).await {
        tracing::warn!(instance_id = %spec.instance_id, ?error, "tunnel ready event failed");
    }
    backend.set_tunnel_port(&spec.instance_id, port).await;
    backend.store_tunnel(&spec.instance_id, child).await;
    Ok(PipelineStep::Start)
}

async fn run_start(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    events: &mpsc::Sender<PipelineEvent>,
    cancel: &CancellationToken,
) -> StepResult {
    let opts = backend.connect_options(spec);
    let remote_data = remote_data_dir(&spec.instance_id);
    let lock_path = format!("{remote_data}/instance.owner.lock");
    let test_argv = build_ssh_argv(&opts, &["test", "-f", &lock_path])
        .map_err(|_| (PipelineStep::Start, "connect_start_failed".into()))?;
    let has_owner = run_status(backend, &backend.programs().ssh, &test_argv, cancel)
        .await
        .map(|status| status.success())
        .unwrap_or(false);
    if has_owner {
        if let Ok(body) = remote_exec(backend, &opts, &["cat", &lock_path], cancel).await {
            let fingerprint = body.lines().next().unwrap_or("").trim().to_string();
            if !fingerprint.is_empty() {
                let _ = events
                    .send(PipelineEvent::OwnerFingerprint(fingerprint))
                    .await;
            }
        }
    } else {
        backend.mark_pipeline_started(&spec.instance_id).await;
        let port = backend
            .tunnel_port(&spec.instance_id)
            .await
            .or_else(|| spec.remote_forward_port.map(|p| p as u16))
            .ok_or((PipelineStep::Start, "connect_start_failed".into()))?;
        let ws_url = format!("ws://127.0.0.1:{port}/instance");
        let remote_bin = remote_bin_path();
        let remote_token = format!("{remote_data}/instance.token");
        let start_argv = build_ssh_argv(
            &opts,
            &[
                &remote_bin,
                "connect",
                &ws_url,
                "--token-file",
                &remote_token,
                "--data-dir",
                &remote_data,
            ],
        )
        .map_err(|_| (PipelineStep::Start, "connect_start_failed".into()))?;
        let bg_argv = argv_with_ssh_background(&start_argv);
        let status = run_status(backend, &backend.programs().ssh, &bg_argv, cancel)
            .await
            .map_err(|_| (PipelineStep::Start, "connect_start_failed".into()))?;
        if !status.success() {
            return Err((PipelineStep::Start, "connect_start_failed".into()));
        }
    }
    Ok(PipelineStep::Connecting)
}

async fn run_connecting(
    backend: &Arc<SshBackend>,
    spec: &PipelineSpec,
    _events: &mpsc::Sender<PipelineEvent>,
    cancel: &CancellationToken,
) -> StepResult {
    let gate = backend.hello_gate(&spec.instance_id).await;
    tokio::select! {
        _ = cancel.cancelled() => Err((PipelineStep::Connecting, "canceled".into())),
        _ = tokio::time::sleep(HELLO_TIMEOUT) => {
            Err((PipelineStep::Connecting, "hello_timeout".into()))
        }
        _ = gate.notified() => Ok(PipelineStep::Online),
    }
}

pub async fn stop_remote_agents(backend: &SshBackend, spec: &PipelineSpec) -> Result<(), String> {
    let opts = backend.connect_options(spec);
    let remote_data = remote_data_dir(&spec.instance_id);
    let remote_token = format!("{remote_data}/instance.token");
    let remote_bin = remote_bin_path();
    let argv = build_ssh_argv(
        &opts,
        &[
            &remote_bin,
            "owner-shutdown",
            "--data-dir",
            &remote_data,
            "--token-file",
            &remote_token,
        ],
    )?;
    let cancel = CancellationToken::new();
    let status = run_status(backend, &backend.programs().ssh, &argv, &cancel)
        .await
        .map_err(|_| "remote stop failed".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("remote stop failed".into())
    }
}

async fn remote_exec(
    backend: &SshBackend,
    opts: &crate::ssh_argv::SshConnectOptions<'_>,
    command: &[&str],
    cancel: &CancellationToken,
) -> Result<String, ()> {
    let argv = build_ssh_argv(opts, command).map_err(|_| ())?;
    run_capture(backend, &backend.programs().ssh, &argv, cancel).await
}

async fn run_capture(
    _backend: &SshBackend,
    program: &std::path::Path,
    argv: &[String],
    cancel: &CancellationToken,
) -> Result<String, ()> {
    let output = tokio::select! {
        _ = cancel.cancelled() => return Err(()),
        result = Command::new(program).args(argv).output() => result,
    }
    .map_err(|_| ())?;
    if !output.status.success() {
        return Err(());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn run_status(
    _backend: &SshBackend,
    program: &std::path::Path,
    argv: &[String],
    cancel: &CancellationToken,
) -> Result<std::process::ExitStatus, ()> {
    tokio::select! {
        _ = cancel.cancelled() => Err(()),
        result = Command::new(program).args(argv).status() => result.map_err(|_| ()),
    }
}

fn argv_with_ssh_background(argv: &[String]) -> Vec<String> {
    let mut bg = Vec::with_capacity(argv.len() + 1);
    bg.push("-f".into());
    bg.extend(argv.iter().cloned());
    bg
}

async fn parse_tunnel_port(
    stderr: impl tokio::io::AsyncRead + Unpin,
    cancel: CancellationToken,
) -> Option<u16> {
    let mut reader = BufReader::new(stderr).lines();
    loop {
        let line = tokio::select! {
            _ = cancel.cancelled() => return None,
            line = reader.next_line() => line,
        };
        let line = line.ok().flatten()?;
        if let Some(port) = line
            .split_whitespace()
            .find_map(|token| token.parse::<u16>().ok())
        {
            if line.contains("Allocated port") || line.contains("remote forward") {
                return Some(port);
            }
        }
        if let Some(rest) = line.strip_prefix("Allocated port ") {
            if let Some(port) = rest.split_whitespace().next().and_then(|p| p.parse().ok()) {
                return Some(port);
            }
        }
    }
}

fn parse_keyscan_line(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
}

fn host_key_fingerprint_sha256(line: &str) -> Result<String, String> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return Err("invalid host key line".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(parts[2])
        .map_err(|error| error.to_string())?;
    let hash = Sha256::digest(bytes);
    let encoded = base64::engine::general_purpose::STANDARD.encode(hash);
    let trimmed = encoded.trim_end_matches('=');
    Ok(format!("SHA256:{trimmed}"))
}

fn known_hosts_has_line(path: &std::path::Path, needle: &str) -> bool {
    let Ok(content) = std::fs::read_to_string(path) else {
        return false;
    };
    let key = needle.split_whitespace().nth(2).unwrap_or("");
    content.lines().any(|line| line.contains(key) && !line.trim().starts_with('#'))
}

fn remote_bin_path() -> String {
    format!("~/{REMOTE_BIN}")
}

fn remote_data_dir(instance_id: &str) -> String {
    format!("~/{REMOTE_SHARE}/instances/{instance_id}")
}

fn remote_os_supported(os: &str, arch: &str) -> bool {
    let os = os.to_ascii_lowercase();
    let arch = arch.to_ascii_lowercase();
    (os.contains("linux") || os.contains("darwin") || os.contains("unix"))
        && !arch.is_empty()
}

fn same_platform(local_os: &str, local_arch: &str, remote_os: &str, remote_arch: &str) -> bool {
    normalize_os(local_os) == normalize_os(remote_os)
        && normalize_arch(local_arch) == normalize_arch(remote_arch)
}

fn normalize_os(value: &str) -> String {
    let v = value.to_ascii_lowercase();
    if v.contains("darwin") {
        "darwin".into()
    } else if v.contains("linux") {
        "linux".into()
    } else {
        v
    }
}

fn normalize_arch(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "x86_64" | "amd64" => "x86_64".into(),
        "aarch64" | "arm64" => "aarch64".into(),
        other => other.into(),
    }
}

fn classify_ssh_error(_argv: &[String]) -> String {
    "ssh_connect_failed".into()
}
