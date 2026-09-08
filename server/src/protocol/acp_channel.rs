//! ACPChannel：入站规范化（架构 §6.1）。
//!
//! instance 透传的原始 ACP 帧（`{type,payload}` 或 JSON-RPC `session/update`
//! 包裹）在此规范化为 [`NormalizedEvent`]。**纯函数**：无 I/O、无日志副作用；
//! binding 校验与持久化在调用方（RelayEventHandler）。
//!
//! 双格式兼容（§6.1）：原始 `{ type, payload }` 与 JSON-RPC `session/update`
//! （含包裹格式）统一提取；JSON-RPC **response**（有 `id`、无 `method`）走
//! 专门面 [`NormalizeOutcome::RpcResponse`]（L3 确认，不产生业务事件）。
//!
//! 未知 type / 未知 method → [`NormalizeOutcome::Dropped`]（§4.8 精神同源：
//! 不静默、不 panic、供计数）；**不产生 `action_error`**——该面只对 client
//! 帧（`UNSUPPORTED_FRAME` 由 gateway 检查，§6）。
//!
//! 字段提取约定【决策】：ACP 线格式字段名文档未逐项规范，本模块优先
//! camelCase（`sessionId`/`turnId`/`entryId`/`blockId`/`toolCallId`/
//! `permissionId`/`createdAt`），回退 snake_case（兼容 `{type,payload}` 历史
//! 形态）。
//!
//! 结构拆分：原文件 1824 行超阈值（≤500 行要求），按「解析主题」拆出——
//! 字段/解析 helper（acp_channel_parse.rs）、消息映射 impl
//! （acp_channel_map.rs）、活动/预测/官方 request impl
//! （acp_channel_activity.rs）、agent plan/命令/配置
//! （acp_channel_config.rs）、elicitation（acp_channel_elicitation.rs）。
//! 本文件保留入口 normalize / normalize_json_rpc 与全部公开结构/常量；
//! 对外导出面（protocol/mod.rs 的 pub use）保持不变。

use std::time::Duration;

use serde_json::Value;

use peri_studio_proto::schema::ElicitationFieldProjection;

use crate::state::normalized::{
    EventBody, EventProvenance, NormalizedEvent, PermissionToolSnapshot,
};

use super::acp_channel_elicitation::{normalize_elicitation_request, ElicitationMapError};
use super::acp_channel_task::{
    extract_source_agent_id, PERI_AGENT_EVENT_METHOD, PERI_UNSTABLE_EVENT_METHOD,
};
use super::acp_channel_parse::{
    acp_replay_provenance, jsonrpc_id_as_string, jsonrpc_response_id, number_field, public_error,
    raw_replay_provenance, string_field, MapError,
};

// 测试经 `use super::*` 引用（拆分前为 acp_channel 模块私有符号；现位于各
// 子模块，此处 cfg(test) pub(crate) 转发保持测试路径不变，可见域与拆分前
// 等价——原符号即为模块私有）。
pub use super::acp_channel_config::{
    normalize_agent_config, AgentConfigSnapshot, ConfigCatalogError,
};
#[cfg(test)]
pub(crate) use super::acp_channel_config::{
    parse_available_commands, COMMAND_CATALOG_MAX_ITEMS, COMMAND_DESCRIPTION_MAX_BYTES,
};
pub use super::acp_channel_parse::extract_session_id;
#[cfg(test)]
pub(crate) use super::acp_channel_parse::{field, TEXT_MAX_BYTES};

/// 权限请求超时（§16/§7.1：5min，`expires_at` 由 server 权威时钟注入，§4.7）。
pub const PERMISSION_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// 工具 arguments/rawInput 序列化字节数上限（§9.3：与
/// [`crate::state::aggregator::TOOL_RESULT_MAX_BYTES`] 对齐，4KB）。超限参数
/// 置 None + 计数（不保留超大 JSON 进入 Yjs 投影/持久化/广播链路——多租户
/// 场景下是内存/带宽攻击面）。
pub const TOOL_ARGUMENTS_MAX_BYTES: usize = 4096;

/// 官方 `session/request_permission` request 解析产物（#1 权限机制官方化）。
///
/// agent→client 的 JSON-RPC **request**（带 id，须回响应）；字段按官方
/// schema v1 提取（params = `{sessionId, toolCall, options}`）。
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionRequestFields {
    /// agent 的 request id（原样，响应帧 id 回显；JSON-RPC id 可为
    /// string/number——`as_str` 失败不得丢弃，与 RpcResponse 分支的关键
    /// 差异）。
    pub request_id: serde_json::Value,
    /// server 生成的 permission_id（uuid v4；聚合器投影键 §5.4）。
    pub permission_id: String,
    /// toolCall.toolCallId（透传 → 投影 tool_call_id）。
    pub tool_call_id: Option<String>,
    /// 官方 request 自带完整 toolCall；保留 rawInput，使 permission-first
    /// 顺序仍能原子投影可理解、可审计的工具卡。
    pub tool: PermissionToolSnapshot,
    pub title: String,
    /// 官方无 description 字段 → None。
    pub description: Option<String>,
    /// 官方 options 原样（`{optionId,name,kind}` 数组；响应须回显 optionId）。
    pub options: Vec<serde_json::Value>,
    /// 官方 params.sessionId（acp_session_id，binding 已校验；仅 relay
    /// register 用，不写入 EventBody——PendingPermissionReq.chat_id 已承载
    /// 归属，relay 侧不落表）。
    pub session_id: String,
}

/// Strict, privacy-safe form projection for ACP `elicitation/create`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ElicitationRequestFields {
    pub request_id: serde_json::Value,
    pub elicitation_id: String,
    pub session_id: String,
    pub message: String,
    pub fields: Vec<ElicitationFieldProjection>,
}

/// 规范化结果（§6.1 事件表 + RpcResponse 专门面）。
#[derive(Debug, Clone, PartialEq)]
pub enum NormalizeOutcome {
    /// 业务事件（投递 DocManager 聚合；Box 消弭与 RpcResponse 的变体大小
    /// 差异——NormalizedEvent 240B vs 响应面 ~40B）。
    Event(Box<NormalizedEvent>),
    /// JSON-RPC response（`id` 匹配 pending_rpc → L3 确认，§4.4；不产生业务
    /// 事件）。`is_error` 区分成功/错误响应。
    RpcResponse {
        /// 响应 id（rpc_id）。
        id: String,
        /// 是否 JSON-RPC error 响应。
        is_error: bool,
    },
    /// 官方 `session/request_permission` request（agent→client，带 id，须回
    /// 响应；#1 权限机制官方化）。由 relay 登记 pending_permissions 表并
    /// 投递 `PermissionRequested` 事件，coordinator resolve 时回官方响应帧。
    PermissionRequest(Box<PermissionRequestFields>),
    /// Supported session-scoped ACP form elicitation.
    ElicitationRequest(Box<ElicitationRequestFields>),
    /// Agent→client JSON-RPC request that Hub must answer with a typed error
    /// instead of silently dropping and hanging the agent tool.
    RejectedClientRequest {
        request_id: serde_json::Value,
        code: i32,
        message: &'static str,
    },
    /// 丢弃 + 原因（调用方计数，不 panic 不静默，§4.8 精神）。
    Dropped(DropReason),
}

/// 丢弃原因（§3 映射表）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropReason {
    /// 双格式 sessionId 均缺失（上层按 NoSessionId 丢弃并计数）。
    NoSessionId,
    /// 缺少必要关联信息（无 turn_id 的增量等，§6.3 同源拒绝）。
    MissingField,
    /// 帧结构非法（非对象、payload 非对象）。
    Malformed,
    /// 未知 type / JSON-RPC method（§4.8 白名单精神；不静默、不 panic）。
    UnsupportedFrame,
}

impl DropReason {
    /// 稳定计数 key（脱敏、可聚合，§17.1）。
    pub fn as_str(self) -> &'static str {
        match self {
            DropReason::NoSessionId => "no_session_id",
            DropReason::MissingField => "missing_field",
            DropReason::Malformed => "malformed",
            DropReason::UnsupportedFrame => "unsupported_frame",
        }
    }
}

/// 入站规范化器（§6.1）。`permission_timeout` 决定 `permission_request` 的
/// `expires_at` 注入；`oversized_tool_arguments` 统计被容量上限截断的工具
/// 参数（观测指标，§9.3 容量约束）。
#[derive(Debug)]
pub struct AcpChannel {
    /// 权限请求超时（§16 默认 5min）。
    pub permission_timeout: Duration,
    /// 序列化字节数超 [`TOOL_ARGUMENTS_MAX_BYTES`] 被置 None 的参数计数
    /// （§4 外部输入容量约束；relay 可读取做指标聚合）。
    pub oversized_tool_arguments: std::sync::atomic::AtomicUsize,
}

impl Default for AcpChannel {
    fn default() -> Self {
        AcpChannel {
            permission_timeout: PERMISSION_TIMEOUT,
            oversized_tool_arguments: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

impl AcpChannel {
    fn normalized_event(
        &self,
        chat_id: &str,
        epoch: u64,
        seq: u64,
        now_rfc3339: &str,
        provenance: EventProvenance,
        source_agent_id: Option<String>,
        body: EventBody,
    ) -> NormalizeOutcome {
        NormalizeOutcome::Event(Box::new(NormalizedEvent {
            chat_id: chat_id.to_string(),
            seq,
            epoch,
            ts: now_rfc3339.to_string(),
            provenance,
            source_agent_id,
            body,
        }))
    }

    /// 主入口：原始 ACP 帧 → 规范化事件（§6.1）。
    ///
    /// `chat_id` 为 **hub 侧** id（调用方已按 binding 翻译与校验）；`epoch`/
    /// `seq` 为 instance 侧流纪元与单调序号（§4.5.1，透传进 NormalizedEvent
    /// envelope）；`now_rfc3339` 为 server 权威时钟（§4.7——permission
    /// expires_at 判定性时间戳由 server 生成，instance 只上报相对时序）。
    pub fn normalize(
        &self,
        chat_id: &str,
        epoch: u64,
        seq: u64,
        now_rfc3339: &str,
        frame: &Value,
    ) -> NormalizeOutcome {
        // 1. JSON-RPC response 优先：官方 ACP v1 回合结束是 session/prompt
        //    的 result（`{id, result:{stopReason}}`）。id 为 string|number；
        //    有的实现省略 `jsonrpc` 键。不得走 {type,payload} 当 Malformed。
        if let Some((id, is_error)) = jsonrpc_response_id(frame) {
            return NormalizeOutcome::RpcResponse { id, is_error };
        }
        // 2. JSON-RPC 形态判定：有 "jsonrpc" 键 → 通知（method）/ request。
        if frame.get("jsonrpc").is_some() {
            return self.normalize_json_rpc(chat_id, epoch, seq, now_rfc3339, frame);
        }
        // 3. 原始 {type, payload} 形态。
        let Some(obj) = frame.as_object() else {
            return NormalizeOutcome::Dropped(DropReason::Malformed);
        };
        let Some(kind) = obj.get("type").and_then(Value::as_str) else {
            // 非对象 / 缺 type：sessionId 提取优先（上层丢弃语义按 NoSessionId
            // 分类），否则 Malformed。
            if extract_session_id(frame).is_none() {
                return NormalizeOutcome::Dropped(DropReason::Malformed);
            }
            return NormalizeOutcome::Dropped(DropReason::MissingField);
        };
        let payload = match obj.get("payload") {
            Some(Value::Object(p)) => p.clone(),
            Some(_) => return NormalizeOutcome::Dropped(DropReason::Malformed),
            None => serde_json::Map::new(),
        };
        match self.map_raw(kind, &payload, now_rfc3339) {
            Ok(body) => self.normalized_event(
                chat_id,
                epoch,
                seq,
                now_rfc3339,
                raw_replay_provenance(kind, &payload),
                None,
                body,
            ),
            Err(MapError::Unsupported) => NormalizeOutcome::Dropped(DropReason::UnsupportedFrame),
            Err(MapError::MissingField) => NormalizeOutcome::Dropped(DropReason::MissingField),
        }
    }

    /// JSON-RPC 形态（§6.1 包裹格式）。
    fn normalize_json_rpc(
        &self,
        chat_id: &str,
        epoch: u64,
        seq: u64,
        now_rfc3339: &str,
        frame: &Value,
    ) -> NormalizeOutcome {
        let Some(obj) = frame.as_object() else {
            return NormalizeOutcome::Dropped(DropReason::Malformed);
        };
        // response：有 id、无 method（normalize 入口已处理带 result/error 的
        // 完整响应；此处兜底 id-only / 非法 id）。
        if obj.contains_key("id") && !obj.contains_key("method") {
            let Some(id) = obj.get("id").and_then(jsonrpc_id_as_string) else {
                return NormalizeOutcome::Dropped(DropReason::Malformed);
            };
            let is_error = obj.get("error").is_some();
            return NormalizeOutcome::RpcResponse { id, is_error };
        }
        // notification：method。
        let Some(method) = obj.get("method").and_then(Value::as_str) else {
            return NormalizeOutcome::Dropped(DropReason::Malformed);
        };
        let params = match obj.get("params") {
            Some(Value::Object(p)) => p.clone(),
            Some(_) => return NormalizeOutcome::Dropped(DropReason::Malformed),
            None => serde_json::Map::new(),
        };
        // session/update 通知：params 两种形态——
        //   a) ACP 包裹 `{type, payload}`（peri-studio 私有帧）；
        //   b) agent-client-protocol `{sessionId, update: {sessionUpdate, ...}}`
        //      （真实 peri 实测；照抄 @fenix/chat-channel acp-channel.ts 映射）。
        if method == "session/update" {
            let source_agent_id = extract_source_agent_id(&params);
            if let Some(update) = params.get("update").and_then(|v| v.as_object()) {
                if update.get("sessionUpdate").is_some() {
                    return match self.map_acp_update(update, now_rfc3339) {
                        Ok(body) => self.normalized_event(
                            chat_id,
                            epoch,
                            seq,
                            now_rfc3339,
                            acp_replay_provenance(update),
                            source_agent_id,
                            body,
                        ),
                        Err(MapError::Unsupported) => {
                            NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
                        }
                        Err(MapError::MissingField) => {
                            NormalizeOutcome::Dropped(DropReason::MissingField)
                        }
                    };
                }
            }
            let Some(kind) = params.get("type").and_then(Value::as_str) else {
                return NormalizeOutcome::Dropped(DropReason::MissingField);
            };
            let payload = match params.get("payload") {
                Some(Value::Object(p)) => p.clone(),
                Some(_) => return NormalizeOutcome::Dropped(DropReason::Malformed),
                None => serde_json::Map::new(),
            };
            return match self.map_raw(kind, &payload, now_rfc3339) {
                Ok(body) => self.normalized_event(
                    chat_id,
                    epoch,
                    seq,
                    now_rfc3339,
                    raw_replay_provenance(kind, &payload),
                    source_agent_id,
                    body,
                ),
                Err(MapError::Unsupported) => {
                    NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
                }
                Err(MapError::MissingField) => NormalizeOutcome::Dropped(DropReason::MissingField),
            };
        }
        if method == PERI_AGENT_EVENT_METHOD {
            return match AcpChannel::parse_peri_agent_event(&params) {
                Ok(body) => self.normalized_event(
                    chat_id,
                    epoch,
                    seq,
                    now_rfc3339,
                    EventProvenance::Unspecified,
                    None,
                    body,
                ),
                Err(MapError::Unsupported) => {
                    NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
                }
                Err(MapError::MissingField) => NormalizeOutcome::Dropped(DropReason::MissingField),
            };
        }
        if method == PERI_UNSTABLE_EVENT_METHOD {
            return match AcpChannel::parse_peri_unstable_event(&params) {
                Ok(body) => self.normalized_event(
                    chat_id,
                    epoch,
                    seq,
                    now_rfc3339,
                    EventProvenance::Unspecified,
                    None,
                    body,
                ),
                Err(MapError::Unsupported) => {
                    NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
                }
                Err(MapError::MissingField) => NormalizeOutcome::Dropped(DropReason::MissingField),
            };
        }
        if method == "peri/agent_activity" {
            return match self.parse_agent_activity(&params) {
                Ok(body) => self.normalized_event(
                    chat_id,
                    epoch,
                    seq,
                    now_rfc3339,
                    EventProvenance::Unspecified,
                    None,
                    body,
                ),
                Err(MapError::Unsupported) => {
                    NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
                }
                Err(MapError::MissingField) => NormalizeOutcome::Dropped(DropReason::MissingField),
            };
        }
        if method == "peri/prediction_ready" {
            return match self.parse_input_prediction(&params) {
                Ok(body) => self.normalized_event(
                    chat_id,
                    epoch,
                    seq,
                    now_rfc3339,
                    EventProvenance::Unspecified,
                    None,
                    body,
                ),
                Err(MapError::Unsupported) => {
                    NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
                }
                Err(MapError::MissingField) => NormalizeOutcome::Dropped(DropReason::MissingField),
            };
        }
        // agent 状态通知（`agent/status`）。
        if method == "agent/status" {
            return self.normalized_event(
                chat_id,
                epoch,
                seq,
                now_rfc3339,
                EventProvenance::Unspecified,
                None,
                EventBody::AgentStatus {
                    status: string_field(&params, "status", "status").unwrap_or_default(),
                    public_error: public_error(&params),
                    model: string_field(&params, "model", "model"),
                    context_window: number_field(&params, "contextWindow", "context_window"),
                    context_used: number_field(&params, "contextUsed", "context_used"),
                },
            );
        }
        // 官方 `session/request_permission` request（#1 权限机制官方化，
        // schema v1）：agent→client 请求权限。带 id（须回响应，§4.4 响应
        // 帧无回执、以 forward_ack 为确认点）；params 必含 sessionId/
        // toolCall/options。
        if method == "session/request_permission" {
            let Some(id) = obj.get("id").filter(|v| !v.is_null()) else {
                // 无 id → 无法回响应（官方为 request 形态，非 notification）。
                return NormalizeOutcome::Dropped(DropReason::MissingField);
            };
            return match self.normalize_request_permission(id, &params) {
                Ok(req) => NormalizeOutcome::PermissionRequest(Box::new(req)),
                Err(MapError::MissingField) => NormalizeOutcome::Dropped(DropReason::MissingField),
                Err(MapError::Unsupported) => {
                    NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
                }
            };
        }
        if method == "elicitation/create" {
            let Some(id) = obj
                .get("id")
                .filter(|value| value.is_string() || value.is_number())
            else {
                return NormalizeOutcome::Dropped(DropReason::MissingField);
            };
            return match normalize_elicitation_request(id, &params) {
                Ok(request) => NormalizeOutcome::ElicitationRequest(Box::new(request)),
                Err(ElicitationMapError::Invalid) => NormalizeOutcome::RejectedClientRequest {
                    request_id: id.clone(),
                    code: -32602,
                    message: "invalid form elicitation",
                },
                Err(ElicitationMapError::Unsupported) => NormalizeOutcome::RejectedClientRequest {
                    request_id: id.clone(),
                    code: -32602,
                    message: "unsupported elicitation mode or field schema",
                },
            };
        }
        NormalizeOutcome::Dropped(DropReason::UnsupportedFrame)
    }
}

// ---------------------------------------------------------------------------
// 拆分转发：mod.rs 的 pub use 面保持不变（extract_session_id /
// normalize_agent_config 已移至子模块，此处维持 acp_channel:: 路径可见）。
// ---------------------------------------------------------------------------

#[cfg(test)]
#[path = "acp_channel_test.rs"]
mod acp_channel_test;
