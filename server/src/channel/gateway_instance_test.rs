//! Gateway instance 侧握手/注册测试（gateway_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 877 行超 500 行阈值，按「ws 对端角色」分主题。
//!
//! 职责边界：本模块只覆盖 instance 连接侧——fake_instance_connect（hello +
//! auth_response HMAC 双向校验工具）、instance_handshake_hmac_verified、
//! instance_hello_populates_registry_instances_projection（hub:registry
//! instances 投影接线）。客户端握手/认证与端到端业务闭环、断链语义分属
//! 其他模块；装配工具（TestServer/start_server/next_frame 等）在父模块。
use super::*;
/// fake instance：hello（nonce + 双向认证校验）→ 帧循环（spawn/JSON-RPC
/// 应答）。
async fn fake_instance_connect(
    server: &TestServer,
) -> (tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,)
{
    let url = format!("ws://{}/", server.addr);
    let (ws, _) = connect_async(url).await.unwrap();
    let (mut sink, mut stream) = ws.split();
    let nonce = generate_challenge_nonce();
    let hello = Frame::InstanceHello(peri_studio_proto::instance::InstanceHello {
        protocol_version: PROTOCOL_VERSION,
        token: server.instance_token.clone(),
        hostname: "local".into(),
        caps: serde_json::json!({}),
        buffered: None,
        buffer_lost: None,
        stream_epochs: None,
        nonce: base64::engine::general_purpose::STANDARD.encode(nonce),
    });
    sink.send(Message::Text(serde_json::to_string(&hello).unwrap().into()))
        .await
        .unwrap();
    // auth_response：校验 server 身份（§9.2 步骤 2；机器侧校验通过前不执行
    // 任何 spawn/kill——测试中以校验结果断言）。
    let resp = next_frame(&mut stream).await;
    match resp {
        Frame::AuthResponse(r) => {
            let token_bytes = base64::engine::general_purpose::STANDARD
                .decode(&server.instance_token)
                .unwrap();
            let key = derive_mac_key(
                &token_bytes.try_into().unwrap(),
                TokenRole::Instance.as_str(),
            );
            let ctx_bytes = base64::engine::general_purpose::STANDARD
                .decode(&r.connection_context)
                .unwrap();
            let input = mac_input(
                &nonce,
                &ctx_bytes.try_into().unwrap(),
                &PROTOCOL_VERSION.to_string(),
                TokenRole::Instance.as_str(),
            );
            verify_mac(&key, &input, &r.hmac).expect("server HMAC must verify");
        }
        other => panic!("expected auth_response, got {other:?}"),
    }
    // 校验完成：重新合并流并返回（调用方决定连接后续；不触发 unreachable）。
    match sink.reunite(stream) {
        Ok(ws) => (ws,),
        Err(_) => panic!("ws sink/stream reunite failed"),
    }
}

#[tokio::test]
async fn instance_handshake_hmac_verified() {
    let server = start_server().await;
    let _ = fake_instance_connect(&server).await;
}

/// 工具：y-sync v1 更新应用到本地 doc（hub.rs `apply_update` 同构，测试
/// 侧本地重放解码投影）。
fn apply_update(doc: &yrs::Doc, update: &[u8]) {
    match yrs::Update::decode_v1(update) {
        Ok(parsed) => {
            let mut txn = doc.transact_mut();
            if let Err(e) = txn.apply_update(parsed) {
                panic!("apply update failed: {e}");
            }
        }
        Err(e) => panic!("update decode failed: {e}"),
    }
}

/// 接线回归（F7 机器列表）：instance hello 注册成功后，`hub:registry` 的
/// `instances` 投影非空且字段正确（§5.5/§7.1）。曾因
/// `RegistryState::upsert_instance` 零调用者导致前端机器列表永远空白。
#[tokio::test]
async fn instance_hello_populates_registry_instances_projection() {
    let server = start_server().await;

    // ---- client：先订阅 hub:registry（快照时序 §4.6）----
    let url = format!("ws://{}/", server.addr);
    let (cws, _) = connect_async(url).await.unwrap();
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
                    docs: vec![peri_studio_proto::conn::DocId::REGISTRY],
                    client_capabilities: vec![
                        peri_studio_proto::ysync::CAP_PROMPT_DELIVERY_V2.to_string()
                    ],
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();

    // ---- fake instance hello（注册 + 双向认证）----
    let _ = fake_instance_connect(&server).await;

    // ---- 累积解码快照/增量（快照先于 hello 发出时 instances 为空，由
    // hello 后的广播增量补齐），直至 instances 投影出现 ----
    let doc = yrs::Doc::new();
    let mut instances_seen = false;
    for _ in 0..8 {
        match next_frame(&mut cstream).await {
            Frame::YsyncUpdate(u) if u.doc == peri_studio_proto::conn::DocId::REGISTRY => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&u.update)
                    .unwrap();
                apply_update(&doc, &bytes);
                let txn = doc.transact();
                let root = txn.get_map(ROOT).unwrap();
                let instances = root
                    .get(&txn, "instances")
                    .and_then(|v| v.cast::<yrs::MapRef>().ok());
                if let Some(instances) = instances {
                    if let Some(mm) = instances
                        .get(&txn, "local")
                        .and_then(|v| v.cast::<yrs::MapRef>().ok())
                    {
                        // token name（机器名）即 instance_id（gateway 认证后
                        // ctx.name）；start_server 以 "local" 生成 instance token。
                        assert_eq!(mm.get(&txn, "id"), Some(yrs::Out::Any("local".into())));
                        assert_eq!(
                            mm.get(&txn, "hostname"),
                            Some(yrs::Out::Any("local".into()))
                        );
                        assert_eq!(mm.get(&txn, "status"), Some(yrs::Out::Any("online".into())));
                        assert_eq!(mm.get(&txn, "chat_count"), Some(yrs::Out::Any(0f64.into())));
                        instances_seen = true;
                        break;
                    }
                }
            }
            Frame::KeepAlive(_) | Frame::Pong(_) | Frame::Ready(_) => continue,
            other => panic!("unexpected frame while waiting for registry instances: {other:?}"),
        }
    }
    assert!(
        instances_seen,
        "hello 后 hub:registry instances 投影应非空（§7.1 接线）"
    );
    drop(csink);
    let _ = cstream;
}
