use std::path::Path;
use std::process::Command;

use peri_studio_proto::resource::{
    GitChangesQuery, GitGroupId, GitMutateQuery, GitSnapshotQuery, InstanceResourcePayload,
    InstanceResourceQuery, InstanceResourceQueryKind, ResourceErrorCode, ResourceGitActionKind,
};
use tempfile::tempdir;

use super::ResourceHost;

fn run(repo: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .status()
        .unwrap();
    assert!(status.success(), "git command failed: {args:?}");
}

fn query(root: &Path, kind: InstanceResourceQueryKind) -> InstanceResourceQuery {
    InstanceResourceQuery {
        request_id: uuid::Uuid::new_v4().to_string(),
        workspace_id: "workspace-1".into(),
        root: root.to_string_lossy().into_owned(),
        query: kind,
    }
}

async fn repository(host: &ResourceHost, root: &Path) -> (String, String) {
    let discovered = host
        .query(query(
            root,
            InstanceResourceQueryKind::DiscoverRepositories(Default::default()),
        ))
        .await;
    let InstanceResourcePayload::RepositoriesPage(repositories) = discovered.result.unwrap() else {
        panic!("expected repositories")
    };
    let repo_id = repositories.repositories[0].repo_id.clone();
    let snapshot = host
        .query(query(
            root,
            InstanceResourceQueryKind::GitSnapshot(GitSnapshotQuery {
                repo_id: repo_id.clone(),
            }),
        ))
        .await;
    let InstanceResourcePayload::GitRepository(snapshot) = snapshot.result.unwrap() else {
        panic!("expected repository snapshot")
    };
    (repo_id, snapshot.generation)
}

fn initialize(repo: &Path) {
    run(repo, &["init", "-q"]);
    run(repo, &["config", "user.email", "test@example.invalid"]);
    run(repo, &["config", "user.name", "Peri Test"]);
    std::fs::write(repo.join("tracked.txt"), b"one\n").unwrap();
    run(repo, &["add", "tracked.txt"]);
    run(repo, &["commit", "-qm", "initial"]);
}

#[tokio::test]
async fn commit_uses_bounded_stdin_message_without_shell_interpolation() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    initialize(dir.path());
    std::fs::write(dir.path().join("staged.txt"), b"ready\n").unwrap();
    run(dir.path(), &["add", "staged.txt"]);
    let host = ResourceHost::default();
    let (repo_id, generation) = repository(&host, dir.path()).await;
    let result = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitMutate(GitMutateQuery {
                repo_id,
                action: ResourceGitActionKind::Commit,
                change_ids: vec![],
                expected_generation: generation,
                message: Some("Ship 'remote' $SCM".into()),
            }),
        ))
        .await;
    assert!(matches!(
        result.result,
        Some(InstanceResourcePayload::Mutation(_))
    ));
    let message = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["log", "-1", "--pretty=%B"])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(message.stdout).unwrap().trim(),
        "Ship 'remote' $SCM"
    );
}

#[tokio::test]
async fn discard_restores_tracked_content_and_removes_only_selected_untracked_files() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    initialize(dir.path());
    std::fs::write(dir.path().join("tracked.txt"), b"changed\n").unwrap();
    std::fs::write(dir.path().join("untracked.txt"), b"remove\n").unwrap();
    std::fs::write(dir.path().join("keep.txt"), b"keep\n").unwrap();
    let host = ResourceHost::default();
    let (repo_id, generation) = repository(&host, dir.path()).await;
    let ids = changes(&host, dir.path(), &repo_id, GitGroupId::WorkingTree)
        .await
        .into_iter()
        .chain(
            changes(&host, dir.path(), &repo_id, GitGroupId::Untracked)
                .await
                .into_iter()
                .filter(|(path, _)| path == "untracked.txt"),
        )
        .map(|(_, id)| id)
        .collect();
    let result = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitMutate(GitMutateQuery {
                repo_id,
                action: ResourceGitActionKind::Discard,
                change_ids: ids,
                expected_generation: generation,
                message: None,
            }),
        ))
        .await;
    assert!(result.error.is_none());
    assert_eq!(
        std::fs::read(dir.path().join("tracked.txt")).unwrap(),
        b"one\n"
    );
    assert!(!dir.path().join("untracked.txt").exists());
    assert!(dir.path().join("keep.txt").exists());
}

async fn changes(
    host: &ResourceHost,
    root: &Path,
    repo_id: &str,
    group_id: GitGroupId,
) -> Vec<(String, String)> {
    let result = host
        .query(query(
            root,
            InstanceResourceQueryKind::GitChanges(GitChangesQuery {
                repo_id: repo_id.to_string(),
                group_id,
                cursor: None,
                limit: 200,
            }),
        ))
        .await;
    let InstanceResourcePayload::GitGroupPage(page) = result.result.unwrap() else {
        panic!("expected Git changes")
    };
    page.changes
        .into_iter()
        .map(|change| (change.path, change.change_id))
        .collect()
}

#[tokio::test]
async fn remote_actions_fail_without_prompting_or_exposing_git_stderr() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let dir = tempdir().unwrap();
    initialize(dir.path());
    let host = ResourceHost::default();
    let (repo_id, generation) = repository(&host, dir.path()).await;
    let result = host
        .query(query(
            dir.path(),
            InstanceResourceQueryKind::GitMutate(GitMutateQuery {
                repo_id,
                action: ResourceGitActionKind::Pull,
                change_ids: vec![],
                expected_generation: generation,
                message: None,
            }),
        ))
        .await;
    let error = result.error.unwrap();
    assert_eq!(error.code, ResourceErrorCode::Unavailable);
    assert_eq!(
        error.message,
        "Pull failed. Check upstream access and branch state."
    );
    assert!(!error.retryable);
}

#[tokio::test]
async fn pull_push_and_sync_follow_the_configured_upstream_without_interaction() {
    if Command::new("git").arg("--version").output().is_err() {
        return;
    }
    let bare = tempdir().unwrap();
    run(bare.path(), &["init", "-q", "--bare"]);
    let local = tempdir().unwrap();
    initialize(local.path());
    run(
        local.path(),
        &["remote", "add", "origin", bare.path().to_str().unwrap()],
    );
    run(local.path(), &["push", "-qu", "origin", "HEAD"]);
    let peer = tempdir().unwrap();
    let clone = Command::new("git")
        .args(["clone", "-q", bare.path().to_str().unwrap()])
        .arg(peer.path())
        .status()
        .unwrap();
    assert!(clone.success());
    run(
        peer.path(),
        &["config", "user.email", "peer@example.invalid"],
    );
    run(peer.path(), &["config", "user.name", "Peer"]);

    std::fs::write(peer.path().join("from-peer.txt"), b"pull\n").unwrap();
    run(peer.path(), &["add", "from-peer.txt"]);
    run(peer.path(), &["commit", "-qm", "peer"]);
    run(peer.path(), &["push", "-q"]);
    run(local.path(), &["fetch", "-q"]);
    let host = ResourceHost::default();
    let (repo_id, generation) = repository(&host, local.path()).await;
    let pulled = mutate_repository(
        &host,
        local.path(),
        &repo_id,
        generation,
        ResourceGitActionKind::Pull,
    )
    .await;
    assert!(pulled.error.is_none());
    assert!(local.path().join("from-peer.txt").exists());

    std::fs::write(local.path().join("from-local.txt"), b"push\n").unwrap();
    run(local.path(), &["add", "from-local.txt"]);
    run(local.path(), &["commit", "-qm", "local"]);
    let (_, generation) = repository(&host, local.path()).await;
    let pushed = mutate_repository(
        &host,
        local.path(),
        &repo_id,
        generation,
        ResourceGitActionKind::Push,
    )
    .await;
    assert!(pushed.error.is_none());

    run(peer.path(), &["pull", "-q", "--ff-only"]);
    std::fs::write(peer.path().join("sync.txt"), b"sync\n").unwrap();
    run(peer.path(), &["add", "sync.txt"]);
    run(peer.path(), &["commit", "-qm", "sync"]);
    run(peer.path(), &["push", "-q"]);
    run(local.path(), &["fetch", "-q"]);
    let (_, generation) = repository(&host, local.path()).await;
    let synced = mutate_repository(
        &host,
        local.path(),
        &repo_id,
        generation,
        ResourceGitActionKind::Sync,
    )
    .await;
    assert!(synced.error.is_none());
    assert!(local.path().join("sync.txt").exists());
}

async fn mutate_repository(
    host: &ResourceHost,
    root: &Path,
    repo_id: &str,
    expected_generation: String,
    action: ResourceGitActionKind,
) -> peri_studio_proto::resource::InstanceResourceResult {
    host.query(query(
        root,
        InstanceResourceQueryKind::GitMutate(GitMutateQuery {
            repo_id: repo_id.to_string(),
            action,
            change_ids: vec![],
            expected_generation,
            message: None,
        }),
    ))
    .await
}
