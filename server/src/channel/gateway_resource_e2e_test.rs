//! 远程资源数据面的 WebSocket 端到端闭环。
//!
//! 本测试使用真实 Gateway、客户端连接和 instance 连接，覆盖浏览器查询到可信
//! root 解析、instance RPC、短租约 Yjs 投影与客户端订阅；HTTP blob 的同源票据
//! 下载由 web/http_test 的真实 TCP 测试覆盖。

use super::*;
use peri_studio_proto::action::{ActionEnvelope, FsWriteFilePayload};
use peri_studio_proto::conn::DocId;
use peri_studio_proto::resource::{
    DirectoryPage, FileKind, FsPermissions, FsStat, InstanceResourcePayload,
    InstanceResourceQueryKind, InstanceResourceResult, OpenResourceUpload, OpenResourceView,
    ResourceQuery, ResourceQueryResult, ResourceViewKind, RESOURCE_PROTOCOL_VERSION,
};

#[tokio::test]
async fn e2e_resource_directory_projects_through_instance_and_ysync() {
    let server = start_server().await;
    let root = server._tmp.path().join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    server
        ._hub_keep
        .projects
        .create_project(
            "project-e2e",
            "Resource E2E",
            root.to_str().unwrap(),
            "local",
        )
        .await
        .unwrap();

    // instance 完成双向认证，并声明资源协议能力。
    let (iws, _) = connect_async(format!("ws://{}/", server.addr))
        .await
        .unwrap();
    let (mut isink, mut istream) = iws.split();
    let nonce = generate_challenge_nonce();
    isink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceHello(
                peri_studio_proto::instance::InstanceHello {
                    protocol_version: PROTOCOL_VERSION,
                    token: server.instance_token.clone(),
                    hostname: "local".into(),
                    caps: serde_json::json!({
                        "resources": {"protocolVersion": RESOURCE_PROTOCOL_VERSION}
                    }),
                    buffered: None,
                    buffer_lost: None,
                    stream_epochs: None,
                    nonce: base64::engine::general_purpose::STANDARD.encode(nonce),
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    assert!(matches!(
        next_frame(&mut istream).await,
        Frame::AuthResponse(_)
    ));

    // 浏览器等价客户端走真实认证、快照、ready 时序。
    let (cws, _) = connect_async(format!("ws://{}/", server.addr))
        .await
        .unwrap();
    let (mut csink, mut cstream) = cws.split();
    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::Auth(peri_studio_proto::conn::Auth {
                token: server.client_token.clone(),
            }))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::YsyncSubscribe(
                peri_studio_proto::ysync::YsyncSubscribe {
                    docs: vec![DocId::REGISTRY],
                    client_capabilities: vec![],
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    assert!(matches!(
        next_frame(&mut cstream).await,
        Frame::YsyncUpdate(_)
    ));
    assert!(matches!(next_frame(&mut cstream).await, Frame::Ready(_)));

    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::ResourceQuery(ResourceQuery::OpenView {
                request_id: "resource-e2e".into(),
                project_id: Some("project-e2e".into()),
                instance_id: None,
                payload: OpenResourceView {
                    kind: ResourceViewKind::FsDirectoryPage,
                    path: Some(String::new()),
                    repo_id: None,
                    group_id: None,
                    cursor: None,
                    expected_generation: None,
                    limit: 200,
                },
            }))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();

    let query = match next_frame(&mut istream).await {
        Frame::InstanceResourceQuery(query) => query,
        other => panic!("expected instance resource query, got {other:?}"),
    };
    assert_eq!(query.root, root.to_str().unwrap());
    isink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceResourceResult(InstanceResourceResult {
                request_id: query.request_id,
                result: Some(InstanceResourcePayload::DirectoryPage(DirectoryPage {
                    path: String::new(),
                    source_generation: "generation-1".into(),
                    entries: vec![],
                    next_cursor: None,
                })),
                error: None,
            }))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();

    let opened = loop {
        match next_frame(&mut cstream).await {
            Frame::ResourceResult(result) => match result.result {
                Some(ResourceQueryResult::View(opened)) => break opened,
                other => panic!("expected resource view, got {other:?}"),
            },
            Frame::YsyncUpdate(_) | Frame::KeepAlive(_) => continue,
            other => panic!("expected resource result, got {other:?}"),
        }
    };
    assert!(opened.doc_id.as_str().starts_with("resource:"));

    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::YsyncSubscribe(
                peri_studio_proto::ysync::YsyncSubscribe {
                    docs: vec![opened.doc_id.clone()],
                    client_capabilities: vec![],
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    match next_frame(&mut cstream).await {
        Frame::YsyncUpdate(update) => {
            assert_eq!(update.doc, opened.doc_id);
            assert!(!update.update.is_empty());
        }
        other => panic!("expected resource y-sync snapshot, got {other:?}"),
    }
}

#[tokio::test]
async fn e2e_upload_commit_routes_to_project_instance_and_returns_fs_stat() {
    let server = start_server().await;
    let root = server._tmp.path().join("upload-workspace");
    std::fs::create_dir_all(&root).unwrap();
    server
        ._hub_keep
        .projects
        .create_project(
            "upload-project",
            "Upload E2E",
            root.to_str().unwrap(),
            "local",
        )
        .await
        .unwrap();

    let (iws, _) = connect_async(format!("ws://{}/", server.addr))
        .await
        .unwrap();
    let (mut isink, mut istream) = iws.split();
    let nonce = generate_challenge_nonce();
    isink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceHello(
                peri_studio_proto::instance::InstanceHello {
                    protocol_version: PROTOCOL_VERSION,
                    token: server.instance_token.clone(),
                    hostname: "local".into(),
                    caps: serde_json::json!({
                        "resources": {
                            "protocolVersion": RESOURCE_PROTOCOL_VERSION,
                            "write": true
                        }
                    }),
                    buffered: None,
                    buffer_lost: None,
                    stream_epochs: None,
                    nonce: base64::engine::general_purpose::STANDARD.encode(nonce),
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    assert!(matches!(
        next_frame(&mut istream).await,
        Frame::AuthResponse(_)
    ));
    server._hub_keep.registry.clear_restarting().await.unwrap();

    let (cws, _) = connect_async(format!("ws://{}/", server.addr))
        .await
        .unwrap();
    let (mut csink, mut cstream) = cws.split();
    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::Auth(peri_studio_proto::conn::Auth {
                token: server.client_token.clone(),
            }))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::YsyncSubscribe(
                peri_studio_proto::ysync::YsyncSubscribe {
                    docs: vec![DocId::REGISTRY],
                    client_capabilities: vec![],
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    assert!(matches!(
        next_frame(&mut cstream).await,
        Frame::YsyncUpdate(_)
    ));
    assert!(matches!(next_frame(&mut cstream).await, Frame::Ready(_)));

    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::ResourceQuery(ResourceQuery::OpenUpload {
                request_id: "open-upload-e2e".into(),
                project_id: "upload-project".into(),
                payload: OpenResourceUpload {
                    path: "notes.txt".into(),
                    expected_bytes: Some(3),
                    sha256: None,
                },
            }))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    let opened = match next_frame(&mut cstream).await {
        Frame::ResourceResult(result) => match result.result {
            Some(ResourceQueryResult::Upload(opened)) => opened,
            other => panic!(
                "expected upload ticket, got {other:?}, error {:?}",
                result.error
            ),
        },
        other => panic!("expected resource result, got {other:?}"),
    };
    server
        ._hub_keep
        .resources
        .begin_upload_put(&server.client_token_id, &opened.upload_id, 3)
        .await
        .unwrap();
    server
        ._hub_keep
        .resources
        .complete_upload_put(&server.client_token_id, &opened.upload_id, b"abc".to_vec())
        .await
        .unwrap();

    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::Action(ActionEnvelope::FsWriteFile {
                command_id: "upload-command-e2e".into(),
                payload: FsWriteFilePayload {
                    project_id: "upload-project".into(),
                    path: "notes.txt".into(),
                    upload_id: opened.upload_id,
                    if_match: None,
                    if_none_match: Some("*".into()),
                },
            }))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();

    let query = match next_frame(&mut istream).await {
        Frame::InstanceResourceQuery(query) => query,
        other => panic!("expected instance write query, got {other:?}"),
    };
    assert_eq!(query.root, root.to_str().unwrap());
    assert!(matches!(
        query.query,
        InstanceResourceQueryKind::WriteFile(ref write)
            if write.path == "notes.txt" && write.content_base64 == "YWJj"
    ));
    isink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceResourceResult(InstanceResourceResult {
                request_id: query.request_id,
                result: Some(InstanceResourcePayload::FsStat(FsStat {
                    path: "notes.txt".into(),
                    kind: FileKind::File,
                    size: 3,
                    mtime_ns: "1".into(),
                    permissions: FsPermissions::ReadWrite,
                    revision: "revision-1".into(),
                })),
                error: None,
            }))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();

    match next_action_ack(&mut cstream).await {
        Frame::ActionAck(ack) => {
            assert_eq!(ack.command_id, "upload-command-e2e");
            assert!(matches!(
                ack.resource_result,
                Some(peri_studio_proto::resource::ActionResourceResult::FsStat(stat))
                    if stat.path == "notes.txt" && stat.size == 3
            ));
        }
        other => panic!("expected upload action ack, got {other:?}"),
    }
}
