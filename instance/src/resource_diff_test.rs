use std::process::Command;

use base64::Engine as _;
use peri_studio_proto::resource::{
    GitDiffQuery, GitGroupId, InstanceResourcePayload, InstanceResourceQuery,
    InstanceResourceQueryKind, ResourceErrorCode,
};

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
async fn working_tree_change_opens_a_bounded_unified_diff_blob() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
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
    std::fs::write(dir.path().join("main.txt"), b"before\n").unwrap();
    run(&["add", "main.txt"]);
    run(&["commit", "-qm", "initial"]);
    std::fs::write(dir.path().join("main.txt"), b"after\n").unwrap();

    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let Some(InstanceResourcePayload::RepositoriesPage(repositories)) = discovered.result else {
        panic!("expected repositories");
    };
    let repo_id = repositories.repositories[0].repo_id.clone();
    let changes = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitChanges(peri_studio_proto::resource::GitChangesQuery {
                repo_id: repo_id.clone(),
                group_id: GitGroupId::WorkingTree,
                cursor: None,
                limit: 20,
            }),
        ))
        .await;
    let Some(InstanceResourcePayload::GitGroupPage(changes)) = changes.result else {
        panic!("expected working tree changes");
    };

    let result = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitDiff(GitDiffQuery {
                repo_id,
                change_id: changes.changes[0].change_id.clone(),
                max_bytes: 8 * 1024 * 1024,
            }),
        ))
        .await;
    let Some(InstanceResourcePayload::Blob(blob)) = result.result else {
        panic!("expected diff blob: {:?}", result.error);
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(blob.content_base64)
        .unwrap();
    let diff = String::from_utf8(bytes).unwrap();
    assert!(diff.contains("--- a/main.txt"));
    assert!(diff.contains("+++ b/main.txt"));
    assert!(diff.contains("-before"));
    assert!(diff.contains("+after"));
    assert_eq!(blob.content_type, "text/x-diff; charset=utf-8");
    assert_eq!(blob.etag.len(), 64);

    let stale = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitDiff(GitDiffQuery {
                repo_id: repositories.repositories[0].repo_id.clone(),
                change_id: "stale-change".into(),
                max_bytes: 8 * 1024 * 1024,
            }),
        ))
        .await;
    assert_eq!(
        stale.error.unwrap().code,
        ResourceErrorCode::VersionConflict
    );
}

#[tokio::test]
async fn untracked_change_diff_is_an_addition_without_absolute_paths() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let status = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["init", "-q"])
        .status()
        .unwrap();
    assert!(status.success());
    std::fs::write(dir.path().join("new.txt"), b"new line\n").unwrap();
    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let Some(InstanceResourcePayload::RepositoriesPage(repositories)) = discovered.result else {
        panic!("expected repositories");
    };
    let repo_id = repositories.repositories[0].repo_id.clone();
    let changes = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitChanges(peri_studio_proto::resource::GitChangesQuery {
                repo_id: repo_id.clone(),
                group_id: GitGroupId::Untracked,
                cursor: None,
                limit: 20,
            }),
        ))
        .await;
    let Some(InstanceResourcePayload::GitGroupPage(changes)) = changes.result else {
        panic!("expected untracked changes");
    };
    let result = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitDiff(GitDiffQuery {
                repo_id,
                change_id: changes.changes[0].change_id.clone(),
                max_bytes: 8 * 1024 * 1024,
            }),
        ))
        .await;
    let Some(InstanceResourcePayload::Blob(blob)) = result.result else {
        panic!("expected diff blob: {:?}", result.error);
    };
    let diff = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(blob.content_base64)
            .unwrap(),
    )
    .unwrap();
    assert!(diff.contains("--- /dev/null") || diff.contains("--- NUL"));
    assert!(diff.contains("+new line"));
    assert!(!diff.contains(dir.path().to_str().unwrap()));
}

#[tokio::test]
async fn staged_change_diff_compares_head_with_the_index() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
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
    std::fs::write(dir.path().join("staged.txt"), b"head\n").unwrap();
    run(&["add", "staged.txt"]);
    run(&["commit", "-qm", "initial"]);
    std::fs::write(dir.path().join("staged.txt"), b"index\n").unwrap();
    run(&["add", "staged.txt"]);

    let host = ResourceHost::default();
    let discovered = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let Some(InstanceResourcePayload::RepositoriesPage(repositories)) = discovered.result else {
        panic!("expected repositories");
    };
    let repo_id = repositories.repositories[0].repo_id.clone();
    let changes = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitChanges(peri_studio_proto::resource::GitChangesQuery {
                repo_id: repo_id.clone(),
                group_id: GitGroupId::Index,
                cursor: None,
                limit: 20,
            }),
        ))
        .await;
    let Some(InstanceResourcePayload::GitGroupPage(changes)) = changes.result else {
        panic!("expected staged changes");
    };
    let result = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitDiff(GitDiffQuery {
                repo_id,
                change_id: changes.changes[0].change_id.clone(),
                max_bytes: 8 * 1024 * 1024,
            }),
        ))
        .await;
    let Some(InstanceResourcePayload::Blob(blob)) = result.result else {
        panic!("expected diff blob: {:?}", result.error);
    };
    let diff = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(blob.content_base64)
            .unwrap(),
    )
    .unwrap();
    assert!(diff.contains("-head"));
    assert!(diff.contains("+index"));
}
