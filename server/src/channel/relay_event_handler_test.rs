//! RelayEventHandler 单测（设计稿 §16 测试 15–17）。
//!
//! 事件 epoch 用 0（F4 聚合器 stream.epoch 以 0 起始；真实 instance 的
//! epoch=1 首事件触发 uncalibratable 缺口为 F4 已知缺口，见输出遗留问题）。

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::sync::mpsc;

use peri_studio_proto::instance::{
    BufferedFrame, InstanceBufferSync, InstanceEvent, InstanceHello,
};

use crate::channel::{ConsumeResult, RelayEventHandler};
use crate::control::ChatRegistry;
use crate::control::StoreSink;
use crate::control::{InstanceConn, InstanceRegistry};
use crate::persist::{PersistConfig, Store};
use crate::state::doc_manager::{BatchConfig, DocCommand, DocManager, SubmitResult};

/// 测试 chat id（UUID 形态——StoreSink 投递按 UUID 解析 chat 归属；非 UUID
/// 的 chat id 在控制类事件投递时返回 PersistFailed）。
const S1: &str = "00000000-0000-0000-0000-000000000001";

struct Env {
    _tmp: tempfile::TempDir,
    chats: ChatRegistry,
    relay: Arc<RelayEventHandler>,
    sink: Arc<StoreSink>,
    doc: Arc<DocManager>,
    /// instance 注册表（uncalibratable 测试需重新 hello 对账 epoch）。
    instance: Arc<InstanceRegistry>,
}

/// 主题子模块：公共 helper 与各主题测试（见模块级 doc 的分工说明）。
#[cfg(test)]
#[path = "relay_event_handler_test_util.rs"]
mod relay_event_handler_test_util;

#[cfg(test)]
#[path = "relay_event_handler_control_test.rs"]
mod relay_event_handler_control_test;

#[cfg(test)]
#[path = "relay_event_handler_buffer_test.rs"]
mod relay_event_handler_buffer_test;

#[cfg(test)]
#[path = "relay_event_handler_permission_test.rs"]
mod relay_event_handler_permission_test;

#[cfg(test)]
#[path = "relay_event_handler_disconnect_test.rs"]
mod relay_event_handler_disconnect_test;

// 公共 helper 再导出：本文件测试与子模块（经 `use super::*`）共用。
use self::relay_event_handler_test_util::{env, ev, inject_user_entry, registry_chat_gap};
#[tokio::test]
async fn epoch_mismatch_dropped() {
    let env = env().await;
    // hello 登记 epoch=0；帧 epoch=1 → 丢弃（§4.5.1 防御）。
    let mut e = ev(
        1,
        json!({"type": "agent_message_chunk", "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "x"}}),
    );
    e.epoch = 1;
    let r = env.relay.on_instance_event("local", &e).await;
    assert!(matches!(
        r,
        ConsumeResult::Dropped {
            reason: "epoch_mismatch"
        }
    ));
}

#[tokio::test]
async fn binding_missing_dropped() {
    let env = env().await;
    // 帧内 sessionId 未命中可信 binding（acp-unknown 无映射）→ 丢弃。
    let e = ev(
        1,
        json!({
            "type": "agent_message_chunk",
            "sessionId": "acp-unknown",
            "payload": {}
        }),
    );
    let r = env.relay.on_instance_event("local", &e).await;
    assert!(matches!(
        r,
        ConsumeResult::Dropped {
            reason: "binding_missing"
        }
    ));
}

#[tokio::test]
async fn rpc_response_advances_stream_without_creating_a_false_gap() {
    let env = env().await;

    // Instance sequence numbers cover every child frame, including JSON-RPC
    // responses. The response has no Yjs projection of its own, but it still
    // proves that seq=1 arrived and must advance the transport watermark.
    let rpc = ev(
        1,
        json!({
            "jsonrpc": "2.0",
            "id": "rpc-without-waiter",
            "result": {}
        }),
    );
    let _ = env.relay.on_instance_event("local", &rpc).await;

    let projected = ev(
        2,
        json!({
            "jsonrpc": "2.0",
            "method": "agent/status",
            "params": {"status": "busy"}
        }),
    );
    let result = env.relay.on_instance_event("local", &projected).await;
    assert!(matches!(
        result,
        ConsumeResult::Delivered { applied: true, .. }
    ));
    assert_eq!(
        registry_chat_gap(&env).await,
        Some(None),
        "a received RPC response must not look like a missing transport frame"
    );
}

#[tokio::test]
async fn binding_mismatch_dropped() {
    let env = env().await;
    // 帧内 sessionId 命中 binding（acp-1 → s1）但信封是另一 session（s2）：
    // 帧与进程归属不符 → 丢弃（§6.1 规则 5「与 binding 不一致直接丢弃」）。
    let mut e = ev(
        1,
        json!({
            "type": "agent_message_chunk",
            "sessionId": "acp-1",
            "payload": {"turnId": "t1", "entryId": "e", "blockId": "b", "text": "x"}
        }),
    );
    e.chat_id = "s2".into();
    let r = env.relay.on_instance_event("local", &e).await;
    assert!(matches!(
        r,
        ConsumeResult::Dropped {
            reason: "binding_missing"
        }
    ));
}

#[tokio::test]
async fn event_delivered_to_aggregator() {
    let env = env().await;
    let e = ev(
        1,
        json!({
            "type": "agent_message_chunk",
            "sessionId": "acp-1",
            "payload": {"turnId": "t1", "entryId": "t1:assistant", "blockId": "b1", "text": "hello"}
        }),
    );
    let r = env.relay.on_instance_event("local", &e).await;
    match r {
        ConsumeResult::Delivered {
            chat_id,
            kind,
            seq,
            applied,
        } => {
            assert_eq!(chat_id, S1);
            assert_eq!(kind, "message_delta");
            assert_eq!(seq, 1);
            assert!(applied);
        }
        other => panic!("expected delivered, got {other:?}"),
    }
    let _ = env;
}

#[tokio::test]
async fn unknown_frame_dropped_counted() {
    let env = env().await;
    // binding 命中（帧内 acp-1 → s1）→ 正常 normalize → 未知 type 计数。
    let e = ev(
        1,
        json!({
            "type": "unknown_frame",
            "sessionId": "acp-1",
            "payload": {}
        }),
    );
    let r = env.relay.on_instance_event("local", &e).await;
    assert!(matches!(
        r,
        ConsumeResult::Dropped {
            reason: "unsupported_frame"
        }
    ));
    assert!(env.relay.dropped_total() >= 1);

    let next = ev(
        2,
        json!({
            "jsonrpc": "2.0",
            "method": "agent/status",
            "params": {"status": "busy"}
        }),
    );
    assert!(matches!(
        env.relay.on_instance_event("local", &next).await,
        ConsumeResult::Delivered { applied: true, .. }
    ));
    assert_eq!(
        registry_chat_gap(&env).await,
        Some(None),
        "a semantically ignored frame was still received by the transport"
    );
}

#[tokio::test]
async fn rpc_response_confirms_coordinator() {
    let env = env().await;
    // coordinator 登记 rpc → relay 匹配响应 → oneshot 通知。
    let rx = env.relay.register_rpc("hub-1", "c1".into()).await;
    let e = ev(
        7,
        json!({"jsonrpc": "2.0", "id": "hub-1", "result": {"ok": true}}),
    );
    let r = env.relay.on_instance_event("local", &e).await;
    match r {
        ConsumeResult::RpcConfirmed {
            command_id,
            response,
        } => {
            assert_eq!(command_id, "c1");
            assert_eq!(response["result"]["ok"], json!(true));
        }
        other => panic!("expected rpc confirmed, got {other:?}"),
    }
    // 等待侧收到响应。
    let resp = tokio::time::timeout(Duration::from_secs(1), rx)
        .await
        .expect("oneshot should resolve")
        .expect("sender alive");
    assert_eq!(resp["id"], json!("hub-1"));
}

// ---------------------------------------------------------------------------
// #5 binding 双端点（relay 侧）：无帧内 sessionId 的 JSON-RPC 形态帧按信封
// 兜底投递（与 child.rs C1 同判据——有 jsonrpc 键）；原始形态仍拒
// ---------------------------------------------------------------------------

/// #5 无 sessionId 的 JSON-RPC 形态通知（agent/status，instance 级事件，
/// §5.4 投影无 chat 归属）→ 信封兜底投递：Delivered{applied:true} + control
/// doc 镜像 `agent.status` 投影（聚合器 write_agent_status）。
#[tokio::test]
async fn agent_status_without_session_id_delivered() {
    let env = env().await;
    let e = ev(
        1,
        json!({
            "jsonrpc": "2.0",
            "method": "agent/status",
            "params": {"status": "busy"}
        }),
    );
    let r = env.relay.on_instance_event("local", &e).await;
    match r {
        ConsumeResult::Delivered {
            chat_id, applied, ..
        } => {
            assert_eq!(chat_id, S1, "信封 chat 兜底归属");
            assert!(applied, "agent/status 应投递（聚合器接受）");
        }
        other => panic!("expected delivered, got {other:?}"),
    }
    // control（session）doc 镜像：agent.status 投影已写（§5.4）。
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
    let agent = root
        .get(&txn, "agent")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    assert_eq!(
        agent.get(&txn, "status").unwrap().cast::<String>().unwrap(),
        "busy",
        "agent/status 投影写入 control doc"
    );
}

/// #5 原始形态（无 jsonrpc 键、无 sessionId）→ 仍 binding_missing（relay
/// 是 server 侧唯一防线；与 child.rs C1 判定对称——直接放行原始形态会让
/// map_raw 命中 agent_status 而投递，安全边界不放宽）。
#[tokio::test]
async fn raw_frame_without_session_id_still_dropped() {
    let env = env().await;
    let e = ev(
        2,
        json!({"type": "agent_status", "payload": {"status": "busy"}}),
    );
    let r = env.relay.on_instance_event("local", &e).await;
    assert!(matches!(
        r,
        ConsumeResult::Dropped {
            reason: "binding_missing"
        }
    ));
}

#[tokio::test]
async fn mcp_app_tool_result_cache_clears_with_chat() {
    let env = env().await;
    let source = "x".repeat(5000);
    env.relay
        .remember_mcp_app_tool_result(
            S1,
            "tool-1",
            json!({
                "content": [{"type": "text", "text": "ok"}],
                "structuredContent": {"source": source}
            }),
        )
        .await;
    let cached = env
        .relay
        .mcp_app_tool_result(S1, "tool-1")
        .await
        .expect("cached first-paint result");
    assert_eq!(
        cached["structuredContent"]["source"]
            .as_str()
            .unwrap()
            .len(),
        5000
    );
    env.relay.clear_mcp_app_tool_results(S1).await;
    assert!(env.relay.mcp_app_tool_result(S1, "tool-1").await.is_none());
}
