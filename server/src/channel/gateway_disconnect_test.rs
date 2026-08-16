//! Gateway 断链语义测试（gateway_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 877 行超阈值，按「instance 生命周期」分主题。
//!
//! 职责边界：本模块只覆盖 instance_disconnect_gaps_chat——instance 断开 →
//! gateway 触发 on_instance_disconnect → session 置 Gap（§8.2）。端到端业务
//! 闭环与 instance 握手注册分属其他模块；装配工具在父模块。
use super::*;
/// 断链语义：instance 断开 → session 置 gap + 活动 turn interrupted（§8.2）。
#[tokio::test]
async fn instance_disconnect_gaps_chat() {
    let server = start_server().await;
    // 建立 instance 连接并完成一个 create（复用 e2e 前半段）→ 简化：直接
    // 通过注册表登记 session，再断开 instance 验证 relay 清理。
    // 端到端断言经 Registry Doc 不可行（内部），这里验证 relay 层行为已在
    // relay_event_handler_test 覆盖；本测试验证 gateway 断开路径触发
    // on_instance_disconnect（session 状态 Gap）。
    let url = format!("ws://{}/", server.addr);
    let (mws, _) = connect_async(url).await.unwrap();
    let (mut msink, mut mstream) = mws.split();
    let nonce = generate_challenge_nonce();
    msink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceHello(
                peri_studio_proto::instance::InstanceHello {
                    protocol_version: PROTOCOL_VERSION,
                    token: server.instance_token.clone(),
                    hostname: "local".into(),
                    caps: serde_json::json!({}),
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
    // 等 auth_response。
    match next_frame(&mut mstream).await {
        Frame::AuthResponse(_) => {}
        other => panic!("expected auth_response, got {other:?}"),
    }
    // 用 coordinator 直接登记一个 session（hub 内部句柄）。
    let hub = server._hub_keep.clone();
    let sid = uuid::Uuid::new_v4().to_string();
    hub.chats
        .register(&sid, "local", Some("t"), "/", None)
        .await
        .unwrap();
    hub.doc
        .open_chat(&sid, "local", Some("t"), None, None)
        .await
        .unwrap();
    hub.chats.bind(&sid, "acp-disc", true).await.unwrap();
    hub.chats.set_active_turn(&sid, "t1").await;
    let _ = hub;

    // 断开 instance（Close 帧）→ gateway 触发 on_instance_disconnect。
    msink.send(Message::Close(None)).await.unwrap();
    // 等待清理完成（轮询 session 状态）。
    let mut gapped = false;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(50)).await;
        if let Some(e) = server._hub_keep.chats.entry(&sid).await {
            if e.state == crate::control::ChatState::Gap {
                gapped = true;
                break;
            }
        }
    }
    assert!(
        gapped,
        "session should be gapped after instance disconnect (§8.2)"
    );
    let _ = mstream;
}
