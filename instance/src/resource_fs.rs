use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

use base64::Engine as _;
use peri_studio_proto::resource::{
    DirectoryPage, FileEntry, FileKind, InstanceBlob, InstanceResourcePayload, ReadDirectoryQuery,
    ReadFileQuery, ResourceErrorCode, ResourceFailure, MAX_DIRECTORY_PAGE_SIZE,
    MAX_RESOURCE_BLOB_BYTES,
};
use sha2::{Digest, Sha256};

use super::common::{
    canonical_root, cursor_for, failure, fs_revision, hash_bytes, hash_text, map_io, parse_cursor,
    path_to_wire, validate_relative,
};

pub(super) fn read_directory(
    root: &str,
    query: ReadDirectoryQuery,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    if query.limit == 0 || query.limit > MAX_DIRECTORY_PAGE_SIZE {
        return Err(failure(ResourceErrorCode::ViewTooLarge, false));
    }
    let root = canonical_root(root)?;
    let relative = validate_relative(&query.path)?;
    let canonical = std::fs::canonicalize(root.join(&relative)).map_err(map_io)?;
    if !canonical.starts_with(&root) {
        return Err(failure(ResourceErrorCode::OutsideWorkspace, false));
    }
    if !canonical.is_dir() {
        return Err(failure(ResourceErrorCode::NotDirectory, false));
    }
    let mut entries = std::fs::read_dir(&canonical)
        .map_err(map_io)?
        .map(|entry| {
            entry
                .map_err(map_io)
                .and_then(|entry| file_entry(&relative, entry))
        })
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|left, right| {
        file_kind_order(left.kind)
            .cmp(&file_kind_order(right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    let generation = directory_generation(&entries);
    let offset = parse_cursor(query.cursor.as_deref(), &generation)?;
    let end = (offset + query.limit as usize).min(entries.len());
    let page = entries[offset.min(entries.len())..end].to_vec();
    let next_cursor = (end < entries.len()).then(|| cursor_for(&generation, end));
    Ok(InstanceResourcePayload::DirectoryPage(DirectoryPage {
        path: path_to_wire(&relative)?,
        source_generation: generation,
        entries: page,
        next_cursor,
    }))
}

pub(super) fn read_file(
    root: &str,
    query: ReadFileQuery,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    read_file_with_hook(root, query, || {})
}

pub(super) fn read_file_with_hook(
    root: &str,
    query: ReadFileQuery,
    before_final_open: impl FnOnce(),
) -> Result<InstanceResourcePayload, ResourceFailure> {
    if query.max_bytes == 0 || query.max_bytes > MAX_RESOURCE_BLOB_BYTES {
        return Err(failure(ResourceErrorCode::ViewTooLarge, false));
    }
    let root = canonical_root(root)?;
    let relative = validate_relative(&query.path)?;
    let file = open_workspace_file(&root, &relative, before_final_open)?;
    let metadata = file.metadata().map_err(map_io)?;
    if !metadata.is_file() {
        return Err(failure(ResourceErrorCode::NotFound, false));
    }
    if metadata.len() > query.max_bytes {
        return Err(failure(ResourceErrorCode::ViewTooLarge, false));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(query.max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(map_io)?;
    if bytes.len() as u64 > query.max_bytes {
        return Err(failure(ResourceErrorCode::ViewTooLarge, false));
    }
    Ok(InstanceResourcePayload::Blob(InstanceBlob {
        content_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        content_type: content_type(&query.path).to_string(),
        etag: hash_bytes(&bytes),
    }))
}

#[cfg(unix)]
fn open_workspace_file(
    root: &Path,
    relative: &Path,
    before_final_open: impl FnOnce(),
) -> Result<std::fs::File, ResourceFailure> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;

    fn open_at(
        directory_fd: i32,
        name: &std::ffi::OsStr,
        directory: bool,
    ) -> Result<std::fs::File, ResourceFailure> {
        let name = CString::new(name.as_bytes())
            .map_err(|_| failure(ResourceErrorCode::InvalidPath, false))?;
        let mut flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW;
        if directory {
            flags |= libc::O_DIRECTORY;
        }
        // SAFETY: `name` 是存活的 NUL 结尾缓冲；成功 fd 立即交给 File 独占。
        let fd = unsafe { libc::openat(directory_fd, name.as_ptr(), flags) };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            if matches!(error.raw_os_error(), Some(code) if code == libc::ELOOP || code == libc::ENOTDIR)
            {
                return Err(failure(ResourceErrorCode::OutsideWorkspace, false));
            }
            return Err(map_io(error));
        }
        // SAFETY: `openat` 返回新的 owned fd，File 成为唯一 owner。
        Ok(unsafe { std::fs::File::from_raw_fd(fd) })
    }

    let mut directory = open_at(libc::AT_FDCWD, root.as_os_str(), true)?;
    let mut components = relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value),
            _ => None,
        })
        .peekable();
    let Some(mut component) = components.next() else {
        return Err(failure(ResourceErrorCode::NotFound, false));
    };
    for next in components {
        directory = open_at(directory.as_raw_fd(), component, true)?;
        component = next;
    }
    before_final_open();
    open_at(directory.as_raw_fd(), component, false)
}

#[cfg(not(unix))]
fn open_workspace_file(
    root: &Path,
    relative: &Path,
    before_final_open: impl FnOnce(),
) -> Result<std::fs::File, ResourceFailure> {
    let canonical = std::fs::canonicalize(root.join(relative)).map_err(map_io)?;
    if !canonical.starts_with(root) {
        return Err(failure(ResourceErrorCode::OutsideWorkspace, false));
    }
    before_final_open();
    std::fs::File::open(canonical).map_err(map_io)
}

fn content_type(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "txt" | "js" | "mjs" | "ts" | "tsx" | "jsx" | "json" | "md" | "rs" | "toml" | "yaml"
        | "yml" => "text/plain; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn file_entry(relative_dir: &Path, entry: std::fs::DirEntry) -> Result<FileEntry, ResourceFailure> {
    let name = entry
        .file_name()
        .into_string()
        .map_err(|_| failure(ResourceErrorCode::InvalidPath, false))?;
    let relative = relative_dir.join(&name);
    let metadata = std::fs::symlink_metadata(entry.path()).map_err(map_io)?;
    let file_type = metadata.file_type();
    let kind = if file_type.is_dir() {
        FileKind::Directory
    } else if file_type.is_file() {
        FileKind::File
    } else if file_type.is_symlink() {
        FileKind::Symlink
    } else {
        FileKind::Other
    };
    let path = path_to_wire(&relative)?;
    let mtime_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let revision = fs_revision(&path, kind, &metadata);
    Ok(FileEntry {
        id: hash_text(&path),
        name,
        path,
        kind,
        size: metadata.len(),
        mtime_ns: mtime_ns.to_string(),
        revision,
    })
}

fn directory_generation(entries: &[FileEntry]) -> String {
    let mut hasher = Sha256::new();
    for entry in entries {
        hasher.update(entry.name.as_bytes());
        hasher.update(entry.revision.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn file_kind_order(kind: FileKind) -> u8 {
    match kind {
        FileKind::Directory => 0,
        FileKind::File => 1,
        FileKind::Symlink => 2,
        FileKind::Other => 3,
    }
}
