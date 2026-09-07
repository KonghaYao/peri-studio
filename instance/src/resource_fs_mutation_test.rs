use std::path::Path;

use peri_studio_proto::resource::{
    CreateDirQuery, DeletePathQuery, FsMutationResult, FsStat, InstanceResourcePayload,
    MovePathQuery, ResourceErrorCode,
};
use tempfile::tempdir;

use super::{
    create_dir, create_dir_with_hook, delete_path, delete_path_with_hook,
    delete_path_with_progress_hook, move_path, move_path_with_hook,
};

fn create_query(path: &str) -> CreateDirQuery {
    CreateDirQuery {
        path: path.into(),
        if_none_match: "*".into(),
    }
}

fn move_query(source: &str, target: &str, revision: &str) -> MovePathQuery {
    MovePathQuery {
        source: source.into(),
        target: target.into(),
        source_if_match: revision.into(),
        target_if_match: None,
        target_if_none_match: Some("*".into()),
    }
}

fn delete_query(path: &str, revision: &str, recursive: bool) -> DeletePathQuery {
    DeletePathQuery {
        path: path.into(),
        if_match: revision.into(),
        recursive,
        use_trash: false,
    }
}

fn mutation(payload: InstanceResourcePayload) -> FsMutationResult {
    let InstanceResourcePayload::FsMutation(result) = payload else {
        panic!("expected FsMutation")
    };
    result
}

fn stat(result: &FsMutationResult) -> &FsStat {
    result.stat.as_ref().expect("expected stat")
}

fn create_and_stat(root: &Path, path: &str) -> FsMutationResult {
    mutation(create_dir(root.to_str().unwrap(), create_query(path)).unwrap())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn creates_one_directory_and_reports_parent() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("src")).unwrap();

    let result = create_and_stat(root.path(), "src/components");

    assert!(root.path().join("src/components").is_dir());
    assert_eq!(result.primary_path, "src/components");
    assert_eq!(result.affected_paths, ["src"]);
    assert_eq!(stat(&result).path, "src/components");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn create_conflict_and_missing_parent_have_no_second_effect() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("same")).unwrap();

    assert_eq!(
        create_dir(root.path().to_str().unwrap(), create_query("same"))
            .unwrap_err()
            .code,
        ResourceErrorCode::VersionConflict
    );
    assert_eq!(
        create_dir(root.path().to_str().unwrap(), create_query("missing/child"))
            .unwrap_err()
            .code,
        ResourceErrorCode::NotFound
    );
    assert!(root.path().join("same").is_dir());
    assert!(!root.path().join("missing").exists());
}

#[test]
fn rejects_invalid_paths_and_preconditions() {
    let root = tempdir().unwrap();
    for path in [
        "",
        "/absolute",
        "../escape",
        "a/../escape",
        "a\\b",
        "nul\0name",
        "a//b",
        "a/./b",
        "trailing/",
    ] {
        assert_eq!(
            create_dir(root.path().to_str().unwrap(), create_query(path))
                .unwrap_err()
                .code,
            ResourceErrorCode::InvalidPath,
            "path {path:?}"
        );
    }

    let mut create = create_query("created");
    create.if_none_match = "revision".into();
    assert_eq!(
        create_dir(root.path().to_str().unwrap(), create)
            .unwrap_err()
            .code,
        ResourceErrorCode::InvalidRequest
    );
    let invalid_move = MovePathQuery {
        source: "source".into(),
        target: "target".into(),
        source_if_match: String::new(),
        target_if_match: None,
        target_if_none_match: Some("*".into()),
    };
    assert_eq!(
        move_path(root.path().to_str().unwrap(), invalid_move)
            .unwrap_err()
            .code,
        ResourceErrorCode::InvalidRequest
    );
    assert_eq!(
        delete_path(
            root.path().to_str().unwrap(),
            DeletePathQuery {
                path: "entry".into(),
                if_match: "revision".into(),
                recursive: false,
                use_trash: true,
            },
        )
        .unwrap_err()
        .code,
        ResourceErrorCode::InvalidRequest
    );
}

#[test]
fn rejects_self_and_descendant_moves_before_io() {
    let root = tempdir().unwrap();
    for (source, target) in [("dir", "dir"), ("dir", "dir/child")] {
        assert_eq!(
            move_path(
                root.path().to_str().unwrap(),
                move_query(source, target, "revision"),
            )
            .unwrap_err()
            .code,
            ResourceErrorCode::InvalidRequest
        );
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn move_checks_source_cas_and_never_overwrites_target() {
    let root = tempdir().unwrap();
    let source = create_and_stat(root.path(), "source");
    std::fs::create_dir(root.path().join("target")).unwrap();

    assert_eq!(
        move_path(
            root.path().to_str().unwrap(),
            move_query("source", "renamed", "stale"),
        )
        .unwrap_err()
        .code,
        ResourceErrorCode::VersionConflict
    );
    assert_eq!(
        move_path(
            root.path().to_str().unwrap(),
            move_query("source", "target", &stat(&source).revision),
        )
        .unwrap_err()
        .code,
        ResourceErrorCode::VersionConflict
    );
    assert!(root.path().join("source").is_dir());
    assert!(root.path().join("target").is_dir());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn moves_across_directories_and_reports_both_parents() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("from")).unwrap();
    std::fs::create_dir(root.path().join("to")).unwrap();
    let source = create_and_stat(root.path(), "from/item");

    let result = mutation(
        move_path(
            root.path().to_str().unwrap(),
            move_query("from/item", "to/item", &stat(&source).revision),
        )
        .unwrap(),
    );

    assert!(!root.path().join("from/item").exists());
    assert!(root.path().join("to/item").is_dir());
    assert_eq!(result.primary_path, "to/item");
    assert_eq!(result.affected_paths, ["from", "to"]);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn deletes_file_empty_directory_and_recursive_directory_with_cas() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("file"), b"content").unwrap();
    let moved = create_and_stat(root.path(), "empty");
    let file_result = mutation(
        move_path(
            root.path().to_str().unwrap(),
            move_query("file", "renamed", &revision_for_entry(root.path(), "file")),
        )
        .unwrap(),
    );
    delete_path(
        root.path().to_str().unwrap(),
        delete_query("renamed", &stat(&file_result).revision, false),
    )
    .unwrap();
    delete_path(
        root.path().to_str().unwrap(),
        delete_query("empty", &stat(&moved).revision, false),
    )
    .unwrap();

    let tree = create_and_stat(root.path(), "tree");
    std::fs::create_dir(root.path().join("tree/child")).unwrap();
    std::fs::write(root.path().join("tree/child/file"), b"x").unwrap();
    let tree_revision = revision_for_entry(root.path(), "tree");
    assert_ne!(tree_revision, stat(&tree).revision);
    assert_eq!(
        delete_path(
            root.path().to_str().unwrap(),
            delete_query("tree", "stale", true),
        )
        .unwrap_err()
        .code,
        ResourceErrorCode::VersionConflict
    );
    delete_path(
        root.path().to_str().unwrap(),
        delete_query("tree", &tree_revision, true),
    )
    .unwrap();

    assert!(!root.path().join("renamed").exists());
    assert!(!root.path().join("empty").exists());
    assert!(!root.path().join("tree").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn non_recursive_delete_rejects_non_empty_directory() {
    let root = tempdir().unwrap();
    let directory = create_and_stat(root.path(), "dir");
    std::fs::write(root.path().join("dir/file"), b"x").unwrap();

    assert_eq!(
        delete_path(
            root.path().to_str().unwrap(),
            delete_query("dir", &stat(&directory).revision, false),
        )
        .unwrap_err()
        .code,
        ResourceErrorCode::VersionConflict
    );
    assert_eq!(std::fs::read(root.path().join("dir/file")).unwrap(), b"x");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn rejects_intermediate_and_target_symlinks_without_outside_effects() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    symlink(outside.path(), root.path().join("escape")).unwrap();
    assert_eq!(
        create_dir(root.path().to_str().unwrap(), create_query("escape/child"))
            .unwrap_err()
            .code,
        ResourceErrorCode::OutsideWorkspace
    );

    std::fs::write(outside.path().join("file"), b"outside").unwrap();
    symlink(outside.path().join("file"), root.path().join("link")).unwrap();
    assert_eq!(
        delete_path(
            root.path().to_str().unwrap(),
            delete_query("link", "revision", false),
        )
        .unwrap_err()
        .code,
        ResourceErrorCode::OutsideWorkspace
    );
    assert_eq!(
        std::fs::read(outside.path().join("file")).unwrap(),
        b"outside"
    );
    assert!(!outside.path().join("child").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn parent_symlink_swap_cannot_redirect_create() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let parent = root.path().join("parent");
    let moved = root.path().join("moved");
    std::fs::create_dir(&parent).unwrap();

    create_dir_with_hook(
        root.path().to_str().unwrap(),
        create_query("parent/child"),
        || {
            std::fs::rename(&parent, &moved).unwrap();
            symlink(outside.path(), &parent).unwrap();
        },
    )
    .unwrap();

    assert!(moved.join("child").is_dir());
    assert!(!outside.path().join("child").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn atomic_move_conflict_wins_toctou_race() {
    let root = tempdir().unwrap();
    let source = create_and_stat(root.path(), "source");
    let target = root.path().join("target");

    let error = move_path_with_hook(
        root.path().to_str().unwrap(),
        move_query("source", "target", &stat(&source).revision),
        || std::fs::create_dir(&target).unwrap(),
    )
    .unwrap_err();

    assert_eq!(error.code, ResourceErrorCode::VersionConflict);
    assert!(root.path().join("source").is_dir());
    assert!(target.is_dir());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn source_swap_after_cas_is_rejected() {
    let root = tempdir().unwrap();
    let source = create_and_stat(root.path(), "source");

    let error = move_path_with_hook(
        root.path().to_str().unwrap(),
        move_query("source", "target", &stat(&source).revision),
        || {
            std::fs::remove_dir(root.path().join("source")).unwrap();
            std::fs::create_dir(root.path().join("source")).unwrap();
            std::fs::write(root.path().join("source/new"), b"replacement").unwrap();
        },
    )
    .unwrap_err();

    assert_eq!(error.code, ResourceErrorCode::VersionConflict);
    assert!(root.path().join("source/new").is_file());
    assert!(!root.path().join("target").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn delete_swap_after_cas_preserves_replacement() {
    let root = tempdir().unwrap();
    let original = create_and_stat(root.path(), "entry");

    let error = delete_path_with_hook(
        root.path().to_str().unwrap(),
        delete_query("entry", &stat(&original).revision, false),
        || {
            std::fs::remove_dir(root.path().join("entry")).unwrap();
            std::fs::create_dir(root.path().join("entry")).unwrap();
            std::fs::write(root.path().join("entry/replacement"), b"replacement").unwrap();
        },
    )
    .unwrap_err();

    assert_eq!(error.code, ResourceErrorCode::VersionConflict);
    assert!(root.path().join("entry/replacement").is_file());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn recursive_delete_reports_partial_progress_after_first_removed_entry() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("tree")).unwrap();
    std::fs::write(root.path().join("tree/first"), b"first").unwrap();
    std::fs::write(root.path().join("tree/second"), b"second").unwrap();
    let revision = revision_for_entry(root.path(), "tree");
    let mut removed = 0;

    let error = delete_path_with_progress_hook(
        root.path().to_str().unwrap(),
        delete_query("tree", &revision, true),
        || {
            removed += 1;
            removed == 1
        },
    )
    .unwrap_err();

    assert_eq!(error.code, ResourceErrorCode::DeliveryUnknown);
    assert!(root.path().join("tree").is_dir());
    assert_eq!(
        std::fs::read_dir(root.path().join("tree")).unwrap().count(),
        1
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn replacing_inode_with_same_size_and_mtime_changes_revision() {
    use std::os::unix::fs::MetadataExt;

    let root = tempdir().unwrap();
    std::fs::write(root.path().join("entry"), b"same").unwrap();
    let first = revision_for_entry(root.path(), "entry");
    let metadata = std::fs::metadata(root.path().join("entry")).unwrap();
    std::fs::remove_file(root.path().join("entry")).unwrap();
    std::fs::write(root.path().join("entry"), b"same").unwrap();
    let times = [
        libc::timespec {
            tv_sec: metadata.mtime(),
            tv_nsec: metadata.mtime_nsec(),
        },
        libc::timespec {
            tv_sec: metadata.mtime(),
            tv_nsec: metadata.mtime_nsec(),
        },
    ];
    let path =
        std::ffi::CString::new(root.path().join("entry").as_os_str().as_encoded_bytes()).unwrap();
    // SAFETY: path 与 times 指针在调用期间有效。
    assert_eq!(
        unsafe { libc::utimensat(libc::AT_FDCWD, path.as_ptr(), times.as_ptr(), 0) },
        0
    );

    assert_ne!(revision_for_entry(root.path(), "entry"), first);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn revision_for_entry(root: &Path, path: &str) -> String {
    use peri_studio_proto::resource::{InstanceResourcePayload, ReadDirectoryQuery};

    let parent = Path::new(path)
        .parent()
        .and_then(Path::to_str)
        .unwrap_or_default();
    let InstanceResourcePayload::DirectoryPage(page) = super::super::fs::read_directory(
        root.to_str().unwrap(),
        ReadDirectoryQuery {
            path: parent.into(),
            cursor: None,
            limit: 100,
        },
    )
    .unwrap() else {
        panic!("expected directory page")
    };
    page.entries
        .into_iter()
        .find(|entry| entry.path == path)
        .unwrap()
        .revision
}
