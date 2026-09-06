use std::path::Path;

use base64::Engine as _;
use peri_studio_proto::resource::{
    FsStat, InstanceResourcePayload, ResourceErrorCode, WriteFileQuery, MAX_RESOURCE_BLOB_BYTES,
};
use tempfile::tempdir;

use super::{write_file, write_file_with_hook};

fn query(path: &str, content: &[u8]) -> WriteFileQuery {
    WriteFileQuery {
        path: path.into(),
        content_base64: base64::engine::general_purpose::STANDARD.encode(content),
        if_match: None,
        if_none_match: Some("*".into()),
    }
}

fn stat(payload: InstanceResourcePayload) -> FsStat {
    let InstanceResourcePayload::FsStat(stat) = payload else {
        panic!("expected FsStat")
    };
    stat
}

fn assert_no_temp_files(root: &Path) {
    let names = std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert!(names.iter().all(|name| !name.starts_with(".peri-upload-")));
}

#[test]
fn writes_normal_and_empty_files_create_only() {
    let root = tempdir().unwrap();
    std::fs::create_dir(root.path().join("src")).unwrap();

    let created = stat(
        write_file(
            root.path().to_str().unwrap(),
            query("src/hello.txt", b"hello"),
        )
        .unwrap(),
    );
    assert_eq!(created.path, "src/hello.txt");
    assert_eq!(created.size, 5);
    assert_eq!(
        std::fs::read(root.path().join("src/hello.txt")).unwrap(),
        b"hello"
    );

    let empty = stat(write_file(root.path().to_str().unwrap(), query("empty.txt", b"")).unwrap());
    assert_eq!(empty.size, 0);
    assert_eq!(std::fs::read(root.path().join("empty.txt")).unwrap(), b"");
    assert_no_temp_files(root.path());
}

#[test]
fn create_only_conflict_preserves_original_and_cleans_temp() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("same.txt"), b"original").unwrap();

    let error = write_file(
        root.path().to_str().unwrap(),
        query("same.txt", b"replacement"),
    )
    .unwrap_err();

    assert_eq!(error.code, ResourceErrorCode::VersionConflict);
    assert_eq!(
        std::fs::read(root.path().join("same.txt")).unwrap(),
        b"original"
    );
    assert_no_temp_files(root.path());
}

#[test]
fn rejects_if_match_because_v1_is_create_only() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("file.txt"), b"first").unwrap();
    let replacement = WriteFileQuery {
        path: "file.txt".into(),
        content_base64: base64::engine::general_purpose::STANDARD.encode(b"second"),
        if_match: Some("opaque-revision".into()),
        if_none_match: None,
    };

    assert_eq!(
        write_file(root.path().to_str().unwrap(), replacement)
            .unwrap_err()
            .code,
        ResourceErrorCode::InvalidRequest
    );
    assert_eq!(
        std::fs::read(root.path().join("file.txt")).unwrap(),
        b"first"
    );
    assert_no_temp_files(root.path());
}

#[test]
fn rejects_oversized_and_malformed_content_without_temp_files() {
    let root = tempdir().unwrap();
    let oversized = vec![0_u8; MAX_RESOURCE_BLOB_BYTES as usize + 1];
    let error = write_file(
        root.path().to_str().unwrap(),
        query("large.bin", &oversized),
    )
    .unwrap_err();
    assert_eq!(error.code, ResourceErrorCode::UploadTooLarge);

    let mut malformed = query("bad.bin", b"");
    malformed.content_base64 = "not-base64".into();
    assert_eq!(
        write_file(root.path().to_str().unwrap(), malformed)
            .unwrap_err()
            .code,
        ResourceErrorCode::InvalidRequest
    );
    assert_no_temp_files(root.path());
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
            write_file(root.path().to_str().unwrap(), query(path, b"x"))
                .unwrap_err()
                .code,
            ResourceErrorCode::InvalidPath,
            "path {path:?}"
        );
    }

    let mut neither = query("file.txt", b"x");
    neither.if_none_match = None;
    assert_eq!(
        write_file(root.path().to_str().unwrap(), neither)
            .unwrap_err()
            .code,
        ResourceErrorCode::InvalidRequest
    );
    let mut both = query("file.txt", b"x");
    both.if_match = Some("revision".into());
    assert_eq!(
        write_file(root.path().to_str().unwrap(), both)
            .unwrap_err()
            .code,
        ResourceErrorCode::InvalidRequest
    );
    let mut invalid_none_match = query("file.txt", b"x");
    invalid_none_match.if_none_match = Some("revision".into());
    assert_eq!(
        write_file(root.path().to_str().unwrap(), invalid_none_match)
            .unwrap_err()
            .code,
        ResourceErrorCode::InvalidRequest
    );
    assert_no_temp_files(root.path());
}

#[cfg(unix)]
#[test]
fn rejects_intermediate_and_target_symlinks() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    symlink(outside.path(), root.path().join("escape")).unwrap();
    assert_eq!(
        write_file(
            root.path().to_str().unwrap(),
            query("escape/file.txt", b"x")
        )
        .unwrap_err()
        .code,
        ResourceErrorCode::OutsideWorkspace
    );
    assert!(!outside.path().join("file.txt").exists());

    std::fs::write(outside.path().join("original.txt"), b"outside").unwrap();
    symlink(
        outside.path().join("original.txt"),
        root.path().join("target.txt"),
    )
    .unwrap();
    assert_eq!(
        write_file(root.path().to_str().unwrap(), query("target.txt", b"x"))
            .unwrap_err()
            .code,
        ResourceErrorCode::OutsideWorkspace
    );
    assert_eq!(
        std::fs::read(outside.path().join("original.txt")).unwrap(),
        b"outside"
    );
    assert_no_temp_files(root.path());
}

#[cfg(unix)]
#[test]
fn create_only_toctou_conflict_is_atomic_and_cleans_temp() {
    let root = tempdir().unwrap();
    let target = root.path().join("race.txt");
    let result = write_file_with_hook(
        root.path().to_str().unwrap(),
        query("race.txt", b"uploaded"),
        || std::fs::write(&target, b"racer").unwrap(),
    );

    assert_eq!(result.unwrap_err().code, ResourceErrorCode::VersionConflict);
    assert_eq!(std::fs::read(target).unwrap(), b"racer");
    assert_no_temp_files(root.path());
}

#[cfg(unix)]
#[test]
fn parent_symlink_swap_does_not_redirect_publish() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let parent = root.path().join("dir");
    let moved = root.path().join("moved");
    std::fs::create_dir(&parent).unwrap();

    let result = write_file_with_hook(
        root.path().to_str().unwrap(),
        query("dir/file.txt", b"uploaded"),
        || {
            std::fs::rename(&parent, &moved).unwrap();
            symlink(outside.path(), &parent).unwrap();
        },
    );

    assert!(result.is_ok());
    assert_eq!(std::fs::read(moved.join("file.txt")).unwrap(), b"uploaded");
    assert!(!outside.path().join("file.txt").exists());
    assert_no_temp_files(&moved);
}
