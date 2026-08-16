//! 能力目录/配置/用量/agent 状态（主题 2d）
//!
//! 拆分动机：原 acp_channel_test.rs 1365 行超阈值（≤500 行要求），按
//! 「解析主题」拆出本文件；测试代码仅移动 + 文件级 use 调整，断言语义零改动。

use serde_json::json;

use super::*;
#[test]
fn map_tool_call_update_failed_terminal() {
    let f = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {"sessionUpdate": "tool_call_update", "toolCallId": "tc1", "status": "failed"}
        }
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::ToolCallCompleted {
                result,
                public_error,
                ..
            } => {
                assert_eq!(result, None);
                let pe = public_error.unwrap();
                assert_eq!(pe.code, "agent_error");
                assert_eq!(pe.message, "Tool call failed");
            }
            _ => panic!("expected tool call completed"),
        },
        other => panic!("expected event, got {other:?}"),
    }
    // error 兼容别名回归（既有行为）。
    let g = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {"sessionUpdate": "tool_call_update", "toolCallId": "tc2", "status": "error"}
        }
    });
    match norm(g) {
        NormalizeOutcome::Event(ev) => assert_eq!(ev.body.kind(), "tool_call_completed"),
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_session_update_partial() {
    let f = json!({"type": "session_update", "payload": {"title": "new title"}});
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::SessionInfo { title, status, .. } => {
                assert_eq!(title.as_deref(), Some("new title"));
                assert!(status.is_none());
            }
            _ => panic!("expected session info"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_capabilities() {
    let f = json!({"type": "available_commands_update", "payload": {"commands": ["bash", "read"]}});
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::Capabilities { capabilities, .. } => {
                assert_eq!(capabilities, vec!["bash".to_string(), "read".to_string()])
            }
            _ => panic!("expected capabilities"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_official_available_commands_preserves_descriptions_and_peri_kinds() {
    let frame = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {
                "sessionUpdate": "available_commands_update",
                "availableCommands": [
                    {"name": "compact", "description": "Compress context"},
                    {"name": "auto-issue-fixer", "description": "Fix an issue",
                     "_meta": {"periKind": "skill", "periLevel": 1}},
                    {"name": "mcp:docs:search", "description": "Search docs",
                     "_meta": {"periKind": "mcp_skill", "periLevel": 2}},
                    {"name": "AUTO-ISSUE-FIXER", "description": "duplicate"},
                    {"name": "bad name", "description": "ignored"}
                ]
            }
        }
    });
    match norm(frame) {
        NormalizeOutcome::Event(event) => match event.body {
            EventBody::Capabilities {
                capabilities,
                descriptions,
                skill_names,
                mcp_skill_names,
            } => {
                assert_eq!(
                    capabilities,
                    vec!["compact", "auto-issue-fixer", "mcp:docs:search"]
                );
                assert_eq!(descriptions["auto-issue-fixer"], "Fix an issue");
                // Phase 6 D1：skill/mcp 分类按条目级 `_meta.periKind` 推导
                // （update 级 skillNames/mcpSkillNames 镜像键已退役）。
                assert_eq!(skill_names, vec!["auto-issue-fixer"]);
                assert_eq!(mcp_skill_names, vec!["mcp:docs:search"]);
            }
            other => panic!("expected capabilities, got {other:?}"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_available_commands_kind_defaults_to_command() {
    // 字符串形态 / 无 periKind 的条目 → 回退 command 分类（与 Peri 侧缺省
    // 回退一致）：不进 skill_names / mcp_skill_names。
    let frame = json!({
        "type": "available_commands_update",
        "payload": {
            "availableCommands": ["bash", "read"]
        }
    });
    match norm(frame) {
        NormalizeOutcome::Event(event) => match event.body {
            EventBody::Capabilities {
                capabilities,
                skill_names,
                mcp_skill_names,
                ..
            } => {
                assert_eq!(capabilities, vec!["bash".to_string(), "read".to_string()]);
                assert!(skill_names.is_empty());
                assert!(mcp_skill_names.is_empty());
            }
            other => panic!("expected capabilities, got {other:?}"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn command_catalog_is_bounded_normalized_and_rejects_unsafe_names() {
    let mut values: Vec<Value> = (0..300)
        .map(|index| json!({"name": format!("skill-{index}"), "description": "line one\nline two"}))
        .collect();
    values.insert(0, json!({"name": "bad/name", "description": "ignored"}));
    values.insert(
        1,
        json!({"name": "bad\u{0000}name", "description": "ignored"}),
    );
    let (names, descriptions, _, _) = parse_available_commands(&values);
    assert_eq!(names.len(), COMMAND_CATALOG_MAX_ITEMS - 2);
    assert!(!names.iter().any(|name| name.starts_with("bad")));
    assert_eq!(descriptions["skill-0"], "line one line two");

    let oversized = "é".repeat(COMMAND_DESCRIPTION_MAX_BYTES);
    let (_, descriptions, _, _) = parse_available_commands(&[json!({
        "name": "bounded",
        "description": oversized,
    })]);
    assert!(descriptions["bounded"].len() <= COMMAND_DESCRIPTION_MAX_BYTES);
    assert!(descriptions["bounded"].is_char_boundary(descriptions["bounded"].len()));
}

#[test]
fn map_agent_status_raw_and_jsonrpc() {
    let raw = json!({"type": "agent_status", "payload": {"status": "idle"}});
    match norm(raw) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::AgentStatus {
                status,
                model,
                context_window,
                context_used,
                ..
            } => {
                assert_eq!(status, "idle");
                // 缺省字段 → None（不覆盖 agent map，§6.3 部分更新）。
                assert_eq!(model, None);
                assert_eq!(context_window, None);
                assert_eq!(context_used, None);
            }
            _ => panic!("expected agent status"),
        },
        other => panic!("expected event, got {other:?}"),
    }
    let rpc = json!({
        "jsonrpc": "2.0",
        "method": "agent/status",
        "params": {
            "status": "busy",
            "model": "claude-sonnet-4-5",
            "contextWindow": 200000,
            "contextUsed": 42000,
        },
    });
    match norm(rpc) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::AgentStatus {
                status,
                model,
                context_window,
                context_used,
                ..
            } => {
                assert_eq!(status, "busy");
                assert_eq!(model.as_deref(), Some("claude-sonnet-4-5"));
                assert_eq!(context_window, Some(200_000));
                assert_eq!(context_used, Some(42_000));
            }
            _ => panic!("expected agent status"),
        },
        other => panic!("expected event, got {other:?}"),
    }
    // snake_case 回退 + 负数/超上限 → None（缺省语义）。
    let snake = json!({
        "jsonrpc": "2.0",
        "method": "agent/status",
        "params": { "status": "error", "context_window": -1, "contextUsed": 99999999999u64 },
    });
    match norm(snake) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::AgentStatus {
                context_window,
                context_used,
                ..
            } => {
                assert_eq!(context_window, None, "负数 → None");
                assert_eq!(context_used, None, "超 u32 → None");
            }
            _ => panic!("expected agent status"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn map_config_option_update() {
    // config_option_update（跨任务契约）：model 从 options 匹配项的
    // name 提取括号内模型名；thinking_effort 取 currentValue。
    let f = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {
                "sessionUpdate": "config_option_update",
                "configOptions": [
                    {"id": "model", "name": "Model", "type": "select", "currentValue": "default",
                     "options": [
                         {"value": "default", "name": "default (claude-sonnet-4-5)"},
                         {"value": "opus", "name": "opus (claude-opus-4-1)"}
                     ], "category": "model"},
                    {"id": "thinking_effort", "name": "Effort", "type": "select",
                     "currentValue": "high", "options": [{"value":"high","name":"High"}],
                     "category": "thought_level"}
                ]
            }
        }
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::AgentConfig {
                model,
                effort,
                config_options,
            } => {
                assert_eq!(model.as_deref(), Some("claude-sonnet-4-5"));
                assert_eq!(effort.as_deref(), Some("high"));
                assert_eq!(config_options.as_ref().map(Vec::len), Some(2));
            }
            _ => panic!("expected agent config"),
        },
        other => panic!("expected event, got {other:?}"),
    }
    // name 无括号 → 回退整个 name。
    let no_paren = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {
                "sessionUpdate": "config_option_update",
                "configOptions": [
                    {"id": "model", "name": "Model", "type": "select", "currentValue": "default",
                     "options": [{"value": "default", "name": "default"}],
                     "category": "model"}
                ]
            }
        }
    });
    match norm(no_paren) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::AgentConfig {
                model,
                effort,
                config_options,
            } => {
                assert_eq!(model.as_deref(), Some("default"));
                assert_eq!(effort, None);
                assert_eq!(config_options.as_ref().map(Vec::len), Some(1));
            }
            _ => panic!("expected agent config"),
        },
        other => panic!("expected event, got {other:?}"),
    }
    // 缺 configOptions / 无匹配 option → 字段 None（部分更新，不覆盖）。
    let partial = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {"sessionId": "acp-1", "update": {"sessionUpdate": "config_option_update"}}
    });
    match norm(partial) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::AgentConfig {
                model,
                effort,
                config_options,
            } => {
                assert_eq!(model, None);
                assert_eq!(effort, None);
                assert_eq!(config_options, None);
            }
            _ => panic!("expected agent config"),
        },
        other => panic!("expected event, got {other:?}"),
    }
}

#[test]
fn agent_config_catalog_rejects_ambiguous_or_unselected_values() {
    let duplicate = vec![
        json!({"id":"mode","name":"Mode","type":"select","currentValue":"default","options":[{"value":"default","name":"Default"}]}),
        json!({"id":"mode","name":"Other","type":"select","currentValue":"default","options":[{"value":"default","name":"Default"}]}),
    ];
    assert!(normalize_agent_config(&duplicate).is_err());

    let missing_current = vec![json!({
        "id":"mode","name":"Mode","type":"select","currentValue":"missing",
        "options":[{"value":"default","name":"Default"}]
    })];
    assert!(normalize_agent_config(&missing_current).is_err());

    let unsupported = vec![json!({
        "id":"flag","name":"Flag","type":"boolean","currentValue":true
    })];
    assert!(normalize_agent_config(&unsupported).is_err());
}

#[test]
fn map_usage_update() {
    let f = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {"sessionUpdate": "usage_update", "used": 42000, "size": 200000}
        }
    });
    match norm(f) {
        NormalizeOutcome::Event(ev) => match ev.body {
            EventBody::AgentUsage {
                context_window,
                context_used,
                input_tokens,
                output_tokens,
                cache_creation_tokens,
                cache_read_tokens,
                request_id,
                model,
                stop_reason,
            } => {
                assert_eq!(context_window, 200_000);
                assert_eq!(context_used, 42_000);
                assert_eq!(input_tokens, None);
                assert_eq!(output_tokens, None);
                assert_eq!(cache_creation_tokens, None);
                assert_eq!(cache_read_tokens, None);
                assert_eq!(request_id, None);
                assert_eq!(model, None);
                assert_eq!(stop_reason, None);
            }
            _ => panic!("expected agent usage"),
        },
        other => panic!("expected event, got {other:?}"),
    }
    // 缺 used/size → MissingField（必填，§6.3 同源拒绝）。
    let missing = json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "acp-1",
            "update": {"sessionUpdate": "usage_update", "used": 1}
        }
    });
    assert!(matches!(
        norm(missing),
        NormalizeOutcome::Dropped(DropReason::MissingField)
    ));
}
