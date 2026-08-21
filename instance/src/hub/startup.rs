//! 启动清理（§8 第三层：崩溃路径）+ env 白名单（§9.6 双端校验的 instance 侧）。
//!
//! 只有 data-dir 身份与 leader 出生指纹同时匹配才会 SIGKILL 进程组；旧格式、
//! 目录副本和 PID 复用都 fail closed。无论是否可安全发信号，发现上代运行记录
//! 或 buffer 都会返回 `buffer_lost=true` 供 server 权威对账。

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read as _, Seek as _, Write as _};
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::buffer::{DataDirIdentity, ProcessFingerprint, Watermark};
use crate::child::{self, ENV_BASE_ALLOWLIST};

use super::config::InstanceConfig;

/// owner 身份文件的最大字节数；当前 JSON 远小于该值，留出格式演进空间。
pub(super) const OWNER_IDENTITY_MAX_BYTES: usize = 16 * 1024;

/// 启动清理：只有 data-dir 身份与 leader 出生指纹同时匹配才会
/// SIGKILL 进程组；旧格式、目录副本和 PID 复用都 fail closed。无论是否
/// 可安全发信号，发现上代运行记录或 buffer 都会返回 `buffer_lost=true`
/// 供 server 权威对账。
pub(crate) struct InstanceOwnerLock {
    _file: File,
    identity: InstanceOwnerIdentity,
}

/// 受 flock 保护的 instance owner 身份；凭据仅保存不可逆摘要。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceOwnerIdentity {
    version: u32,
    pid: u32,
    process_fingerprint: Option<ProcessFingerprint>,
    server_url: String,
    credential_digest: String,
    managed_local_id: Option<String>,
}

impl InstanceOwnerIdentity {
    /// owner 进程 id，仅用于诊断与完整身份匹配；不得据此向 adopted 进程发信号。
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// 是否为当前 server 上一次启动的 managed-local instance。
    pub fn matches_managed_local(
        &self,
        server_url: &str,
        token: &str,
        managed_local_id: &str,
    ) -> bool {
        let process_matches = self.process_fingerprint.as_ref().is_some_and(|expected| {
            child::process_fingerprint(self.pid as i32).as_ref() == Some(expected)
        });
        process_matches
            && self.server_url == server_url
            && self.credential_digest == credential_digest(token)
            && self.managed_local_id.as_deref() == Some(managed_local_id)
    }
}

impl InstanceOwnerLock {
    fn acquire(config: &InstanceConfig) -> anyhow::Result<Self> {
        use std::os::fd::AsRawFd;
        let path = config.data_dir.join("instance.owner.lock");
        let mut file = fs::OpenOptions::new()
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
        let identity = InstanceOwnerIdentity {
            version: 1,
            pid: std::process::id(),
            process_fingerprint: child::process_fingerprint(std::process::id() as i32),
            server_url: config.server_url.clone(),
            credential_digest: credential_digest(&config.token),
            managed_local_id: config.managed_local_id.clone(),
        };
        if identity.managed_local_id.is_some() && identity.process_fingerprint.is_none() {
            anyhow::bail!("managed local instance process identity is unavailable");
        }
        file.set_len(0)?;
        file.rewind()?;
        serde_json::to_writer(&mut file, &identity)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        Ok(Self {
            _file: file,
            identity,
        })
    }

    pub(super) fn identity(&self) -> InstanceOwnerIdentity {
        self.identity.clone()
    }
}

/// 返回当前持有 instance 数据目录锁的进程；无存活 owner 时返回 `None`。
pub(super) fn current_owner(data_dir: &Path) -> anyhow::Result<Option<InstanceOwnerIdentity>> {
    use std::os::fd::AsRawFd;

    let path = data_dir.join("instance.owner.lock");
    let mut file = match fs::OpenOptions::new().read(true).write(true).open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    // 成功拿锁说明没有运行中的 owner；File drop 会立即释放本次探测锁。
    // SAFETY: flock 只操作当前进程持有的有效文件描述符。
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc == 0 {
        return Ok(None);
    }
    let error = std::io::Error::last_os_error();
    let code = error.raw_os_error();
    if code != Some(libc::EWOULDBLOCK) && code != Some(libc::EAGAIN) {
        return Err(error.into());
    }

    file.rewind()?;
    Ok(Some(read_owner_identity(&mut file)?))
}

fn read_owner_identity(file: &mut File) -> anyhow::Result<InstanceOwnerIdentity> {
    let mut value = String::new();
    std::io::Read::by_ref(file)
        .take(OWNER_IDENTITY_MAX_BYTES as u64 + 1)
        .read_to_string(&mut value)?;
    if value.len() > OWNER_IDENTITY_MAX_BYTES {
        anyhow::bail!("instance owner lock is too large");
    }
    let identity: InstanceOwnerIdentity = serde_json::from_str(&value)
        .map_err(|error| anyhow::anyhow!("instance owner lock is invalid: {error}"))?;
    if identity.version != 1 || identity.pid == 0 {
        anyhow::bail!("instance owner lock contains an unsupported identity");
    }
    Ok(identity)
}

fn credential_digest(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
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
    let owner_lock = InstanceOwnerLock::acquire(config)?;
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
pub(super) fn validate_env(
    env: &HashMap<String, String>,
    extra: &[String],
) -> Result<(), &'static str> {
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
