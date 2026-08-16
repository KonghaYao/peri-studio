//! Translator 出站映射单测（设计稿 §16 测试 6–7）。

use serde_json::json;

use peri_studio_proto::action::{
    ActionEnvelope, CancelChatPayload, PermissionDecision, PromptChatPayload,
    ResolvePermissionPayload,
};

use super::*;

// 供兄弟测试模块 translator_rpc_test 复用（RPC 主题拆分后共享）。
pub(crate) fn ctx() -> OutboundCtx {
    OutboundCtx {
        cwd: "/srv/work".to_string(),
        acp_session_id: "acp-1".to_string(),
    }
}

#[test]
fn prompt_translation() {
    let t = Translator::new();
    let action = ActionEnvelope::Prompt {
        command_id: "c1".into(),
        payload: PromptChatPayload {
            chat_id: "hub-s1".into(),
            message: "hello".into(),
            effort: None,
        },
    };
    let msg = t.translate(&action, &ctx()).unwrap();
    match msg {
        OutboundMessage::JsonRpc(v) => {
            assert_eq!(v["jsonrpc"], json!("2.0"));
            assert_eq!(v["method"], json!("session/prompt"));
            assert_eq!(v["params"]["sessionId"], json!("acp-1"));
            // 官方 PromptRequest = {sessionId, prompt}（schema v1，#7）：无
            // cwd（spawn/会话绑定目录隐含）——不得出现在出站帧。
            assert!(v["params"].get("cwd").is_none());
            // agent-client-protocol（peri acp 实测）：prompt 为 ContentBlock
            // 序列，非 message 字符串；无 turnId（宿主侧归位，§7.2）。
            assert_eq!(
                v["params"]["prompt"],
                json!([{ "type": "text", "text": "hello" }])
            );
            assert!(v["params"].get("message").is_none());
            assert!(v["params"].get("turnId").is_none());
            // effort 缺省 → 不写入 params（agent 默认档位，跨任务契约 §2）。
            assert!(v["params"].get("effort").is_none());
            assert!(v["id"].as_str().unwrap().starts_with("hub-"));
            // id 必带（避免被当作 notification，§6.1）。
            assert!(v["id"].is_string());
        }
        _ => panic!("expected json rpc"),
    }
}

#[test]
fn prompt_translation_ignores_effort() {
    // #7：官方 PromptRequest 无 effort 字段——payload.effort 即使为
    // Some 也不写入出站帧（agent 侧默认档位；proto/web 端保留，仅
    // translator 不写，遗留标注见 02-plan.md Slice 2）。
    let t = Translator::new();
    let action = ActionEnvelope::Prompt {
        command_id: "c1".into(),
        payload: PromptChatPayload {
            chat_id: "hub-s1".into(),
            message: "hi".into(),
            effort: Some("high".into()),
        },
    };
    match t.translate(&action, &ctx()).unwrap() {
        OutboundMessage::JsonRpc(v) => {
            assert!(v["params"].get("effort").is_none());
            assert!(v["params"].get("cwd").is_none());
        }
        _ => panic!("expected json rpc"),
    }
}

#[test]
fn outbound_ctx_without_turn_id() {
    // #6：OutboundCtx 仅 cwd + acp_session_id（字段删除的编译期验证——
    // 若残留 turn_id 字段此构造不通过）；prompt 帧 params 精确等于
    // `{sessionId, prompt}`（无任何多余键，官方 PromptRequest 形状）。
    let t = Translator::new();
    let action = ActionEnvelope::Prompt {
        command_id: "c1".into(),
        payload: PromptChatPayload {
            chat_id: "hub-s1".into(),
            message: "hello".into(),
            effort: None,
        },
    };
    match t.translate(&action, &ctx()).unwrap() {
        OutboundMessage::JsonRpc(v) => {
            assert_eq!(
                v["params"],
                json!({
                    "sessionId": "acp-1",
                    "prompt": [{ "type": "text", "text": "hello" }],
                }),
                "params 无多余键（cwd/effort/turnId 均不得出现）"
            );
        }
        _ => panic!("expected json rpc"),
    }
}

#[test]
fn cancel_translation() {
    let t = Translator::new();
    let action = ActionEnvelope::Cancel {
        command_id: "c2".into(),
        payload: CancelChatPayload {
            chat_id: "hub-s1".into(),
        },
    };
    match t.translate(&action, &ctx()).unwrap() {
        OutboundMessage::JsonRpc(v) => {
            assert_eq!(v["method"], json!("session/cancel"));
            assert_eq!(v["params"]["sessionId"], json!("acp-1"));
            // 官方 CancelNotification = {sessionId}（schema v1，#7）：无 cwd。
            assert_eq!(
                v["params"],
                json!({ "sessionId": "acp-1" }),
                "params 仅保留 sessionId"
            );
            // 真实 peri 实测：session/cancel 是 notification——无 id、必带
            // jsonrpc 版本。
            assert_eq!(v["jsonrpc"], json!("2.0"));
            assert!(v.get("id").is_none());
        }
        _ => panic!("expected json rpc"),
    }
}

#[test]
fn session_new_translation() {
    let t = Translator::new();
    let action = ActionEnvelope::SessionNew {
        command_id: "c2".into(),
        payload: peri_studio_proto::action::SessionNewChatPayload {
            chat_id: "hub-s1".into(),
        },
    };
    match t.translate(&action, &ctx()).unwrap() {
        OutboundMessage::JsonRpc(v) => {
            assert_eq!(v["jsonrpc"], json!("2.0"));
            assert_eq!(v["method"], json!("session/new"));
            // cwd 由 server 注入（与 spawn/会话绑定目录一致，§6.3）。
            assert_eq!(v["params"]["cwd"], json!("/srv/work"));
            // mcpServers 必填（agent-client-protocol；空数组 = 无 MCP）。
            assert_eq!(v["params"]["mcpServers"], json!([]));
            // 带 id 的 request（非 notification）——coordinator 以帧 id 为
            // register_rpc 键（§6.1）；id 为本次 translate 分配的 rpc_id。
            assert!(v["id"].as_str().unwrap().starts_with("hub-"));
            // 无 title（会话标题由后续 session_update/服务端单写补齐）。
            assert!(v["params"].get("title").is_none());
        }
        _ => panic!("expected json rpc"),
    }
}

#[test]
fn resolve_translation() {
    let t = Translator::new();
    let action = ActionEnvelope::ResolvePermission {
        command_id: "c3".into(),
        payload: ResolvePermissionPayload {
            chat_id: "hub-s1".into(),
            permission_id: "p1".into(),
            decision: PermissionDecision::Allow,
        },
    };
    match t.translate(&action, &ctx()).unwrap() {
        OutboundMessage::JsonRpc(v) => {
            assert_eq!(v["method"], json!("permission.resolve"));
            assert_eq!(v["params"]["permissionId"], json!("p1"));
            assert_eq!(v["params"]["decision"], json!("allow"));
            // resolve 同带 cwd（ACP 请求字段一致性）。
            assert_eq!(v["params"]["cwd"], json!("/srv/work"));
        }
        _ => panic!("expected json rpc"),
    }
}

// ---------------------------------------------------------------------------
// cwd 校验（§4.3 裁决）
// ---------------------------------------------------------------------------

#[test]
fn cwd_default_ok() {
    assert!(validate_cwd("/Users/me/work").is_ok());
}

#[test]
fn cwd_relative_rejected() {
    assert!(matches!(
        validate_cwd("relative/path"),
        Err(TranslateError::BadCwd(_))
    ));
}

#[test]
fn cwd_nul_rejected() {
    assert!(matches!(
        validate_cwd("/work\0x"),
        Err(TranslateError::BadCwd(_))
    ));
}

#[test]
fn cwd_control_chars_rejected() {
    assert!(matches!(
        validate_cwd("/work\nx"),
        Err(TranslateError::BadCwd(_))
    ));
}

#[test]
fn cwd_too_long_rejected() {
    let long = format!("/{}", "a".repeat(CWD_MAX_BYTES + 1));
    assert!(matches!(
        validate_cwd(&long),
        Err(TranslateError::BadCwd(_))
    ));
}

#[test]
fn cwd_empty_rejected() {
    assert!(matches!(validate_cwd(""), Err(TranslateError::MissingCwd)));
}
