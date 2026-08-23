//! RecoveryCoordinator 的 heartbeat 顺序与连接 fencing 回归测试。

use super::*;

/// P0 竞态回归：旧快照尚未进入对账时，同一连接 epoch 的新快照必须覆盖它；
/// 不得先按旧 alive 集合确认 runtime 或发送错误的 session/resume。
#[tokio::test]
async fn recovery_latest_heartbeat_wins_before_reconcile() {
    let env = env().await;
    let uuid = uuid::Uuid::parse_str(S1).unwrap();
    env.store.create_chat(uuid).unwrap();
    env.doc
        .open_chat(S1, "local", None, None, None)
        .await
        .unwrap();
    env.chats
        .register(S1, "local", None, "/", None)
        .await
        .unwrap();
    env.chats.bind(S1, "acp-restored", false).await.unwrap();

    let registry = env.doc.registry();
    registry.set_restarting().await.unwrap();
    let recovery = crate::channel::instance_recovery::RecoveryCoordinator::new(
        std::collections::HashSet::from(["local".to_string()]),
        env.instance.clone(),
        env.coordinator.clone(),
        registry.clone(),
    );
    recovery.on_connection_registered("local", 1).await;
    let pause = recovery.pause_next_reconcile().await;
    recovery
        .on_heartbeat_snapshot("local", 1, vec![S1.to_string()], true, true)
        .await;
    pause.wait_until_blocked().await;
    recovery
        .on_heartbeat_snapshot("local", 1, Vec::new(), false, true)
        .await;
    pause.release();

    tokio::time::timeout(Duration::from_secs(2), async {
        while registry.global_status() != peri_studio_proto::schema::GlobalStatus::Healthy {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("最新空快照完成对账后应开门");
    assert!(
        env.instance_rx.is_empty(),
        "被更新快照否定的 runtime 不得发送 session/resume"
    );
    assert!(!env.chats.entry(S1).await.unwrap().runtime_confirmed);
}

/// P0 fencing 回归：新 hello 替换连接 epoch 后，已排队的旧 heartbeat 必须
/// 失去 resume 与开门资格；恢复只能由新连接的首份权威快照完成一次。
#[tokio::test]
async fn recovery_fenced_connection_cannot_resume_or_complete_barrier() {
    let mut env = env().await;
    let uuid = uuid::Uuid::parse_str(S1).unwrap();
    env.store.create_chat(uuid).unwrap();
    env.doc
        .open_chat(S1, "local", None, None, None)
        .await
        .unwrap();
    env.chats
        .register(S1, "local", None, "/", None)
        .await
        .unwrap();
    env.chats.bind(S1, "acp-restored", false).await.unwrap();

    let registry = env.doc.registry();
    registry.set_restarting().await.unwrap();
    let recovery = crate::channel::instance_recovery::RecoveryCoordinator::new(
        std::collections::HashSet::from(["local".to_string()]),
        env.instance.clone(),
        env.coordinator.clone(),
        registry.clone(),
    );
    recovery.on_connection_registered("local", 1).await;
    let pause = recovery.pause_next_reconcile().await;
    recovery
        .on_heartbeat_snapshot("local", 1, vec![S1.to_string()], true, true)
        .await;
    pause.wait_until_blocked().await;

    recovery.on_connection_registered("local", 2).await;
    recovery
        .on_heartbeat_snapshot("local", 2, vec![S1.to_string()], true, true)
        .await;
    pause.release();
    let rpc_id = drive_rpc(&env.instance, &mut env.instance_rx, "session/resume").await;
    assert_eq!(
        registry.global_status(),
        peri_studio_proto::schema::GlobalStatus::Restarting,
        "新连接 resume 确认前，旧连接不得完成 barrier"
    );
    let response = peri_studio_proto::instance::InstanceEvent {
        chat_id: S1.into(),
        epoch: 0,
        seq: 1,
        frame: serde_json::json!({"jsonrpc":"2.0","id":rpc_id,"result":{}}),
    };
    let _ = env.relay.on_instance_event("local", &response).await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while registry.global_status() != peri_studio_proto::schema::GlobalStatus::Healthy {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("新连接恢复终态后应开门");
    assert!(
        env.instance_rx.is_empty(),
        "旧连接快照不得造成第二次 session/resume"
    );
}
