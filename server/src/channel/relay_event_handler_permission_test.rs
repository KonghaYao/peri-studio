//! RelayEventHandler session/request_permission 测试（relay_event_handler_test.rs
//! 拆分产物）。
//!
//! 拆分动机：原文件 1181 行超阈值，按「权限机制」分主题。
//!
//! 职责边界：本模块只覆盖官方 session/request_permission（§6.5/评审 P2-c）——
//! pending 表登记 + 投递投影、turn_id 注入、活动 turn 缺失时空串不丢功能。
//! 主题专属 helper（mirror_pending_permissions/official_permission_frame）随本
//! 模块保留；公共 helper 见 relay_event_handler_test_util。
use super::*;
// ---------------------------------------------------------------------------
// #1 官方 session/request_permission（权限机制官方化）：登记 pending 表 +
// 投递投影（turn_id 从 active_turns 表注入，聚合器 aggregator.rs:1042 守卫）
// ---------------------------------------------------------------------------

/// 读 session doc 镜像 `pending_permissions`：返回 `(permission_id,
/// turn_id)` 列表（镜像断言写法对齐 327-342 的 session map 读法）。
async fn mirror_pending_permissions(env: &Env) -> Vec<(String, String)> {
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
    let Some(perms) = root.get(&txn, "pending_permissions") else {
        return Vec::new();
    };
    let perms = perms.cast::<yrs::MapRef>().unwrap();
    let mut out = Vec::new();
    for (k, v) in perms.iter(&txn) {
        let turn = v
            .cast::<yrs::MapRef>()
            .ok()
            .and_then(|m| m.get(&txn, "turn_id"))
            .and_then(|t| t.cast::<String>().ok())
            .unwrap_or_default();
        out.push((k.to_string(), turn));
    }
    out
}

/// 官方 request_permission 帧（sessionId=acp-1 命中 binding；id 为 number）。
fn official_permission_frame() -> serde_json::Value {
    json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "session/request_permission",
        "params": {
            "sessionId": "acp-1",
            "toolCall": {"toolCallId": "tc1", "title": "run cmd"},
            "options": [
                {"optionId": "allow-once", "name": "允许一次", "kind": "allow_once"}
            ]
        }
    })
}

#[tokio::test]
async fn request_permission_registered_and_delivered() {
    let env = env().await;
    // 建立 doc 侧活动 turn（§6.5 服务端单写注入；聚合器守卫要求：
    // PermissionRequested 关联检查要求 turn 已知，aggregator judge_turn_guard）。
    inject_user_entry(&env, S1).await;
    env.chats.set_active_turn(S1, "t1").await;
    // 官方 request → Delivered{applied:true} + pending_permissions 表登记
    // （take 命中且 request_id/options 回读一致）。
    let e = ev(2, official_permission_frame());
    let r = env.relay.on_instance_event("local", &e).await;
    assert!(
        matches!(r, ConsumeResult::Delivered { applied: true, .. }),
        "{r:?}"
    );
    // 投影已写（pending_permissions 有条目；permission_id 由 server 生成）。
    let perms = mirror_pending_permissions(&env).await;
    assert_eq!(perms.len(), 1, "权限投影写入 control doc");
    let pid = perms[0].0.clone();
    // 回读命中且一致；确认 delivery 前必须可重复读取。
    let taken = env.relay.pending_permission(&pid).await.expect("read 命中");
    assert_eq!(taken.request_id, json!(5), "agent request id 原样");
    assert_eq!(taken.options.len(), 1);
    assert_eq!(taken.options[0]["optionId"], json!("allow-once"));
    assert_eq!(taken.chat_id, S1);
    assert!(
        env.relay.pending_permission(&pid).await.is_some(),
        "delivery 前保留回投材料"
    );
}

#[tokio::test]
async fn request_permission_turn_id_injected() {
    let env = env().await;
    // 建立 doc 侧活动 turn（§6.5 服务端单写注入 → 聚合器 active_turn 投影）
    // + registry 表注入（relay 从 active_turns 表取 turn_id，官方帧无
    // turnId 字段）。
    inject_user_entry(&env, S1).await;
    env.chats.set_active_turn(S1, "t1").await;
    // 官方 request_permission 帧到达 → 镜像 pending_permissions 条目
    // turn_id == "t1"（对齐 327-342 的镜像断言写法）。
    let e = ev(2, official_permission_frame());
    let r = env.relay.on_instance_event("local", &e).await;
    assert!(
        matches!(r, ConsumeResult::Delivered { applied: true, .. }),
        "{r:?}"
    );
    let perms = mirror_pending_permissions(&env).await;
    assert_eq!(perms.len(), 1);
    assert_eq!(perms[0].1, "t1", "turn_id 从 active_turns 表注入");
}

#[tokio::test]
async fn request_permission_before_active_turn_empty_turn_id() {
    let env = env().await;
    // doc 侧活动 turn 已建立（§6.5 服务端单写注入；聚合器守卫前提），但
    // registry active_turns 表无登记（relay 注入源为空）→ 官方帧到达 →
    // turn_id=="" 但权限仍投影、take 仍命中（评审 P2-c 固化：功能不丢）。
    // 守卫放行依据 aggregator judge_turn_guard `(Some(a), Some(""))` →
    // accepting 通过。
    inject_user_entry(&env, S1).await;
    // 注意：不调用 chats.set_active_turn——registry 表保持无登记。
    let e = ev(2, official_permission_frame());
    let r = env.relay.on_instance_event("local", &e).await;
    assert!(
        matches!(r, ConsumeResult::Delivered { applied: true, .. }),
        "{r:?}"
    );
    let perms = mirror_pending_permissions(&env).await;
    assert_eq!(perms.len(), 1, "权限仍投影");
    assert_eq!(perms[0].1, "", "registry 无 active turn → turn_id 空串");
    assert!(
        env.relay.pending_permission(&perms[0].0).await.is_some(),
        "read 仍命中（功能不丢）"
    );
}
