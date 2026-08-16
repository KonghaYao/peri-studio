//! CommandCoordinator metadata 主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 project/session 的 create、archive/restore、rename
//! 生命周期与 ordered ack 语义（§4.3/§8 目录与元数据路径）。环境装配与
//! 公共 helper 见 command_coordinator_test_util（经父模块 re-export，经
//! `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn project_create_accepts_before_terminal_and_session_rename_persists() {
    let env = env().await;
    let (tx, mut rx) = mpsc::channel(8);
    let create_id = uuid::Uuid::new_v4().to_string();
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::ProjectCreate {
                command_id: create_id.clone(),
                payload: ProjectCreatePayload {
                    name: "Demo".into(),
                    cwd: env._tmp.path().to_string_lossy().into_owned(),
                    instance_id: None,
                },
            },
            tx.clone(),
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled));
    let accepted = match tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap()
    {
        OutboundMsg::Frame(Frame::ActionAck(ack)) => ack,
        other => panic!("expected accepted ack, got {other:?}"),
    };
    assert_eq!(accepted.status, peri_studio_proto::ack::AckStatus::Accepted);
    let ack = match tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap()
    {
        OutboundMsg::Frame(Frame::ActionAck(ack)) => ack,
        other => panic!("expected terminal ack after accepted return, got {other:?}"),
    };
    assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
    let project_id = ack.project_id.expect("distinct project id");
    env.metadata
        .import_session(
            "logical-1",
            &project_id,
            "acp-1",
            "Original",
            &chrono::Utc::now().to_rfc3339(),
        )
        .await
        .unwrap();
    let rename_id = uuid::Uuid::new_v4().to_string();
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionRename {
                command_id: rename_id,
                payload: PersistedSessionRenamePayload {
                    session_id: "logical-1".into(),
                    name: "Renamed".into(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(result, SubmitAck::Handled));
    let accepted = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(
        matches!(accepted, OutboundMsg::Frame(Frame::ActionAck(ref ack)) if ack.status == peri_studio_proto::ack::AckStatus::Accepted)
    );
    let _terminal = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap();
    assert_eq!(
        env.metadata
            .session("logical-1")
            .await
            .unwrap()
            .unwrap()
            .display_title(),
        "Renamed"
    );
}

#[tokio::test]
async fn project_archive_and_restore_roundtrip_through_ordered_acks() {
    let env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::channel(8);

    for (action, expect_archived) in [
        (
            ActionEnvelope::ProjectArchive {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: peri_studio_proto::action::ProjectArchivePayload {
                    project_id: "p1".into(),
                },
            },
            true,
        ),
        (
            ActionEnvelope::ProjectRestore {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: peri_studio_proto::action::ProjectArchivePayload {
                    project_id: "p1".into(),
                },
            },
            false,
        ),
    ] {
        assert!(matches!(
            env.coordinator
                .submit(&ctx("catalog"), action, tx.clone())
                .await,
            SubmitAck::Handled
        ));
        let accepted = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(accepted, OutboundMsg::Frame(Frame::ActionAck(ref ack)) if ack.status == peri_studio_proto::ack::AckStatus::Accepted)
        );
        let terminal = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(terminal, OutboundMsg::Frame(Frame::ActionAck(ref ack)) if ack.status == peri_studio_proto::ack::AckStatus::Committed)
        );
        assert_eq!(
            env.metadata
                .project("p1")
                .await
                .unwrap()
                .unwrap()
                .archived_at
                .is_some(),
            expect_archived
        );
    }
}

#[tokio::test]
async fn project_archive_rejects_a_live_runtime() {
    let env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    env.metadata
        .import_session("logical-1", "p1", "acp-1", "Active", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    env.chats
        .register(
            "chat-live",
            "local",
            Some("Active"),
            env._tmp.path().to_str().unwrap(),
            Some("p1"),
        )
        .await
        .unwrap();
    env.chats.bind("chat-live", "acp-1", true).await.unwrap();
    env.metadata
        .touch_session_open("logical-1", "chat-live")
        .await
        .unwrap();

    let (tx, _rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::ProjectArchive {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: peri_studio_proto::action::ProjectArchivePayload {
                    project_id: "p1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(
        matches!(result, SubmitAck::Failed(ref error) if error.code == ErrorCode::InvalidState)
    );
    assert!(env
        .metadata
        .project("p1")
        .await
        .unwrap()
        .unwrap()
        .archived_at
        .is_none());
}

#[tokio::test]
async fn session_archive_restore_commits_without_changing_lifecycle() {
    let env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    env.metadata
        .import_session("logical-1", "p1", "acp-1", "Saved", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    let lifecycle = env
        .metadata
        .session("logical-1")
        .await
        .unwrap()
        .unwrap()
        .lifecycle;

    for archive in [true, false] {
        let command_id = uuid::Uuid::new_v4().to_string();
        let action = if archive {
            ActionEnvelope::PersistedSessionArchive {
                command_id,
                payload: peri_studio_proto::action::PersistedSessionOpenPayload {
                    session_id: "logical-1".into(),
                },
            }
        } else {
            ActionEnvelope::PersistedSessionRestore {
                command_id,
                payload: peri_studio_proto::action::PersistedSessionOpenPayload {
                    session_id: "logical-1".into(),
                },
            }
        };
        let (tx, mut rx) = mpsc::channel(4);
        assert!(matches!(
            env.coordinator.submit(&ctx("catalog"), action, tx).await,
            SubmitAck::Handled
        ));
        assert!(
            matches!(rx.recv().await, Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))) if ack.status == AckStatus::Accepted)
        );
        assert!(
            matches!(rx.recv().await, Some(OutboundMsg::Frame(Frame::ActionAck(ref ack))) if ack.status == AckStatus::Committed && ack.session_id.as_deref() == Some("logical-1"))
        );
        let session = env.metadata.session("logical-1").await.unwrap().unwrap();
        assert_eq!(session.archived_at.is_some(), archive);
        assert_eq!(session.lifecycle, lifecycle);
    }
}

#[tokio::test]
async fn session_archive_rejects_a_live_runtime() {
    let env = env().await;
    env.metadata
        .create_project("p1", "Demo", env._tmp.path().to_str().unwrap(), "local")
        .await
        .unwrap();
    env.metadata
        .import_session("logical-1", "p1", "acp-1", "Active", "2026-08-13T00:00:00Z")
        .await
        .unwrap();
    bound_session(&env, S1, "acp-1").await;
    let (tx, _rx) = mpsc::channel(4);
    let result = env
        .coordinator
        .submit(
            &ctx("catalog"),
            ActionEnvelope::PersistedSessionArchive {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: peri_studio_proto::action::PersistedSessionOpenPayload {
                    session_id: "logical-1".into(),
                },
            },
            tx,
        )
        .await;
    assert!(
        matches!(result, SubmitAck::Failed(ref error) if error.code == ErrorCode::InvalidState)
    );
    assert!(env
        .metadata
        .session("logical-1")
        .await
        .unwrap()
        .unwrap()
        .archived_at
        .is_none());
}

#[tokio::test]
async fn project_rename_commits_after_projection_without_changing_identity() {
    let env = env().await;
    let cwd = env._tmp.path().to_str().unwrap();
    env.metadata
        .create_project("p1", "Before", cwd, "local")
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::channel(4);
    assert!(matches!(
        env.coordinator
            .submit(
                &ctx("catalog"),
                ActionEnvelope::ProjectRename {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    payload: peri_studio_proto::action::ProjectRenamePayload {
                        project_id: "p1".into(),
                        name: "After".into(),
                    },
                },
                tx,
            )
            .await,
        SubmitAck::Handled
    ));
    for status in [AckStatus::Accepted, AckStatus::Committed] {
        let frame = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(frame, OutboundMsg::Frame(Frame::ActionAck(ref ack)) if ack.status == status)
        );
    }
    let project = env.metadata.project("p1").await.unwrap().unwrap();
    assert_eq!(project.id, "p1");
    assert_eq!(project.name, "After");
    assert_eq!(project.cwd, cwd);
    assert_eq!(project.instance_id, "local");
}
