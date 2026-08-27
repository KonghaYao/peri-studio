//! 补推/epoch/多 session/背压集成测试（T3/T6/T10/T13 + P1-3 端到端）。

use super::hub_test_common::*;
use super::*;

use tokio::net::TcpListener;

#[tokio::test]
async fn test_buffer_sync_resync() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut config = test_config(addr, dir.path());
    // 退避 500ms：保证断线期帧（脚本 0.2s 后输出）先入缓冲，重连 hello 才能
    // 上报 buffered=true。
    config.reconnect_base = Duration::from_millis(500);

    let hub = tokio::spawn(run(config, tokio_util::sync::CancellationToken::new()));

    // --- 连接 1：auth → spawn（脚本：0.2s 后输出 3 帧，再 1.5s 后输出第 4 帧）→ 断线 ---
    let script = r#"sleep 0.2; echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":1}}'; echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":2}}'; echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":3}}'; sleep 1.5; echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":4}}'"#;
    let (mut sink1, mut s1, _hello1) = handshake_server(accept_ws(&listener).await).await;
    send_frame(&mut sink1, &spawn_frame("c1", "s1", script)).await;
    match next_frame_skipping_hb(&mut s1).await {
        Frame::InstanceSpawnAck(a) => assert!(a.ok),
        other => panic!("期待 spawn_ack，收到 {other:?}"),
    }
    drop(sink1);
    drop(s1); // 断线 → instance 进入缓冲模式

    // --- 连接 2：hello 携带缓冲水位 → auth → buffer_sync 补推 → 实时 event ---
    let (sink2, mut s2, hello2) = handshake_server(accept_ws(&listener).await).await;
    assert_eq!(
        hello2.buffered,
        Some(true),
        "有缓冲时必须上报 buffered=true"
    );
    let epochs = hello2.stream_epochs.as_ref().unwrap();
    assert_eq!(
        epochs.get("s1"),
        Some(&1),
        "stream_epochs 应含存活 session 的 epoch"
    );

    // buffer_sync：from_seq=1（last_sent_seq+1）、frames seq 升序 1..3、epoch=1。
    let sync = loop {
        match next_frame(&mut s2).await {
            Frame::InstanceBufferSync(b) => break b,
            Frame::InstanceHeartbeat(_) => continue,
            other => panic!("期待 buffer_sync，收到 {other:?}"),
        }
    };
    assert_eq!(sync.chat_id, "s1");
    assert_eq!(sync.epoch, 1);
    assert_eq!(sync.from_seq, 1, "from_seq = last_sent_seq+1 = 1");
    let seqs: Vec<u64> = sync.frames.iter().map(|f| f.seq).collect();
    assert_eq!(seqs, vec![1, 2, 3], "补推帧按 seq 升序连续");

    // 补推完成后转实时：第 4 帧以 instance/event 到达（seq=4，同一序列）。
    let evt = loop {
        match next_frame(&mut s2).await {
            Frame::InstanceEvent(e) if e.seq == 4 => break e,
            Frame::InstanceHeartbeat(_) | Frame::InstanceBufferSync(_) => continue,
            other => panic!("期待实时 event(seq=4)，收到 {other:?}"),
        }
    };
    assert_eq!(evt.epoch, 1);
    assert_eq!(evt.chat_id, "s1");

    // 脚本自然退出 → process_exit（在线路径）。
    match next_frame(&mut s2).await {
        Frame::InstanceProcessExit(e) => assert_eq!(e.chat_id, "s1"),
        Frame::InstanceHeartbeat(_) => match next_frame(&mut s2).await {
            Frame::InstanceProcessExit(e) => assert_eq!(e.chat_id, "s1"),
            other => panic!("期待 process_exit，收到 {other:?}"),
        },
        other => panic!("期待 process_exit，收到 {other:?}"),
    }

    drop(sink2);
    drop(s2);
    hub.abort();
    let _ = hub.await;
}

#[tokio::test]
async fn test_epoch_increment_on_rebuild() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let config = test_config(addr, dir.path());

    let hub = tokio::spawn(run(config, tokio_util::sync::CancellationToken::new()));
    let script =
        r#"echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":1}}'; exec sleep 30"#;

    // 连接 1：spawn（epoch=1）→ event(seq=1) → kill → process_exit → 重建 spawn
    // （epoch=2）→ event(seq=1, epoch=2)。
    let (mut sink1, mut s1, _h1) = handshake_server(accept_ws(&listener).await).await;
    send_frame(&mut sink1, &spawn_frame("c1", "s1", script)).await;
    match next_frame_skipping_hb(&mut s1).await {
        Frame::InstanceSpawnAck(a) => assert!(a.ok),
        other => panic!("期待 spawn_ack，收到 {other:?}"),
    }
    match next_frame_skipping_hb(&mut s1).await {
        Frame::InstanceEvent(e) => {
            assert_eq!((e.epoch, e.seq), (1, 1), "新 session：epoch=1、首帧 seq=1");
        }
        other => panic!("期待 event，收到 {other:?}"),
    }

    send_frame(&mut sink1, &kill_frame("c2", "s1", Some(200))).await;
    match next_frame_skipping_hb(&mut s1).await {
        Frame::InstanceKillAck(a) => assert!(a.ok),
        other => panic!("期待 kill_ack，收到 {other:?}"),
    }
    match next_frame_skipping_hb(&mut s1).await {
        Frame::InstanceProcessExit(_) => {}
        other => panic!("期待 process_exit，收到 {other:?}"),
    }

    // 重建（同 chat_id 再次 spawn）：epoch = 水位 + 1 = 2，seq 重置 1（§4.5.1）。
    send_frame(&mut sink1, &spawn_frame("c3", "s1", script)).await;
    match next_frame_skipping_hb(&mut s1).await {
        Frame::InstanceSpawnAck(a) => assert!(a.ok),
        other => panic!("期待重建 spawn_ack，收到 {other:?}"),
    }
    match next_frame_skipping_hb(&mut s1).await {
        Frame::InstanceEvent(e) => {
            assert_eq!((e.epoch, e.seq), (2, 1), "重建：epoch+1、seq 重置 1");
        }
        other => panic!("期待重建 event，收到 {other:?}"),
    }
    // 清理（问题 18）：重建后的进程仍在运行，abort 前 kill。
    send_frame(&mut sink1, &kill_frame("c4", "s1", Some(100))).await;
    match next_frame_skipping_hb(&mut s1).await {
        Frame::InstanceKillAck(a) => assert!(a.ok),
        other => panic!("期待 kill_ack，收到 {other:?}"),
    }
    drop(sink1);
    drop(s1);

    // 连接 2：hello 正常（第二次 kill 的 Exit 已把 acp 置 None，stream_epochs
    // 只含存活 session——epoch 递增的验证由下方水位断言承担，§4.5.1）。
    let (_sink2, _s2, _hello2) = handshake_server(accept_ws(&listener).await).await;

    // 水位持久化：epoch=2 已落盘（T13）。
    let wm = Watermark::load(dir.path()).unwrap();
    assert_eq!(wm.epoch_of("s1"), Some(2));

    drop(_sink2);
    drop(_s2);
    hub.abort();
    let _ = hub.await;
}

#[tokio::test]
async fn test_two_sessions_isolated_seqs() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let config = test_config(addr, dir.path());

    let hub = tokio::spawn(run(config, tokio_util::sync::CancellationToken::new()));
    let (mut sink, mut stream, _hello) = handshake_server(accept_ws(&listener).await).await;

    let script = r#"echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":1}}'; echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":2}}'; exec sleep 30"#;
    let script2 =
        r#"echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s2","n":1}}'; exec sleep 30"#;
    send_frame(&mut sink, &spawn_frame("c1", "s1", script)).await;
    send_frame(&mut sink, &spawn_frame("c2", "s2", script2)).await;

    // 两个 spawn_ack。
    for _ in 0..2 {
        match next_frame_skipping_hb(&mut stream).await {
            Frame::InstanceSpawnAck(a) => assert!(a.ok),
            other => panic!("期待 spawn_ack，收到 {other:?}"),
        }
    }

    // 各 session 独立 seq：s1 有 1,2；s2 有 1（互不串扰）。
    let mut s1_seqs = Vec::new();
    let mut s2_seqs = Vec::new();
    for _ in 0..4 {
        match next_frame_timeout(&mut stream, Duration::from_millis(1500)).await {
            Some(Frame::InstanceEvent(e)) => {
                if e.chat_id == "s1" {
                    s1_seqs.push(e.seq);
                } else if e.chat_id == "s2" {
                    s2_seqs.push(e.seq);
                } else {
                    panic!("未知 session {}", e.chat_id);
                }
            }
            Some(Frame::InstanceHeartbeat(_)) => continue,
            other => {
                if s1_seqs.len() == 2 && s2_seqs.len() == 1 {
                    break;
                }
                panic!("等待事件失败: {other:?}");
            }
        }
    }
    assert_eq!(s1_seqs, vec![1, 2]);
    assert_eq!(s2_seqs, vec![1]);

    // 清理：2×kill_ack + 2×process_exit（顺序不定——kill_ack 由 hub 直发、
    // process_exit 由子进程 wait 完成触发，两者竞态）。
    send_frame(&mut sink, &kill_frame("k1", "s1", Some(100))).await;
    send_frame(&mut sink, &kill_frame("k2", "s2", Some(100))).await;
    let mut acks = 0;
    let mut exits = 0;
    for _ in 0..4 {
        match next_frame_skipping_hb(&mut stream).await {
            Frame::InstanceKillAck(a) => {
                assert!(a.ok);
                acks += 1;
            }
            Frame::InstanceProcessExit(_) => exits += 1,
            other => panic!("期待 kill_ack/process_exit，收到 {other:?}"),
        }
    }
    assert_eq!(acks, 2);
    assert_eq!(exits, 2);

    drop(stream);
    drop(sink);
    hub.abort();
    let _ = hub.await;
}

#[tokio::test]
async fn test_backpressure_disconnect_buffers_then_resyncs() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut config = test_config(addr, dir.path());
    // 写超时 300ms：背压后快速断线（默认 10s 太长，测试不可等待）。
    config.write_timeout = Duration::from_millis(300);

    let hub = tokio::spawn(run(config, tokio_util::sync::CancellationToken::new()));

    // 高输出 agent：64 × 64KB 帧（≈4.2MB——双倍覆盖 Linux 默认 tcp_wmem 上限
    // 4MB，防「内核缓冲完全吸收 → 无背压 → 无断线」的平台差异假失败，review
    // M2；帧数 × 帧大小 ≤ Buffer 内存预算 5MB，避免 §8.5 预算丢弃干扰断言）
    // → sleep 6s（留给断线 + 重连 + 补推完成）→ 5 帧小帧（验证转实时 + seq
    // 衔接）→ 退出。
    let script = r#"P=$(head -c 65536 /dev/zero | tr '\0' 'x'); for i in $(seq 1 64); do echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":'$i',"pad":"'$P'"}}'; done; sleep 6; for j in $(seq 65 69); do echo '{"jsonrpc":"2.0","method":"m","params":{"sessionId":"s1","n":'$j'}}'; done; sleep 1"#;

    // --- 连接 1：spawn 后立即停止读取（TCP 背压）→ 写超时断线 ---
    let (mut sink1, mut s1, _hello1) = handshake_server(accept_ws(&listener).await).await;
    send_frame(&mut sink1, &spawn_frame("c1", "s1", script)).await;
    match next_frame_skipping_hb(&mut s1).await {
        Frame::InstanceSpawnAck(a) => assert!(a.ok),
        other => panic!("期待 spawn_ack，收到 {other:?}"),
    }
    // 停止读取：不再调用 next_frame（内核接收缓冲填满 → 写超时 → 断线）。
    drop(sink1);
    drop(s1);

    // --- 连接 2：hello buffered=true → buffer_sync 补推（seq 连续）→ 实时 ---
    // 总时限保护：时序敏感（停读/超时/退避/补推均为真实时间），防慢机器挂死。
    let result = tokio::time::timeout(Duration::from_secs(40), async {
        let (sink2, mut s2, hello2) = handshake_server(accept_ws(&listener).await).await;
        assert_eq!(
            hello2.buffered,
            Some(true),
            "背压帧必须已入 Buffer（修复语义闭环：帧不丢失在通道内）"
        );
        assert_eq!(
            hello2.stream_epochs.as_ref().unwrap().get("s1"),
            Some(&1),
            "stream_epochs 应含存活 session 的 epoch"
        );

        // 收集全部 buffer_sync 补推帧（多批）与转实时后的 event 帧。
        let mut synced: Vec<u64> = Vec::new();
        let mut live: Vec<u64> = Vec::new();
        while live.last().copied().unwrap_or_default() < 69 {
            match next_frame_skipping_hb(&mut s2).await {
                Frame::InstanceBufferSync(b) => {
                    assert_eq!(b.chat_id, "s1");
                    assert_eq!(b.epoch, 1);
                    synced.extend(b.frames.iter().map(|f| f.seq));
                }
                Frame::InstanceEvent(e) => {
                    assert_eq!(e.chat_id, "s1");
                    assert_eq!(e.epoch, 1);
                    live.push(e.seq);
                }
                other => panic!("期待 buffer_sync / instance/event，收到 {other:?}"),
            }
        }
        assert!(
            synced.windows(2).all(|w| w[1] == w[0] + 1),
            "补推帧 seq 必须连续无缺口，实际 {synced:?}"
        );
        assert!(!synced.is_empty(), "背压/断线窗口内帧必须经缓冲补推");
        // 已在线送达的帧（内核缓冲吸收的 1~4 帧）不补推：实时首帧必须
        // 紧接补推尾（last_sent_seq+1），整体流完整无缺口。
        assert_eq!(
            synced.last().unwrap() + 1,
            live[0],
            "实时帧 seq 必须与补推衔接（gap 无），synced 尾 {}，live 首 {}",
            synced.last().unwrap(),
            live[0]
        );
        let expected: Vec<u64> = (live[0]..=69).collect();
        assert_eq!(live, expected, "实时帧 seq 连续");

        // process_exit（实时路径，证明链路恢复）。
        match next_frame_skipping_hb(&mut s2).await {
            Frame::InstanceProcessExit(e) => assert_eq!(e.chat_id, "s1"),
            other => panic!("期待 process_exit，收到 {other:?}"),
        }

        drop(sink2);
        drop(s2);
    })
    .await;
    assert!(result.is_ok(), "背压补推链路必须在限时内完成");

    hub.abort();
    let _ = hub.await;
}
