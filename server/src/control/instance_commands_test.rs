//! InstanceRegistry 指令面单测（设计稿 §16 测试 24–27）：spawn/kill ack
//! 跟踪与超时、forward_rpc/forward_notification、孤儿清理与心跳对账 kill
//! 裁决。生命周期 / 心跳 / fencing 测试见 `instance_registry_test.rs`。

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::sync::mpsc;

use peri_studio_proto::frame::Frame;
use peri_studio_proto::instance::{
    InstanceForwardAck, InstanceHello, InstanceKillAck, InstanceSpawn, InstanceSpawnAck,
};
use peri_studio_proto::resource::{
    DirectoryPage, InstanceResourcePayload, InstanceResourceQuery, InstanceResourceQueryKind,
    InstanceResourceResult, ReadDirectoryQuery,
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
        caps: json!({"resources": {"protocolVersion": peri_studio_proto::resource::RESOURCE_PROTOCOL_VERSION}}),
        buffered: None,
        buffer_lost: None,
        stream_epochs: None,
        nonce: "AAAA".into(),
    }
}

#[tokio::test]
async fn spawn_ack_tracking_and_timeout() {
    let (registry, _drop) = test_registry();
    let chats = ChatRegistry::new(registry);
    // 指令超时用极短值。
    let reg = InstanceRegistry::new(Duration::from_secs(30), Duration::from_millis(50), chats);
    let (tx, mut rx) = mpsc::channel(8);
    reg.on_hello("m1", "tok-1", InstanceConn { tx }, &hello("m1"))
        .await;

    let spawn_cmd = InstanceSpawn {
        command_id: "c1".into(),
        chat_id: "s1".into(),
        cmd: vec!["peri".into()],
        cwd: "/".into(),
        env: None,
    };
    // 无 ack → 超时（AgentUnavailable 语义）。
    let spawned = tokio::spawn({
        let reg = reg.clone();
        let cmd = spawn_cmd.clone();
        async move { reg.send_spawn("m1", cmd).await }
    });
    // instance 侧先收到 spawn 帧。
    match rx.recv().await {
        Some(OutboundMsg::Frame(Frame::InstanceSpawn(_))) => {}
        other => panic!("expected spawn frame, got {other:?}"),
    }
    // 回 ack → 回填成功。
    let r = reg
        .on_ack(
            "m1",
            "c1",
            InstanceAck::Spawn(InstanceSpawnAck {
                command_id: "c1".into(),
                chat_id: "s1".into(),
                ok: true,
                error: None,
            }),
        )
        .await;
    assert!(r);
    let result = spawned.await.unwrap().unwrap();
    match result {
        SpawnOutcome::Acked(a) => assert!(a.ok),
    }
    // 超时路径。
    let cmd2 = InstanceSpawn {
        command_id: "c2".into(),
        chat_id: "s2".into(),
        cmd: vec!["peri".into()],
        cwd: "/".into(),
        env: None,
    };
    let r2 = reg.send_spawn("m1", cmd2).await;
    assert!(matches!(r2, Err(InstanceError::Timeout)));
    let _ = _drop;
}

#[tokio::test]
async fn offline_instance_rejects_commands() {
    let (registry, _drop) = test_registry();
    let chats = ChatRegistry::new(registry);
    let reg = InstanceRegistry::new(Duration::from_secs(30), Duration::from_secs(10), chats);
    let (tx, _rx) = mpsc::channel(8);
    reg.on_hello("m1", "tok-1", InstanceConn { tx: tx.clone() }, &hello("m1"))
        .await;
    // 断开（当前连接句柄）→ OFFLINE。
    assert!(reg.on_disconnect("m1", &InstanceConn { tx }).await);
    let cmd = InstanceSpawn {
        command_id: "c1".into(),
        chat_id: "s1".into(),
        cmd: vec!["peri".into()],
        cwd: "/".into(),
        env: None,
    };
    assert!(matches!(
        reg.send_spawn("m1", cmd).await,
        Err(InstanceError::Offline)
    ));
    let _ = _drop;
}

#[tokio::test]
async fn resource_query_tracks_result_by_request_id() {
    let (registry, _drop) = test_registry();
    let chats = ChatRegistry::new(registry);
    let reg = InstanceRegistry::new(Duration::from_secs(30), Duration::from_secs(10), chats);
    let (tx, mut rx) = mpsc::channel(8);
    reg.on_hello("m1", "tok-1", InstanceConn { tx }, &hello("m1"))
        .await;

    let query = InstanceResourceQuery {
        request_id: "resource-1".into(),
        workspace_id: "project-1".into(),
        root: "/workspace".into(),
        query: InstanceResourceQueryKind::ReadDirectory(ReadDirectoryQuery {
            path: "".into(),
            cursor: None,
            limit: 200,
        }),
    };
    let pending = tokio::spawn({
        let reg = reg.clone();
        let query = query.clone();
        async move { reg.query_resource("m1", query).await }
    });

    match rx.recv().await {
        Some(OutboundMsg::Frame(Frame::InstanceResourceQuery(actual))) => {
            assert_eq!(actual, query);
        }
        other => panic!("expected resource query frame, got {other:?}"),
    }
    let result = InstanceResourceResult {
        request_id: "resource-1".into(),
        result: Some(InstanceResourcePayload::DirectoryPage(DirectoryPage {
            path: "".into(),
            source_generation: "g1".into(),
            entries: Vec::new(),
            next_cursor: None,
        })),
        error: None,
    };
    assert!(
        reg.on_ack("m1", "resource-1", InstanceAck::Resource(result.clone()))
            .await
    );
    assert_eq!(pending.await.unwrap().unwrap(), result);
}

#[tokio::test]
async fn resource_query_requires_negotiated_instance_capability() {
    let (registry, _drop) = test_registry();
    let reg = InstanceRegistry::new(
        Duration::from_secs(30),
        Duration::from_secs(1),
        ChatRegistry::new(registry),
    );
    let (tx, _rx) = mpsc::channel(4);
    let mut unsupported = hello("m1");
    unsupported.caps = json!({});
    reg.on_hello("m1", "tok-1", InstanceConn { tx }, &unsupported)
        .await;
    let error = reg
        .query_resource(
            "m1",
            InstanceResourceQuery {
                request_id: "resource-unsupported".into(),
                workspace_id: "workspace-1".into(),
                root: "/workspace".into(),
                query: InstanceResourceQueryKind::ReadDirectory(ReadDirectoryQuery {
                    path: String::new(),
                    cursor: None,
                    limit: 10,
                }),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error, InstanceError::ResourceUnsupported);
}

#[tokio::test]
async fn forward_rpc_and_offline() {
    let (registry, _drop) = test_registry();
    let chats = ChatRegistry::new(registry);
    let reg = InstanceRegistry::new(Duration::from_secs(30), Duration::from_secs(10), chats);
    let (tx, mut rx) = mpsc::channel(8);
    reg.on_hello("m1", "tok-1", InstanceConn { tx: tx.clone() }, &hello("m1"))
        .await;
    let msg = json!({"jsonrpc":"2.0","id":"hub-1","method":"session/prompt","params":{}});
    // 回 forward_ack（L1+L2 确认）：测试侧等 rx 收到 forward 帧后 on_ack。
    let reg2 = reg.clone();
    let ack_task = tokio::spawn(async move {
        match rx.recv().await {
            Some(OutboundMsg::Frame(Frame::InstanceForward(f))) => {
                assert_eq!(f.command_id, "hub-1");
                assert_eq!(f.chat_id, "s1");
                assert_eq!(f.frame["id"], json!("hub-1"));
                reg2.on_ack(
                    "m1",
                    &f.command_id,
                    InstanceAck::Forward(InstanceForwardAck {
                        command_id: f.command_id.clone(),
                        chat_id: f.chat_id.clone(),
                        ok: true,
                        error: None,
                    }),
                )
                .await;
            }
            other => panic!("expected forward frame, got {other:?}"),
        }
    });
    reg.forward_rpc("m1", "s1", &msg).await.unwrap();
    ack_task.await.unwrap();
    // 未知 instance。
    assert!(matches!(
        reg.forward_rpc("nope", "s1", &msg).await,
        Err(InstanceError::UnknownInstance(_))
    ));
    // 断开后 OFFLINE。
    reg.on_disconnect("m1", &InstanceConn { tx: tx.clone() })
        .await;
    assert!(matches!(
        reg.forward_rpc("m1", "s1", &msg).await,
        Err(InstanceError::Offline)
    ));
    let _ = _drop;
}

#[tokio::test]
async fn cleanup_orphans_kill_decision() {
    // 真实 registry（register/transition/request_close_offline 写回 Registry
    // Doc 需要存活写者，§5.2 单写）。
    let tmp = tempfile::tempdir().unwrap();
    let sink = Arc::new(crate::control::StoreSink::new());
    let doc = Arc::new(crate::state::doc_manager::DocManager::new(
        crate::state::doc_manager::BatchConfig::default(),
        sink,
    ));
    let chats = ChatRegistry::new(doc.registry());
    // 下发超时 2s：ack 回填需在窗口内。
    let reg = InstanceRegistry::new(
        Duration::from_secs(30),
        Duration::from_secs(2),
        chats.clone(),
    );
    let (tx, mut rx) = mpsc::channel(8);
    reg.on_hello("m1", "tok-1", InstanceConn { tx }, &hello("m1"))
        .await;

    // s1：终态（意外存活裁决目标，§7.5）；s2：pending_close（补发目标，
    // §7.6）；s3：正常存活（不 kill）。
    chats.register("s1", "m1", None, "/", None).await.unwrap();
    chats.transition("s1", ChatState::Closed).await.unwrap();
    chats.register("s2", "m1", None, "/", None).await.unwrap();
    chats.request_close_offline("s2").await.unwrap();
    chats.register("s3", "m1", None, "/", None).await.unwrap();

    let outcome = HelloOutcome {
        fenced_previous: false,
        buffer_lost: false,
        alive_sessions: vec!["s1".to_string(), "s3".to_string()],
        chat_epochs: Default::default(),
    };
    // cleanup 内 send_kill 等 ack：放独立 task，fake instance 侧回填。
    let cleanup = tokio::spawn({
        let reg = reg.clone();
        let outcome = outcome.clone();
        async move { reg.cleanup_orphans("m1", &outcome).await }
    });
    let mut targets = Vec::new();
    for _ in 0..2 {
        let msg = tokio::time::timeout(Duration::from_secs(3), rx.recv())
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
    let killed = cleanup.await.unwrap();
    assert!(
        killed.contains(&"s1".to_string()),
        "意外存活应 kill（§7.5）"
    );
    assert!(
        killed.contains(&"s2".to_string()),
        "pending_close 应补发 kill（§7.6）"
    );
    assert!(!killed.contains(&"s3".to_string()), "正常存活不 kill");
    assert_eq!(targets.len(), 2);
    // s2 补发完成 → 清 pending_close（§7.6）。
    assert!(chats.pending_close_chats().await.is_empty());
    let _ = (doc, tmp);
}
