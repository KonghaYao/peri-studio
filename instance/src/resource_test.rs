use std::process::Command;

use base64::Engine as _;
use peri_studio_proto::resource::{
    GitGroupId, InstanceResourcePayload, InstanceResourceQuery, InstanceResourceQueryKind,
    ReadDirectoryQuery, ResourceErrorCode,
};
use tempfile::tempdir;

use super::ResourceHost;

fn query(root: &std::path::Path, kind: InstanceResourceQueryKind) -> InstanceResourceQuery {
    InstanceResourceQuery {
        request_id: uuid::Uuid::new_v4().to_string(),
        workspace_id: "workspace-1".into(),
        root: root.to_string_lossy().into_owned(),
        query: kind,
    }
}

#[tokio::test]
async fn directory_query_is_sorted_bounded_and_rejects_escape() {
    let dir = tempdir().unwrap();
    std::fs::create_dir(dir.path().join("src")).unwrap();
    std::fs::write(dir.path().join("z.txt"), b"z").unwrap();
    std::fs::write(dir.path().join("a.txt"), b"a").unwrap();
    let host = ResourceHost::default();

    let result = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::ReadDirectory(ReadDirectoryQuery {
                path: String::new(),
                cursor: None,
                limit: 2,
            }),
        ))
        .await;
    let InstanceResourcePayload::DirectoryPage(page) = result.result.unwrap() else {
        panic!("expected directory page")
    };
    assert_eq!(
        page.entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>(),
        vec!["src", "a.txt"]
    );
    assert!(page.next_cursor.is_some());

    let escaped = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::ReadDirectory(ReadDirectoryQuery {
                path: "../".into(),
                cursor: None,
                limit: 20,
            }),
        ))
        .await;
    assert_eq!(escaped.error.unwrap().code, ResourceErrorCode::InvalidPath);
}

#[tokio::test]
async fn file_blob_is_bounded_and_preserves_exact_bytes() {
    let root = tempdir().unwrap();
    std::fs::write(root.path().join("hello.txt"), b"hello\0world").unwrap();
    let result = ResourceHost::default()
        .query(query(
            root.path(),
            InstanceResourceQueryKind::ReadFile(peri_studio_proto::resource::ReadFileQuery {
                path: "hello.txt".into(),
                max_bytes: 32,
            }),
        ))
        .await;
    let InstanceResourcePayload::Blob(blob) = result.result.unwrap() else {
        panic!("expected blob");
    };
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(blob.content_base64)
            .unwrap(),
        b"hello\0world"
    );
    assert_eq!(blob.content_type, "text/plain; charset=utf-8");

    let too_small = ResourceHost::default()
        .query(query(
            root.path(),
            InstanceResourceQueryKind::ReadFile(peri_studio_proto::resource::ReadFileQuery {
                path: "hello.txt".into(),
                max_bytes: 4,
            }),
        ))
        .await;
    assert_eq!(
        too_small.error.unwrap().code,
        ResourceErrorCode::ViewTooLarge
    );
}

#[cfg(unix)]
#[tokio::test]
async fn directory_query_rejects_a_symlink_that_leaves_the_workspace() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    std::fs::write(outside.path().join("secret"), b"hidden").unwrap();
    symlink(outside.path(), root.path().join("escape")).unwrap();

    let result = ResourceHost::default()
        .query(query(
            root.path(),
            InstanceResourceQueryKind::ReadDirectory(ReadDirectoryQuery {
                path: "escape".into(),
                cursor: None,
                limit: 20,
            }),
        ))
        .await;
    assert_eq!(
        result.error.unwrap().code,
        ResourceErrorCode::OutsideWorkspace
    );
}

#[tokio::test]
async fn git_query_projects_repository_groups_without_raw_output() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    let run = |args: &[&str]| {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git command failed: {args:?}");
    };
    run(&["init", "-q"]);
    run(&["config", "user.email", "test@example.invalid"]);
    run(&["config", "user.name", "Peri Test"]);
    std::fs::write(dir.path().join("tracked.txt"), b"one\n").unwrap();
    run(&["add", "tracked.txt"]);
    run(&["commit", "-qm", "initial"]);
    std::fs::write(dir.path().join("tracked.txt"), b"two\n").unwrap();
    std::fs::write(dir.path().join("staged.txt"), b"staged\n").unwrap();
    run(&["add", "staged.txt"]);
    std::fs::write(dir.path().join("new.txt"), b"new\n").unwrap();

    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let InstanceResourcePayload::RepositoriesPage(repos) = discovered.result.unwrap() else {
        panic!("expected repositories")
    };
    assert_eq!(repos.repositories.len(), 1);
    let repo_id = repos.repositories[0].repo_id.clone();

    let snapshot = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitSnapshot(peri_studio_proto::resource::GitSnapshotQuery {
                repo_id: repo_id.clone(),
            }),
        ))
        .await;
    let InstanceResourcePayload::GitRepository(repo) = snapshot.result.unwrap() else {
        panic!("expected git repository")
    };
    let count = |group| {
        repo.groups
            .iter()
            .find(|item| item.id == group)
            .map(|item| item.count)
            .unwrap_or_default()
    };
    assert_eq!(count(GitGroupId::Index), 1);
    assert_eq!(count(GitGroupId::WorkingTree), 1);
    assert_eq!(count(GitGroupId::Untracked), 1);

    let competing_host = host.clone();
    let generation = repo.generation.clone();
    let first = host.query(query(
        dir.path(),
        InstanceResourceQueryKind::GitMutate(peri_studio_proto::resource::GitMutateQuery {
            repo_id: repo_id.clone(),
            action: peri_studio_proto::resource::ResourceGitActionKind::Stage,
            paths: vec!["new.txt".into()],
            expected_generation: generation.clone(),
        }),
    ));
    let second = competing_host.query(query(
        dir.path(),
        InstanceResourceQueryKind::GitMutate(peri_studio_proto::resource::GitMutateQuery {
            repo_id: repo_id.clone(),
            action: peri_studio_proto::resource::ResourceGitActionKind::Stage,
            paths: vec!["tracked.txt".into()],
            expected_generation: generation,
        }),
    ));
    let (first, second) = tokio::join!(first, second);
    let results = [first, second];
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result.result, Some(InstanceResourcePayload::Mutation(_))))
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result
                .error
                .as_ref()
                .is_some_and(|error| error.code == ResourceErrorCode::VersionConflict))
            .count(),
        1
    );
    let refreshed = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitSnapshot(peri_studio_proto::resource::GitSnapshotQuery {
                repo_id,
            }),
        ))
        .await;
    let Some(InstanceResourcePayload::GitRepository(refreshed)) = refreshed.result else {
        panic!("expected refreshed repository");
    };
    assert_eq!(
        refreshed
            .groups
            .iter()
            .find(|group| group.id == GitGroupId::Index)
            .unwrap()
            .count,
        2
    );
    assert_eq!(
        refreshed
            .groups
            .iter()
            .find(|group| group.id == GitGroupId::Untracked)
            .unwrap()
            .count,
        0
    );
}
