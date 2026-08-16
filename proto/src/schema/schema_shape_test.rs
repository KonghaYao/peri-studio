//! 跨 Doc 的序列化形态与 round-trip 测试（camelCase 字段名 / 枚举形态 /
//! internally tagged 判别 / 根对象完整 round-trip）。

use crate::action::PermissionDecision;
use crate::schema::{
    BlockVisibility, ChatDocRoot, ChatStatus, ContentBlock, EntryKind, EntryRole, EntryStatus,
    GlobalStatus, InstanceStatus, PermissionOptions, PermissionStatus, PublicError,
    RegistryDocRoot, SessionDocRoot, ToolCallStatus, TurnStatus,
};

use super::util::{chat_root, control_root, registry_root};

/// 三 Doc 根对象字段名 camelCase 形态（§5.3–5.5 与 §2 序列化约定）。
#[test]
fn doc_root_camel_case_field_names() {
    let chat = serde_json::to_value(chat_root()).unwrap();
    assert_eq!(chat["schemaVersion"], 1);
    assert_eq!(chat["projectionVersion"], 3);
    assert_eq!(chat["entryOrder"][0], "t1:assistant");
    assert!(chat.get("entries").is_some());
    assert_eq!(chat["toolCalls"]["tc1"]["name"], "bash");

    let session = serde_json::to_value(control_root()).unwrap();
    assert_eq!(session["chat"]["chatId"], "s1");
    assert_eq!(session["chat"]["activeTurnId"], "t1");
    assert_eq!(session["agent"]["sessionId"], "acp-1");
    assert_eq!(session["agent"]["extensions"][0], "peri.tokenStats");
    assert_eq!(session["agent"]["availableCommands"][0], "bash");
    assert_eq!(session["agent"]["latestUsage"]["inputTokens"], 1200);
    assert_eq!(session["activeTurn"]["turnStatus"], "running");
    assert_eq!(
        session["pendingPermissions"]["p1"]["options"][0],
        "allowOnce"
    );
    assert!(session.get("sessions").is_some());

    let registry = serde_json::to_value(registry_root()).unwrap();
    assert_eq!(registry["instances"]["i1"]["tokenId"], "tok1");
    assert_eq!(registry["instances"]["i1"]["chatCount"], 2);
    assert_eq!(registry["chats"]["s1"]["instanceId"], "i1");
    assert_eq!(registry["global"]["status"], "healthy");
}

/// 跨 Doc 枚举序列化形态（camelCase；`PermissionDecision` 为 snake_case，§4.2）。
#[test]
fn enum_serialized_shapes() {
    assert_eq!(
        serde_json::to_string(&EntryKind::Message).unwrap(),
        "\"message\""
    );
    assert_eq!(
        serde_json::to_string(&EntryRole::Assistant).unwrap(),
        "\"assistant\""
    );
    assert_eq!(
        serde_json::to_string(&EntryStatus::Streaming).unwrap(),
        "\"streaming\""
    );
    assert_eq!(
        serde_json::to_string(&ToolCallStatus::AwaitingPermission).unwrap(),
        "\"awaitingPermission\""
    );
    assert_eq!(
        serde_json::to_string(&TurnStatus::AwaitingPermission).unwrap(),
        "\"awaitingPermission\""
    );
    assert_eq!(
        serde_json::to_string(&ChatStatus::Crashed).unwrap(),
        "\"crashed\""
    );
    assert_eq!(
        serde_json::to_string(&InstanceStatus::Offline).unwrap(),
        "\"offline\""
    );
    assert_eq!(
        serde_json::to_string(&GlobalStatus::Degraded).unwrap(),
        "\"degraded\""
    );
    assert_eq!(
        serde_json::to_string(&PermissionOptions::AllowSession).unwrap(),
        "\"allowSession\""
    );
    assert_eq!(
        serde_json::to_string(&PermissionStatus::Expired).unwrap(),
        "\"expired\""
    );
    assert_eq!(
        serde_json::to_string(&BlockVisibility::Hidden).unwrap(),
        "\"hidden\""
    );
    // PermissionDecision 供 §7 schema 复用（§4.2：snake_case）
    assert_eq!(
        serde_json::to_string(&PermissionDecision::Deny).unwrap(),
        "\"deny\""
    );
}

/// ContentBlock：tag = "kind" 的 internally tagged 判别（§5.3 镜像形态）。
#[test]
fn content_block_kind_tag() {
    let block = ContentBlock::ToolCall {
        block_id: "b1".into(),
        tool_call_id: "tc1".into(),
    };
    let v: serde_json::Value = serde_json::to_value(&block).unwrap();
    // §7.2 设计文档明确：ContentBlock 用 snake_case（镜像内部判别形态，非线协议）；
    // internally tagged 模式下 rename_all 只作用于 variant 名（kind 值），
    // 字段名保持 rust 名（block_id/tool_call_id）
    assert_eq!(v["kind"], "tool_call");
    assert_eq!(v["tool_call_id"], "tc1");

    let text: serde_json::Value = serde_json::to_value(ContentBlock::Text {
        block_id: "b2".into(),
        text: "hi".into(),
    })
    .unwrap();
    assert_eq!(text["kind"], "text");

    // 反序列化判别（字段名 = rust 名，见上注）
    let back: ContentBlock =
        serde_json::from_value(serde_json::json!({"kind": "resource", "block_id": "b3",
            "resource_id": "r1", "media_type": "text/plain", "name": "a.txt"}))
        .unwrap();
    assert_eq!(
        back,
        ContentBlock::Resource {
            block_id: "b3".into(),
            resource_id: "r1".into(),
            media_type: "text/plain".into(),
            name: "a.txt".into(),
        }
    );
}

/// 三 Doc 完整 round-trip（serde_json round-trip 每类根对象）。
#[test]
fn schema_roots_full_roundtrip() {
    let chat = chat_root();
    let back: ChatDocRoot = serde_json::from_str(&serde_json::to_string(&chat).unwrap()).unwrap();
    assert_eq!(back, chat);

    let session = control_root();
    let back: SessionDocRoot =
        serde_json::from_str(&serde_json::to_string(&session).unwrap()).unwrap();
    assert_eq!(back, session);

    let registry = registry_root();
    let back: RegistryDocRoot =
        serde_json::from_str(&serde_json::to_string(&registry).unwrap()).unwrap();
    assert_eq!(back, registry);
}

/// PublicError 脱敏公开错误（§9.3）round-trip。
#[test]
fn public_error_roundtrip() {
    let err = PublicError {
        code: "AGENT_UNAVAILABLE".into(),
        message: "redacted".into(),
    };
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["code"], "AGENT_UNAVAILABLE");
    assert_eq!(v["message"], "redacted");
    assert_eq!(serde_json::from_value::<PublicError>(v).unwrap(), err);
}
