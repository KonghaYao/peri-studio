//! 远程资源数据面的 WebSocket 端到端闭环。
//!
//! 本测试使用真实 Gateway、客户端连接和 instance 连接，覆盖浏览器查询到可信
//! root 解析、instance RPC、短租约 Yjs 投影与客户端订阅；HTTP blob 的同源票据
//! 下载由 web/http_test 的真实 TCP 测试覆盖。

use super::*;
use peri_studio_proto::conn::DocId;
use peri_studio_proto::resource::{
    DirectoryPage, InstanceResourcePayload, InstanceResourceResult, OpenResourceView,
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
                project_id: "project-e2e".into(),
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
