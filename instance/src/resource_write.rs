use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine as _;
use peri_studio_proto::resource::{
    FileKind, FsPermissions, FsStat, InstanceResourcePayload, ResourceErrorCode, ResourceFailure,
    WriteFileQuery, MAX_RESOURCE_BLOB_BYTES,
};

use super::common::{canonical_root, failure, hash_text, map_io, path_to_wire, validate_relative};

pub(super) fn write_file(
    root: &str,
    query: WriteFileQuery,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    write_file_with_hook(root, query, || {})
}

fn write_file_with_hook(
    root: &str,
    query: WriteFileQuery,
    before_publish: impl FnOnce(),
) -> Result<InstanceResourcePayload, ResourceFailure> {
    let relative = validate_write_path(&query.path)?;
    validate_precondition(&query)?;
    let content = decode_content(&query.content_base64)?;
    let root = canonical_root(root)?;
    let stat = publish(&root, &relative, &content, before_publish)?;
    Ok(InstanceResourcePayload::FsStat(stat))
}

fn validate_write_path(value: &str) -> Result<PathBuf, ResourceFailure> {
    let path = validate_relative(value)?;
    if value.is_empty()
        || value.starts_with('/')
        || value.ends_with('/')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(failure(ResourceErrorCode::InvalidPath, false));
    }
    Ok(path)
}

fn validate_precondition(query: &WriteFileQuery) -> Result<(), ResourceFailure> {
    match (query.if_match.as_deref(), query.if_none_match.as_deref()) {
        (None, Some("*")) => Ok(()),
        _ => Err(failure(ResourceErrorCode::InvalidRequest, false)),
    }
}

fn decode_content(encoded: &str) -> Result<Vec<u8>, ResourceFailure> {
    let max_encoded = MAX_RESOURCE_BLOB_BYTES.div_ceil(3) * 4;
    if encoded.len() as u64 > max_encoded {
        return Err(failure(ResourceErrorCode::UploadTooLarge, false));
    }
    let content = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| failure(ResourceErrorCode::InvalidRequest, false))?;
    if content.len() as u64 > MAX_RESOURCE_BLOB_BYTES {
        return Err(failure(ResourceErrorCode::UploadTooLarge, false));
    }
    Ok(content)
}

#[cfg(unix)]
fn publish(
    root: &Path,
    relative: &Path,
    content: &[u8],
    before_publish: impl FnOnce(),
) -> Result<FsStat, ResourceFailure> {
    use std::ffi::{CStr, CString};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;

    let (parent, name) = open_parent(root, relative)?;
    let name = CString::new(name.as_bytes())
        .map_err(|_| failure(ResourceErrorCode::InvalidPath, false))?;
    validate_existing(parent.as_raw_fd(), &name)?;

    let temp_name = CString::new(format!(".peri-upload-{}.tmp", uuid::Uuid::new_v4()))
        .map_err(|_| failure(ResourceErrorCode::Unavailable, true))?;
    let temp = open_temp(parent.as_raw_fd(), &temp_name)?;
    let mut cleanup = TempCleanup::new(parent.as_raw_fd(), &temp_name);
    write_and_sync(&temp, content)?;
    before_publish();

    link_new(parent.as_raw_fd(), &temp_name, &name)?;
    cleanup.remove()?;
    parent.sync_all().map_err(map_io)?;
    let result = stat_at(parent.as_raw_fd(), relative, &name);

    fn open_parent<'a>(
        root: &Path,
        relative: &'a Path,
    ) -> Result<(std::fs::File, &'a std::ffi::OsStr), ResourceFailure> {
        let mut directory = open_directory(libc::AT_FDCWD, root.as_os_str())?;
        let mut parts = relative
            .components()
            .filter_map(|part| match part {
                Component::Normal(value) => Some(value),
                _ => None,
            })
            .peekable();
        let Some(mut part) = parts.next() else {
            return Err(failure(ResourceErrorCode::InvalidPath, false));
        };
        for next in parts {
            directory = open_directory(directory.as_raw_fd(), part)?;
            part = next;
        }
        Ok((directory, part))
    }

    fn open_directory(fd: i32, name: &std::ffi::OsStr) -> Result<std::fs::File, ResourceFailure> {
        let name = CString::new(name.as_bytes())
            .map_err(|_| failure(ResourceErrorCode::InvalidPath, false))?;
        let flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_DIRECTORY;
        // SAFETY: name 是有效的 NUL 结尾缓冲；成功 fd 立即转交 File。
        let opened = unsafe { libc::openat(fd, name.as_ptr(), flags) };
        if opened < 0 {
            return Err(map_path_io(std::io::Error::last_os_error()));
        }
        // SAFETY: openat 返回新的 owned fd。
        Ok(unsafe { std::fs::File::from_raw_fd(opened) })
    }

    fn open_temp(fd: i32, name: &CStr) -> Result<std::fs::File, ResourceFailure> {
        let flags =
            libc::O_WRONLY | libc::O_CLOEXEC | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW;
        // SAFETY: name 是有效的 NUL 结尾缓冲；成功 fd 立即转交 File。
        let opened = unsafe { libc::openat(fd, name.as_ptr(), flags, 0o600) };
        if opened < 0 {
            return Err(map_io(std::io::Error::last_os_error()));
        }
        // SAFETY: openat 返回新的 owned fd。
        Ok(unsafe { std::fs::File::from_raw_fd(opened) })
    }

    fn validate_existing(fd: i32, name: &CStr) -> Result<(), ResourceFailure> {
        match metadata_at(fd, name)? {
            None => Ok(()),
            Some(_) => Err(failure(ResourceErrorCode::VersionConflict, false)),
        }
    }

    fn metadata_at(fd: i32, name: &CStr) -> Result<Option<std::fs::Metadata>, ResourceFailure> {
        let flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW;
        // SAFETY: name 是有效的 NUL 结尾缓冲；成功 fd 立即转交 File。
        let opened = unsafe { libc::openat(fd, name.as_ptr(), flags) };
        if opened < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(None);
            }
            return Err(map_path_io(error));
        }
        // SAFETY: openat 返回新的 owned fd。
        let file = unsafe { std::fs::File::from_raw_fd(opened) };
        let metadata = file.metadata().map_err(map_io)?;
        if !metadata.is_file() {
            return Err(failure(ResourceErrorCode::VersionConflict, false));
        }
        Ok(Some(metadata))
    }

    fn link_new(fd: i32, temp: &CStr, target: &CStr) -> Result<(), ResourceFailure> {
        // SAFETY: 两个名称均是有效 NUL 结尾缓冲，且由同一已锚定目录 fd 解析。
        let result = unsafe { libc::linkat(fd, temp.as_ptr(), fd, target.as_ptr(), 0) };
        if result == 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            Err(failure(ResourceErrorCode::VersionConflict, false))
        } else {
            Err(map_path_io(error))
        }
    }

    struct TempCleanup<'a> {
        fd: i32,
        name: &'a CStr,
        armed: bool,
    }
    impl<'a> TempCleanup<'a> {
        fn new(fd: i32, name: &'a CStr) -> Self {
            Self {
                fd,
                name,
                armed: true,
            }
        }
        fn remove(&mut self) -> Result<(), ResourceFailure> {
            // SAFETY: name 在 guard 生命周期内有效，fd 由调用方持有。
            let result = unsafe { libc::unlinkat(self.fd, self.name.as_ptr(), 0) };
            if result != 0 {
                return Err(map_io(std::io::Error::last_os_error()));
            }
            self.armed = false;
            Ok(())
        }
    }
    impl Drop for TempCleanup<'_> {
        fn drop(&mut self) {
            if self.armed {
                // SAFETY: best-effort 清理同目录临时文件；不记录路径或内容。
                unsafe {
                    libc::unlinkat(self.fd, self.name.as_ptr(), 0);
                }
            }
        }
    }

    result
}

#[cfg(not(unix))]
fn publish(
    root: &Path,
    relative: &Path,
    content: &[u8],
    before_publish: impl FnOnce(),
) -> Result<FsStat, ResourceFailure> {
    let parent_relative = relative.parent().unwrap_or_else(|| Path::new(""));
    let parent = std::fs::canonicalize(root.join(parent_relative)).map_err(map_io)?;
    if !parent.starts_with(root) || !parent.is_dir() {
        return Err(failure(ResourceErrorCode::OutsideWorkspace, false));
    }
    let target = parent.join(
        relative
            .file_name()
            .ok_or_else(|| failure(ResourceErrorCode::InvalidPath, false))?,
    );
    validate_path_absent(&target)?;
    let temp = parent.join(format!(".peri-upload-{}.tmp", uuid::Uuid::new_v4()));
    let mut cleanup = PathCleanup(Some(temp.clone()));
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(map_io)?;
    write_and_sync(&file, content)?;
    before_publish();
    let parent_now = std::fs::canonicalize(root.join(parent_relative)).map_err(map_io)?;
    if parent_now != parent {
        return Err(failure(ResourceErrorCode::OutsideWorkspace, false));
    }
    std::fs::hard_link(&temp, &target).map_err(map_publish_io)?;
    std::fs::remove_file(&temp).map_err(map_io)?;
    cleanup.0 = None;
    stat_path(relative, &target)
}

fn write_and_sync(file: &std::fs::File, content: &[u8]) -> Result<(), ResourceFailure> {
    let mut file = file;
    file.write_all(content).map_err(map_io)?;
    file.sync_all().map_err(map_io)
}

#[cfg(unix)]
fn stat_at(fd: i32, relative: &Path, name: &std::ffi::CStr) -> Result<FsStat, ResourceFailure> {
    use std::os::fd::FromRawFd;
    let flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW;
    // SAFETY: name 是有效 NUL 结尾缓冲；成功 fd 立即转交 File。
    let opened = unsafe { libc::openat(fd, name.as_ptr(), flags) };
    if opened < 0 {
        return Err(map_path_io(std::io::Error::last_os_error()));
    }
    // SAFETY: openat 返回新的 owned fd。
    let file = unsafe { std::fs::File::from_raw_fd(opened) };
    stat_metadata(relative, file.metadata().map_err(map_io)?)
}

#[cfg(not(unix))]
fn stat_path(relative: &Path, target: &Path) -> Result<FsStat, ResourceFailure> {
    stat_metadata(relative, std::fs::metadata(target).map_err(map_io)?)
}

fn stat_metadata(relative: &Path, metadata: std::fs::Metadata) -> Result<FsStat, ResourceFailure> {
    if !metadata.is_file() {
        return Err(failure(ResourceErrorCode::VersionConflict, false));
    }
    let mtime_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    Ok(FsStat {
        path: path_to_wire(relative)?,
        kind: FileKind::File,
        size: metadata.len(),
        mtime_ns: mtime_ns.to_string(),
        permissions: if metadata.permissions().readonly() {
            FsPermissions::ReadOnly
        } else {
            FsPermissions::ReadWrite
        },
        revision: revision_for_metadata(&metadata),
    })
}

fn revision_for_metadata(metadata: &std::fs::Metadata) -> String {
    let mtime_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    hash_text(&format!("file:{}:{mtime_ns}", metadata.len()))
}

#[cfg(unix)]
fn map_path_io(error: std::io::Error) -> ResourceFailure {
    if matches!(error.raw_os_error(), Some(code) if code == libc::ELOOP || code == libc::ENOTDIR) {
        failure(ResourceErrorCode::OutsideWorkspace, false)
    } else {
        map_io(error)
    }
}

#[cfg(not(unix))]
fn validate_path_absent(target: &Path) -> Result<(), ResourceFailure> {
    match std::fs::symlink_metadata(target) {
        Ok(_) => Err(failure(ResourceErrorCode::VersionConflict, false)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(map_io(error)),
    }
}

#[cfg(not(unix))]
fn map_publish_io(error: std::io::Error) -> ResourceFailure {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        failure(ResourceErrorCode::VersionConflict, false)
    } else {
        map_io(error)
    }
}

#[cfg(not(unix))]
struct PathCleanup(Option<PathBuf>);
#[cfg(not(unix))]
impl Drop for PathCleanup {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
#[path = "resource_write_test.rs"]
mod tests;
