//! Translator JSON-RPC 出站映射单测——RPC 主题（设计稿 §16 测试 6–7）。
//!
//! 拆分动机：原 translator_test.rs 534 行超阈值（≤500 行要求），按
//! 「出站帧主题」拆出本文件；测试代码仅移动 + 文件级 use 调整，断言语义零改动。

use serde_json::json;

use peri_studio_proto::action::{ActionEnvelope, LoadChatPayload, PermissionDecision};

use super::translator_test::ctx;
use super::*;

// ---------------------------------------------------------------------------
// #1 官方 request_permission 响应构造（schema v1；响应帧无回执，§4.4 以
// forward_ack 为确认点）
// ---------------------------------------------------------------------------

/// ①Allow + [allow_once option] → `selected` + optionId 回显。
#[test]
fn permission_response_rpc_allow_selects_allow_option() {
    let t = Translator::new();
    let options = json!([
        {"optionId": "reject-once", "name": "拒绝一次", "kind": "reject_once"},
        {"optionId": "allow-once", "name": "允许一次", "kind": "allow_once"}
    ]);
    let v = t.permission_response_rpc(
        &json!(5),
        PermissionDecision::Allow,
        None,
        options.as_array().unwrap(),
    );
    assert_eq!(v["jsonrpc"], json!("2.0"));
    assert_eq!(v["id"], json!(5), "agent request id 原样回显（number）");
    assert!(v.get("method").is_none(), "响应帧无 method");
    assert_eq!(v["result"]["outcome"]["outcome"], json!("selected"));
    assert_eq!(v["result"]["outcome"]["optionId"], json!("allow-once"));
}

#[test]
fn permission_response_rpc_allow_prefers_once_over_session_order() {
    let t = Translator::new();
    let options = json!([
        {"optionId": "allow-session", "name": "允许本会话", "kind": "allowSession"},
        {"optionId": "allow-once", "name": "仅允许一次", "kind": "allowOnce"}
    ]);
    let v = t.permission_response_rpc(
        &json!(7),
        PermissionDecision::Allow,
        None,
        options.as_array().unwrap(),
    );
    assert_eq!(v["result"]["outcome"]["optionId"], json!("allow-once"));
}

#[test]
fn permission_response_rpc_honors_exact_session_scope() {
    let t = Translator::new();
    let options = json!([
        {"optionId": "allow-once", "name": "仅允许一次", "kind": "allow_once"},
        {"optionId": "allow-session", "name": "允许本会话", "kind": "allowSession"}
    ]);
    let v = t.permission_response_rpc(
        &json!(7),
        PermissionDecision::Allow,
        Some("allow-session"),
        options.as_array().unwrap(),
    );
    assert_eq!(v["result"]["outcome"]["optionId"], json!("allow-session"));
}

#[test]
fn permission_response_rpc_rejects_unknown_exact_option() {
    let t = Translator::new();
    let options = json!([
        {"optionId": "allow-once", "name": "仅允许一次", "kind": "allow_once"}
    ]);
    let v = t.permission_response_rpc(
        &json!(7),
        PermissionDecision::Allow,
        Some("forged-option"),
        options.as_array().unwrap(),
    );
    assert_eq!(v["result"]["outcome"]["outcome"], json!("cancelled"));
}

#[test]
fn permission_response_rpc_rejects_scope_mismatch() {
    let t = Translator::new();
    let options = json!([
        {"optionId": "reject-once", "name": "拒绝一次", "kind": "reject_once"}
    ]);
    let v = t.permission_response_rpc(
        &json!(7),
        PermissionDecision::Allow,
        Some("reject-once"),
        options.as_array().unwrap(),
    );
    assert_eq!(v["result"]["outcome"]["outcome"], json!("cancelled"));
}

#[test]
fn permission_response_rpc_allow_does_not_fallback_to_unrelated_option() {
    let t = Translator::new();
    let options = json!([
        {"optionId": "reject-once", "name": "拒绝", "kind": "reject_once"}
    ]);
    let v = t.permission_response_rpc(
        &json!(8),
        PermissionDecision::Allow,
        None,
        options.as_array().unwrap(),
    );
    assert_eq!(v["result"]["outcome"]["outcome"], json!("cancelled"));
}

/// ②Deny 无 reject 类 option → `cancelled` 且无 optionId。
#[test]
fn permission_response_rpc_deny_without_reject_cancelled() {
    let t = Translator::new();
    let options = json!([
        {"optionId": "allow-session", "name": "始终允许", "kind": "allowSession"}
    ]);
    let v = t.permission_response_rpc(
        &json!("req-9"),
        PermissionDecision::Deny,
        None,
        options.as_array().unwrap(),
    );
    assert_eq!(v["id"], json!("req-9"));
    assert_eq!(v["result"]["outcome"]["outcome"], json!("cancelled"));
    assert!(v["result"]["outcome"].get("optionId").is_none());
}

/// ③Deny + [reject_once option] → `selected` + reject optionId（保留
/// 「拒绝并记住」语义）。
#[test]
fn permission_response_rpc_deny_selects_reject_option() {
    let t = Translator::new();
    let options = json!([
        {"optionId": "allow-once", "name": "允许", "kind": "allow_once"},
        {"optionId": "reject-always", "name": "始终拒绝", "kind": "reject_always"}
    ]);
    let v = t.permission_response_rpc(
        &json!(5),
        PermissionDecision::Deny,
        None,
        options.as_array().unwrap(),
    );
    assert_eq!(v["result"]["outcome"]["outcome"], json!("selected"));
    assert_eq!(v["result"]["outcome"]["optionId"], json!("reject-always"));
}

/// ④Allow + 空 options（入站校验允许空数组，评审 P2-1）→ `cancelled`
/// 且无 `optionId: null`（官方契约 selected 分支 optionId 必须为 string）。
#[test]
fn permission_response_rpc_allow_empty_options_cancelled() {
    let t = Translator::new();
    let v = t.permission_response_rpc(&json!(5), PermissionDecision::Allow, None, &[]);
    assert_eq!(v["id"], json!(5));
    assert_eq!(v["result"]["outcome"]["outcome"], json!("cancelled"));
    assert!(
        v["result"]["outcome"].get("optionId").is_none(),
        "空 options 时不得序列化 optionId: null"
    );
    let serialized = serde_json::to_string(&v["result"]["outcome"]).unwrap();
    assert!(
        !serialized.contains("null"),
        "序列化结果不得含 null: {serialized}"
    );
}

#[test]
fn rpc_id_monotonic_and_unique() {
    let t = Translator::new();
    let a = t.alloc_rpc_id();
    let b = t.alloc_rpc_id();
    assert_eq!(a, "hub-1");
    assert_eq!(b, "hub-2");
    assert_ne!(a, b);
}

#[test]
fn unsupported_actions() {
    let t = Translator::new();
    // §8.5：chat/load 已支持（exec_load_chat 直连 session_load_rpc；translate
    // 入口同样完整翻译，见 load_action_translation_uses_session_load_frame）。
    let load = ActionEnvelope::Load {
        command_id: "c".into(),
        payload: peri_studio_proto::action::LoadChatPayload {
            chat_id: "s".into(),
            acp_session_id: "acp-s".into(),
        },
    };
    assert!(t.translate(&load, &ctx()).is_ok());
    // create/close 不在此入口（两段式 / instance/kill）。
    let create = ActionEnvelope::Create {
        command_id: "c".into(),
        payload: peri_studio_proto::action::CreateChatPayload::default(),
    };
    assert!(matches!(
        t.translate(&create, &ctx()),
        Err(TranslateError::UnsupportedAction(_))
    ));
}

#[test]
fn create_two_phase_rpcs() {
    let t = Translator::new();
    let (init_id, init) = t.initialize_rpc("/srv/work");
    assert_eq!(init["method"], json!("initialize"));
    // 官方 InitializeRequest = {protocolVersion, ...}（schema v1，#7）：
    // 无 cwd；protocolVersion 官方 integer，值 1 合法。
    assert_eq!(init["params"]["protocolVersion"], json!(1));
    assert_eq!(
        init["params"]["clientCapabilities"]["elicitation"]["form"],
        json!({})
    );
    assert!(init["params"]["clientCapabilities"]["elicitation"]
        .get("url")
        .is_none());
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.tokenStats"],
        json!(true)
    );
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.skillNames"],
        json!(true)
    );
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.agentActivity"],
        json!(true)
    );
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.prediction"],
        json!(true)
    );
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.replay"],
        json!(true)
    );
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.oauth"],
        json!(true)
    );
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.planEntryActiveForm"],
        json!(true)
    );
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.rewind"],
        json!(true)
    );
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.agentEvent"],
        json!(true)
    );
    assert_eq!(
        init["params"]["clientCapabilities"]["_meta"]["peri.unstableEvent"],
        json!(true)
    );
    assert!(init["params"].get("cwd").is_none());
    assert_eq!(init["id"].as_str().unwrap(), init_id.as_str());

    let (new_id, new) = t.session_new_rpc("/srv/work", Some("my session"));
    assert_eq!(new["method"], json!("session/new"));
    assert_eq!(new["params"]["cwd"], json!("/srv/work"));
    assert_eq!(new["params"]["title"], json!("my session"));
    assert_eq!(new["id"].as_str().unwrap(), new_id.as_str());
    assert_ne!(init_id, new_id);
}

#[test]
fn initialize_extensions_require_an_explicit_whitelisted_echo() {
    let echoed = json!({
        "result": {"agentCapabilities": {"_meta": {
            "peri.tokenStats": true,
            "peri.skillNames": true,
            "peri.agentActivity": true,
            "peri.prediction": true,
            "peri.replay": true,
            "peri.oauth": true,
            "peri.planEntryActiveForm": true,
            "peri.rewind": true,
            "peri.agentEvent": true,
            "untrusted.extension": true
        }}}
    });
    assert_eq!(
        super::negotiated_peri_extensions(&echoed),
        vec![
            "peri.tokenStats".to_string(),
            "peri.skillNames".to_string(),
            "peri.agentActivity".to_string(),
            "peri.prediction".to_string(),
            "peri.replay".to_string(),
            "peri.oauth".to_string(),
            "peri.planEntryActiveForm".to_string(),
            "peri.rewind".to_string(),
        ]
    );

    for response in [
        json!({"result": {"agentCapabilities": {}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.tokenStats": false}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.tokenStats": "true"}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.skillNames": false}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.skillNames": "true"}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.agentActivity": false}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.agentActivity": "true"}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.prediction": false}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.prediction": "true"}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.replay": false}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.replay": "true"}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.oauth": false}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.oauth": "true"}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.planEntryActiveForm": false}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.planEntryActiveForm": "true"}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.rewind": false}}}}),
        json!({"result": {"agentCapabilities": {"_meta": {"peri.rewind": "true"}}}}),
    ] {
        assert!(super::negotiated_peri_extensions(&response).is_empty());
    }
}

#[test]
fn session_load_rpc_frame_shape() {
    let t = Translator::new();
    let (load_id, load) = t.session_load_rpc("/srv/work", "019fe709-3097-7f23-8266-9e5ceda78f4b");
    assert_eq!(load["jsonrpc"], json!("2.0"));
    assert_eq!(load["method"], json!("session/load"));
    // 目标会话 id 由请求参数携带（§8.5：load 响应体不含 sessionId，binding
    // 以请求参数为准）。
    assert_eq!(
        load["params"]["sessionId"],
        json!("019fe709-3097-7f23-8266-9e5ceda78f4b")
    );
    assert_eq!(load["params"]["cwd"], json!("/srv/work"));
    // 带 id 的 request（非 notification）——rpcId 由 server 分配（§6.1）。
    assert_eq!(load["id"].as_str().unwrap(), load_id.as_str());
    assert_eq!(load_id, "hub-1", "同一 translator 内 rpcId 单调");
}

#[test]
fn session_load_rpc_rejects_bad_cwd() {
    let t = Translator::new();
    // cwd 缺省/非法时 panic（server 注入路径的防御；同 initialize_rpc）。
    let r = std::panic::catch_unwind(|| t.session_load_rpc("", "acp-1"));
    assert!(r.is_err(), "空 cwd 应 panic（防御）");
}

#[test]
fn session_resume_rpc_frame_shape() {
    let t = Translator::new();
    let (resume_id, resume) =
        t.session_resume_rpc("/srv/work", "019fe709-3097-7f23-8266-9e5ceda78f4b");
    assert_eq!(resume["jsonrpc"], json!("2.0"));
    assert_eq!(resume["method"], json!("session/resume"));
    // 目标会话 = chat 当前 binding 的 acp_session_id（§4 恢复路径：resume
    // 不切换会话，由 server 侧以 ChatRecord.session_id 填充）。
    assert_eq!(
        resume["params"]["sessionId"],
        json!("019fe709-3097-7f23-8266-9e5ceda78f4b")
    );
    assert_eq!(resume["params"]["cwd"], json!("/srv/work"));
    // 带 id 的 request（非 notification）——rpcId 由 server 分配（§6.1）。
    assert_eq!(resume["id"].as_str().unwrap(), resume_id.as_str());
}

#[test]
fn session_resume_rpc_rejects_bad_cwd() {
    let t = Translator::new();
    let r = std::panic::catch_unwind(|| t.session_resume_rpc("", "acp-1"));
    assert!(r.is_err(), "空 cwd 应 panic（防御）");
}

#[test]
fn load_action_translation_uses_session_load_frame() {
    let t = Translator::new();
    let action = ActionEnvelope::Load {
        command_id: "c-1".into(),
        payload: LoadChatPayload {
            chat_id: "s1".into(),
            acp_session_id: "acp-1".into(),
        },
    };
    let msg = t
        .translate(
            &action,
            &OutboundCtx {
                cwd: "/srv/work".into(),
                acp_session_id: "acp-1".into(),
            },
        )
        .unwrap();
    let OutboundMessage::JsonRpc(json) = msg else {
        panic!("load must translate to a JSON-RPC frame");
    };
    assert_eq!(json["method"], json!("session/load"));
    assert_eq!(json["params"]["sessionId"], json!("acp-1"));
    assert_eq!(json["params"]["cwd"], json!("/srv/work"));
}
