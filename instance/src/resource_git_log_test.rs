use std::process::Command;

use peri_studio_proto::resource::{
    GitLogQuery, InstanceResourcePayload, InstanceResourceQuery, InstanceResourceQueryKind,
    ResourceErrorCode,
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
