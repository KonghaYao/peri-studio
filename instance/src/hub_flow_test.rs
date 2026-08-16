//! 全链路集成测试：hello → auth → spawn（幂等）→ event（seq 单调）→
//! heartbeat → kill → process_exit（T2/T6/T7/T9）+ 认证前拒绝（T11）。

use super::hub_test_common::*;
use super::*;

use futures::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn test_full_flow_spawn_event_heartbeat_kill_exit() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let config = test_config(addr, dir.path());

    let hub = tokio::spawn(run(config));
    let (mut sink, mut stream, hello) = handshake_server(accept_ws(&listener).await).await;
    assert_eq!(hello.buffered, Some(false), "无缓冲时 hello.buffered=false");

    // spawn：sh 输出 3 帧（带 sessionId）后挂起。
    let script = r#"echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":1}}'; echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":2}}'; echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":3}}'; exec sleep 30"#;
    send_frame(&mut sink, &spawn_frame("c1", "s1", script)).await;

    match next_frame_skipping_hb(&mut stream).await {
        Frame::InstanceSpawnAck(a) => {
            assert!(a.ok, "spawn 应成功");
            assert_eq!(a.chat_id, "s1");
            assert_eq!(a.command_id, "c1");
        }
        other => panic!("期待 spawn_ack，收到 {other:?}"),
    }

    // 3 帧 instance/event：seq 单调 1..3，epoch=1（T6）。
    for i in 1..=3u64 {
        match next_frame_skipping_hb(&mut stream).await {
            Frame::InstanceEvent(e) => {
                assert_eq!(e.chat_id, "s1");
                assert_eq!(e.epoch, 1);
                assert_eq!(e.seq, i, "seq 必须单调递增");
            }
            other => panic!("期待 instance/event，收到 {other:?}"),
        }
    }

    // spawn 幂等（T7）：同 session 再次 spawn → ack ok，且不二次起进程
    // （无额外 event 帧——若有新进程会立即输出 3 帧）。
    send_frame(&mut sink, &spawn_frame("c2", "s1", script)).await;
    match next_frame_skipping_hb(&mut stream).await {
        Frame::InstanceSpawnAck(a) => {
            assert!(a.ok, "幂等 spawn 必须 ack ok");
            assert_eq!(a.command_id, "c2");
        }
        other => panic!("期待幂等 spawn_ack，收到 {other:?}"),
    }
    // 若幂等失败（二次起进程），此处会收到 event 帧 → panic。
    match next_frame_timeout(&mut stream, Duration::from_millis(400)).await {
        Some(Frame::InstanceHeartbeat(_)) => {}
        Some(other) => panic!("幂等 spawn 后不应有事件帧，收到 {other:?}"),
        None => panic!("幂等 spawn 后应收到 heartbeat"),
    }

    // heartbeat（T2）：alive_sessions 含 s1。
    match next_frame(&mut stream).await {
        Frame::InstanceHeartbeat(h) => {
            assert!(
                h.alive_sessions.contains(&"s1".to_string()),
                "alive 应含 s1"
            );
            assert_eq!(h.load, 20, "load = min(100, alive×20)");
        }
        other => panic!("期待 heartbeat，收到 {other:?}"),
    }

    // kill → kill_ack → process_exit（T9）。
    send_frame(&mut sink, &kill_frame("c3", "s1", Some(200))).await;
    match next_frame_skipping_hb(&mut stream).await {
        Frame::InstanceKillAck(a) => {
            assert!(a.ok);
            assert_eq!(a.chat_id, "s1");
        }
        other => panic!("期待 kill_ack，收到 {other:?}"),
    }
    match next_frame_skipping_hb(&mut stream).await {
        Frame::InstanceProcessExit(e) => {
            assert_eq!(e.chat_id, "s1");
        }
        other => panic!("期待 process_exit，收到 {other:?}"),
    }

    drop(stream);
    drop(sink);
    hub.abort();
    let _ = hub.await;
}

#[tokio::test]
async fn test_spawn_before_auth_is_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let config = test_config(addr, dir.path());

    let hub = tokio::spawn(run(config));

    // 连接 1：读 hello，但**不回 auth_response**，直接发 spawn（模拟未经
    // 认证的指令注入）。
    let mut ws = accept_ws(&listener).await;
    loop {
        match ws.next().await {
            Some(Ok(Message::Text(t))) => {
                if let Ok(Frame::InstanceHello(_)) = Frame::parse(&t) {
                    break;
                }
            }
            other => panic!("等待 hello 失败: {other:?}"),
        }
    }
    ws.send(Message::Text(
        serde_json::to_string(&spawn_frame("c1", "s1", "echo x; exec sleep 30"))
            .unwrap()
            .into(),
    ))
    .await
    .unwrap();

    // 认证通过前 spawn 被丢弃：不 ack、不执行（§9.2 步骤 3）——instance 视
    // 握手阶段业务帧为协议违反，断开重连，且从未下发 spawn_ack。
    let got = tokio::time::timeout(Duration::from_millis(600), async {
        let mut frames = Vec::new();
        while let Some(msg) = ws.next().await {
            if let Ok(Message::Text(t)) = msg {
                if let Ok(f) = Frame::parse(&t) {
                    frames.push(f);
                }
            }
        }
        frames
    })
    .await;
    let frames = got.unwrap_or_default();
    assert!(
        frames.is_empty(),
        "认证通过前 spawn 必须被丢弃（无 ack/无任何帧），收到 {frames:?}"
    );

    // 连接 2（重连后）：正常握手 → 认证通过 → daemon 正常运行（heartbeat），
    // 认证后 spawn 正常工作。
    let (mut sink2, mut s2, _hello2) = handshake_server(accept_ws(&listener).await).await;
    // 认证通过后 spawn 正常执行（此前注入的 spawn 未执行/未缓冲）。
    send_frame(&mut sink2, &spawn_frame("c2", "s2", "echo x; exec sleep 30")).await;
    match next_frame_skipping_hb(&mut s2).await {
        Frame::InstanceSpawnAck(a) => {
            assert!(a.ok);
            assert_eq!(a.command_id, "c2");
            assert_eq!(a.chat_id, "s2");
        }
        other => panic!("认证后 spawn 应正常 ack，收到 {other:?}"),
    }
    // 清理。
    send_frame(&mut sink2, &kill_frame("k1", "s2", Some(100))).await;
    match next_frame_skipping_hb(&mut s2).await {
        Frame::InstanceKillAck(a) => assert!(a.ok),
        other => panic!("期待 kill_ack，收到 {other:?}"),
    }
    match next_frame_skipping_hb(&mut s2).await {
        Frame::InstanceProcessExit(_) => {}
        other => panic!("期待 process_exit，收到 {other:?}"),
    }

    drop(sink2);
    drop(s2);
    hub.abort();
    let _ = hub.await;
}
