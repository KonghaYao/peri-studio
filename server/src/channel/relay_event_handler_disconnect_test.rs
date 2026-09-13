//! RelayEventHandler 断链清理测试（relay_event_handler_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 1181 行超阈值，按「instance 生命周期」分主题。
//!
//! 职责边界：本模块只覆盖 on_instance_disconnect/on_process_exit 的清理语义
//! （§7.1/§8.2）——活动 turn interrupted + pending 权限批量过期 + session 置
//! Gap、进程退出置 Ended。断链后的 buffer 补推追平恢复归
//! relay_event_handler_buffer_test；公共 helper 见 relay_event_handler_test_util。
use super::*;
#[tokio::test]
async fn disconnect_cleanup_interrupts_turn_and_gaps() {
    let env = env().await;
    // 投影活动 turn（§6.5 服务端单写注入：session doc active_turn 建立，
    // permission 关联检查前提）+ 一条 pending 权限（断链清理输入，§7.1）。
    inject_user_entry(&env, S1).await;
    let r = env
        .relay
        .on_instance_event(
            "local",
            &ev(2, json!({"type": "permission_request", "sessionId": "acp-1", "payload": {"permissionId": "p1", "turnId": "t1", "title": "允许执行", "options": ["allowOnce"]}})),
        )
        .await;
    assert!(matches!(r, ConsumeResult::Delivered { applied: true, .. }));
    // 登记活动 turn（coordinator 路径行为）。
    env.chats.set_active_turn(S1, "t1").await;
    env.relay.on_instance_disconnect("local").await.unwrap();
    // session 置 Gap（§8.2 matrix instance 行）。
    let e = env.chats.entry(S1).await.unwrap();
    assert_eq!(e.state, crate::control::ChatState::Gap);
    // 断链清理生效：活动 turn interrupted + pending 权限批量 expired
    // （StoreSink 镜像快照 → 应用断言，与 doc_manager 测试同款 mirror）。
    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S1))
        .await
        .expect("session 镜像快照");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    let parsed = yrs::Update::decode_v1(&snapshot).unwrap();
    mirror.transact_mut().apply_update(parsed).unwrap();
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let sm = root
        .get(&txn, "session")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        sm.get(&txn, "active_turn_status")
            .unwrap()
            .cast::<String>()
            .unwrap(),
        "interrupted",
        "断链 → 活动 turn interrupted（§7.1）"
    );
    let perms = root
        .get(&txn, "pending_permissions")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let pm = perms
        .get(&txn, "p1")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        pm.get(&txn, "status").unwrap().cast::<String>().unwrap(),
        "expired",
        "断链 → pending 权限批量过期（§7.1 expireTurnPermissions）"
    );
}

#[tokio::test]
async fn process_exit_sets_terminal() {
    let env = env().await;
    inject_user_entry(&env, S1).await;
    let exit = peri_studio_proto::instance::InstanceProcessExit {
        chat_id: S1.into(),
        code: 0,
    };
    let r = env.relay.on_process_exit("local", &exit).await;
    assert!(matches!(
        r,
        ConsumeResult::Delivered {
            kind: "process_exit",
            ..
        }
    ));
    let e = env.chats.entry(S1).await.unwrap();
    assert_eq!(e.state, crate::control::ChatState::Ended);

    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(S1))
        .await
        .expect("session 镜像快照");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let mirror = yrs::Doc::new();
    let parsed = yrs::Update::decode_v1(&snapshot).unwrap();
    mirror.transact_mut().apply_update(parsed).unwrap();
    let txn = mirror.transact();
    let root = txn.get_map("root").unwrap();
    let sm = root
        .get(&txn, "session")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        sm.get(&txn, "loading")
            .and_then(|value| value.cast::<bool>().ok()),
        Some(false),
        "process_exit 必须清掉 Session Doc loading"
    );
    assert!(
        sm.get(&txn, "active_turn_id").is_none(),
        "process_exit 必须清掉 active_turn"
    );
}
