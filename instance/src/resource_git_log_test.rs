use std::process::Command;

use peri_studio_proto::resource::{
    GitLogQuery, GitLogScope, InstanceResourcePayload, InstanceResourceQuery,
    InstanceResourceQueryKind, MAX_COMMIT_MESSAGE_BYTES, ResourceErrorCode,
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

fn init_repo(dir: &std::path::Path) {
    let run = |args: &[&str]| {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git command failed: {args:?}");
    };
    run(&["init", "-q"]);
    run(&["config", "user.email", "test@example.invalid"]);
    run(&["config", "user.name", "Peri Test"]);
}

#[tokio::test]
async fn git_log_paginates_linear_history() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    init_repo(dir.path());
    for index in 0..3 {
        std::fs::write(
            dir.path().join(format!("file-{index}.txt")),
            format!("content-{index}\n"),
        )
        .unwrap();
        let status = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(["add", &format!("file-{index}.txt")])
            .status()
            .unwrap();
        assert!(status.success());
        let status = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(["commit", "-qm", &format!("commit {index}")])
            .status()
            .unwrap();
        assert!(status.success());
    }

    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let InstanceResourcePayload::RepositoriesPage(repos) = discovered.result.unwrap() else {
        panic!("expected repositories");
    };
    let repo_id = repos.repositories[0].repo_id.clone();

    let snapshot = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitSnapshot(peri_studio_proto::resource::GitSnapshotQuery {
                repo_id: repo_id.clone(),
            }),
        ))
        .await;
    let InstanceResourcePayload::GitRepository(repository) = snapshot.result.unwrap() else {
        panic!("expected repository");
    };
    let generation = repository.generation.clone();
    let head_oid = repository.head_oid.clone().expect("head oid");

    let first = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitLog(GitLogQuery {
                repo_id: repo_id.clone(),
                expected_generation: generation.clone(),
                cursor: None,
                limit: 2,
            }),
        ))
        .await;
    let InstanceResourcePayload::GitLogPage(first_page) = first.result.unwrap() else {
        panic!("expected git log page");
    };
    assert_eq!(first_page.commits.len(), 2);
    assert_eq!(first_page.source_generation, generation);
    assert_eq!(first_page.head_oid, head_oid);
    assert_eq!(first_page.commits[0].message, "commit 2");
    assert_eq!(first_page.commits[1].message, "commit 1");
    assert!(first_page.commits[0].oid.len() == 40);
    assert_eq!(first_page.commits[0].commit_id, first_page.commits[0].oid);
    assert_eq!(first_page.commits[0].short_oid.len(), 8);
    assert!(first_page.next_cursor.is_some());

    let second = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitLog(GitLogQuery {
                repo_id: repo_id.clone(),
                expected_generation: generation.clone(),
                cursor: first_page.next_cursor.clone(),
                limit: 2,
            }),
        ))
        .await;
    let InstanceResourcePayload::GitLogPage(second_page) = second.result.unwrap() else {
        panic!("expected second git log page");
    };
    assert_eq!(second_page.commits.len(), 1);
    assert_eq!(second_page.commits[0].message, "commit 0");
    assert!(second_page.next_cursor.is_none());
}

#[tokio::test]
async fn git_log_rejects_stale_expected_generation() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    init_repo(dir.path());
    std::fs::write(dir.path().join("tracked.txt"), b"one\n").unwrap();
    let status = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["add", "tracked.txt"])
        .status()
        .unwrap();
    assert!(status.success());
    let status = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["commit", "-qm", "initial"])
        .status()
        .unwrap();
    assert!(status.success());

    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let InstanceResourcePayload::RepositoriesPage(repos) = discovered.result.unwrap() else {
        panic!("expected repositories");
    };
    let repo_id = repos.repositories[0].repo_id.clone();

    let result = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitLog(GitLogQuery {
                repo_id,
                expected_generation: "stale-generation".into(),
                cursor: None,
                limit: 50,
            }),
        ))
        .await;
    assert_eq!(result.error.unwrap().code, ResourceErrorCode::StaleCursor);
}

fn git_commit(dir: &std::path::Path, paths: &[&str], message: &str) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["add"])
        .args(paths)
        .status()
        .unwrap();
    assert!(status.success());
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["commit", "-qm", message])
        .status()
        .unwrap();
    assert!(status.success());
}

#[tokio::test]
async fn git_log_scopes_to_workspace_subtree() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    init_repo(dir.path());
    std::fs::create_dir_all(dir.path().join("pkg")).unwrap();
    std::fs::create_dir_all(dir.path().join("other")).unwrap();
    std::fs::write(dir.path().join("other/file.txt"), b"other\n").unwrap();
    git_commit(dir.path(), &["other/file.txt"], "other commit");
    std::fs::write(dir.path().join("pkg/file.txt"), b"pkg\n").unwrap();
    git_commit(dir.path(), &["pkg/file.txt"], "pkg commit");

    let pkg_root = dir.path().join("pkg");
    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let InstanceResourcePayload::RepositoriesPage(repos) = discovered.result.unwrap() else {
        panic!("expected repositories");
    };
    let repo_id = repos.repositories[0].repo_id.clone();

    let snapshot = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitSnapshot(peri_studio_proto::resource::GitSnapshotQuery {
                repo_id: repo_id.clone(),
            }),
        ))
        .await;
    let InstanceResourcePayload::GitRepository(repository) = snapshot.result.unwrap() else {
        panic!("expected repository");
    };
    let generation = repository.generation.clone();

    let result = host
        .query(query(
            &pkg_root,
            InstanceResourceQueryKind::GitLog(GitLogQuery {
                repo_id,
                expected_generation: generation,
                cursor: None,
                limit: 50,
            }),
        ))
        .await;
    let InstanceResourcePayload::GitLogPage(page) = result.result.unwrap() else {
        panic!("expected git log page");
    };
    assert_eq!(page.scope, Some(GitLogScope::WorkspaceSubtreeReadonly));
    assert_eq!(page.commits.len(), 1);
    assert_eq!(page.commits[0].message, "pkg commit");
}

#[tokio::test]
async fn discover_repositories_from_workspace_subtree() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    init_repo(dir.path());
    std::fs::create_dir_all(dir.path().join("pkg")).unwrap();
    std::fs::write(dir.path().join("pkg/file.txt"), b"pkg\n").unwrap();
    git_commit(dir.path(), &["pkg/file.txt"], "pkg commit");

    let pkg_root = dir.path().join("pkg");
    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            &pkg_root,
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let InstanceResourcePayload::RepositoriesPage(repos) = discovered.result.unwrap() else {
        panic!("expected repositories");
    };
    assert_eq!(repos.repositories.len(), 1);
    assert_eq!(repos.repositories[0].root, "pkg");
}

#[tokio::test]
async fn git_log_rejects_oversized_page() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    init_repo(dir.path());
    let large_message = "x".repeat(MAX_COMMIT_MESSAGE_BYTES);
    for index in 0..80 {
        std::fs::write(
            dir.path().join(format!("file-{index}.txt")),
            format!("content-{index}\n"),
        )
        .unwrap();
        git_commit(
            dir.path(),
            &[&format!("file-{index}.txt")],
            &format!("{large_message}-{index}"),
        );
    }

    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let InstanceResourcePayload::RepositoriesPage(repos) = discovered.result.unwrap() else {
        panic!("expected repositories");
    };
    let repo_id = repos.repositories[0].repo_id.clone();

    let snapshot = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitSnapshot(peri_studio_proto::resource::GitSnapshotQuery {
                repo_id: repo_id.clone(),
            }),
        ))
        .await;
    let InstanceResourcePayload::GitRepository(repository) = snapshot.result.unwrap() else {
        panic!("expected repository");
    };
    let generation = repository.generation.clone();

    let result = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitLog(GitLogQuery {
                repo_id,
                expected_generation: generation,
                cursor: None,
                limit: 500,
            }),
        ))
        .await;
    let error = result.error.expect("expected ViewTooLarge");
    assert_eq!(error.code, ResourceErrorCode::ViewTooLarge);
    assert!(error.message.contains("try limit"));
}

#[tokio::test]
async fn git_log_rate_limits_concurrent_queries() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    init_repo(dir.path());
    std::fs::write(dir.path().join("tracked.txt"), b"one\n").unwrap();
    git_commit(dir.path(), &["tracked.txt"], "initial");

    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let InstanceResourcePayload::RepositoriesPage(repos) = discovered.result.unwrap() else {
        panic!("expected repositories");
    };
    let repo_id = repos.repositories[0].repo_id.clone();

    let snapshot = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitSnapshot(peri_studio_proto::resource::GitSnapshotQuery {
                repo_id: repo_id.clone(),
            }),
        ))
        .await;
    let InstanceResourcePayload::GitRepository(repository) = snapshot.result.unwrap() else {
        panic!("expected repository");
    };
    let generation = repository.generation.clone();

    let root = dir.path().to_path_buf();
    let mut handles = Vec::new();
    for _ in 0..5 {
        let host = host.clone();
        let repo_id = repo_id.clone();
        let generation = generation.clone();
        let root = root.clone();
        handles.push(tokio::spawn(async move {
            host.query(query(
                &root,
                InstanceResourceQueryKind::GitLog(GitLogQuery {
                    repo_id,
                    expected_generation: generation,
                    cursor: None,
                    limit: 50,
                }),
            ))
            .await
        }));
    }

    let mut rate_limited = 0;
    for handle in handles {
        let result = handle.await.unwrap();
        if result.error.as_ref().is_some_and(|error| {
            error.code == ResourceErrorCode::RateLimited
        }) {
            rate_limited += 1;
        }
    }
    assert!(rate_limited >= 1, "expected at least one RateLimited response");
}
