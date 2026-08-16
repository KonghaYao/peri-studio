//! Translator：出站翻译（架构 §6.1）。
//!
//! 客户端 Action → ACP JSON-RPC（`session/prompt`/`session/cancel`/
//! `permission.resolve`/`initialize`/`session/new`）。`cwd` 由 server 按已
//! 认证上下文注入（§4.3 裁决——客户端字段不可覆盖 binding），`rpcId` 由
//! server 分配（避免消息被当作 notification，§6.1）。
//!
//! create 序列两段式（§6.2）：`initialize` → `session/new` 由 coordinator
//! 流程分两次调用（[`Translator::initialize_rpc`] / [`Translator::session_new_rpc`]）。

use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;

use peri_studio_proto::action::ActionEnvelope;

#[path = "translator_helpers.rs"]
mod translator_helpers;
use translator_helpers::{first_option_id, pick_option_id};
// validate_cwd 为公开 API（coordinator / metadata 校验等消费），经
// helpers 模块实现后在此 re-export 保持 `protocol::validate_cwd` 路径。
pub use translator_helpers::validate_cwd;

/// Peri extension currently consumed end-to-end by peri-studio.
pub const PERI_TOKEN_STATS_EXTENSION: &str = "peri.tokenStats";
/// Peri extension that classifies local Skills in available-command updates.
pub const PERI_SKILL_NAMES_EXTENSION: &str = "peri.skillNames";
/// Privacy-safe Peri lifecycle projection for Hub/GUI clients.
pub const PERI_AGENT_ACTIVITY_EXTENSION: &str = "peri.agentActivity";
/// Peri's safe, user-confirmed next-input suggestion surface.
pub const PERI_PREDICTION_EXTENSION: &str = "peri.prediction";
/// Peri producer provenance for `session/load` replay updates.
pub const PERI_REPLAY_EXTENSION: &str = "peri.replay";
/// Peri's safe MCP OAuth control and transient authorization-event surface.
pub const PERI_OAUTH_EXTENSION: &str = "peri.oauth";
/// Peri's bounded active wording for standard ACP plan entries.
pub const PERI_PLAN_ENTRY_ACTIVE_FORM_EXTENSION: &str = "peri.planEntryActiveForm";
/// Peri's preview-bound, destructive session rewind surface.
pub const PERI_REWIND_EXTENSION: &str = "peri.rewind";

/// Parse only extension capabilities that this Hub requested and implements.
/// An initialize request is not proof of support; the agent response must echo
/// the capability as boolean `true`.
pub fn negotiated_peri_extensions(response: &serde_json::Value) -> Vec<String> {
    let meta = response
        .get("result")
        .and_then(|result| result.get("agentCapabilities"))
        .and_then(|capabilities| capabilities.get("_meta"))
        .and_then(serde_json::Value::as_object);
    [
        PERI_TOKEN_STATS_EXTENSION,
        PERI_SKILL_NAMES_EXTENSION,
        PERI_AGENT_ACTIVITY_EXTENSION,
        PERI_PREDICTION_EXTENSION,
        PERI_REPLAY_EXTENSION,
        PERI_OAUTH_EXTENSION,
        PERI_PLAN_ENTRY_ACTIVE_FORM_EXTENSION,
        PERI_REWIND_EXTENSION,
    ]
    .into_iter()
    .filter(|extension| {
        meta.and_then(|value| value.get(*extension))
            .and_then(serde_json::Value::as_bool)
            == Some(true)
    })
    .map(str::to_string)
    .collect()
}

/// 客户端 cwd 形态校验（§4.3 裁决）：绝对路径 + 无 NUL/控制字符 + ≤ 4KB。
/// 存在性由 instance spawn 结果判定（失败走 `AGENT_UNAVAILABLE`）。
pub const CWD_MAX_BYTES: usize = 4096;

/// 出站翻译错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TranslateError {
    /// 该 Action 不在 M1 出站方法面（Load/SubscribeEvents 等，§4.3）。
    #[error("unsupported action for outbound translation: {0}")]
    UnsupportedAction(&'static str),
    /// 缺省 cwd 且 server 未注入默认目录（配置缺失）。
    #[error("cwd required")]
    MissingCwd,
    /// cwd 形态非法（相对路径 / NUL、控制字符 / 超长）。
    #[error("invalid cwd: {0}")]
    BadCwd(&'static str),
}

/// 出站上下文（server 按连接绑定注入；客户端字段不可覆盖 binding，§4.3）。
/// turn_id 不入出站帧（#6 死字段清理）：turnId 由聚合器以事件序列归位，
/// 宿主侧不随 prompt 下发（§7.2），translator 无需感知。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundCtx {
    /// 最终 cwd：已认证上下文默认目录（§4.3 裁决）。
    pub cwd: String,
    /// binding 翻译后的 acp_session_id（hub session_id → 协议投递 id，§6.1）。
    pub acp_session_id: String,
}

/// 出站产物。
#[derive(Debug, Clone, PartialEq)]
pub enum OutboundMessage {
    /// 单条 JSON-RPC（带 id）：prompt/cancel/resolve。
    JsonRpc(serde_json::Value),
    /// `session/new`（M1 create 序列第二步，§6.2）。
    SessionNew(serde_json::Value),
}

/// 出站翻译器（§6.1 出站翻译边界）。`cwd` 由 server 注入，`rpcId` 由
/// server 分配。
#[derive(Debug, Default)]
pub struct Translator {
    next_rpc_id: AtomicU64,
}

impl Translator {
    /// 空翻译器（rpcId 从 1 起）。
    pub fn new() -> Self {
        Translator::default()
    }

    /// rpcId 分配【决策】：全局单调，格式 `hub-{n}`（n 从 1 起）。文档只要求
    /// 「server 分配」，未指定形态；全局计数避免 per-session 状态，与
    /// pending_rpc 表（relay 模块）以字符串匹配。
    pub fn alloc_rpc_id(&self) -> String {
        let n = self.next_rpc_id.fetch_add(1, Ordering::Relaxed) + 1;
        format!("hub-{n}")
    }

    /// 翻译入口（M1 方法面子集：prompt/cancel/resolve；create 序列见
    /// [`Translator::initialize_rpc`]/[`Translator::session_new_rpc`]）。
    pub fn translate(
        &self,
        action: &ActionEnvelope,
        ctx: &OutboundCtx,
    ) -> Result<OutboundMessage, TranslateError> {
        let rpc_id = self.alloc_rpc_id();
        match action {
            ActionEnvelope::Prompt { payload, .. } => {
                validate_cwd(&ctx.cwd)?;
                // agent-client-protocol（peri acp 实测）：prompt 为 ContentBlock
                // 序列（`prompt: [{type:"text",text}]`），非 message 字符串。
                // 官方 PromptRequest = {sessionId, prompt}（schema v1）——无
                // cwd/effort（#7 非官方字段清理：cwd 已由 spawn/会话绑定目录
                // 隐含，effort 由 agent 侧默认档位决定）。
                let mut params = serde_json::Map::new();
                params.insert("sessionId".to_string(), json!(ctx.acp_session_id));
                params.insert(
                    "prompt".to_string(),
                    json!([{ "type": "text", "text": payload.message }]),
                );
                Ok(OutboundMessage::JsonRpc(json!({
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "method": "session/prompt",
                    "params": params,
                })))
            }
            ActionEnvelope::Cancel { .. } => {
                validate_cwd(&ctx.cwd)?;
                // agent-client-protocol（peri acp 实测）：session/cancel 是
                // **notification**（无 id、无响应帧），非 request。官方
                // CancelNotification = {sessionId}（schema v1）——无 cwd（#7）。
                Ok(OutboundMessage::JsonRpc(json!({
                    "jsonrpc": "2.0",
                    "method": "session/cancel",
                    "params": { "sessionId": ctx.acp_session_id },
                })))
            }
            ActionEnvelope::ConfigSet { payload, .. } => {
                validate_cwd(&ctx.cwd)?;
                Ok(OutboundMessage::JsonRpc(json!({
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "method": "session/set_config_option",
                    "params": {
                        "sessionId": ctx.acp_session_id,
                        "configId": payload.config_id,
                        "value": payload.value,
                    },
                })))
            }
            ActionEnvelope::ResolvePermission { payload, .. } => {
                validate_cwd(&ctx.cwd)?;
                Ok(OutboundMessage::JsonRpc(json!({
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "method": "permission.resolve",
                    "params": {
                        "permissionId": payload.permission_id,
                        "decision": match payload.decision {
                            peri_studio_proto::action::PermissionDecision::Allow => "allow",
                            peri_studio_proto::action::PermissionDecision::Deny => "deny",
                        },
                        "cwd": ctx.cwd,
                    },
                })))
            }
            ActionEnvelope::RespondElicitation { .. } => Err(TranslateError::UnsupportedAction(
                "elicitation/respond (client response)",
            )),
            // chat/session-new（§8.5 当前对话内新建会话）：等价 create 序列
            // 的 `session/new` 一步——进程已存在，直接向目标会话发
            // session/new；响应含新 sessionId（coordinator 据此更新 binding）。
            ActionEnvelope::SessionNew { .. } => {
                validate_cwd(&ctx.cwd)?;
                // 复用 session_new_rpc 的帧构造（cwd/mcpServers 约定一致）；
                // 帧 id 重写为本次 translate 分配的 rpc_id——coordinator 以
                // 帧 id 为 register_rpc 键（§6.1），与 create 序列的两段式
                // （自取返回 id）不同。帧构造不分配 id（session_new_frame），
                // 避免 rpc id 双分配（空洞）。
                let mut msg = Self::session_new_frame(&ctx.cwd, None);
                msg["id"] = json!(rpc_id);
                Ok(OutboundMessage::JsonRpc(msg))
            }
            // create/close 不走此入口（create 两段式；close = instance/kill，
            // 由 coordinator 直接构造 InstanceKill）。
            ActionEnvelope::Create { .. } => Err(TranslateError::UnsupportedAction(
                "session/create (two-phase)",
            )),
            ActionEnvelope::Close { .. } => Err(TranslateError::UnsupportedAction(
                "session/close (instance/kill)",
            )),
            ActionEnvelope::Load { payload, .. } => {
                validate_cwd(&ctx.cwd)?;
                // §8.5 历史会话恢复：复用 create 序列的 session/load 帧构造
                // （cwd/mcpServers 约定一致）；帧 id 重写为本次 translate 分配
                // 的 rpc_id——exec_load_chat 直连 session_load_rpc 为主路径，
                // 本分支保证 translate 入口对 Load 的完整性（§6.1 出站翻译
                // 边界不因走捷径而失配）。帧构造不分配 id（session_load_frame）。
                let mut msg = Self::session_load_frame(&ctx.cwd, &payload.acp_session_id);
                msg["id"] = json!(rpc_id);
                Ok(OutboundMessage::JsonRpc(msg))
            }
            ActionEnvelope::SubscribeEvents { .. } => {
                Err(TranslateError::UnsupportedAction("events/subscribe (M3)"))
            }
            ActionEnvelope::UnsubscribeEvents { .. } => {
                Err(TranslateError::UnsupportedAction("events/unsubscribe (M3)"))
            }
            // workspace 管理命令：submit 层直接执行（不经过出站翻译）。
            ActionEnvelope::WorkspaceCreate { .. } => Err(TranslateError::UnsupportedAction(
                "workspace/create (control-plane)",
            )),
            ActionEnvelope::WorkspaceRemove { .. } => Err(TranslateError::UnsupportedAction(
                "workspace/remove (control-plane)",
            )),
            ActionEnvelope::SessionList { .. } => Err(TranslateError::UnsupportedAction(
                "session/list (control-plane)",
            )),
            ActionEnvelope::McpList { .. }
            | ActionEnvelope::McpOAuthStart { .. }
            | ActionEnvelope::McpOAuthAuthorization { .. }
            | ActionEnvelope::McpOAuthCancel { .. } => {
                Err(TranslateError::UnsupportedAction("mcp control-plane"))
            }
            ActionEnvelope::RewindCandidates { .. }
            | ActionEnvelope::RewindPreview { .. }
            | ActionEnvelope::Rewind { .. } => {
                Err(TranslateError::UnsupportedAction("rewind control-plane"))
            }
            ActionEnvelope::ProjectCreate { .. }
            | ActionEnvelope::ProjectArchive { .. }
            | ActionEnvelope::ProjectRestore { .. }
            | ActionEnvelope::ProjectRename { .. }
            | ActionEnvelope::PersistedSessionCreate { .. }
            | ActionEnvelope::PersistedSessionOpen { .. }
            | ActionEnvelope::PersistedSessionRename { .. }
            | ActionEnvelope::PersistedSessionArchive { .. }
            | ActionEnvelope::PersistedSessionRestore { .. }
            | ActionEnvelope::PersistedSessionImport { .. }
            | ActionEnvelope::PersistedSessionDiscover { .. }
            | ActionEnvelope::PersistedSessionPromptStatus { .. } => {
                Err(TranslateError::UnsupportedAction("metadata control-plane"))
            }
        }
    }

    /// 官方 `session/request_permission` 响应构造（schema v1，#1 权限机制
    /// 官方化）：
    /// result = `{ outcome: { outcome: "selected", optionId } | { outcome: "cancelled" } }`，
    /// id = agent request id 原样回显。响应帧不回 L3（JSON-RPC response 无
    /// 回执，§4.4 以 forward_ack 为确认点）。
    ///
    /// 选档规则：`Allow` → 第一个 `options[i].kind ∈ {allow_once, allow_always}`
    /// 的 `optionId`（无匹配 → 第一个元素的 `optionId` 保底）；`Deny` → 第一
    /// 个 `kind ∈ {reject_once, reject_always}` 的 `optionId`（有则
    /// `selected`+optionId；无 → `cancelled`）。kind 兼容 camelCase 别名
    /// （`allowOnce`/`allowSession`，对齐 relay 投影层 P2-e 兼容先例）。
    pub fn permission_response_rpc(
        &self,
        request_id: &serde_json::Value,
        decision: peri_studio_proto::action::PermissionDecision,
        options: &[serde_json::Value],
    ) -> serde_json::Value {
        let outcome = match decision {
            peri_studio_proto::action::PermissionDecision::Allow => {
                match pick_option_id(options, &["allow_once", "allow_always"])
                    .or_else(|| first_option_id(options))
                {
                    Some(option_id) => {
                        json!({ "outcome": "selected", "optionId": option_id })
                    }
                    // 入站校验允许空 options 数组（评审 P2-1）：无任何
                    // optionId 可回显时不得写 `"optionId": null`（官方契约
                    // selected 分支 optionId 必须为 string）——回落 cancelled，
                    // 与 Deny 分支一致。
                    None => json!({ "outcome": "cancelled" }),
                }
            }
            peri_studio_proto::action::PermissionDecision::Deny => {
                match pick_option_id(options, &["reject_once", "reject_always"]) {
                    Some(option_id) => {
                        json!({ "outcome": "selected", "optionId": option_id })
                    }
                    None => json!({ "outcome": "cancelled" }),
                }
            }
        };
        json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": { "outcome": outcome },
        })
    }

    /// create 序列第一步：`initialize` JSON-RPC（§6.2；10s 超时由 coordinator
    /// 执行）。返回 `(rpc_id, 请求帧)`。
    ///
    /// `protocolVersion` 必填（agent-client-protocol / peri acp 实测：缺省
    /// 即 `missing field protocolVersion`）。官方 InitializeRequest =
    /// `{protocolVersion, clientCapabilities?, clientInfo?}`（schema v1）——
    /// 无 cwd（#7）；`protocolVersion` 官方为 integer，值 1 合法。
    pub fn initialize_rpc(&self, cwd: &str) -> (String, serde_json::Value) {
        validate_cwd(cwd).expect("server-injected cwd must be valid");
        let rpc_id = self.alloc_rpc_id();
        let msg = json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
                "clientCapabilities": {
                    "elicitation": {
                        "form": {}
                    },
                    "_meta": {
                        (PERI_TOKEN_STATS_EXTENSION): true,
                        (PERI_SKILL_NAMES_EXTENSION): true,
                        (PERI_AGENT_ACTIVITY_EXTENSION): true,
                        (PERI_PREDICTION_EXTENSION): true,
                        (PERI_REPLAY_EXTENSION): true,
                        (PERI_OAUTH_EXTENSION): true,
                        (PERI_PLAN_ENTRY_ACTIVE_FORM_EXTENSION): true,
                        (PERI_REWIND_EXTENSION): true
                    }
                }
            },
        });
        (rpc_id, msg)
    }

    /// create 序列第二步：`session/new`（M1 create 序列，§6.2；binding 30s
    /// 超时由 coordinator 执行）。返回 `(rpc_id, 请求帧)`。
    ///
    /// `mcpServers` 必填（agent-client-protocol / peri acp 实测：缺省即
    /// `missing field mcpServers`；空数组 = 无 MCP）。
    pub fn session_new_rpc(&self, cwd: &str, title: Option<&str>) -> (String, serde_json::Value) {
        validate_cwd(cwd).expect("server-injected cwd must be valid");
        let rpc_id = self.alloc_rpc_id();
        let mut msg = Self::session_new_frame(cwd, title);
        msg["id"] = json!(rpc_id);
        (rpc_id, msg)
    }

    /// `session/new` 请求帧构造（不含 rpc id——id 由调用方分配，避免
    /// 双分配：create 序列经 [`Self::session_new_rpc`] 分配，translate 的
    /// `SessionNew` 分支复用本帧并重写 id，rpc id 序列不得出现空洞）。
    fn session_new_frame(cwd: &str, title: Option<&str>) -> serde_json::Value {
        let mut params = serde_json::Map::new();
        params.insert("cwd".to_string(), json!(cwd));
        params.insert("mcpServers".to_string(), json!([]));
        if let Some(t) = title {
            params.insert("title".to_string(), json!(t));
        }
        json!({
            "jsonrpc": "2.0",
            "method": "session/new",
            "params": params,
        })
    }

    /// create 序列第二步（历史会话恢复，§8.5）：`session/load`（M2，点击
    /// ACP 历史会话条目进入）。返回 `(rpc_id, 请求帧)`。
    ///
    /// 与 `session/new` 不同：**目标会话 id 由请求参数携带**（来自
    /// session/list 的 acp_session_id），load 响应体不含 sessionId——binding
    /// 以请求参数为准（coordinator 预绑定，回放通知先于响应到达）。
    ///
    /// `mcpServers` 必填（agent-client-protocol `LoadSessionRequest` 该字段
    /// 无 `#[serde(default)]`；缺省即 peri 反序列化失败 `-32602 missing field
    /// mcpServers`，与 `session_new_rpc` 同规则——实测必填）。
    pub fn session_load_rpc(&self, cwd: &str, session_id: &str) -> (String, serde_json::Value) {
        validate_cwd(cwd).expect("server-injected cwd must be valid");
        let rpc_id = self.alloc_rpc_id();
        let mut msg = Self::session_load_frame(cwd, session_id);
        msg["id"] = json!(rpc_id);
        (rpc_id, msg)
    }

    /// `session/load` 请求帧构造（不含 rpc id；同 [`Self::session_new_frame`]
    /// 的双分配规避）。
    fn session_load_frame(cwd: &str, session_id: &str) -> serde_json::Value {
        json!({
            "jsonrpc": "2.0",
            "method": "session/load",
            "params": { "sessionId": session_id, "cwd": cwd, "mcpServers": [] },
        })
    }

    /// server 重启恢复（无状态投影 §4 恢复路径）：`session/resume`——请求
    /// ACP 进程按需注入冻结数据并从 ThreadStore 重放历史（emit view-commit
    /// → 聚合器投影 → server 镜像重建）。返回 `(rpc_id, 请求帧)`。
    ///
    /// 与 `session/load` 不同：resume 不切换会话（binding 已在 hello 前
    /// 保持），目标会话即 chat 当前 binding 的 acp_session_id；`mcpServers`
    /// 官方有 `#[serde(default)]`，可省略（保留 cwd 必填）。
    pub fn session_resume_rpc(&self, cwd: &str, session_id: &str) -> (String, serde_json::Value) {
        validate_cwd(cwd).expect("server-injected cwd must be valid");
        let rpc_id = self.alloc_rpc_id();
        let msg = json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": "session/resume",
            "params": { "sessionId": session_id, "cwd": cwd },
        });
        (rpc_id, msg)
    }
}

#[cfg(test)]
#[path = "translator_test.rs"]
mod translator_test;

// RPC 主题（permission response / create / initialize / load / resume）自
// translator_test 拆出（534 行超阈值，见 translator_rpc_test.rs 头注）。
#[cfg(test)]
#[path = "translator_rpc_test.rs"]
mod translator_rpc_test;
