//! ACPChannel 活动/预测/官方 request 解析 impl（acp_channel.rs 拆分产物）。
//!
//! 拆分动机：原 acp_channel.rs 1824 行超阈值（≤500 行要求），`impl AcpChannel`
//! 按方法主题拆为两处——本模块承载**请求与观测面**：`peri/agent_activity`
//! 白名单投影（[`parse_agent_activity`]）、`peri/prediction_ready` 输入预测
//! 归一化（[`parse_input_prediction`]）、工具参数容量归一化
//! （[`normalize_tool_arguments`]，§9.3 容量约束）与官方
//! `session/request_permission` 解析（[`normalize_request_permission`]，#1
//! 权限机制官方化）。
//!
//! 职责边界：本模块只含上述四个方法的 impl 块（方法经 pub(crate) 供
//! acp_channel.rs 入口与 acp_channel_map.rs 调用）；消息映射在
//! acp_channel_map.rs，字段提取/截断 helper 在 acp_channel_parse.rs。
//! 方法语义与拆分前逐字符一致（仅可见性提升 pub(crate)）。

use serde_json::Value;

use peri_studio_proto::schema::{AgentActivityKind, AgentActivityStatus};

use crate::state::normalized::{EventBody, PermissionToolSnapshot};

use super::acp_channel::{AcpChannel, PermissionRequestFields, TOOL_ARGUMENTS_MAX_BYTES};
use super::acp_channel_parse::{
    normalize_activity_label, normalize_prediction_text, parse_activity_attributes,
    parse_activity_metrics, required, string_field, validate_prediction_actions,
    valid_activity_correlation, MapError,
};

impl AcpChannel {
    pub(crate) fn parse_agent_activity(
        &self,
        params: &serde_json::Map<String, Value>,
    ) -> Result<EventBody, MapError> {
        let activity = params
            .get("activity")
            .and_then(Value::as_object)
            .ok_or(MapError::MissingField)?;
        const TOP_LEVEL: &[&str] = &[
            "schemaVersion",
            "kind",
            "status",
            "correlationId",
            "label",
            "isBackground",
            "metrics",
            "attributes",
        ];
        if activity
            .keys()
            .any(|key| !TOP_LEVEL.contains(&key.as_str()))
        {
            return Err(MapError::Unsupported);
        }
        if activity.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
            return Err(MapError::Unsupported);
        }
        let kind = match activity.get("kind").and_then(Value::as_str) {
            Some("subagent") => AgentActivityKind::Subagent,
            Some("background_task") => AgentActivityKind::BackgroundTask,
            Some("compact") => AgentActivityKind::Compact,
            Some("context") => AgentActivityKind::Context,
            Some("llm_retry") => AgentActivityKind::LlmRetry,
            Some("workflow") => AgentActivityKind::Workflow,
            Some("rewind") => AgentActivityKind::Rewind,
            Some("diagnostics") => AgentActivityKind::Diagnostics,
            Some("turn") => AgentActivityKind::Turn,
            Some("agent") => AgentActivityKind::Agent,
            Some("system") => AgentActivityKind::System,
            Some("oauth") => AgentActivityKind::Oauth,
            Some(_) => return Err(MapError::Unsupported),
            None => return Err(MapError::MissingField),
        };
        let status = match activity.get("status").and_then(Value::as_str) {
            Some("running") => AgentActivityStatus::Running,
            Some("completed") => AgentActivityStatus::Completed,
            Some("failed") => AgentActivityStatus::Failed,
            Some("warning") => AgentActivityStatus::Warning,
            Some("suspended") => AgentActivityStatus::Suspended,
            Some("cancelled") => AgentActivityStatus::Cancelled,
            Some("info") => AgentActivityStatus::Info,
            Some(_) => return Err(MapError::Unsupported),
            None => return Err(MapError::MissingField),
        };
        let correlation_id = match activity.get("correlationId") {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) if valid_activity_correlation(value) => Some(value.clone()),
            Some(_) => return Err(MapError::MissingField),
        };
        let label = match activity.get("label") {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) => normalize_activity_label(value),
            Some(_) => return Err(MapError::MissingField),
        };
        let is_background = match activity.get("isBackground") {
            None | Some(Value::Null) => None,
            Some(Value::Bool(value)) => Some(*value),
            Some(_) => return Err(MapError::MissingField),
        };
        let metrics = parse_activity_metrics(activity.get("metrics"))?;
        let attributes = parse_activity_attributes(activity.get("attributes"))?;
        Ok(EventBody::AgentActivity {
            kind,
            status,
            correlation_id,
            label,
            is_background,
            metrics,
            attributes,
        })
    }

    pub(crate) fn parse_input_prediction(
        &self,
        params: &serde_json::Map<String, Value>,
    ) -> Result<EventBody, MapError> {
        const TOP_LEVEL: &[&str] = &["sessionId", "session_id", "text", "actions"];
        if params.keys().any(|key| !TOP_LEVEL.contains(&key.as_str())) {
            return Err(MapError::Unsupported);
        }
        let text = match params.get("text") {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) => normalize_prediction_text(value)?,
            Some(_) => return Err(MapError::MissingField),
        };
        if let Some(actions) = params.get("actions") {
            validate_prediction_actions(actions)?;
        }
        Ok(EventBody::InputPrediction { text })
    }

    /// 归一化工具参数（§9.3 容量约束，[`TOOL_ARGUMENTS_MAX_BYTES`]）：
    /// 按序列化字节数判定，超限置 `None`（不保留超大 JSON）+ 计数（观测）。
    /// 三个提取点（`map_raw`/`map_acp_update`/`normalize_request_permission`）
    /// 统一经此——外部输入不可信，容量校验必须在协议边界完成。
    pub(crate) fn normalize_tool_arguments(&self, value: &Value) -> Option<Value> {
        let oversized = serde_json::to_string(value)
            .map(|serialized| serialized.len() > TOOL_ARGUMENTS_MAX_BYTES)
            .unwrap_or(true);
        if oversized {
            self.oversized_tool_arguments
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            return None;
        }
        Some(value.clone())
    }

    /// 官方 `session/request_permission` 解析（schema v1）：params =
    /// `{sessionId(req), toolCall(req, ToolCallUpdate), options(req)}`。
    ///
    /// - `permission_id` 由 server 生成（uuid v4，§4.7 server 权威；官方
    ///   request 无 permissionId 字段）；
    /// - `title` = toolCall.title → toolCall.toolCallId → 空串回退；
    /// - `description` 官方无字段 → None；
    /// - `request_id` 帧顶层 id **原样保留** `serde_json::Value`
    ///   （string/number 均合法；`as_str` 失败不得丢弃——这是与现有
    ///   [`NormalizeOutcome::RpcResponse`] 分支 160-162 的关键差异）。
    pub(crate) fn normalize_request_permission(
        &self,
        request_id: &Value,
        params: &serde_json::Map<String, Value>,
    ) -> Result<PermissionRequestFields, MapError> {
        let session_id = required(params, "sessionId", "session_id")?;
        let tool_call = params
            .get("toolCall")
            .and_then(Value::as_object)
            .ok_or(MapError::MissingField)?;
        let tool_call_id =
            string_field(tool_call, "toolCallId", "tool_call_id").ok_or(MapError::MissingField)?;
        let options = params
            .get("options")
            .and_then(Value::as_array)
            .ok_or(MapError::MissingField)?;
        for o in options {
            let obj = o.as_object().ok_or(MapError::MissingField)?;
            if string_field(obj, "optionId", "option_id").is_none() {
                return Err(MapError::MissingField);
            }
        }
        let title =
            string_field(tool_call, "title", "title").unwrap_or_else(|| tool_call_id.clone());
        Ok(PermissionRequestFields {
            request_id: request_id.clone(),
            permission_id: uuid::Uuid::new_v4().to_string(),
            tool_call_id: Some(tool_call_id.clone()),
            tool: PermissionToolSnapshot {
                tool_call_id,
                name: title.clone(),
                arguments: tool_call
                    .get("rawInput")
                    .and_then(|v| self.normalize_tool_arguments(v)),
            },
            title,
            description: None,
            options: options.clone(),
            session_id,
        })
    }
}
