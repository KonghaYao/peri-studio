use std::ffi::{CStr, CString, OsStr};
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::ffi::OsStrExt;

use super::*;

pub(super) fn create_dir_platform(
    root: &Path,
    relative: &Path,
    before_mutation: impl FnOnce(),
) -> Result<InstanceResourcePayload, ResourceFailure> {
    let (parent, name) = open_parent(root, relative)?;
    let name = c_name(name)?;
    before_mutation();
    // SAFETY: name 有效且 parent fd 在调用期间存活。
    if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o755) } != 0 {
        return Err(map_create_error(std::io::Error::last_os_error()));
    }
    parent.sync_all().map_err(map_io)?;
    let stat = stat_at(parent.as_raw_fd(), relative, &name)?;
    mutation_result(relative, vec![parent_wire(relative)?], Some(stat))
}

pub(super) fn move_path_platform(
    root: &Path,
    source: &Path,
    target: &Path,
    source_revision: &str,
    before_mutation: impl FnOnce(),
) -> Result<InstanceResourcePayload, ResourceFailure> {
    let (source_parent, source_name) = open_parent(root, source)?;
    let (target_parent, target_name) = open_parent(root, target)?;
    let source_name = c_name(source_name)?;
    let target_name = c_name(target_name)?;
    let source_stat = stat_at(source_parent.as_raw_fd(), source, &source_name)?;
    if source_stat.revision != source_revision {
        return Err(failure(ResourceErrorCode::VersionConflict, false));
    }
    let source_handle = open_identity_handle(source_parent.as_raw_fd(), &source_name)?;
    let source_identity = identity_of(&source_handle)?;
    before_mutation();
    let staging_name = unique_staging_name(source_parent.as_raw_fd())?;
    rename_exclusive(
        source_parent.as_raw_fd(),
        &source_name,
        source_parent.as_raw_fd(),
        &staging_name,
    )?;
    if identity_at(source_parent.as_raw_fd(), &staging_name)? != source_identity {
        restore_staging(source_parent.as_raw_fd(), &staging_name, &source_name);
        return Err(failure(ResourceErrorCode::VersionConflict, false));
    }
    if let Err(error) = rename_exclusive(
        source_parent.as_raw_fd(),
        &staging_name,
        target_parent.as_raw_fd(),
        &target_name,
    ) {
        restore_staging(source_parent.as_raw_fd(), &staging_name, &source_name);
        return Err(error);
    }
    source_parent.sync_all().map_err(map_io)?;
    if source_parent.as_raw_fd() != target_parent.as_raw_fd() {
        target_parent.sync_all().map_err(map_io)?;
    }
    let stat = stat_at(target_parent.as_raw_fd(), target, &target_name)?;
    let mut affected = vec![parent_wire(source)?];
    let target_parent_wire = parent_wire(target)?;
    if affected[0] != target_parent_wire {
        affected.push(target_parent_wire);
    }
    mutation_result(target, affected, Some(stat))
}

pub(super) fn delete_path_platform_with_hooks(
    root: &Path,
    relative: &Path,
    revision: &str,
    recursive: bool,
    before_isolation: impl FnOnce(),
    mut after_entry_removed: impl FnMut() -> bool,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    let (parent, name) = open_parent(root, relative)?;
    let name = c_name(name)?;
    let stat = stat_at(parent.as_raw_fd(), relative, &name)?;
    if stat.revision != revision {
        return Err(failure(ResourceErrorCode::VersionConflict, false));
    }
    let identity_handle = open_identity_handle(parent.as_raw_fd(), &name)?;
    let identity = identity_of(&identity_handle)?;
    before_isolation();
    let staging_name = unique_staging_name(parent.as_raw_fd())?;
    rename_exclusive(parent.as_raw_fd(), &name, parent.as_raw_fd(), &staging_name)?;
    let isolated = stat_at(parent.as_raw_fd(), relative, &staging_name)?;
    if identity_at(parent.as_raw_fd(), &staging_name)? != identity {
        restore_staging(parent.as_raw_fd(), &staging_name, &name);
        return Err(failure(ResourceErrorCode::VersionConflict, false));
    }
    if isolated.kind == FileKind::Directory && recursive {
        let directory = open_directory(
            parent.as_raw_fd(),
            OsStr::from_bytes(staging_name.to_bytes()),
        )?;
        if let Err(error) = remove_directory_contents(&directory, &mut after_entry_removed) {
            restore_staging(parent.as_raw_fd(), &staging_name, &name);
            return Err(error);
        }
    }
    let flags = if isolated.kind == FileKind::Directory {
        libc::AT_REMOVEDIR
    } else {
        0
    };
    // SAFETY: staging_name 是本次操作独占创建的目录项。
    if unsafe { libc::unlinkat(parent.as_raw_fd(), staging_name.as_ptr(), flags) } != 0 {
        let error = map_delete_error(std::io::Error::last_os_error());
        restore_staging(parent.as_raw_fd(), &staging_name, &name);
        return Err(error);
    }
    parent.sync_all().map_err(map_io)?;
    mutation_result(relative, vec![parent_wire(relative)?], None)
}

fn open_parent<'a>(
    root: &Path,
    relative: &'a Path,
) -> Result<(std::fs::File, &'a OsStr), ResourceFailure> {
    let mut directory = open_directory(libc::AT_FDCWD, root.as_os_str())?;
    let mut parts = relative.components().filter_map(|part| match part {
        Component::Normal(value) => Some(value),
        _ => None,
    });
    let Some(mut part) = parts.next() else {
        return Err(failure(ResourceErrorCode::InvalidPath, false));
    };
    for next in parts {
        directory = open_directory(directory.as_raw_fd(), part)?;
        part = next;
    }
    Ok((directory, part))
}

fn open_directory(fd: RawFd, name: &OsStr) -> Result<std::fs::File, ResourceFailure> {
    let name = c_name(name)?;
    let flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_DIRECTORY;
    // SAFETY: name 有效；成功 fd 立即交给 File 独占。
    let opened = unsafe { libc::openat(fd, name.as_ptr(), flags) };
    if opened < 0 {
        return Err(map_path_error(std::io::Error::last_os_error()));
    }
    // SAFETY: openat 返回新的 owned fd。
    Ok(unsafe { std::fs::File::from_raw_fd(opened) })
}

fn stat_at(fd: RawFd, relative: &Path, name: &CStr) -> Result<FsStat, ResourceFailure> {
    let flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW;
    // SAFETY: name 有效；成功 fd 立即交给 File 独占。
    let opened = unsafe { libc::openat(fd, name.as_ptr(), flags) };
    if opened < 0 {
        return Err(map_path_error(std::io::Error::last_os_error()));
    }
    // SAFETY: openat 返回新的 owned fd。
    let file = unsafe { std::fs::File::from_raw_fd(opened) };
    stat_metadata(relative, file.metadata().map_err(map_io)?)
}

fn stat_metadata(relative: &Path, metadata: std::fs::Metadata) -> Result<FsStat, ResourceFailure> {
    let kind = if metadata.is_dir() {
        FileKind::Directory
    } else if metadata.is_file() {
        FileKind::File
    } else {
        return Err(failure(ResourceErrorCode::OutsideWorkspace, false));
    };
    let mtime_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let path = path_to_wire(relative)?;
    Ok(FsStat {
        revision: fs_revision(&path, kind, &metadata),
        path,
        kind,
        size: metadata.len(),
        mtime_ns: mtime_ns.to_string(),
        permissions: if metadata.permissions().readonly() {
            FsPermissions::ReadOnly
        } else {
            FsPermissions::ReadWrite
        },
    })
}

fn remove_directory_contents(
    directory: &std::fs::File,
    after_entry_removed: &mut impl FnMut() -> bool,
) -> Result<(), ResourceFailure> {
    // SAFETY: dup 创建独立 owned fd，fdopendir 成功后由 closedir 接管。
    let duplicated = unsafe { libc::dup(directory.as_raw_fd()) };
    if duplicated < 0 {
        return Err(map_io(std::io::Error::last_os_error()));
    }
    // SAFETY: duplicated 是有效目录 fd。
    let stream = unsafe { libc::fdopendir(duplicated) };
    if stream.is_null() {
        // SAFETY: fdopendir 失败时 ownership 未转移。
        unsafe { libc::close(duplicated) };
        return Err(map_io(std::io::Error::last_os_error()));
    }
    let result = read_and_remove_entries(directory, stream, after_entry_removed);
    // SAFETY: stream 由 fdopendir 返回且仅关闭一次。
    unsafe { libc::closedir(stream) };
    result
}

fn read_and_remove_entries(
    directory: &std::fs::File,
    stream: *mut libc::DIR,
    after_entry_removed: &mut impl FnMut() -> bool,
) -> Result<(), ResourceFailure> {
    loop {
        // SAFETY: stream 在循环期间有效。
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            return Ok(());
        }
        // SAFETY: d_name 是 NUL 结尾数组。
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
        if matches!(name.to_bytes(), b"." | b"..") {
            continue;
        }
        let entry_type = entry_type_at(directory.as_raw_fd(), name)?;
        if entry_type == libc::S_IFDIR {
            let child = open_directory(directory.as_raw_fd(), OsStr::from_bytes(name.to_bytes()))?;
            remove_directory_contents(&child, after_entry_removed)?;
            // SAFETY: name 来自有效 dirent。
            if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) }
                != 0
            {
                return Err(map_delete_error(std::io::Error::last_os_error()));
            }
        } else if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            return Err(map_delete_error(std::io::Error::last_os_error()));
        }
        if after_entry_removed() {
            return Err(failure(ResourceErrorCode::DeliveryUnknown, false));
        }
    }
}

fn entry_type_at(fd: RawFd, name: &CStr) -> Result<libc::mode_t, ResourceFailure> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: stat 指向可写缓冲；不跟随 symlink。
    let result = unsafe {
        libc::fstatat(
            fd,
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result != 0 {
        return Err(map_path_error(std::io::Error::last_os_error()));
    }
    // SAFETY: fstatat 成功后已初始化。
    Ok(unsafe { stat.assume_init() }.st_mode & libc::S_IFMT)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EntryIdentity {
    dev: libc::dev_t,
    ino: u64,
    mode: libc::mode_t,
}

fn identity_of(file: &std::fs::File) -> Result<EntryIdentity, ResourceFailure> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: stat 指向可写缓冲，file fd 在调用期间有效。
    if unsafe { libc::fstat(file.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
        return Err(map_io(std::io::Error::last_os_error()));
    }
    // SAFETY: fstat 成功后已初始化。
    let stat = unsafe { stat.assume_init() };
    Ok(EntryIdentity {
        dev: stat.st_dev,
        ino: stat.st_ino,
        mode: stat.st_mode,
    })
}

fn open_identity_handle(fd: RawFd, name: &CStr) -> Result<std::fs::File, ResourceFailure> {
    // O_RDONLY 可同时打开文件和目录；O_NONBLOCK 避免 FIFO 等特殊文件阻塞。
    let flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK;
    // SAFETY: name 是存活的 NUL 结尾缓冲；成功 fd 立即交给 File 独占。
    let opened = unsafe { libc::openat(fd, name.as_ptr(), flags) };
    if opened < 0 {
        return Err(map_path_error(std::io::Error::last_os_error()));
    }
    // SAFETY: openat 返回新的 owned fd，File 成为唯一 owner。
    Ok(unsafe { std::fs::File::from_raw_fd(opened) })
}

fn identity_at(fd: RawFd, name: &CStr) -> Result<EntryIdentity, ResourceFailure> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: stat 指向可写缓冲；不跟随 symlink。
    if unsafe {
        libc::fstatat(
            fd,
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return Err(map_path_error(std::io::Error::last_os_error()));
    }
    // SAFETY: fstatat 成功后已初始化。
    let stat = unsafe { stat.assume_init() };
    Ok(EntryIdentity {
        dev: stat.st_dev,
        ino: stat.st_ino,
        mode: stat.st_mode,
    })
}

fn unique_staging_name(fd: RawFd) -> Result<CString, ResourceFailure> {
    for _ in 0..16 {
        let name = CString::new(format!(".peri-fs-mutation-{}", uuid::Uuid::new_v4())).unwrap();
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: stat 缓冲有效。
        if unsafe {
            libc::fstatat(
                fd,
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ENOENT) {
                return Ok(name);
            }
            return Err(map_path_error(error));
        }
    }
    Err(failure(ResourceErrorCode::RateLimited, true))
}

fn restore_staging(fd: RawFd, staging: &CStr, original: &CStr) {
    let _ = rename_exclusive(fd, staging, fd, original);
}

#[cfg(target_os = "linux")]
fn rename_exclusive(
    from_fd: RawFd,
    from: &CStr,
    to_fd: RawFd,
    to: &CStr,
) -> Result<(), ResourceFailure> {
    // SAFETY: names 与 fd 在调用期间有效。
    let result = unsafe {
        libc::renameat2(
            from_fd,
            from.as_ptr(),
            to_fd,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(map_rename_error(std::io::Error::last_os_error()))
    }
}

#[cfg(target_os = "macos")]
fn rename_exclusive(
    from_fd: RawFd,
    from: &CStr,
    to_fd: RawFd,
    to: &CStr,
) -> Result<(), ResourceFailure> {
    // SAFETY: names 与 fd 在调用期间有效。
    let result = unsafe {
        libc::renameatx_np(
            from_fd,
            from.as_ptr(),
            to_fd,
            to.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(map_rename_error(std::io::Error::last_os_error()))
    }
}

fn c_name(name: &OsStr) -> Result<CString, ResourceFailure> {
    CString::new(name.as_bytes()).map_err(|_| failure(ResourceErrorCode::InvalidPath, false))
}

fn map_path_error(error: std::io::Error) -> ResourceFailure {
    if matches!(error.raw_os_error(), Some(code) if code == libc::ELOOP || code == libc::ENOTDIR) {
        failure(ResourceErrorCode::OutsideWorkspace, false)
    } else {
        map_io(error)
    }
}

fn map_create_error(error: std::io::Error) -> ResourceFailure {
    if error.raw_os_error() == Some(libc::EEXIST) {
        failure(ResourceErrorCode::VersionConflict, false)
    } else {
        map_path_error(error)
    }
}

fn map_rename_error(error: std::io::Error) -> ResourceFailure {
    if matches!(error.raw_os_error(), Some(code) if code == libc::EEXIST || code == libc::ENOTEMPTY)
    {
        failure(ResourceErrorCode::VersionConflict, false)
    } else {
        map_path_error(error)
    }
}

fn map_delete_error(error: std::io::Error) -> ResourceFailure {
    if matches!(error.raw_os_error(), Some(code) if code == libc::ENOTEMPTY || code == libc::EISDIR)
    {
        failure(ResourceErrorCode::VersionConflict, false)
    } else {
        map_path_error(error)
    }
}
