//! CommandCoordinator workspace 主题测试（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分。
//!
//! 职责边界：本模块覆盖 workspace create/remove 的注册表投影与持久化提交、
//! 非法 cwd 拒绝、remove 保留既有 runtime、create 带 workspace_id 继承 cwd、
//! 未知 workspace 失败（§4.3 workspace 生命周期）。公共 helper 见
//! command_coordinator_test_util（经父模块 re-export，经 `use super::*` 可见）。
use super::*;
#[tokio::test]
async fn workspace_create_committed_and_registry_projected() {
    let env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();
    let action = ActionEnvelope::WorkspaceCreate {
        command_id: cid.clone(),
        payload: peri_studio_proto::action::WorkspaceCreatePayload {
            name: "my-ws".into(),
            cwd: path.clone(),
        },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    // client 收 committed Ack（管理面：accepted → committed 直通）。
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(a)))) => {
            assert_eq!(a.command_id, cid);
            assert_eq!(a.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected committed ack, got {other:?}"),
    }
    // 投影到 Registry Doc（create 的读取面）。
    let list = env.chats.registry().list_workspaces().await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "my-ws");
    assert_eq!(list[0].cwd, path);
}

#[tokio::test]
async fn workspace_create_invalid_cwd_error() {
    let env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::WorkspaceCreate {
        command_id: cid.clone(),
        payload: peri_studio_proto::action::WorkspaceCreatePayload {
            name: "w".into(),
            cwd: "/no/such/dir-xyz-123".into(),
        },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(e)))) => {
            assert_eq!(e.command_id, cid);
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::InvalidState);
            assert!(!e.retryable);
        }
        other => panic!("expected action_error, got {other:?}"),
    }
    // 未投影。
    assert!(env
        .chats
        .registry()
        .list_workspaces()
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn workspace_remove_committed_and_removed() {
    let env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let dir = tempfile::tempdir().unwrap();
    // 先建。
    let create_cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(
            &ctx("c"),
            ActionEnvelope::WorkspaceCreate {
                command_id: create_cid.clone(),
                payload: peri_studio_proto::action::WorkspaceCreatePayload {
                    name: "w".into(),
                    cwd: dir.path().to_str().unwrap().into(),
                },
            },
            tx.clone(),
        )
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    // 消费 committed ack。
    let _ = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("create committed ack");
    // 从 Registry Doc 读回 id。
    let list = env.chats.registry().list_workspaces().await.unwrap();
    assert_eq!(list.len(), 1);
    let ws_id = list[0].id.clone();

    // 删。
    let remove_cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(
            &ctx("c"),
            ActionEnvelope::WorkspaceRemove {
                command_id: remove_cid.clone(),
                payload: peri_studio_proto::action::WorkspaceRemovePayload {
                    workspace_id: ws_id.clone(),
                },
            },
            tx.clone(),
        )
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(a)))) => {
            assert_eq!(a.command_id, remove_cid);
            assert_eq!(a.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected committed ack, got {other:?}"),
    }
    assert!(env
        .chats
        .registry()
        .list_workspaces()
        .await
        .unwrap()
        .is_empty());

    // 删不存在的 → InvalidState。
    let cid2 = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(
            &ctx("c"),
            ActionEnvelope::WorkspaceRemove {
                command_id: cid2.clone(),
                payload: peri_studio_proto::action::WorkspaceRemovePayload {
                    workspace_id: ws_id.clone(),
                },
            },
            tx.clone(),
        )
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionError(e)))) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::InvalidState);
        }
        other => panic!("expected action_error, got {other:?}"),
    }
}

#[tokio::test]
async fn workspace_remove_preserves_an_existing_runtime() {
    let env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();

    let create = env
        .coordinator
        .submit(
            &ctx("legacy-runtime"),
            ActionEnvelope::WorkspaceCreate {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: peri_studio_proto::action::WorkspaceCreatePayload {
                    name: "legacy".into(),
                    cwd: path.clone(),
                },
            },
            tx.clone(),
        )
        .await;
    assert!(matches!(create, SubmitAck::Accepted { .. }));
    assert!(matches!(
        rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Committed
    ));
    let workspace_id = env.chats.registry().list_workspaces().await.unwrap()[0]
        .id
        .clone();
    env.chats
        .register(S1, "local", Some("live"), &path, Some(&workspace_id))
        .await
        .unwrap();

    let remove = env
        .coordinator
        .submit(
            &ctx("legacy-runtime"),
            ActionEnvelope::WorkspaceRemove {
                command_id: uuid::Uuid::new_v4().to_string(),
                payload: peri_studio_proto::action::WorkspaceRemovePayload {
                    workspace_id: workspace_id.clone(),
                },
            },
            tx,
        )
        .await;
    assert!(matches!(remove, SubmitAck::Accepted { .. }));
    assert!(matches!(
        rx.recv().await,
        Some(OutboundMsg::Frame(Frame::ActionAck(ref ack)))
            if ack.status == AckStatus::Committed
    ));
    assert!(env
        .chats
        .registry()
        .list_workspaces()
        .await
        .unwrap()
        .is_empty());
    let runtime = env
        .chats
        .entry(S1)
        .await
        .expect("runtime remains registered");
    assert_eq!(runtime.state, ChatState::Accepting);
    assert_eq!(runtime.workspace_id.as_deref(), Some(workspace_id.as_str()));
}

#[tokio::test]
async fn create_with_workspace_id_inherits_cwd() {
    let mut env = env().await;
    let (tx, _rx) = mpsc::channel(16);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();
    // 先建 workspace。
    let ws_cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(
            &ctx("c"),
            ActionEnvelope::WorkspaceCreate {
                command_id: ws_cid,
                payload: peri_studio_proto::action::WorkspaceCreatePayload {
                    name: "ws".into(),
                    cwd: path.clone(),
                },
            },
            tx.clone(),
        )
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    let list = env.chats.registry().list_workspaces().await.unwrap();
    assert_eq!(list.len(), 1);
    let ws_id = list[0].id.clone();

    // workspace 下新建对话（不直传 cwd）→ spawn cwd = workspace.cwd。
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Create {
        command_id: cid.clone(),
        payload: CreateChatPayload {
            instance_id: Some("local".into()),
            cwd: None,
            title: Some("t".into()),
            acp_session_id: None,
            workspace_id: Some(ws_id),
        },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    // spawn 帧携带 workspace 的 cwd（§6.2：ACP 进程工作目录继承）。
    let spawn_frame = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("instance should receive spawn")
        .expect("rx alive");
    match spawn_frame {
        OutboundMsg::Frame(Frame::InstanceSpawn(s)) => {
            assert_eq!(s.cwd, path);
        }
        other => panic!("expected spawn, got {other:?}"),
    }
}

#[tokio::test]
async fn create_with_unknown_workspace_fails_invalid_state() {
    let mut env = env().await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let action = ActionEnvelope::Create {
        command_id: cid.clone(),
        payload: CreateChatPayload {
            instance_id: Some("local".into()),
            cwd: None,
            title: Some("t".into()),
            acp_session_id: None,
            workspace_id: Some(uuid::Uuid::new_v4().to_string()),
        },
    };
    let r = env.coordinator.submit(&ctx("c"), action, tx.clone()).await;
    match r {
        SubmitAck::Failed(e) => {
            assert_eq!(e.code, peri_studio_proto::ack::ErrorCode::InvalidState);
            assert!(!e.retryable, "workspace 缺失不是瞬时故障");
        }
        other => panic!("expected failed, got {other:?}"),
    }
    // instance 不应收到任何帧（前置失败）。
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        env.instance_rx.try_recv().is_err(),
        "instance 不应收到 spawn"
    );
    // client 不应收到 ack/error（提交即失败，无异步终态）。
    assert!(rx.try_recv().is_err(), "client 不应收到帧");
}

// ── session/list 按需查询（§6.3：agent 侧真实数据源）────────────────────
