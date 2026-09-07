use std::path::{Component, Path, PathBuf};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::time::UNIX_EPOCH;

use peri_studio_proto::resource::{
    CreateDirQuery, DeletePathQuery, InstanceResourcePayload, MovePathQuery, ResourceErrorCode,
    ResourceFailure,
};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use peri_studio_proto::resource::{FileKind, FsMutationResult, FsPermissions, FsStat};

use super::common::{canonical_root, failure, validate_relative};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use super::common::{fs_revision, map_io, path_to_wire};

pub(super) fn create_dir(
    root: &str,
    query: CreateDirQuery,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    create_dir_with_hook(root, query, || {})
}

fn create_dir_with_hook(
    root: &str,
    query: CreateDirQuery,
    before_mutation: impl FnOnce(),
) -> Result<InstanceResourcePayload, ResourceFailure> {
    let relative = validate_mutation_path(&query.path)?;
    if query.if_none_match != "*" {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    let root = canonical_root(root)?;
    create_dir_platform(&root, &relative, before_mutation)
}

pub(super) fn move_path(
    root: &str,
    query: MovePathQuery,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    move_path_with_hook(root, query, || {})
}

fn move_path_with_hook(
    root: &str,
    query: MovePathQuery,
    before_mutation: impl FnOnce(),
) -> Result<InstanceResourcePayload, ResourceFailure> {
    let source = validate_mutation_path(&query.source)?;
    let target = validate_mutation_path(&query.target)?;
    validate_move_preconditions(&query)?;
    if source == target || target.starts_with(&source) {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    let root = canonical_root(root)?;
    move_path_platform(
        &root,
        &source,
        &target,
        &query.source_if_match,
        before_mutation,
    )
}

pub(super) fn delete_path(
    root: &str,
    query: DeletePathQuery,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    delete_path_with_hook(root, query, || {})
}

fn delete_path_with_hook(
    root: &str,
    query: DeletePathQuery,
    before_isolation: impl FnOnce(),
) -> Result<InstanceResourcePayload, ResourceFailure> {
    let relative = validate_mutation_path(&query.path)?;
    if query.if_match.is_empty() || query.use_trash {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    let root = canonical_root(root)?;
    delete_path_platform_with_hooks(
        &root,
        &relative,
        &query.if_match,
        query.recursive,
        before_isolation,
        || false,
    )
}

#[cfg(test)]
fn delete_path_with_progress_hook(
    root: &str,
    query: DeletePathQuery,
    after_entry_removed: impl FnMut() -> bool,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    let relative = validate_mutation_path(&query.path)?;
    if query.if_match.is_empty() || query.use_trash {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    let root = canonical_root(root)?;
    delete_path_platform_with_hooks(
        &root,
        &relative,
        &query.if_match,
        query.recursive,
        || {},
        after_entry_removed,
    )
}

fn validate_mutation_path(value: &str) -> Result<PathBuf, ResourceFailure> {
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

fn validate_move_preconditions(query: &MovePathQuery) -> Result<(), ResourceFailure> {
    if query.source_if_match.is_empty()
        || query.target_if_match.is_some()
        || query.target_if_none_match.as_deref() != Some("*")
    {
        return Err(failure(ResourceErrorCode::InvalidRequest, false));
    }
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn parent_wire(path: &Path) -> Result<String, ResourceFailure> {
    path_to_wire(path.parent().unwrap_or_else(|| Path::new("")))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn mutation_result(
    primary_path: &Path,
    affected_paths: Vec<String>,
    stat: Option<FsStat>,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    Ok(InstanceResourcePayload::FsMutation(FsMutationResult {
        primary_path: path_to_wire(primary_path)?,
        affected_paths,
        stat,
    }))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[path = "resource_fs_mutation_unix.rs"]
mod supported_unix;

#[cfg(any(target_os = "linux", target_os = "macos"))]
use supported_unix::{create_dir_platform, delete_path_platform_with_hooks, move_path_platform};

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn create_dir_platform(
    _root: &Path,
    _relative: &Path,
    _before_mutation: impl FnOnce(),
) -> Result<InstanceResourcePayload, ResourceFailure> {
    Err(failure(ResourceErrorCode::ResourceUnsupported, false))
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn move_path_platform(
    _root: &Path,
    _source: &Path,
    _target: &Path,
    _source_revision: &str,
    _before_mutation: impl FnOnce(),
) -> Result<InstanceResourcePayload, ResourceFailure> {
    Err(failure(ResourceErrorCode::ResourceUnsupported, false))
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn delete_path_platform_with_hooks(
    _root: &Path,
    _relative: &Path,
    _revision: &str,
    _recursive: bool,
    _before_isolation: impl FnOnce(),
    _after_entry_removed: impl FnMut() -> bool,
) -> Result<InstanceResourcePayload, ResourceFailure> {
    Err(failure(ResourceErrorCode::ResourceUnsupported, false))
}

#[cfg(test)]
#[path = "resource_fs_mutation_test.rs"]
mod tests;
