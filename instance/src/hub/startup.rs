//! 启动清理（§8 第三层：崩溃路径）+ env 白名单（§9.6 双端校验的 instance 侧）。
//!
//! 只有 data-dir 身份与 leader 出生指纹同时匹配才会 SIGKILL 进程组；旧格式、
//! 目录副本和 PID 复用都 fail closed。无论是否可安全发信号，发现上代运行记录
//! 或 buffer 都会返回 `buffer_lost=true` 供 server 权威对账。

use std::collections::HashMap;
use std::fs::{self, File};
use std::path::Path;

use crate::buffer::{DataDirIdentity, Watermark};
use crate::child::{self, ENV_BASE_ALLOWLIST};

use super::config::InstanceConfig;

/// 启动清理：只有 data-dir 身份与 leader 出生指纹同时匹配才会
/// SIGKILL 进程组；旧格式、目录副本和 PID 复用都 fail closed。无论是否
/// 可安全发信号，发现上代运行记录或 buffer 都会返回 `buffer_lost=true`
/// 供 server 权威对账。
pub(crate) struct InstanceOwnerLock {
    _file: File,
}

impl InstanceOwnerLock {
    fn acquire(data_dir: &Path) -> anyhow::Result<Self> {
        use std::os::fd::AsRawFd;
        let path = data_dir.join("instance.owner.lock");
        let file = fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        // SAFETY: flock operates on a valid owned fd and does not access Rust memory.
        let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if rc != 0 {
            anyhow::bail!("instance data directory is already owned by another daemon");
        }
        Ok(Self { _file: file })
    }
}

#[cfg(unix)]
pub(super) fn data_dir_identity(path: &Path) -> anyhow::Result<DataDirIdentity> {
    use std::os::unix::fs::MetadataExt;
    let metadata = fs::metadata(path)?;
    Ok(DataDirIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

pub(super) fn startup_cleanup(
    config: &InstanceConfig,
) -> anyhow::Result<(Watermark, bool, InstanceOwnerLock)> {
    fs::create_dir_all(&config.data_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&config.data_dir, fs::Permissions::from_mode(0o700));
    }
    let owner_lock = InstanceOwnerLock::acquire(&config.data_dir)?;
    let identity = data_dir_identity(&config.data_dir)?;
    let mut watermark = Watermark::load(&config.data_dir)?;
    let buffer_dir = config.data_dir.join("buffer");
    let runtime_records = watermark.runtime_records();
    let buffer_lost = !runtime_records.is_empty() || buffer_dir.exists();

    let directory_matches = watermark.data_dir_identity() == Some(identity);
    for (pgid, expected) in runtime_records {
        let actual = child::process_fingerprint(pgid);
        if directory_matches && expected.is_some() && expected == actual {
            let signalled = child::sys::kill_group(pgid, child::sys::SIGKILL);
            tracing::info!(target: "peri_studio::instance", pgid, signalled,
                "startup cleanup: signalled verified leftover process group");
        } else {
            tracing::warn!(target: "peri_studio::instance", pgid, directory_matches,
                fingerprint_present = expected.is_some(), process_matches = expected.is_some() && expected == actual,
                "startup cleanup: ownership unproven, skipping signal");
        }
    }
    if buffer_dir.exists() {
        fs::remove_dir_all(&buffer_dir)?;
        tracing::info!(target: "peri_studio::instance", "startup cleanup: removed leftover buffer directory");
    }
    watermark.finalize_startup(identity)?;
    Ok((watermark, buffer_lost, owner_lock))
}

// ---------------------------------------------------------------------------
// env 白名单（§9.6 双端校验的 instance 侧）
// ---------------------------------------------------------------------------

/// env 值长度上限（【决策】4096）。
const ENV_VALUE_MAX_LEN: usize = 4096;

/// `PERI_STUDIO_ENV_ALLOWLIST`（逗号分隔键名追加，§9.6【决策】）。
pub(super) fn env_allowlist_extra() -> Vec<String> {
    std::env::var("PERI_STUDIO_ENV_ALLOWLIST")
        .map(|v| {
            v.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// 键名白名单 + 值校验（UTF-8 天然满足；长度 ≤ 4096【决策】）。
///
/// 基集常量 [`ENV_BASE_ALLOWLIST`] 定义在 child 模块（spawn 落地侧与校验侧
/// 共用同一份，防漂移）。
pub(super) fn validate_env(env: &HashMap<String, String>, extra: &[String]) -> Result<(), &'static str> {
    for (k, v) in env {
        if !ENV_BASE_ALLOWLIST.contains(&k.as_str()) && !extra.contains(k) {
            return Err("env_rejected");
        }
        if v.len() > ENV_VALUE_MAX_LEN {
            return Err("env_rejected");
        }
    }
    Ok(())
}
