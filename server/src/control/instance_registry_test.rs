//! InstanceRegistry 生命周期单测（设计稿 §16 测试 24–27）：hello 幂等替换
//! （fencing）、心跳/离线判定、per-chat 流纪元、陈旧断开识别。
//! 指令下发 / ack 跟踪 / 孤儿清理测试见 `instance_commands_test.rs`。

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;
use tokio::sync::mpsc;

use peri_studio_proto::frame::Frame;
use peri_studio_proto::instance::{
    InstanceHeartbeat, InstanceHello, InstanceKillAck, InstanceSpawn,
};

use super::*;
use crate::channel::OutboundMsg;
use crate::control::chat_registry::ChatRegistry;
use crate::state::registry::RegistryState;

/// 无 Registry 的 ChatRegistry 替身（测试不写 Registry Doc）。
fn test_registry() -> (RegistryState, mpsc::Receiver<()>) {
    // 直接构造一个「死 registry」：channel closed → 方法返回 Err，测试避免
    // 依赖 Registry。
    let (rtx, _rrx) = mpsc::channel::<crate::state::registry::RegistryMsg>(8);
    let registry = RegistryState::new(rtx);
    let (_drop_tx, drop_rx) = mpsc::channel::<()>(8);
    (registry, drop_rx)
}

fn hello(instance_id: &str) -> InstanceHello {
    InstanceHello {
        protocol_version: peri_studio_proto::version::PROTOCOL_VERSION,
        token: "tok".into(),
        hostname: instance_id.into(),
        caps: json!({}),
        buffered: None,
        buffer_lost: None,
        stream_epochs: None,
        nonce: "AAAA".into(),
    }
}

#[tokio::test]
async fn lifecycle_hello_heartbeat_offline() {
    let (registry, _drop) = test_registry();
    let chats = ChatRegistry::new(registry);
    let reg = InstanceRegistry::new(Duration::from_secs(30), Duration::from_secs(10), chats);
    let (tx, _rx) = mpsc::channel(8);
    let outcome = reg
        .on_hello("m1", "tok-1", InstanceConn { tx }, &hello("m1"))
        .await;
    assert!(!outcome.fenced_previous);
    assert_eq!(reg.state("m1").await, Some(InstanceState::Online));

    // 心跳续期。
    let first = reg
        .on_heartbeat(
            "m1",
            &InstanceHeartbeat {
                load: 10,
                alive_sessions: vec![],
            },
        )
        .await
        .unwrap();
    assert_eq!(
        first,
        HeartbeatOutcome {
            first_snapshot: true,
            changed: true,
        },
        "首个空 alive_sessions 仍是 authoritative 快照"
    );

    let repeated = reg
        .on_heartbeat(
            "m1",
            &InstanceHeartbeat {
                load: 10,
                alive_sessions: vec![],
            },
        )
        .await
        .unwrap();
    assert_eq!(
        repeated,
        HeartbeatOutcome {
            first_snapshot: false,
            changed: false,
        }
    );

    // 30s 无心跳 → OFFLINE（注入时钟）。
    let t0 = Instant::now();
    assert!(reg
        .sweep_offline(t0 + Duration::from_secs(29))
        .await
        .is_empty());
    let offline = reg.sweep_offline(t0 + Duration::from_secs(31)).await;
    assert_eq!(offline, vec!["m1".to_string()]);
    assert_eq!(reg.state("m1").await, Some(InstanceState::Offline));

    // 重连心跳 → ONLINE。
    reg.on_heartbeat(
        "m1",
        &InstanceHeartbeat {
            load: 0,
            alive_sessions: vec![],
        },
    )
    .await
    .unwrap();
    assert_eq!(reg.state("m1").await, Some(InstanceState::Online));
    let _ = _drop;
}

#[tokio::test]
async fn hello_fencing_replaces_connection() {
    let (registry, _drop) = test_registry();
    let chats = ChatRegistry::new(registry);
    let reg = InstanceRegistry::new(Duration::from_secs(30), Duration::from_secs(10), chats);
    let (tx1, mut rx1) = mpsc::channel(8);
    reg.on_hello("m1", "tok-1", InstanceConn { tx: tx1 }, &hello("m1"))
        .await;
    // 新 hello（同 instance_id）→ 旧连接 fencing（关闭信号）。
    let (tx2, _rx2) = mpsc::channel(8);
    let outcome = reg
        .on_hello("m1", "tok-1", InstanceConn { tx: tx2 }, &hello("m1"))
        .await;
    assert!(outcome.fenced_previous);
    // 旧连接收到 Close(1011)。
    let msg = rx1.recv().await.expect("old connection should be closed");
    assert!(matches!(msg, OutboundMsg::Close(1011)));
    let _ = _drop;
}

#[tokio::test]
async fn chat_epoch_from_hello() {
    let (registry, _drop) = test_registry();
    let chats = ChatRegistry::new(registry);
    let reg = InstanceRegistry::new(Duration::from_secs(30), Duration::from_secs(10), chats);
    let mut h = hello("m1");
    h.stream_epochs = Some([("acp-1".to_string(), 1u64)].into_iter().collect());
    let (tx, _rx) = mpsc::channel(8);
    reg.on_hello("m1", "tok-1", InstanceConn { tx }, &h).await;
    assert_eq!(reg.chat_epoch("m1", "acp-1").await, Some(1));
    assert_eq!(reg.chat_epoch("m1", "acp-2").await, None);
    let _ = _drop;
}

/// 孤儿清理钩子（§16 测试 27 + §7.5/§7.6）：意外存活（server 已标记终态但
/// instance 声称存活）+ pending_close 补发 → 下发 kill 断言（fake conn 收
/// kill 并回 ack）。
///
/// 注意：M1 `instance/hello` 无 alive_sessions 字段（§4.5 表），`on_hello`
/// 产出的 [`HelloOutcome`] 存活清单恒空——此处手工构造 [`HelloOutcome`]
/// 驱动对账，等价于未来版本/心跳驱动的对账输入（§8.3 步骤 5）。
#[tokio::test]
async fn fencing_stale_disconnect_keeps_new_connection_serving() {
    let (registry, _drop) = test_registry();
    let chats = ChatRegistry::new(registry);
    let reg = InstanceRegistry::new(Duration::from_secs(30), Duration::from_secs(10), chats);
    let (tx1, _rx1) = mpsc::channel(8);
    reg.on_hello(
        "m1",
        "tok-1",
        InstanceConn { tx: tx1.clone() },
        &hello("m1"),
    )
    .await;
    // 新 hello（fencing 旧连接，§4.5）。
    let (tx2, mut rx2) = mpsc::channel(8);
    let outcome = reg
        .on_hello(
            "m1",
            "tok-1",
            InstanceConn { tx: tx2.clone() },
            &hello("m1"),
        )
        .await;
    assert!(outcome.fenced_previous);
    let heartbeat = InstanceHeartbeat {
        load: 0,
        alive_sessions: vec!["s-live".to_string()],
    };
    assert!(matches!(
        reg.on_connection_heartbeat("m1", &InstanceConn { tx: tx1.clone() }, &heartbeat)
            .await,
        Err(InstanceError::ConnectionGone)
    ));
    assert!(
        reg.on_connection_heartbeat("m1", &InstanceConn { tx: tx2.clone() }, &heartbeat)
            .await
            .unwrap()
            .first_snapshot
    );
    // 旧连接退出（gateway 断链路径）——陈旧断开：不得置 Offline。
    assert!(!reg.on_disconnect("m1", &InstanceConn { tx: tx1 }).await);
    assert_eq!(reg.state("m1").await, Some(InstanceState::Online));
    // 新连接仍可服务：spawn 下发成功（fake instance 回 ack）。
    let spawned = tokio::spawn({
        let reg = reg.clone();
        async move {
            reg.send_spawn(
                "m1",
                InstanceSpawn {
                    command_id: "c1".into(),
                    chat_id: "s1".into(),
                    cmd: vec!["peri".into()],
                    cwd: "/".into(),
                    env: None,
                },
            )
            .await
        }
    });
    match rx2.recv().await {
        Some(OutboundMsg::Frame(Frame::InstanceSpawn(k))) => {
            assert!(
                reg.on_ack(
                    "m1",
                    &k.command_id,
                    InstanceAck::Spawn(InstanceSpawnAck {
                        command_id: k.command_id.clone(),
                        chat_id: "s1".into(),
                        ok: true,
                        error: None,
                    }),
                )
                .await
            );
        }
        other => panic!("expected spawn frame on new connection, got {other:?}"),
    }
    assert!(matches!(spawned.await.unwrap(), Ok(SpawnOutcome::Acked(_))));
    let _ = _drop;
}

/// 心跳超时判定 OFFLINE 后，心跳恢复 → ONLINE 即可服务（§7.1 心跳恢复
/// 路径）：`sweep_offline` 不得清空连接句柄（连接可能仍存活；清空后无恢复
/// 路径，机器不会重连——服务瘫痪）。
#[tokio::test]
async fn heartbeat_recovery_after_offline_sweep_serves_commands() {
    let (registry, _drop) = test_registry();
    let chats = ChatRegistry::new(registry);
    let reg = InstanceRegistry::new(Duration::from_secs(30), Duration::from_secs(10), chats);
    let (tx, mut rx) = mpsc::channel(8);
    reg.on_hello("m1", "tok-1", InstanceConn { tx: tx.clone() }, &hello("m1"))
        .await;
    // 30s 无心跳 → OFFLINE（连接句柄保留）。
    let t0 = Instant::now();
    let offline = reg.sweep_offline(t0 + Duration::from_secs(31)).await;
    assert_eq!(offline, vec!["m1".to_string()]);
    assert_eq!(reg.state("m1").await, Some(InstanceState::Offline));
    // OFFLINE 期间指令拒绝（§7.1）。
    assert!(matches!(
        reg.send_spawn(
            "m1",
            InstanceSpawn {
                command_id: "c0".into(),
                chat_id: "s0".into(),
                cmd: vec!["peri".into()],
                cwd: "/".into(),
                env: None,
            },
        )
        .await,
        Err(InstanceError::Offline)
    ));
    // 心跳恢复 → ONLINE，无需重连即可服务（§7.1 图：OFFLINE ──► ONLINE）。
    reg.on_heartbeat(
        "m1",
        &InstanceHeartbeat {
            load: 0,
            alive_sessions: vec![],
        },
    )
    .await
    .unwrap();
    assert_eq!(reg.state("m1").await, Some(InstanceState::Online));
    let spawned = tokio::spawn({
        let reg = reg.clone();
        async move {
            reg.send_spawn(
                "m1",
                InstanceSpawn {
                    command_id: "c1".into(),
                    chat_id: "s1".into(),
                    cmd: vec!["peri".into()],
                    cwd: "/".into(),
                    env: None,
                },
            )
            .await
        }
    });
    match rx.recv().await {
        Some(OutboundMsg::Frame(Frame::InstanceSpawn(k))) => {
            assert!(
                reg.on_ack(
                    "m1",
                    &k.command_id,
                    InstanceAck::Spawn(InstanceSpawnAck {
                        command_id: k.command_id.clone(),
                        chat_id: "s1".into(),
                        ok: true,
                        error: None,
                    }),
                )
                .await
            );
        }
        other => panic!("expected spawn frame after heartbeat recovery, got {other:?}"),
    }
    assert!(matches!(spawned.await.unwrap(), Ok(SpawnOutcome::Acked(_))));
    let _ = _drop;
}

/// 心跳只记录 authoritative alive 快照并返回变化语义；具体 reconcile + kill
/// 由 RecoveryCoordinator 的串行 lane 调用，InstanceRegistry 不得自行 spawn
/// 后台任务破坏快照顺序。
#[tokio::test]
async fn heartbeat_alive_sessions_reconciliation_kills() {
    let tmp = tempfile::tempdir().unwrap();
    let sink = Arc::new(crate::control::StoreSink::new());
    let doc = Arc::new(crate::state::doc_manager::DocManager::new(
        crate::state::doc_manager::BatchConfig::default(),
        sink,
    ));
    let chats = ChatRegistry::new(doc.registry());
    let reg = InstanceRegistry::new(
        Duration::from_secs(30),
        Duration::from_secs(2),
        chats.clone(),
    );
    let (tx, mut rx) = mpsc::channel(8);
    reg.on_hello("m1", "tok-1", InstanceConn { tx }, &hello("m1"))
        .await;

    // s1：终态（意外存活，§7.5）；s2：pending_close（§7.6 补发）。
    chats.register("s1", "m1", None, "/", None).await.unwrap();
    chats.transition("s1", ChatState::Closed).await.unwrap();
    chats.register("s2", "m1", None, "/", None).await.unwrap();
    chats.request_close_offline("s2").await.unwrap();

    let heartbeat = reg
        .on_heartbeat(
            "m1",
            &InstanceHeartbeat {
                load: 0,
                alive_sessions: vec!["s1".to_string(), "s2".to_string()],
            },
        )
        .await
        .unwrap();
    assert!(heartbeat.first_snapshot);
    assert!(heartbeat.changed);
    assert!(
        tokio::time::timeout(Duration::from_millis(20), rx.recv())
            .await
            .is_err(),
        "registry 记录心跳时不得自行启动异步对账"
    );
    reg.reconcile_authoritative_alive("m1", &["s1".to_string(), "s2".to_string()])
        .await
        .unwrap();
    let mut targets = Vec::new();
    for _ in 0..2 {
        let msg = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("kill frame timeout")
            .expect("channel alive");
        match msg {
            OutboundMsg::Frame(Frame::InstanceKill(k)) => {
                targets.push(k.chat_id.clone());
                let ack = InstanceAck::Kill(InstanceKillAck {
                    command_id: k.command_id.clone(),
                    chat_id: k.chat_id.clone(),
                    ok: true,
                });
                assert!(reg.on_ack("m1", &k.command_id, ack).await);
            }
            other => panic!("expected InstanceKill, got {other:?}"),
        }
    }
    assert!(
        targets.contains(&"s1".to_string()),
        "意外存活应 kill（§7.5）"
    );
    assert!(
        targets.contains(&"s2".to_string()),
        "pending_close 应补发 kill（§7.6）"
    );
    // kill 完成 → 会话 Closed（pending_close 集合清除，§7.6）。
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(chats.pending_close_chats().await.is_empty());
    // 相同 alive 再上报 → 不重复触发（无新 kill 帧）。
    reg.on_heartbeat(
        "m1",
        &InstanceHeartbeat {
            load: 0,
            alive_sessions: vec!["s1".to_string(), "s2".to_string()],
        },
    )
    .await
    .unwrap();
    let extra = tokio::time::timeout(Duration::from_millis(300), rx.recv()).await;
    assert!(extra.is_err(), "alive 未变化不应重复对账 kill");
    let _ = (doc, tmp);
}
