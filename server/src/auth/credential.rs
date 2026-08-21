//! 凭据文件发布：以仅属主权限进行排他创建或原子替换。

use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};

use super::token::StoreError;

/// 已确保落盘的 instance 凭据元数据。
///
/// 该类型刻意不携带 token 本体，避免凭据经过运行时返回值、`Debug` 或日志。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnsuredInstanceCredential {
    /// token 记录 id（审计/吊销引用键）。
    pub token_id: String,
    /// instance 身份；线级 `instance_id` 由 token name 决定。
    pub instance_id: String,
    /// 仅属主可读写的凭据文件。
    pub path: PathBuf,
    /// 本次调用是否创建了新的 token 记录。
    pub newly_created: bool,
}

/// 排他创建原始凭据文件，不提供覆盖窗口。
///
/// 硬链接是原子发布点；调用方持久化对应有效记录前，文件与父目录均会同步。
pub(super) fn write_private_credential(output: &Path, token: &str) -> Result<(), StoreError> {
    let dir = credential_directory(output);
    ensure_directory(dir)?;
    if output.exists() {
        return Err(StoreError::Persist(format!(
            "credential output already exists: {}",
            output.display()
        )));
    }

    let tmp = dir.join(format!(
        ".instance-token.tmp.{}.{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let result = (|| -> Result<(), StoreError> {
        let mut file = open_private(&tmp)?;
        write_token(&mut file, token)?;
        fs::hard_link(&tmp, output)?;
        fs::remove_file(&tmp)?;
        sync_directory(dir)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// 原子创建或替换凭据文件；rename 是唯一发布点，不暴露半写入内容。
pub(super) fn write_private_credential_replace(
    output: &Path,
    token: &str,
) -> Result<(), StoreError> {
    let dir = credential_directory(output);
    ensure_directory(dir)?;
    let tmp = dir.join(format!(
        ".instance-token.replace.{}.{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let result = (|| -> Result<(), StoreError> {
        let mut file = open_private(&tmp)?;
        write_token(&mut file, token)?;
        fs::rename(&tmp, output)?;
        sync_directory(dir)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn credential_directory(output: &Path) -> &Path {
    output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn ensure_directory(dir: &Path) -> Result<(), StoreError> {
    if !dir.is_dir() {
        return Err(StoreError::Persist(format!(
            "credential output directory does not exist: {}",
            dir.display()
        )));
    }
    Ok(())
}

fn open_private(path: &Path) -> Result<fs::File, StoreError> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}

fn write_token(file: &mut fs::File, token: &str) -> Result<(), StoreError> {
    file.write_all(token.as_bytes())?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}

fn sync_directory(dir: &Path) -> Result<(), StoreError> {
    fs::File::open(dir)?
        .sync_all()
        .map_err(|error| StoreError::Persist(format!("directory fsync failed: {error}")))
}
