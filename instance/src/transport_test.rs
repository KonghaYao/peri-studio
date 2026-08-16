//! transport 测试（连接循环侧）：指数退避序列（T1）、重连循环（pause + 本地
//! ws stub）、认证通过后退避重置、4502 → Stopped、AuthFailed → Stopped、
//! 连接被拒后重连成功。
//!
//! 发送队列/写路径测试在 [`super::transport_handle_test`]。

use super::transport_test_common::*;
use super::*;
use std::time::Duration;

use peri_studio_proto::frame::Frame;
use futures::SinkExt;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

// ---------------------------------------------------------------------------
// T1：退避序列（纯函数）
// ---------------------------------------------------------------------------

#[test]
fn test_backoff_sequence() {
    let max = Duration::from_secs(60);
    let mut b = Duration::from_secs(1);
    let mut seq = vec![b];
    for _ in 0..8 {
        b = next_backoff(b, max);
        seq.push(b);
    }
    assert_eq!(
        seq,
        vec![
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(4),
            Duration::from_secs(8),
            Duration::from_secs(16),
            Duration::from_secs(32),
            Duration::from_secs(60),
            Duration::from_secs(60),
            Duration::from_secs(60),
        ],
        "§7.1：1s→2s→4s→…→60s 上限"
    );
}

// ---------------------------------------------------------------------------
// T1：重连循环退避（pause + stub：accept 后立即关闭 → 握手失败 → 退避重连）
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn test_reconnect_backoff_sequence() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("ws://{addr}/instance");

    let (acc_tx, mut acc_rx) = mpsc::unbounded_channel::<tokio::time::Instant>();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let tx = acc_tx.clone();
            tokio::spawn(async move {
                let t = tokio::time::Instant::now();
                // 完成 ws 握手后立即关闭 → instance 握手失败 → 退避重连。
                let _ = tokio_tungstenite::accept_async(stream).await;
                let _ = tx.send(t);
            });
        }
    });

    let (events_tx, mut events_rx) = mpsc::channel(256);
    let (handle, task) = start_run(base_config(url), events_tx);

    // 虚拟时钟步进，收集连接时间戳（退避 1,2,4,8,16,32,60,60…）。
    // 每步 advance 后让出真实时间供 I/O 完成（否则 accept 时刻被虚拟时钟
    // 前进污染）。
    let mut conns = Vec::new();
    for _ in 0..2000 {
        tokio::time::advance(Duration::from_millis(100)).await;
        real_wait_yield(Duration::from_millis(5)).await;
        while let Ok(t) = acc_rx.try_recv() {
            conns.push(t);
        }
        if conns.len() >= 9 {
            break;
        }
    }
    assert!(conns.len() >= 9, "应观察到 ≥9 次重连，实际 {}", conns.len());

    // 时间间隔序列（容差 ±300ms：100ms 步进 + 真实 I/O 微秒级）。
    let gaps: Vec<Duration> = conns.windows(2).map(|w| w[1] - w[0]).collect();
    let expected = [
        Duration::from_secs(1),
        Duration::from_secs(2),
        Duration::from_secs(4),
        Duration::from_secs(8),
        Duration::from_secs(16),
        Duration::from_secs(32),
        Duration::from_secs(60),
        Duration::from_secs(60),
    ];
    for (i, (got, want)) in gaps.iter().zip(expected.iter()).enumerate() {
        assert!(
            (*got).abs_diff(*want) <= Duration::from_millis(300),
            "第 {i} 个间隔应为 {want:?}，实际 {got:?}"
        );
    }

    // 事件序列：Connected / Disconnected 交替（握手失败 → Retry）。
    let events = drain_events(&mut events_rx).await;
    assert!(
        events
            .iter()
            .any(|e| matches!(e, TransportEvent::Connected)),
        "应有 Connected 事件，实际 {events:?}"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, TransportEvent::Disconnected)),
        "握手失败应有 Disconnected 事件，实际 {events:?}"
    );

    handle.shutdown();
    task.abort();
}

// ---------------------------------------------------------------------------
// T1：认证通过后退避重置为 base
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn test_backoff_reset_after_auth() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("ws://{addr}/instance");

    // stub 状态机：前 2 次连接关闭（握手失败 → 退避涨到 4s），第 3 次正常
    // 认证后关闭，第 4 次起记录时间。
    let (acc_tx, mut acc_rx) = mpsc::unbounded_channel::<(u64, tokio::time::Instant)>();
    tokio::spawn(async move {
        let mut conn_no = 0u64;
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            conn_no += 1;
            let tx = acc_tx.clone();
            tokio::spawn(async move {
                let t = tokio::time::Instant::now();
                let Ok(ws) = tokio_tungstenite::accept_async(stream).await else {
                    return;
                };
                let mut ws = ws;
                if conn_no <= 2 {
                    // 不认证：直接关闭 → 握手失败。
                    let _ = ws.close(None).await;
                    let _ = tx.send((conn_no, t));
                    return;
                }
                // 认证成功。
                let mut hello = None;
                use futures::StreamExt;
                for _ in 0..4 {
                    match ws.next().await {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(Frame::InstanceHello(h)) = Frame::parse(&text) {
                                hello = Some(h);
                                break;
                            }
                        }
                        _ => break,
                    }
                }
                let Some(h) = hello else { return };
                let resp = valid_auth_response(&h);
                let _ = ws
                    .send(Message::Text(
                        serde_json::to_string(&Frame::AuthResponse(resp))
                            .unwrap()
                            .into(),
                    ))
                    .await;
                // 保持连接片刻（虚拟时间 100ms）后关闭 → instance 断线重连。
                tokio::time::sleep(Duration::from_millis(100)).await;
                let _ = ws.close(None).await;
                let _ = tx.send((conn_no, t));
            });
        }
    });

    let (events_tx, mut events_rx) = mpsc::channel(256);
    let (handle, task) = start_run(base_config(url), events_tx);

    let mut conns = Vec::new();
    for _ in 0..600 {
        tokio::time::advance(Duration::from_millis(100)).await;
        real_wait_yield(Duration::from_millis(5)).await;
        while let Ok((no, t)) = acc_rx.try_recv() {
            conns.push((no, t));
        }
        if conns.len() >= 4 {
            break;
        }
    }
    assert!(
        conns.len() >= 4,
        "应观察到 4 次连接，实际 {:?}",
        conns.len()
    );

    // 前两次失败：间隔 1s、2s（退避增长中）。
    let t1 = conns.iter().find(|(n, _)| *n == 1).unwrap().1;
    let t2 = conns.iter().find(|(n, _)| *n == 2).unwrap().1;
    let t3 = conns.iter().find(|(n, _)| *n == 3).unwrap().1;
    let t4 = conns.iter().find(|(n, _)| *n == 4).unwrap().1;
    assert!((t2 - t1).abs_diff(Duration::from_secs(1)) <= Duration::from_millis(300));
    assert!((t3 - t2).abs_diff(Duration::from_secs(2)) <= Duration::from_millis(300));
    // 第 3 次认证通过 → 退避重置为 base=1s：第 4 次连接间隔 1s（而非 4s）。
    assert!(
        (t4 - t3).abs_diff(Duration::from_secs(1)) <= Duration::from_millis(300),
        "认证通过后退避必须重置为 1s，实际间隔 {:?}",
        t4 - t3
    );

    // 事件：曾出现 Authenticated。
    let events = drain_events(&mut events_rx).await;
    assert!(events
        .iter()
        .any(|e| matches!(e, TransportEvent::Authenticated)));

    handle.shutdown();
    task.abort();
}

// ---------------------------------------------------------------------------
// T1：4502 → Stopped(ConfigFatal)，不再重连
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_close_4502_stops_reconnect() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("ws://{addr}/instance");

    let (events_tx, mut events_rx) = mpsc::channel(256);
    let (_handle, task) = start_run(base_config(url), events_tx);

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
            return;
        };
        // 读 hello（模拟 server 收到注册请求后校验失败）。
        use futures::StreamExt;
        for _ in 0..4 {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(Frame::InstanceHello(_)) = Frame::parse(&text) {
                        break;
                    }
                }
                _ => break,
            }
        }
        // server 以 4502（配置性永久失败）关闭。
        let _ = ws
            .close(Some(CloseFrame {
                code: 4502.into(),
                reason: "config_fatal".into(),
            }))
            .await;
    });

    let events = collect_events(&mut events_rx, Duration::from_secs(3)).await;
    assert!(
        events
            .iter()
            .any(|e| matches!(e, TransportEvent::Stopped(StoppedReason::ConfigFatal))),
        "4502 关闭 → Stopped(ConfigFatal)，事件: {events:?}"
    );
    // run 应已返回（不再重连）。
    let _ = task.await.expect("run 正常返回");
    drop(_handle);
}

// ---------------------------------------------------------------------------
// T11：AuthFailed → Stopped（伪造 HMAC）
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_auth_failure_stops() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("ws://{addr}/instance");

    let (events_tx, mut events_rx) = mpsc::channel(256);
    let (_handle, task) = start_run(base_config(url), events_tx);

    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
            return;
        };
        // 读 hello → 回伪造 auth_response。
        use futures::StreamExt;
        for _ in 0..4 {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(Frame::InstanceHello(h)) = Frame::parse(&text) {
                        let resp = forged_auth_response(&h);
                        let _ = ws
                            .send(Message::Text(
                                serde_json::to_string(&Frame::AuthResponse(resp))
                                    .unwrap()
                                    .into(),
                            ))
                            .await;
                        break;
                    }
                }
                _ => break,
            }
        }
    });

    let events = collect_events(&mut events_rx, Duration::from_secs(3)).await;
    assert!(
        events
            .iter()
            .any(|e| matches!(e, TransportEvent::Stopped(StoppedReason::AuthFailed))),
        "伪造 HMAC → Stopped(AuthFailed)，不自动重连，事件: {events:?}"
    );
    let _ = task.await.expect("run 正常返回");
    drop(_handle);
}

// ---------------------------------------------------------------------------
// 连接失败（无 listener）→ 退避重试后成功
// ---------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn test_connect_refused_then_success() {
    // 先占用一个端口再释放，制造「连接被拒」。
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener); // 端口释放：第一次连接将被拒绝

    let url = format!("ws://{addr}/instance");
    let (events_tx, mut events_rx) = mpsc::channel(256);
    let (handle, task) = start_run(base_config(url), events_tx);

    // stub：虚拟 2s 后恢复监听（第一次连接被拒 → 退避 1s → 重试仍失败 →
    // 退避 2s → 虚拟 3s 重试成功）。
    let (acc_tx, mut acc_rx) = mpsc::unbounded_channel::<tokio::time::Instant>();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let listener = TcpListener::bind(addr).await.unwrap();
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let tx = acc_tx.clone();
            tokio::spawn(async move {
                let t = tokio::time::Instant::now();
                let _ = tokio_tungstenite::accept_async(stream).await;
                let _ = tx.send(t);
            });
        }
    });

    // 分步推进：1s（第一次重试，仍被拒）→ 2s（stub 恢复监听）→ 3s（退避中）
    // → 4s（第二次重试成功：退避 1s→2s 后）。
    for _ in 0..4 {
        tokio::time::advance(Duration::from_secs(1)).await;
        real_wait_yield(Duration::from_millis(50)).await;
    }
    real_wait_yield(Duration::from_millis(300)).await;

    let mut accs = Vec::new();
    while let Ok(t) = acc_rx.try_recv() {
        accs.push(t);
    }
    assert!(!accs.is_empty(), "stub 应观察到连接（退避重连成功）");
    let events = drain_events(&mut events_rx).await;
    assert!(
        events
            .iter()
            .any(|e| matches!(e, TransportEvent::Connected)),
        "连接被拒后应退避重连成功，事件: {events:?}"
    );

    handle.shutdown();
    task.abort();
}
