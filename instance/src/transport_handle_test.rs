//! transport 测试（发送队列/写路径侧）：§8.6 硬背压（队列满及时返回）、
//! send_acked / send_acked_bytes 断线回执、字节入口逐字节写入、P1-3 写超时
//! 断线。

use super::transport_test_common::*;
use super::*;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use peri_studio_proto::frame::Frame;
use peri_studio_proto::instance::{InstanceEvent, InstanceHeartbeat};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

// ---------------------------------------------------------------------------
// §8.6 硬背压：发送队列满 → 及时返回（不挂起主循环）+ 通道关闭
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_queue_full_returns_immediately_not_hang() {
    // 手工构造满 channel（无 writer 消费）验证 try_dispatch 语义：
    // 满 → Err(QueueFull)（dispatch 层处置为断线）；关闭后 → Err(Disconnected)。
    let (tx, _rx) = mpsc::channel::<Outbound>(4);
    let frame = Frame::InstanceHeartbeat(InstanceHeartbeat {
        load: 0,
        alive_sessions: Vec::new(),
    });
    for _ in 0..4 {
        tx.try_send(Outbound::Frame(frame.clone())).unwrap();
    }

    let full = tokio::time::timeout(Duration::from_secs(1), async {
        try_dispatch(&tx, Outbound::Frame(frame.clone()))
    })
    .await
    .expect("队列满时入队必须及时返回（不得挂起主循环）");
    assert_eq!(full, Err(SendError::QueueFull), "满 → QueueFull（§8.6）");

    // 已关闭的通道（receiver 已 drop）：一律 Err(Disconnected)。
    let (tx2, rx2) = mpsc::channel::<Outbound>(1);
    drop(rx2);
    let closed = tokio::time::timeout(Duration::from_secs(1), async {
        try_dispatch(&tx2, Outbound::Frame(frame))
    })
    .await
    .expect("通道关闭后入队必须及时返回");
    assert_eq!(closed, Err(SendError::Disconnected));
}

// ---------------------------------------------------------------------------
// send_acked：无连接/断线时回执 Err（帧未发出，hub 转缓冲路径）
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_send_acked_disconnected_errors() {
    let (handle, _cancel) = TransportHandle::new(4);
    let frame = Frame::InstanceHeartbeat(InstanceHeartbeat {
        load: 0,
        alive_sessions: Vec::new(),
    });
    let res = tokio::time::timeout(Duration::from_secs(1), handle.send_acked(frame))
        .await
        .expect("无连接时 send_acked 必须及时返回")
        .expect_err("无连接必须 Err");
    assert_eq!(res, SendError::Disconnected);
}

// ---------------------------------------------------------------------------
// P1-2 字节入口：send_acked_bytes（复用大小检查序列化产物，免二次序列化）
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_send_acked_bytes_disconnected_errors() {
    let (handle, _cancel) = TransportHandle::new(4);
    let res = tokio::time::timeout(
        Duration::from_secs(1),
        handle.send_acked_bytes(b"{}".to_vec()),
    )
    .await
    .expect("无连接时 send_acked_bytes 必须及时返回（drain 回执遗漏会悬挂）")
    .expect_err("无连接必须 Err");
    assert_eq!(res, SendError::Disconnected);
}

#[tokio::test]
async fn test_send_acked_bytes_writes_exact_bytes() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("ws://{addr}/instance");

    let (events_tx, mut events_rx) = mpsc::channel(256);
    let (handle, task) = start_run(base_config(url), events_tx);

    // stub server：握手 → 之后所有文本帧原样转发（不解析，供逐字节断言）。
    let (recv_tx, mut recv_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
            return;
        };
        // 读 hello → 回合法 auth_response。
        for _ in 0..4 {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(Frame::InstanceHello(h)) = Frame::parse(&text) {
                        let resp = valid_auth_response(&h);
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
        while let Some(Ok(Message::Text(t))) = ws.next().await {
            if recv_tx.send(t.as_bytes().to_vec()).is_err() {
                break;
            }
        }
    });

    // 等认证通过（连接建立；writer 就绪需稍后，见下方重试）。
    let authed = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match events_rx.recv().await {
                Some(TransportEvent::Authenticated) => break,
                Some(_) => continue,
                None => panic!("events channel 关闭"),
            }
        }
    })
    .await;
    assert!(authed.is_ok(), "应完成认证");

    // 1) Frame 序列化字节：server 端逐字节等于发送内容（不走 Frame 序列化/解析）。
    let frame_bytes = serde_json::to_vec(&Frame::InstanceHeartbeat(InstanceHeartbeat {
        load: 0,
        alive_sessions: Vec::new(),
    }))
    .unwrap();
    // Authenticated 事件发送与 writer 初始化在同一任务内顺序执行，到达时发送
    // 队列可能尚未就绪（Err(Disconnected)）→ 重试直至成功（限时保护）。
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match handle.send_acked_bytes(frame_bytes.clone()).await {
                Ok(()) => break,
                Err(SendError::Disconnected) => tokio::task::yield_now().await,
                Err(e) => panic!("在线 send_acked_bytes 失败: {e:?}"),
            }
        }
    })
    .await
    .expect("writer 应在 3s 内就绪");
    let got = tokio::time::timeout(Duration::from_secs(1), recv_rx.recv())
        .await
        .expect("server 应收到字节帧")
        .expect("channel 未关闭");
    assert_eq!(got, frame_bytes, "字节入口必须原样写入（逐字节相等）");

    // 2) 非 Frame 合法 JSON：证明字节入口不做 Frame 约束，仍按文本原样写入。
    let raw = br#"{"a":1}"#.to_vec();
    handle
        .send_acked_bytes(raw.clone())
        .await
        .expect("在线发送必须成功");
    let got = tokio::time::timeout(Duration::from_secs(1), recv_rx.recv())
        .await
        .expect("server 应收到第二帧")
        .expect("channel 未关闭");
    assert_eq!(got, raw, "非 Frame JSON 也必须原样写入");

    handle.shutdown();
    task.abort();
}

// ---------------------------------------------------------------------------
// P1-3：写超时断线（TCP 背压 → 单帧写超时 == 断线，复用既有断线路径）
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_write_timeout_disconnects_stalled_peer() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("ws://{addr}/instance");

    // stub server：握手完成后**保持连接打开但不再读取**（内核接收缓冲填满 →
    // TCP 窗口 0 → instance writer 卡写 → 超时断线）。
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
            return;
        };
        // 读 hello → 回合法 auth_response。
        for _ in 0..4 {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(Frame::InstanceHello(h)) = Frame::parse(&text) {
                        let resp = valid_auth_response(&h);
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
        // 保持连接打开但不读（真实时间；不 drop ws 否则立即断线而非背压）。
        tokio::time::sleep(Duration::from_secs(3)).await;
    });

    let mut config = base_config(url);
    config.write_timeout = Duration::from_millis(200);
    let (events_tx, mut events_rx) = mpsc::channel(256);
    let (handle, task) = start_run(config, events_tx);

    // 等认证通过（writer 就绪）。
    let authed = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match events_rx.recv().await {
                Some(TransportEvent::Authenticated) => break,
                Some(_) => continue,
                None => panic!("events channel 关闭"),
            }
        }
    })
    .await;
    assert!(authed.is_ok(), "应完成认证");

    // 循环发送 256KB 帧直至断线：每帧必须在 2s 内返回（核心回归断言——
    // 修复前 send_acked 在背压时无限挂起，主循环与心跳一起停摆）。
    let payload = serde_json::json!({ "pad": "x".repeat(256 * 1024) });
    let mut sent: u64 = 0;
    let mut disconnected = false;
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let frame = Frame::InstanceEvent(InstanceEvent {
                chat_id: "s1".to_string(),
                epoch: 1,
                seq: sent + 1,
                frame: payload.clone(),
            });
            match tokio::time::timeout(Duration::from_secs(2), handle.send_acked(frame))
                .await
                .expect("send_acked 必须及时返回（不得挂起主循环）")
            {
                Ok(()) => sent += 1,
                Err(SendError::Disconnected) => {
                    disconnected = true;
                    break;
                }
                Err(e) => panic!("在线发送意外失败: {e:?}"),
            }
        }
    })
    .await
    .expect("发送循环必须在限时内收敛（断线回执）");
    assert!(disconnected, "背压超时必须回执 Disconnected");
    assert!(
        sent >= 4,
        "应至少发出 4 帧（1MB，确保填满内核接收缓冲触发背压），实际 {sent}"
    );

    // Disconnected 事件（断线 → 重连已触发）。
    let events = collect_events(&mut events_rx, Duration::from_millis(500)).await;
    assert!(
        events
            .iter()
            .any(|e| matches!(e, TransportEvent::Disconnected)),
        "应出现 Disconnected 事件，实际 {events:?}"
    );

    handle.shutdown();
    task.abort();
}
