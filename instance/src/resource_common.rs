use std::path::{Component, Path, PathBuf};

use peri_studio_proto::resource::{ResourceErrorCode, ResourceFailure};
use sha2::{Digest, Sha256};

pub(super) fn validate_relative(value: &str) -> Result<PathBuf, ResourceFailure> {
    if value.contains('\0') || value.contains('\\') {
        return Err(failure(ResourceErrorCode::InvalidPath, false));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(failure(ResourceErrorCode::InvalidPath, false));
    }
    Ok(path.to_path_buf())
}

pub(super) fn canonical_root(root: &str) -> Result<PathBuf, ResourceFailure> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err(failure(ResourceErrorCode::InvalidPath, false));
    }
    let root = std::fs::canonicalize(root).map_err(map_io)?;
    if !root.is_dir() {
        return Err(failure(ResourceErrorCode::NotDirectory, false));
    }
    Ok(root)
}

pub(super) fn path_to_wire(path: &Path) -> Result<String, ResourceFailure> {
    path.to_str()
        .map(|value| value.replace(std::path::MAIN_SEPARATOR, "/"))
        .ok_or_else(|| failure(ResourceErrorCode::InvalidPath, false))
}

pub(super) fn cursor_for(generation: &str, offset: usize) -> String {
    format!("{generation}.{offset}")
}

pub(super) fn parse_cursor(
    cursor: Option<&str>,
    generation: &str,
) -> Result<usize, ResourceFailure> {
    let Some(cursor) = cursor else { return Ok(0) };
    let Some((base, offset)) = cursor.rsplit_once('.') else {
        return Err(failure(ResourceErrorCode::StaleCursor, false));
    };
    if base != generation {
        return Err(failure(ResourceErrorCode::StaleCursor, false));
    }
    offset
        .parse::<usize>()
        .map_err(|_| failure(ResourceErrorCode::StaleCursor, false))
}

pub(super) fn relative_path(root: &Path, target: &Path) -> Result<String, ResourceFailure> {
    let relative = target
        .strip_prefix(root)
        .map_err(|_| failure(ResourceErrorCode::OutsideWorkspace, false))?;
    path_to_wire(relative)
}

pub(super) fn hash_text(value: &str) -> String {
    hash_bytes(value.as_bytes())
}

pub(super) fn hash_bytes(value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value);
    format!("{:x}", hasher.finalize())
}

pub(super) fn map_io(error: std::io::Error) -> ResourceFailure {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => ResourceErrorCode::NotFound,
        std::io::ErrorKind::PermissionDenied => ResourceErrorCode::PermissionDenied,
        _ => ResourceErrorCode::Unavailable,
    };
    failure(code, matches!(code, ResourceErrorCode::Unavailable))
}

pub(super) fn failure(code: ResourceErrorCode, retryable: bool) -> ResourceFailure {
    ResourceFailure {
        code,
        message: match code {
            ResourceErrorCode::InvalidPath => "Invalid workspace-relative path",
            ResourceErrorCode::OutsideWorkspace => "Resource is outside the workspace",
            ResourceErrorCode::NotFound => "Resource not found",
            ResourceErrorCode::NotDirectory => "Resource is not a directory",
            ResourceErrorCode::PermissionDenied => "Permission denied",
            ResourceErrorCode::RepoNotFound => "Git repository not found",
            ResourceErrorCode::GitNotAvailable => "Git is unavailable",
            ResourceErrorCode::ViewTooLarge => "Requested resource page is too large",
            ResourceErrorCode::StaleCursor => "Resource page changed; refresh required",
            ResourceErrorCode::Timeout => "Resource query timed out",
            _ => "Resource is unavailable",
        }
        .to_string(),
        retryable,
    }
}
