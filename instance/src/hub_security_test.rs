//! 敏感瞬时帧（peri/oauth）分类与不透传测试（问题 12 决策守卫）。

use super::hub_test_common::*;
use super::*;

use super::forward::ChildFrameDeliveryClass;
use peri_studio_proto::instance::InstanceSpawnAck;
use tokio::net::TcpListener;

#[test]
fn test_oauth_method_is_always_sensitive_ephemeral() {
    for frame in [
        serde_json::json!({"jsonrpc":"2.0","method":"peri/oauth","params":{}}),
        serde_json::json!({"method":"peri/oauth","params":{"malformed":true}}),
    ] {
        assert_eq!(
            super::forward::child_frame_delivery_class(&frame),
            ChildFrameDeliveryClass::SensitiveEphemeral
        );
    }
    assert_eq!(
        super::forward::child_frame_delivery_class(
            &serde_json::json!({"jsonrpc":"2.0","method":"session/update","params":{}})
        ),
        ChildFrameDeliveryClass::Replayable
    );
    for response in [
        serde_json::json!({"jsonrpc":"2.0","id":1,"result":{"authorizationUrl":"https://auth.example.test/"}}),
        serde_json::json!({"jsonrpc":"2.0","id":2,"result":{"nested":{"refreshToken":"secret"}}}),
    ] {
        assert_eq!(
            super::forward::child_frame_delivery_class(&response),
            ChildFrameDeliveryClass::SensitiveEphemeral,
            "OAuth response secrets must never enter replay buffers"
        );
    }
}

#[test]
fn test_mcp_apps_frames_are_sensitive_ephemeral() {
    for frame in [
        serde_json::json!({"jsonrpc":"2.0","method":"peri/mcp/open","params":{}}),
        serde_json::json!({"jsonrpc":"2.0","method":"peri/mcp/resource","params":{}}),
        serde_json::json!({"jsonrpc":"2.0","method":"peri/mcp/app","params":{}}),
        serde_json::json!({"jsonrpc":"2.0","id":1,"result":{"resources":[{"mimeType":"text/html;profile=mcp-app","text":"<html></html>"}]}}),
        serde_json::json!({"jsonrpc":"2.0","id":2,"result":{"resources":[{"uri":"ui://fixture/dashboard","text":"<html></html>"}]}}),
        serde_json::json!({"jsonrpc":"2.0","id":3,"result":{"html":"<html></html>"}}),
    ] {
        assert_eq!(
            super::forward::child_frame_delivery_class(&frame),
            ChildFrameDeliveryClass::SensitiveEphemeral
        );
    }
}

#[test]
fn test_session_update_text_chunk_is_replayable() {
    let frame = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "s1",
            "update": {
                "type": "agent_message_chunk",
                "content": { "type": "text", "text": "hello world" }
            }
        }
    });
    assert_eq!(
        super::forward::child_frame_delivery_class(&frame),
        ChildFrameDeliveryClass::Replayable
    );
}

#[test]
fn test_instance_event_payload_wire_equals_proto() {
    // P1-2 wire 一致性守卫：在线转发改用借用信封序列化（免 clone），输出必须
    // 与 proto InstanceEvent 逐位一致（camelCase chatId/epoch/seq/frame）。
    let sid = "s1".to_string();
    let epoch = 3u64;
    let seq = 7u64;
    let frame = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "m",
        "params": { "sessionId": "s1", "n": 1 },
    });
    let proto = serde_json::to_vec(&Frame::InstanceEvent(
        peri_studio_proto::instance::InstanceEvent {
            chat_id: sid.clone(),
            epoch,
            seq,
            frame: frame.clone(),
        },
    ))
    .unwrap();
    let borrowed = serde_json::to_vec(&super::forward::InstanceEventPayload {
        t: "instance/event",
        chat_id: &sid,
        epoch,
        seq,
        frame: &frame,
    })
    .unwrap();
    assert_eq!(
        borrowed, proto,
        "借用信封 wire 必须与 proto InstanceEvent 逐位一致"
    );
    let text = String::from_utf8(borrowed).unwrap();
    assert!(
        text.contains("\"chatId\":\"s1\""),
        "camelCase 漂移守卫: {text}"
    );
}

#[tokio::test]
async fn test_sensitive_oauth_frame_is_online_only_and_not_replayed() {
    const SECRET: &str = "OAUTH_URL_SECRET_SENTINEL";
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let config = test_config(addr, dir.path());
    let hub = tokio::spawn(run(config, tokio_util::sync::CancellationToken::new()));
    let (mut sink, mut stream, _) = handshake_server(accept_ws(&listener).await).await;
    let script = format!(
        "echo '{{\"jsonrpc\":\"2.0\",\"method\":\"peri/oauth\",\"params\":{{\"schemaVersion\":1,\"flowId\":\"flow-1\",\"serverName\":\"docs\",\"status\":\"authorization_needed\",\"authorizationUrl\":\"https://auth.example.test/?state={SECRET}\"}}}}'; exec sleep 30"
    );
    send_frame(&mut sink, &spawn_frame("c1", "s1", &script)).await;
    assert!(matches!(
        next_frame_skipping_hb(&mut stream).await,
        Frame::InstanceSpawnAck(InstanceSpawnAck { ok: true, .. })
    ));
    let event = match next_frame_skipping_hb(&mut stream).await {
        Frame::InstanceEvent(event) => event,
        other => panic!("期待在线敏感 instance/event，收到 {other:?}"),
    };
    assert_eq!(event.frame["method"], "peri/oauth");
    assert!(event.frame.to_string().contains(SECRET));
    assert!(!data_dir_contains(dir.path(), SECRET));

    // 清理（问题 18）：abort 前显式 kill，防 `sh -c` 孙进程孤儿残留。
    send_frame(&mut sink, &kill_frame("k1", "s1", Some(100))).await;
    match next_frame_skipping_hb(&mut stream).await {
        Frame::InstanceKillAck(a) => assert!(a.ok),
        other => panic!("期待 kill_ack，收到 {other:?}"),
    }
    drop(sink);
    drop(stream);
    hub.abort();
    let _ = hub.await;
}

#[tokio::test]
async fn test_offline_sensitive_oauth_frame_never_enters_buffer_or_disk() {
    const SECRET: &str = "OFFLINE_OAUTH_URL_SECRET_SENTINEL";
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut config = test_config(addr, dir.path());
    config.reconnect_base = Duration::from_millis(700);
    config.mem_buffer_bytes = 1;
    let hub = tokio::spawn(run(config, tokio_util::sync::CancellationToken::new()));

    let (mut sink1, mut stream1, _) = handshake_server(accept_ws(&listener).await).await;
    let script = format!(
        "sleep 0.15; echo '{{\"jsonrpc\":\"2.0\",\"method\":\"peri/oauth\",\"params\":{{\"schemaVersion\":1,\"flowId\":\"flow-offline\",\"serverName\":\"docs\",\"status\":\"authorization_needed\",\"authorizationUrl\":\"https://auth.example.test/?state={SECRET}\"}}}}'; echo '{{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{{\"sessionId\":\"s1\",\"safe\":true}}}}'; exec sleep 30"
    );
    send_frame(&mut sink1, &spawn_frame("c1", "s1", &script)).await;
    assert!(matches!(
        next_frame_skipping_hb(&mut stream1).await,
        Frame::InstanceSpawnAck(InstanceSpawnAck { ok: true, .. })
    ));
    drop(sink1);
    drop(stream1);

    let (sink2, mut stream2, hello) = handshake_server(accept_ws(&listener).await).await;
    assert_eq!(hello.buffered, Some(true));
    let sync = loop {
        match next_frame(&mut stream2).await {
            Frame::InstanceBufferSync(sync) => break sync,
            Frame::InstanceHeartbeat(_) => continue,
            other => panic!("期待只含普通帧的 buffer_sync，收到 {other:?}"),
        }
    };
    assert_eq!(sync.frames.len(), 1);
    assert_eq!(sync.frames[0].seq, 2, "敏感 seq=1 应成为显式缺口");
    assert_eq!(sync.frames[0].frame["method"], "session/update");
    assert!(!serde_json::to_string(&sync).unwrap().contains(SECRET));
    assert!(!data_dir_contains(dir.path(), SECRET));

    // 清理：断线后无法经 ws 发 kill；脚本用 `exec sleep 30`（问题 18）——
    // sleep 直接替换 sh 成为直接子进程，abort 时 kill_on_drop 可整棵终止，
    // 无孙进程孤儿。
    drop(sink2);
    drop(stream2);
    hub.abort();
    let _ = hub.await;
}

#[tokio::test]
async fn test_oversize_sensitive_oauth_frame_is_dropped_without_retention() {
    const SECRET: &str = "OVERSIZE_OAUTH_URL_SECRET_SENTINEL";
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut config = test_config(addr, dir.path());
    config.max_frame_bytes = 512;
    let hub = tokio::spawn(run(config, tokio_util::sync::CancellationToken::new()));
    let (mut sink, mut stream, _) = handshake_server(accept_ws(&listener).await).await;
    let padding = "x".repeat(1500);
    let script = format!(
        "echo '{{\"jsonrpc\":\"2.0\",\"method\":\"peri/oauth\",\"params\":{{\"schemaVersion\":1,\"flowId\":\"flow-big\",\"serverName\":\"docs\",\"status\":\"authorization_needed\",\"authorizationUrl\":\"https://auth.example.test/?state={SECRET}{padding}\"}}}}'; echo '{{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{{\"sessionId\":\"s1\"}}}}'; exec sleep 30"
    );
    send_frame(&mut sink, &spawn_frame("c1", "s1", &script)).await;
    assert!(matches!(
        next_frame_skipping_hb(&mut stream).await,
        Frame::InstanceSpawnAck(InstanceSpawnAck { ok: true, .. })
    ));
    let event = match next_frame_skipping_hb(&mut stream).await {
        Frame::InstanceEvent(event) => event,
        other => panic!("期待超限敏感帧后的普通 event，收到 {other:?}"),
    };
    assert_eq!(event.seq, 2);
    assert_eq!(event.frame["method"], "session/update");
    assert!(!data_dir_contains(dir.path(), SECRET));

    // 清理（问题 18）。
    send_frame(&mut sink, &kill_frame("k1", "s1", Some(100))).await;
    match next_frame_skipping_hb(&mut stream).await {
        Frame::InstanceKillAck(a) => assert!(a.ok),
        other => panic!("期待 kill_ack，收到 {other:?}"),
    }
    drop(sink);
    drop(stream);
    hub.abort();
    let _ = hub.await;
}
