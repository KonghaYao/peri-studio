//! CommandCoordinator 测试公共 helper（command_coordinator_test.rs 拆分产物）。
//!
//! 拆分动机：原文件 6304 行超阈值，按主题拆分后各主题共用的测试铺设工具
//! 集中于此，避免跨文件复制。
//!
//! 职责边界：仅包含无断言意图的测试铺设工具——drive_rpc（instance 下行 RPC
//! 驱动 + forward ack）、bound_session（Store/Doc/Registry/binding 完整注册）、
//! prompt_action/load_action/session_new_action（action 信封构造）、
//! broadcast_active_turn_status（turn 广播镜像快照）、official_permission_frame/
//! mirror_pending_permissions/setup_active_turn/register_official_permission
//! （permission 铺设）、drive_prompt_l3（完整 prompt L3 链路驱动）。断言/测试
//! 数据一律留在各主题测试文件。
//!
//! 可见性说明：本模块以 `use super::*` 继承父模块的 import 与 S1/Env 等；父模块
//! 通过 `use self::command_coordinator_test_util::{...}` 再导出，供各主题模块
//! 经 `use super::*` 使用（mod 名以父模块名做前缀，避免 crate 内冲突）。
use super::*;
/// 读 instance 下行帧中的 JSON-RPC request id（initialize / session/load），
/// 并回 forward ack（L1+L2 合并确认，§4.4——forward_rpc 等待该 ack 才继续）。
pub(super) async fn drive_rpc(
    instance: &InstanceRegistry,
    rx: &mut mpsc::Receiver<OutboundMsg>,
    method: &str,
) -> String {
    for _ in 0..8 {
        let msg = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("rpc request")
            .expect("rx alive");
        if let OutboundMsg::Frame(Frame::InstanceForward(f)) = msg {
            if f.frame.get("method").and_then(serde_json::Value::as_str) == Some(method) {
                instance
                    .on_ack(
                        "local",
                        &f.command_id,
                        InstanceAck::Forward(InstanceForwardAck {
                            command_id: f.command_id.clone(),
                            chat_id: f.chat_id.clone(),
                            ok: true,
                            error: None,
                        }),
                    )
                    .await;
                return f
                    .frame
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .expect("rpc id")
                    .to_string();
            }
        }
    }
    panic!("expected {method} request");
}

/// 注册 + binding 一个可 prompt 的 session（完整生命周期：Store 目录 →
/// Doc 打开 → Registry 登记 → binding，§6.2）。
pub(super) async fn bound_session(env: &Env, sid: &str, acp: &str) {
    let uuid = uuid::Uuid::parse_str(sid).expect("uuid session id");
    env.store.create_chat(uuid).unwrap();
    env.doc
        .open_chat(sid, "local", None, None, None)
        .await
        .unwrap();
    env.chats
        .register(sid, "local", None, "/", None)
        .await
        .unwrap();
    env.chats.bind(sid, acp, true).await.unwrap();
}

pub(super) fn prompt_action(cid: &str, sid: &str) -> ActionEnvelope {
    ActionEnvelope::Prompt {
        command_id: cid.into(),
        payload: PromptChatPayload {
            chat_id: sid.into(),
            message: format!("msg-{cid}"),
            effort: None,
        },
    }
}

pub(super) async fn broadcast_active_turn_status(
    updates: &mut mpsc::UnboundedReceiver<crate::state::doc_manager::DocUpdate>,
    sid: &str,
    base_snapshot: &[u8],
) -> Option<String> {
    let mirror = yrs::Doc::new();
    mirror
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(base_snapshot).unwrap())
        .unwrap();
    while let Ok(update) = updates.try_recv() {
        if update.doc != peri_studio_proto::conn::DocId::session(sid) {
            continue;
        }
        mirror
            .transact_mut()
            .apply_update(yrs::Update::decode_v1(&update.update).unwrap())
            .unwrap();
    }
    let txn = mirror.transact();
    txn.get_map("root")
        .and_then(|root| root.get(&txn, "session"))
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
        .and_then(|session| session.get(&txn, "active_turn_status"))
        .and_then(|value| value.cast::<String>().ok())
}

/// 官方 request_permission 帧（sessionId 命中 binding；id=5 number——
/// agent 常为数字自增 id）。
pub(super) fn official_permission_frame(acp: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "session/request_permission",
        "params": {
            "sessionId": acp,
            "toolCall": {"toolCallId": "tc1", "title": "run cmd"},
            "options": [
                {"optionId": "allow-once", "name": "允许一次", "kind": "allow_once"}
            ]
        }
    })
}

/// 读 session doc 镜像 `pending_permissions`：返回 `(permission_id,
/// turn_id)` 列表（镜像读法对齐 drive_prompt_l3 1474-1494）。
pub(super) async fn mirror_pending_permissions(env: &Env, sid: &str) -> Vec<(String, String)> {
    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(sid))
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

/// 建立 doc 侧活动 turn（RegisterUserEntry → 聚合器 active_turn 投影，
/// §6.5 服务端单写）+ registry 表注入（relay register_permission_request
/// 的 turn_id 来源）。
pub(super) async fn setup_active_turn(env: &Env, sid: &str) {
    let turn = env
        .doc
        .submit_command(
            sid,
            crate::state::doc_manager::DocCommand::RegisterUserEntry {
                turn_id: "t1".into(),
                entry_id: "t1:user".into(),
                text: "hi".into(),
                author_user_id: None,
                source_command_id: "active-turn-command".into(),
                created_at: chrono::Utc::now().to_rfc3339(),
            },
        )
        .await;
    assert!(matches!(
        turn,
        crate::state::doc_manager::SubmitResult::Applied(_)
    ));
    env.chats.set_active_turn(sid, "t1").await;
}

/// 官方 request_permission 入站（binding 命中）→ 投影 pending + 登记表；
/// 返回 server 生成的 permission_id。
pub(super) async fn register_official_permission(
    env: &Env,
    sid: &str,
    acp: &str,
    seq: u64,
) -> String {
    let ev = peri_studio_proto::instance::InstanceEvent {
        chat_id: sid.into(),
        epoch: 0,
        seq,
        frame: official_permission_frame(acp),
    };
    let r = env.relay.on_instance_event("local", &ev).await;
    assert!(
        matches!(
            r,
            crate::channel::ConsumeResult::Delivered { applied: true, .. }
        ),
        "{r:?}"
    );
    let perms = mirror_pending_permissions(env, sid).await;
    assert_eq!(perms.len(), 1, "权限投影写入 control doc");
    perms[0].0.clone()
}

/// 官方轨 resolve：take 命中 → 官方响应帧（id=5 原样回显、selected+
/// optionId、无 method）→ forward_ack → Committed ack（不再等 L3 响应帧）。
pub(super) fn load_action(cid: &str, chat_id: &str, acp_session_id: &str) -> ActionEnvelope {
    ActionEnvelope::Load {
        command_id: cid.into(),
        payload: peri_studio_proto::action::LoadChatPayload {
            chat_id: chat_id.into(),
            acp_session_id: acp_session_id.into(),
        },
    }
}

/// 成功路径：submit Accepted → instance 收 session/load RPC（转发目标 =
/// hub chat id，不是 acp session id）→ L3 响应 → committed ack + chat
/// 当前会话切换（bindings 新旧会话均指向本 chat，§8.5 进程内切换）。
pub(super) fn session_new_action(cid: &str, chat_id: &str) -> ActionEnvelope {
    ActionEnvelope::SessionNew {
        command_id: cid.into(),
        payload: peri_studio_proto::action::SessionNewChatPayload {
            chat_id: chat_id.into(),
        },
    }
}

/// 成功：session/new RPC → 新 sessionId → binding 更新（registry + chat
/// doc agent.acp_session_id）→ committed ack 携带 acpSessionId。
/// 驱动一轮完整 prompt L3 链路：提交 → forward_ack（L1+L2）→ L3 response
/// （`stop_reason` 缺省 = result 无 stopReason）→ committed ack。返回 session
/// doc 镜像中 `active_turn_status`；断言活动 turn 表项已清理。
pub(super) async fn drive_prompt_l3(
    env: &mut Env,
    sid: &str,
    acp: &str,
    stop_reason: Option<&str>,
) -> String {
    bound_session(env, sid, acp).await;
    let (tx, mut rx) = mpsc::channel(16);
    let cid = uuid::Uuid::new_v4().to_string();
    let r = env
        .coordinator
        .submit(&ctx("c"), prompt_action(&cid, sid), tx.clone())
        .await;
    assert!(matches!(r, SubmitAck::Accepted { .. }), "{r:?}");
    let fwd = tokio::time::timeout(Duration::from_secs(2), env.instance_rx.recv())
        .await
        .expect("forward received")
        .expect("rx alive");
    let rpc_id = match &fwd {
        OutboundMsg::Frame(Frame::InstanceForward(f)) => {
            env.instance
                .on_ack(
                    "local",
                    &f.command_id,
                    InstanceAck::Forward(InstanceForwardAck {
                        command_id: f.command_id.clone(),
                        chat_id: f.chat_id.clone(),
                        ok: true,
                        error: None,
                    }),
                )
                .await;
            f.frame["id"].as_str().unwrap().to_string()
        }
        other => panic!("expected forward frame, got {other:?}"),
    };
    // L3：JSON-RPC response（result.stopReason）。
    let mut result = serde_json::Map::new();
    if let Some(sr) = stop_reason {
        result.insert("stopReason".into(), serde_json::Value::String(sr.into()));
    }
    let resp = peri_studio_proto::instance::InstanceEvent {
        chat_id: sid.into(),
        epoch: 0,
        seq: 2,
        frame: serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": result,
        }),
    };
    let r = env.relay.on_instance_event("local", &resp).await;
    assert!(
        matches!(r, crate::channel::ConsumeResult::RpcConfirmed { .. }),
        "{r:?}"
    );
    match tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        Ok(Some(OutboundMsg::Frame(Frame::ActionAck(ack)))) => {
            assert_eq!(ack.status, peri_studio_proto::ack::AckStatus::Committed);
        }
        other => panic!("expected committed ack, got {other:?}"),
    }
    // 活动 turn 表项清理（§7.2：终态后不得滞留阻塞 load）。
    assert!(
        env.chats.active_turn(sid).await.is_none(),
        "终态后活动 turn 表项必须清理"
    );
    // The real prompt coordinator must project the originating command id so
    // Web can replace its local outbox only with this exact durable entry.
    let (chat_snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::chat(sid))
        .await
        .expect("chat 镜像快照");
    use yrs::updates::decoder::Decode as _;
    use yrs::{Map as _, ReadTxn as _, Transact as _};
    let chat_mirror = yrs::Doc::new();
    let chat_update = yrs::Update::decode_v1(&chat_snapshot).unwrap();
    chat_mirror
        .transact_mut()
        .apply_update(chat_update)
        .unwrap();
    let chat_txn = chat_mirror.transact();
    let chat_root = chat_txn.get_map("root").unwrap();
    let entries = chat_root
        .get(&chat_txn, "entries")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert!(
        entries.iter(&chat_txn).any(|(_, value)| {
            value
                .cast::<yrs::MapRef>()
                .ok()
                .and_then(|entry| entry.get(&chat_txn, "source_command_id"))
                .and_then(|value| value.cast::<String>().ok())
                .as_deref()
                == Some(cid.as_str())
        }),
        "prompt user entry carries exact source command id"
    );
    drop(chat_txn);
    // session doc 镜像：active_turn_status。
    let (snapshot, _) = env
        .sink
        .snapshot(&peri_studio_proto::conn::DocId::session(sid))
        .await
        .expect("session 镜像快照");
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
    let loading = sm
        .get(&txn, "loading")
        .and_then(|v| v.cast::<bool>().ok())
        .unwrap_or(true);
    assert!(
        !loading,
        "ACP session/prompt L3 stopReason 必须清除 session.loading，否则输入框保持锁定"
    );
    sm.get(&txn, "active_turn_status")
        .and_then(|v| v.cast::<String>().ok())
        .unwrap_or_default()
}
