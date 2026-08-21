//! ACPChannel 事件映射 impl（acp_channel.rs 拆分产物）。
//!
//! 拆分动机：原 acp_channel.rs 1824 行超阈值（≤500 行要求），`impl AcpChannel`
//! 约 800 行按方法主题拆为两处——本模块承载**消息映射面**：agent-client
//! protocol `session/update` 的 update 对象映射（[`map_acp_update`]，照抄
//! @fenix/chat-channel acp-channel.ts 语义）与原始 `{type,payload}` 事件表
//! 映射（[`map_raw`]，§6.1 事件表 + RpcResponse 之外的全部 EventBody 面）。
//!
//! 职责边界：本模块只含上述两个映射方法的 impl 块（方法经 pub(crate)
//! 供 acp_channel.rs 入口调用）；活动/预测/官方 request 解析在
//! acp_channel_activity.rs，plan/config/elicitation 解析与字段 helper 在
//! 各自子模块。方法语义与拆分前逐字符一致（仅可见性提升 pub(crate)）。

use chrono::DateTime;
use serde_json::Value;

use peri_studio_proto::action::PermissionDecision;
use peri_studio_proto::schema::{BlockVisibility, ChatStatus, PublicError, TurnStatus};

use crate::state::normalized::EventBody;

use super::acp_channel::AcpChannel;
use super::acp_channel_config::{
    normalize_agent_config, parse_agent_plan, parse_available_commands,
};
use super::acp_channel_parse::{
    nonterminal_tool_status, number_field, opt_json, permission_options, public_error, required,
    string_field, truncate_identifier, truncate_text, MapError,
};

impl AcpChannel {
    pub(crate) fn map_acp_update(
        &self,
        update: &serde_json::Map<String, Value>,
        now_rfc3339: &str,
    ) -> Result<EventBody, MapError> {
        use EventBody as B;
        let kind =
            string_field(update, "sessionUpdate", "sessionUpdate").ok_or(MapError::MissingField)?;
        let content_text = || {
            // extractContent：优先 update.content，回退 update.text。
            update
                .get("content")
                .and_then(|v| v.get("text"))
                .and_then(Value::as_str)
                .map(truncate_text)
                .unwrap_or_else(|| {
                    truncate_text(&string_field(update, "text", "text").unwrap_or_default())
                })
        };
        let body = match kind.as_str() {
            "agent_message_chunk" => B::MessageDelta {
                turn_id: String::new(),
                entry_id: String::new(),
                block_id: String::new(),
                text: content_text(),
            },
            "agent_thought_chunk" => B::ReasoningDelta {
                turn_id: String::new(),
                entry_id: String::new(),
                block_id: String::new(),
                text: content_text(),
                visibility: BlockVisibility::Summary,
            },
            "user_message_chunk" => B::UserMessage {
                turn_id: String::new(),
                entry_id: String::new(),
                text: content_text(),
                author_user_id: None,
                created_at: now_rfc3339.to_string(),
            },
            // tool_call / tool_call_update 按 status 细分终态
            // （resolveToolCallType：running→started；completed/complete/done→
            // completed；failed/error→failed；缺省 running。官方 ToolCallStatus
            // 值域 pending/in_progress/completed/failed（#2），兼容别名
            // complete/done/error；pending/in_progress 归入 started 非终态）。
            "tool_call" | "tool_call_update" => {
                let tool_call_id = update
                    .get("toolCallId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        update
                            .get("content")
                            .and_then(|v| v.get("id"))
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .unwrap_or_default();
                if tool_call_id.is_empty() {
                    return Err(MapError::MissingField);
                }
                match string_field(update, "status", "status").as_deref() {
                    Some("completed") | Some("complete") | Some("done") => B::ToolCallCompleted {
                        turn_id: String::new(),
                        tool_call_id,
                        result: update
                            .get("rawOutput")
                            .or_else(|| update.get("output"))
                            .cloned(),
                        public_error: None,
                        completed_at: now_rfc3339.to_string(),
                    },
                    // #2：官方 failed 终态（ToolCallStatus 值域
                    // pending/in_progress/completed/failed）；error 为兼容
                    // 别名（同为 ToolCallCompleted + public_error）。
                    Some("failed") | Some("error") => B::ToolCallCompleted {
                        turn_id: String::new(),
                        tool_call_id,
                        result: None,
                        public_error: Some(PublicError {
                            code: "agent_error".to_string(),
                            message: string_field(update, "title", "title")
                                .unwrap_or_else(|| "Tool call failed".to_string()),
                        }),
                        completed_at: now_rfc3339.to_string(),
                    },
                    status => {
                        let status = nonterminal_tool_status(status);
                        if kind == "tool_call_update" {
                            B::ToolCallUpdated {
                                turn_id: String::new(),
                                tool_call_id,
                                status: Some(status),
                                arguments: update
                                    .get("rawInput")
                                    .and_then(|v| self.normalize_tool_arguments(v)),
                            }
                        } else {
                            B::ToolCallStarted {
                                turn_id: String::new(),
                                tool_call_id,
                                name: string_field(update, "title", "title")
                                    .or_else(|| string_field(update, "name", "name"))
                                    .unwrap_or_default(),
                                status,
                                arguments: update
                                    .get("rawInput")
                                    .and_then(|v| self.normalize_tool_arguments(v)),
                                created_at: now_rfc3339.to_string(),
                            }
                        }
                    }
                }
            }
            // session 元信息（title 等；peri 实测仅 updatedAt，其余缺省不覆盖）。
            "session_info_update" | "session_update" => B::SessionInfo {
                title: string_field(update, "title", "title"),
                status: None,
                active_turn_id: None,
            },
            // 模型/effort 配置（跨任务契约）：configOptions 中 id 为 model /
            // thinking_effort 的 option；任一缺失对应字段 None（部分更新，
            // 同 SessionInfo 语义）。model 取 options 匹配项（value ==
            // currentValue）的 name 括号内模型名（`alias (模型名)`），无括号
            // 回退整个 name。wire 字段名（schema v1.4.0）：SessionConfigSelect
            // = currentValue/options，SessionConfigSelectOption = value/name。
            "config_option_update" => {
                let snapshot = update
                    .get("configOptions")
                    .and_then(Value::as_array)
                    .and_then(|options| normalize_agent_config(options).ok());
                B::AgentConfig {
                    model: snapshot
                        .as_ref()
                        .and_then(|snapshot| snapshot.model.clone()),
                    effort: snapshot
                        .as_ref()
                        .and_then(|snapshot| snapshot.effort.clone()),
                    config_options: snapshot.map(|snapshot| snapshot.options),
                }
            }
            // 上下文用量快照（跨任务契约）：used/size 必填（缺 → MissingField，
            // 与 tool_call_id 同源拒绝，§6.3）。
            "usage_update" => {
                let meta = update.get("_meta").and_then(Value::as_object);
                B::AgentUsage {
                    context_window: number_field(update, "size", "size")
                        .ok_or(MapError::MissingField)?,
                    context_used: number_field(update, "used", "used")
                        .ok_or(MapError::MissingField)?,
                    input_tokens: meta
                        .and_then(|value| number_field(value, "inputTokens", "input_tokens")),
                    output_tokens: meta
                        .and_then(|value| number_field(value, "outputTokens", "output_tokens")),
                    cache_creation_tokens: meta.and_then(|value| {
                        number_field(value, "cacheCreationTokens", "cache_creation_tokens")
                    }),
                    cache_read_tokens: meta.and_then(|value| {
                        number_field(value, "cacheReadTokens", "cache_read_tokens")
                    }),
                    request_id: meta
                        .and_then(|value| string_field(value, "requestId", "request_id"))
                        .map(|value| truncate_identifier(&value)),
                    model: meta
                        .and_then(|value| string_field(value, "model", "model"))
                        .map(|value| truncate_identifier(&value)),
                    stop_reason: meta
                        .and_then(|value| string_field(value, "stopReason", "stop_reason"))
                        .map(|value| truncate_identifier(&value)),
                }
            }
            "available_commands_update" => {
                // Phase 6 D1：skill/mcp 分类按条目级 `_meta.periKind` 推导
                // （update 级 skillNames/mcpSkillNames 镜像键已退役）。
                let (capabilities, descriptions, skill_names, mcp_skill_names) =
                    parse_available_commands(
                        update
                            .get("availableCommands")
                            .and_then(Value::as_array)
                            .map(Vec::as_slice)
                            .unwrap_or_default(),
                    );
                B::Capabilities {
                    capabilities,
                    descriptions,
                    skill_names,
                    mcp_skill_names,
                }
            }
            "plan" => B::AgentPlan {
                entries: parse_agent_plan(update)?,
            },
            "plan_removed" => B::AgentPlan { entries: vec![] },
            // M1 无需投影的会话级元数据。
            "current_mode_update" | "plan_update" => {
                return Err(MapError::Unsupported);
            }
            _ => return Err(MapError::Unsupported),
        };
        Ok(body)
    }

    /// §6.1 事件映射表核心：`{type,payload}` → EventBody（14 变体）。
    ///
    /// 私有错误收敛为 [`MapError`]（调用方统一转为
    /// [`DropReason::MissingField`]，§6.3 同源拒绝）。
    pub(crate) fn map_raw(
        &self,
        kind: &str,
        payload: &serde_json::Map<String, Value>,
        now_rfc3339: &str,
    ) -> Result<EventBody, MapError> {
        use EventBody as B;
        let body = match kind {
            // ---- 文本 / 推理增量（§5.3）----
            "agent_message_chunk" => B::MessageDelta {
                turn_id: required(payload, "turnId", "turn_id")?,
                entry_id: required(payload, "entryId", "entry_id")?,
                block_id: required(payload, "blockId", "block_id")?,
                text: truncate_text(&string_field(payload, "text", "text").unwrap_or_default()),
            },
            // 架构 §6.1 表为 agent_thought_chunk；任务描述 agent_reasoning_chunk
            // 为别名（冲突裁决：以架构为准，两者同映射，f5 设计稿 §3.2）。
            "agent_thought_chunk" | "agent_reasoning_chunk" => {
                let visibility = match string_field(payload, "visibility", "visibility").as_deref()
                {
                    Some("hidden") => BlockVisibility::Hidden,
                    _ => BlockVisibility::Summary,
                };
                B::ReasoningDelta {
                    turn_id: required(payload, "turnId", "turn_id")?,
                    entry_id: required(payload, "entryId", "entry_id")?,
                    block_id: required(payload, "blockId", "block_id")?,
                    text: truncate_text(&string_field(payload, "text", "text").unwrap_or_default()),
                    visibility,
                }
            }
            // ---- 用户消息（服务端单写注册映射，§6.5；幂等以 turn_id）----
            "user_message_chunk" => B::UserMessage {
                turn_id: required(payload, "turnId", "turn_id")?,
                entry_id: required(payload, "entryId", "entry_id")?,
                text: truncate_text(&string_field(payload, "text", "text").unwrap_or_default()),
                author_user_id: string_field(payload, "authorUserId", "author_user_id"),
                created_at: string_field(payload, "createdAt", "created_at")
                    .unwrap_or_else(|| now_rfc3339.to_string()),
            },
            // ---- Turn 终态（§7.2）----
            "prompt_complete" | "agent_message_complete" => B::TurnTerminal {
                turn_id: required(payload, "turnId", "turn_id")?,
                status: TurnStatus::Completed,
                completed_at: now_rfc3339.to_string(),
                public_error: None,
            },
            "turn_cancelled" => B::TurnTerminal {
                turn_id: required(payload, "turnId", "turn_id")?,
                status: TurnStatus::Cancelled,
                completed_at: now_rfc3339.to_string(),
                public_error: None,
            },
            "session_error" => B::TurnTerminal {
                turn_id: required(payload, "turnId", "turn_id")?,
                status: TurnStatus::Failed,
                completed_at: now_rfc3339.to_string(),
                public_error: public_error(payload),
            },
            // ---- 工具调用（§5.3 tool_calls）----
            "tool_call" => B::ToolCallStarted {
                turn_id: required(payload, "turnId", "turn_id")?,
                tool_call_id: required(payload, "toolCallId", "tool_call_id")?,
                name: string_field(payload, "name", "name").unwrap_or_default(),
                status: nonterminal_tool_status(
                    string_field(payload, "status", "status").as_deref(),
                ),
                arguments: opt_json(payload, "arguments")
                    .and_then(|v| self.normalize_tool_arguments(&v)),
                created_at: string_field(payload, "createdAt", "created_at")
                    .unwrap_or_else(|| now_rfc3339.to_string()),
            },
            "tool_call_update" => {
                let status = string_field(payload, "status", "status").unwrap_or_default();
                let tool_call_id = required(payload, "toolCallId", "tool_call_id")?;
                if matches!(status.as_str(), "completed" | "error" | "failed") {
                    B::ToolCallCompleted {
                        turn_id: string_field(payload, "turnId", "turn_id").unwrap_or_default(),
                        tool_call_id,
                        result: opt_json(payload, "result"),
                        public_error: public_error(payload),
                        completed_at: now_rfc3339.to_string(),
                    }
                } else {
                    // running / streaming / 其余：M1 arguments 全量覆盖（§6.1 表）。
                    B::ToolCallUpdated {
                        turn_id: string_field(payload, "turnId", "turn_id").unwrap_or_default(),
                        tool_call_id,
                        status: Some(nonterminal_tool_status(Some(status.as_str()))),
                        arguments: opt_json(payload, "arguments")
                            .and_then(|v| self.normalize_tool_arguments(&v)),
                    }
                }
            }
            // ---- 权限（§5.4 pending_permissions）----
            "permission_request" => {
                let expires_at = match DateTime::parse_from_rfc3339(now_rfc3339) {
                    Ok(t) => (t + chrono::Duration::from_std(self.permission_timeout)
                        .unwrap_or(chrono::Duration::seconds(300)))
                    .to_rfc3339(),
                    // 防御分支（§4.7）：now_rfc3339 是 server 内部生成的权威
                    // 时间戳，不可解析即编程错误；但不得把权限退化为「立即
                    // 过期」——回退 now + 超时（与正常分支一致的语义），
                    // 保持 pending 窗口完整。
                    Err(_) => (chrono::Utc::now() + self.permission_timeout).to_rfc3339(),
                };
                B::PermissionRequested {
                    permission_id: required(payload, "permissionId", "permission_id")?,
                    turn_id: required(payload, "turnId", "turn_id")?,
                    tool_call_id: string_field(payload, "toolCallId", "tool_call_id"),
                    tool: None,
                    title: string_field(payload, "title", "title").unwrap_or_default(),
                    description: string_field(payload, "description", "description"),
                    options: permission_options(payload),
                    expires_at,
                }
            }
            "permission_response" => B::PermissionResolved {
                permission_id: required(payload, "permissionId", "permission_id")?,
                decision: match string_field(payload, "decision", "decision").as_deref() {
                    // M1 决议面只有 allow/deny（§4.3）；allow_once/allow_session
                    // 归一为 allow（会话级档位后置）。
                    Some("allow") | Some("allow_once") | Some("allow_session") => {
                        PermissionDecision::Allow
                    }
                    Some("deny") => PermissionDecision::Deny,
                    _ => return Err(MapError::MissingField),
                },
            },
            // ---- Session 元信息 / 能力（§5.4，部分更新）----
            "session_update" => B::SessionInfo {
                title: string_field(payload, "title", "title"),
                status: string_field(payload, "status", "status")
                    .as_deref()
                    .and_then(|s| match s {
                        "accepting" => Some(ChatStatus::Accepting),
                        "active" => Some(ChatStatus::Active),
                        "ended" => Some(ChatStatus::Ended),
                        "closed" => Some(ChatStatus::Closed),
                        "crashed" => Some(ChatStatus::Crashed),
                        _ => None,
                    }),
                active_turn_id: string_field(payload, "activeTurnId", "active_turn_id"),
            },
            "available_commands_update" => {
                // Phase 6 D1：skill/mcp 分类按条目级 `_meta.periKind` 推导
                // （update 级 skillNames/mcpSkillNames 镜像键已退役）。
                let (capabilities, descriptions, skill_names, mcp_skill_names) =
                    parse_available_commands(
                        payload
                            .get("commands")
                            .or_else(|| payload.get("availableCommands"))
                            .and_then(Value::as_array)
                            .map(Vec::as_slice)
                            .unwrap_or_default(),
                    );
                B::Capabilities {
                    capabilities,
                    descriptions,
                    skill_names,
                    mcp_skill_names,
                }
            }
            // ---- Agent 状态 / session_list（§5.4）----
            "agent_status" => {
                return Ok(EventBody::AgentStatus {
                    status: string_field(payload, "status", "status").unwrap_or_default(),
                    public_error: public_error(payload),
                    model: string_field(payload, "model", "model"),
                    context_window: number_field(payload, "contextWindow", "context_window"),
                    context_used: number_field(payload, "contextUsed", "context_used"),
                })
            }
            "session_list" => {
                let entries = payload
                    .get("sessions")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| {
                                let o = v.as_object()?;
                                let id = string_field(o, "sessionId", "session_id")?;
                                let title = string_field(o, "title", "title").unwrap_or_default();
                                let status =
                                    string_field(o, "status", "status").unwrap_or_default();
                                let updated_at =
                                    string_field(o, "updatedAt", "updated_at").unwrap_or_default();
                                Some(peri_studio_proto::schema::SessionSummaryProjection {
                                    session_id: id,
                                    title,
                                    status,
                                    updated_at,
                                    // control doc 侧无 cwd 面（poller 直连路径
                                    // 由轮询侧标注，§6.3 workspace 扩展）。
                                    cwd: String::new(),
                                    bound_chat_id: None,
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                B::SessionListResponse { entries }
            }
            _ => return Err(MapError::Unsupported),
        };
        Ok(body)
    }
}
