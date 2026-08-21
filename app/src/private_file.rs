//! 私密凭据文件的有界读取与权限校验。

use std::io::Read as _;
use std::path::Path;

use anyhow::Context as _;

pub const CREDENTIAL_MAX_BYTES: usize = 4096;

/// 读取由当前用户独占的短文本凭据，并拒绝竞态扩容与空内容。
pub fn read_private_text(path: &Path, label: &str) -> anyhow::Result<String> {
    let mut file = std::fs::File::open(path)
        .with_context(|| format!("failed to open {label}: {}", path.display()))?;
    let metadata = file.metadata()?;
    validate_private_file(path, label, &metadata)?;
    if metadata.len() > CREDENTIAL_MAX_BYTES as u64 {
        anyhow::bail!("{label} is too large: {}", path.display());
    }
    let mut content = String::new();
    file.by_ref()
        .take(CREDENTIAL_MAX_BYTES as u64 + 1)
        .read_to_string(&mut content)
        .with_context(|| format!("failed to read {label}: {}", path.display()))?;
    if content.len() > CREDENTIAL_MAX_BYTES {
        anyhow::bail!("{label} is too large: {}", path.display());
    }
    let value = content.trim().to_string();
    if value.is_empty() {
        anyhow::bail!("{label} is empty: {}", path.display());
    }
    Ok(value)
}

#[cfg(unix)]
fn validate_private_file(
    path: &Path,
    label: &str,
    metadata: &std::fs::Metadata,
) -> anyhow::Result<()> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    if !metadata.is_file() {
        anyhow::bail!("{label} path is not a regular file: {}", path.display());
    }
    // SAFETY: geteuid 无参数且不解引用指针，只读取当前进程的有效用户 ID。
    let owner = unsafe { libc::geteuid() };
    if metadata.uid() != owner {
        anyhow::bail!(
            "{label} is not owned by the current user: {}",
            path.display()
        );
    }
    if metadata.permissions().mode() & 0o077 != 0 {
        anyhow::bail!(
            "{label} permissions must not allow group or world access: {}",
            path.display()
        );
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_private_file(
    path: &Path,
    label: &str,
    metadata: &std::fs::Metadata,
) -> anyhow::Result<()> {
    if !metadata.is_file() {
        anyhow::bail!("{label} path is not a regular file: {}", path.display());
    }
    Ok(())
}
