//! Gateway 端到端业务闭环测试（gateway_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 877 行超阈值，且本测试自身即 398 行，按「测试规模」独立
//! 成模块。
//!
//! 职责边界：本模块只包含 e2e_create_prompt_event_broadcast——create → spawn →
//! initialize → session/new → binding → prompt → 事件流 → y-sync 广播的完整
//! 闭环（设计稿 §16 测试 32）。握手/认证类与断链类测试分属其他模块；装配工具
//! （TestServer/start_server/next_frame/next_action_ack）在父模块。
use super::*;
/// 端到端：create → spawn → initialize → session/new → binding → prompt →
/// 事件流 → 客户端收到 y-sync 广播（设计稿 §16 测试 32 的核心闭环）。
#[tokio::test]
async fn e2e_create_prompt_event_broadcast() {
    let server = start_server().await;
    // ---- fake client ----
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

    // ---- fake instance ----
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
    // instance 校验 auth_response（§9.2）。
    match next_frame(&mut mstream).await {
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
            verify_mac(&key, &input, &r.hmac).expect("HMAC verify");
        }
        other => panic!("expected auth_response, got {other:?}"),
    }

    // ---- client 订阅 chat doc（create 前先订阅，快照时序 §4.6）----
    // create 的 chat_id 未知，订阅 registry 建立 ready；create committed
    // 后再订阅 chat:{sid}。
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
    // 快照 + ready。
    assert!(matches!(
        next_frame(&mut cstream).await,
        Frame::YsyncUpdate(_)
    ));
    assert!(matches!(next_frame(&mut cstream).await, Frame::Ready(_)));

    // ---- client session/create ----
    let create_cid = uuid::Uuid::new_v4().to_string();
    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::Action(
                peri_studio_proto::action::ActionEnvelope::Create {
                    command_id: create_cid.clone(),
                    payload: peri_studio_proto::action::CreateChatPayload {
                        instance_id: Some("local".into()),
                        cwd: None,
                        title: Some("e2e".into()),
                        acp_session_id: None,
                        workspace_id: None,
                    },
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    // accepted（create 执行器先写 Registry 摘要 → 订阅了 hub:registry 的
    // 客户端会先收到 registry 更新帧，§5.2 单写广播；跳过至 ActionAck）。
    let accepted = loop {
        match next_frame(&mut cstream).await {
            Frame::ActionAck(a) if a.command_id == create_cid => break a,
            Frame::YsyncUpdate(_) => continue, // registry 更新（accepting 摘要）
            other => panic!("expected accepted, got {other:?}"),
        }
    };
    assert_eq!(accepted.status, peri_studio_proto::ack::AckStatus::Accepted);
    // instance 收 instance/spawn → 回 spawn_ack。
    let chat_id = match next_frame(&mut mstream).await {
        Frame::InstanceSpawn(s) => {
            assert_eq!(s.command_id, create_cid);
            msink
                .send(Message::Text(
                    serde_json::to_string(&Frame::InstanceSpawnAck(
                        peri_studio_proto::instance::InstanceSpawnAck {
                            command_id: s.command_id.clone(),
                            chat_id: s.chat_id.clone(),
                            ok: true,
                            error: None,
                        },
                    ))
                    .unwrap()
                    .into(),
                ))
                .await
                .unwrap();
            s.chat_id
        }
        other => panic!("expected spawn, got {other:?}"),
    };
    // instance 收 initialize（instance/forward 帧）→ 回 forward_ack（L1+L2，
    // §4.4 M1 合并）→ 经 instance/event 回 JSON-RPC response（§4.5：机器上行
    // 统一帧面；initialize/session/new 响应在 binding 建立前到达，server 以
    // pending_rpc 匹配（rpc_id → command_id，§4.4 L3），无 binding 依赖）。
    let init = match next_frame(&mut mstream).await {
        Frame::InstanceForward(f) => f,
        other => panic!("expected forward(initialize), got {other:?}"),
    };
    assert_eq!(init.frame["method"], serde_json::json!("initialize"));
    msink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceForwardAck(
                peri_studio_proto::instance::InstanceForwardAck {
                    command_id: init.command_id.clone(),
                    chat_id: init.chat_id.clone(),
                    ok: true,
                    error: None,
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    msink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceEvent(
                peri_studio_proto::instance::InstanceEvent {
                    chat_id: String::new(),
                    epoch: 0,
                    seq: 1,
                    frame: serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": init.frame["id"].clone(),
                        "result": {"ok": true}
                    }),
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    // instance 收 session/new（instance/forward）→ forward_ack → response。
    let new = match next_frame(&mut mstream).await {
        Frame::InstanceForward(f) => f,
        other => panic!("expected forward(session/new), got {other:?}"),
    };
    assert_eq!(new.frame["method"], serde_json::json!("session/new"));
    msink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceForwardAck(
                peri_studio_proto::instance::InstanceForwardAck {
                    command_id: new.command_id.clone(),
                    chat_id: new.chat_id.clone(),
                    ok: true,
                    error: None,
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    msink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceEvent(
                peri_studio_proto::instance::InstanceEvent {
                    chat_id: String::new(),
                    epoch: 0,
                    seq: 2,
                    frame: serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": new.frame["id"].clone(),
                        "result": {"sessionId": "acp-e2e-1"}
                    }),
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    // client 收 committed{sessionId}（§6.2 binding 建立；跳过心跳帧）。
    match next_action_ack(&mut cstream).await {
        Frame::ActionAck(a) => {
            assert_eq!(a.status, peri_studio_proto::ack::AckStatus::Committed);
            assert_eq!(a.chat_id.as_deref(), Some(chat_id.as_str()));
        }
        other => panic!("expected committed, got {other:?}"),
    }

    // ---- client 订阅 chat doc + prompt ----
    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::YsyncSubscribe(
                peri_studio_proto::ysync::YsyncSubscribe {
                    docs: vec![peri_studio_proto::conn::DocId::chat(&chat_id)],
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
    // 二次订阅：非首订阅 → 快照（无 ready；跳过心跳 keep_alive 帧）。
    loop {
        match next_frame(&mut cstream).await {
            Frame::YsyncUpdate(_) => break,
            Frame::KeepAlive(_) => continue,
            other => panic!("expected snapshot, got {other:?}"),
        }
    }

    let prompt_cid = uuid::Uuid::new_v4().to_string();
    csink
        .send(Message::Text(
            serde_json::to_string(&Frame::Action(
                peri_studio_proto::action::ActionEnvelope::Prompt {
                    command_id: prompt_cid.clone(),
                    payload: peri_studio_proto::action::PromptChatPayload {
                        chat_id: chat_id.clone(),
                        message: "hello e2e".into(),
                        effort: None,
                    },
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    assert!(matches!(
        next_action_ack(&mut cstream).await,
        Frame::ActionAck(a) if a.status == peri_studio_proto::ack::AckStatus::Accepted
    ));
    // instance 收 prompt（instance/forward）→ forward_ack → 经 instance/event 回
    // response（L3，§4.4）。
    let prompt = match next_frame(&mut mstream).await {
        Frame::InstanceForward(f) => f,
        other => panic!("expected forward(prompt), got {other:?}"),
    };
    assert_eq!(prompt.frame["method"], serde_json::json!("session/prompt"));
    // agent-client-protocol（peri acp 实测）：prompt 为 ContentBlock 序列，
    // 无 turnId（宿主侧归位，§7.2）——事件帧走真实 peri 形态（session/update
    // 包裹），聚合器按 active_turn 归位。
    assert_eq!(
        prompt.frame["params"]["prompt"],
        serde_json::json!([{ "type": "text", "text": "hello e2e" }])
    );
    assert!(prompt.frame["params"].get("turnId").is_none());
    msink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceForwardAck(
                peri_studio_proto::instance::InstanceForwardAck {
                    command_id: prompt.command_id.clone(),
                    chat_id: prompt.chat_id.clone(),
                    ok: true,
                    error: None,
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    // ---- instance 上报事件（epoch=0）→ client 收 y-sync 广播 ----
    // 信封 chat_id = 进程归属（hub session id，§4.5.1）；帧内 sessionId =
    // acp_session_id（可信 binding 校验键，§495）。
    // 顺序语义（真实 peri）：流式 chunk 先于 prompt 响应（stopReason）到达——
    // L3 确认会触发 turn 终态（Completed），晚到的增量将被终态守卫拒绝（§6.3）。
    msink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceEvent(
                peri_studio_proto::instance::InstanceEvent {
                    chat_id: chat_id.clone(),
                    epoch: 0,
                    seq: 1,
                    frame: serde_json::json!({
                        "jsonrpc": "2.0",
                        "method": "session/update",
                        "params": {
                            "sessionId": "acp-e2e-1",
                            "update": {
                                "sessionUpdate": "agent_message_chunk",
                                "content": {"type": "text", "text": "streamed reply"}
                            }
                        }
                    }),
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    // L3 response（prompt 确认，§4.4）。
    msink
        .send(Message::Text(
            serde_json::to_string(&Frame::InstanceEvent(
                peri_studio_proto::instance::InstanceEvent {
                    chat_id: "acp-e2e-1".into(),
                    epoch: 0,
                    seq: 2,
                    frame: serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": prompt.frame["id"].clone(),
                        "result": {"ok": true}
                    }),
                },
            ))
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
    // client 收 committed + 广播（到达顺序不定：事件 flush 窗口 16ms 与 L3
    // 处理路径竞态——事件广播可能先于 committed 到达，被顺序断言吞掉）。
    let mut got_broadcast = false;
    let mut got_committed = false;
    for _ in 0..12 {
        match tokio::time::timeout(Duration::from_secs(5), cstream.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => match Frame::parse(&t) {
                Ok(Frame::YsyncUpdate(u))
                    if u.doc == peri_studio_proto::conn::DocId::chat(&chat_id) =>
                {
                    got_broadcast = true;
                }
                Ok(Frame::ActionAck(a)) if a.status == peri_studio_proto::ack::AckStatus::Committed => {
                    got_committed = true;
                }
                Ok(Frame::KeepAlive(_)) | Ok(Frame::Pong(_)) => {}
                Ok(other) => {
                    panic!("unexpected frame during committed/broadcast wait: {other:?}");
                }
                Err(_) => continue,
            },
            other => panic!("unexpected: {other:?}"),
        }
        if got_broadcast && got_committed {
            break;
        }
    }
    assert!(got_committed, "client should receive committed ack");
    assert!(got_broadcast, "client should receive y-sync broadcast");

    drop(csink);
    drop(msink);
    let _ = (cstream, mstream);
}
