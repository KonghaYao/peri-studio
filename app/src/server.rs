//! server 角色与本地自连接 instance 的进程监督。

use std::process::Stdio;
use std::time::Duration;

use anyhow::Context as _;
use peri_studio_server::config::Config;
use peri_studio_server::runtime::{ServerReady, ServerRuntime};
use tokio::process::{Child, Command};
use tokio_util::sync::CancellationToken;

use crate::private_file::read_private_text;

/// 启动 server；`managed_local` 决定是否用当前二进制启动本地 instance。
pub async fn run(
    config: Config,
    managed_local: bool,
    json_log: bool,
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
    let server_shutdown = shutdown.clone();
    let runtime = ServerRuntime::start(config.clone(), async move {
        server_shutdown.cancelled().await;
    })
    .await?;
    let ready = runtime.ready().clone();
    println!("Peri Studio: {}", ready.web_url);

    if !managed_local {
        return runtime.wait().await;
    }
    supervise_local_instance(runtime, ready, config, json_log, shutdown).await
}

async fn supervise_local_instance(
    runtime: ServerRuntime,
    ready: ServerReady,
    config: Config,
    json_log: bool,
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
    let instance_data = config.data_dir.join("instances").join("local");
    std::fs::create_dir_all(&instance_data).with_context(|| {
        format!(
            "failed to create local instance data dir: {}",
            instance_data.display()
        )
    })?;
    let expected = ExpectedLocalInstance::from_ready(&ready)?;
    let executable = std::env::current_exe().context("failed to locate peri-studio executable")?;
    let mut instance = match compatible_owner(&instance_data, &expected)? {
        Some(owner) => {
            tracing::info!(pid = owner.pid(), "adopted existing local instance");
            LocalInstance::Adopted(owner)
        }
        None => LocalInstance::Managed(spawn_local_instance(
            &executable,
            &ready,
            &instance_data,
            &config.log_level,
            json_log,
        )?),
    };
    let mut server = Box::pin(runtime.wait());
    let mut restart_delay = Duration::from_secs(1);
    let mut owner_poll = tokio::time::interval(Duration::from_millis(250));
    owner_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        match &mut instance {
            LocalInstance::Managed(child) => tokio::select! {
                result = &mut server => {
                    if shutdown.is_cancelled() {
                        stop_child(child).await?;
                        return result;
                    }
                    // 异常 server 退出时刻意不杀 instance。instance 会保留 ACP
                    // 进程树并持续重连，下一次 server 启动后恢复。
                    tracing::error!("server exited unexpectedly; local instance left running for recovery");
                    return result.and_then(|_| Err(anyhow::anyhow!("server exited unexpectedly")));
                }
                status = child.wait() => {
                    let status = status.context("failed to wait for local instance")?;
                    if shutdown.is_cancelled() {
                        return server.await;
                    }
                    if let Some(owner) = compatible_owner(&instance_data, &expected)? {
                        tracing::info!(pid = owner.pid(), "adopted concurrently started local instance");
                        instance = LocalInstance::Adopted(owner);
                        continue;
                    }
                    tracing::warn!(%status, delay_ms = restart_delay.as_millis(),
                        "local instance exited; restarting");
                    tokio::select! {
                        _ = tokio::time::sleep(restart_delay) => {}
                        _ = shutdown.cancelled() => return server.await,
                    }
                    restart_delay = (restart_delay * 2).min(Duration::from_secs(30));
                    instance = LocalInstance::Managed(spawn_local_instance(
                        &executable,
                        &ready,
                        &instance_data,
                        &config.log_level,
                        json_log,
                    )?);
                }
            },
            LocalInstance::Adopted(owner) => tokio::select! {
                result = &mut server => {
                    if shutdown.is_cancelled() {
                        stop_adopted_instance(owner, &instance_data, &expected.token).await?;
                        return result;
                    }
                    tracing::error!(pid = owner.pid(),
                        "server exited unexpectedly; adopted local instance left running");
                    return result.and_then(|_| Err(anyhow::anyhow!("server exited unexpectedly")));
                }
                _ = owner_poll.tick() => match compatible_owner(&instance_data, &expected)? {
                    Some(current) if current == *owner => {}
                    Some(current) => {
                        tracing::info!(old_pid = owner.pid(), pid = current.pid(),
                            "local instance owner changed to a compatible process");
                        instance = LocalInstance::Adopted(current);
                    }
                    None => {
                        tracing::warn!(pid = owner.pid(), "adopted local instance exited; restarting");
                        instance = LocalInstance::Managed(spawn_local_instance(
                            &executable,
                            &ready,
                            &instance_data,
                            &config.log_level,
                            json_log,
                        )?);
                    }
                }
            },
        }
    }
}

enum LocalInstance {
    Managed(Child),
    Adopted(peri_instance::hub::InstanceOwnerIdentity),
}

struct ExpectedLocalInstance {
    server_url: String,
    token: String,
    managed_local_id: String,
}

impl ExpectedLocalInstance {
    fn from_ready(ready: &ServerReady) -> anyhow::Result<Self> {
        let token = read_private_text(
            &ready.local_instance.token_file,
            "local instance credential",
        )?;
        Ok(Self {
            server_url: ready.instance_url.to_string(),
            token,
            managed_local_id: ready.local_instance.token_id.clone(),
        })
    }
}

fn compatible_owner(
    data_dir: &std::path::Path,
    expected: &ExpectedLocalInstance,
) -> anyhow::Result<Option<peri_instance::hub::InstanceOwnerIdentity>> {
    let Some(owner) = peri_instance::hub::owner_identity(data_dir)? else {
        return Ok(None);
    };
    if !owner.matches_managed_local(
        &expected.server_url,
        &expected.token,
        &expected.managed_local_id,
    ) {
        anyhow::bail!(
            "instance data directory is owned by an incompatible process; refusing local takeover"
        );
    }
    Ok(Some(owner))
}

fn spawn_local_instance(
    executable: &std::path::Path,
    ready: &ServerReady,
    data_dir: &std::path::Path,
    log_level: &str,
    json_log: bool,
) -> anyhow::Result<Child> {
    let mut command = Command::new(executable);
    command
        .arg("connect")
        .arg(ready.instance_url.as_str())
        .arg("--token-file")
        .arg(&ready.local_instance.token_file)
        .arg("--data-dir")
        .arg(data_dir)
        .arg("--managed-local-id")
        .arg(&ready.local_instance.token_id)
        .arg("--log-level")
        .arg(log_level)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .kill_on_drop(false);
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    if json_log {
        command.arg("--json-log");
    }
    command
        .spawn()
        .context("failed to start local instance role")
}

async fn stop_child(child: &mut Child) -> anyhow::Result<()> {
    let Some(id) = child.id() else {
        child
            .wait()
            .await
            .context("failed to confirm local instance exit")?;
        return Ok(());
    };
    #[cfg(unix)]
    {
        // SAFETY: id 来自当前 Child；SIGTERM 只发送给这个精确 pid。
        let result = unsafe { libc::kill(id as libc::pid_t, libc::SIGTERM) };
        if result != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(error).context("failed to signal local instance");
            }
        }
    }
    #[cfg(not(unix))]
    if let Err(error) = child.start_kill() {
        if child.try_wait()?.is_none() {
            return Err(error).context("failed to stop local instance");
        }
    }

    match tokio::time::timeout(Duration::from_secs(5), child.wait()).await {
        Ok(result) => {
            result.context("failed to wait for local instance shutdown")?;
            Ok(())
        }
        Err(_) => {
            tracing::warn!(
                pid = id,
                "local instance ignored graceful shutdown; killing"
            );
            if let Err(error) = child.start_kill() {
                if child.try_wait()?.is_none() {
                    return Err(error).context("failed to kill local instance");
                }
            }
            child
                .wait()
                .await
                .context("failed to confirm killed local instance exit")?;
            Ok(())
        }
    }
}

async fn stop_adopted_instance(
    owner: &peri_instance::hub::InstanceOwnerIdentity,
    data_dir: &std::path::Path,
    token: &str,
) -> anyhow::Result<()> {
    if peri_instance::hub::owner_identity(data_dir)?.as_ref() != Some(owner) {
        anyhow::bail!("adopted local instance ownership changed; refusing shutdown request");
    }
    peri_instance::hub::request_owner_shutdown(data_dir, owner, token)
        .await
        .context("failed to request adopted local instance shutdown")?;
    if wait_for_owner_exit(owner, data_dir, Duration::from_secs(7)).await? {
        return Ok(());
    }
    anyhow::bail!("adopted local instance remained alive after authenticated shutdown request")
}

async fn wait_for_owner_exit(
    owner: &peri_instance::hub::InstanceOwnerIdentity,
    data_dir: &std::path::Path,
    timeout: Duration,
) -> anyhow::Result<bool> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        match peri_instance::hub::owner_identity(data_dir)? {
            None => return Ok(true),
            Some(current) if current != *owner => {
                anyhow::bail!("adopted local instance ownership changed while stopping");
            }
            Some(_) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn local_instance_uses_role_specific_data_directory() {
        let root = PathBuf::from("/tmp/peri-data");
        assert_eq!(
            root.join("instances").join("local"),
            PathBuf::from("/tmp/peri-data/instances/local")
        );
    }
}
