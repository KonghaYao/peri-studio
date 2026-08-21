//! Control Doc 的 agent 状态投影类型（§5.4）。
//!
//! 从 `control.rs` 拆出（review 问题 13：按主题拆分）。承载
//! [`super::SessionDocRoot`] `agent` 字段及其全部子类型：计划 / 输入预测 /
//! 会话配置目录 / 用量 / 命令目录 / 活动记录。

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use super::PublicError;

/// Agent 状态投影（§5.4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusProjection {
    pub instance_id: String,
    pub session_id: String,
    /// 【决策】agent 状态值域文档未展开，M1 透传 ACP agent 状态。
    pub status: String,
    /// 可用命令目录的旧名称（兼容面）。
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// 当前 ACP session 广播的命令列表。这是操作性 UI 数据，
    /// 不是协议能力协商。
    #[serde(default)]
    pub available_commands: Vec<String>,
    /// 结构化斜杠命令目录。上方纯名称数组保留为旧读者的兼容排序/来源。
    #[serde(default)]
    pub command_catalog: HashMap<String, AgentCommandProjection>,
    /// initialize 期间协商的 ACP extensions。这不是旧 `capabilities` 字段
    /// 承载的 runtime 可用命令目录。
    #[serde(default)]
    pub extensions: Vec<String>,
    /// 最近一次 model 请求的精确用量；仅当 agent 与 Hub 协商了兼容扩展
    /// （如 `peri.tokenStats`）时存在。
    #[serde(default)]
    pub latest_usage: Option<AgentUsageProjection>,
    /// 隐私安全的 Peri 活动记录，按稳定 activity id 索引。
    #[serde(default)]
    pub activities: HashMap<String, AgentActivityProjection>,
    /// `activities` 的由旧到新排序（由 producer 界定数量）。
    #[serde(default)]
    pub activity_order: Vec<String>,
    /// 最新的 Peri 提议用户输入。仅 `peri.prediction` 协商后存在；
    /// 接受它仍是显式的客户端动作。
    #[serde(default)]
    pub input_prediction: Option<AgentInputPredictionProjection>,
    /// 最新的全量替换 ACP 执行计划。`active_form` 仅当
    /// `peri.planEntryActiveForm` 协商后存在。
    #[serde(default)]
    pub plan: Vec<AgentPlanEntryProjection>,
    /// RFC3339。
    pub last_activity_at: String,
    pub public_error: Option<PublicError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanEntryProjection {
    pub content: String,
    pub status: AgentPlanEntryStatus,
    pub active_form: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPlanEntryStatus {
    Pending,
    InProgress,
    Completed,
}

impl AgentPlanEntryStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInputPredictionProjection {
    pub id: String,
    pub text: String,
    /// RFC3339 server 观测时间。
    pub created_at: String,
}

/// Agent 投影的 ACP select 风格会话配置目录。未知 option kind 与元数据
/// 绝不进入该 DTO。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigOptionProjection {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<SessionConfigCategory>,
    pub current_value: String,
    pub options: Vec<SessionConfigChoiceProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigChoiceProjection {
    pub value: String,
    pub name: String,
    pub description: Option<String>,
}

/// ACP 保留类别，浏览器侧有稳定语义。缺失或未知类别保持 `None`；
/// category 对合法性非必需。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionConfigCategory {
    Mode,
    Model,
    ModelConfig,
    ThoughtLevel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageProjection {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub cache_creation_tokens: Option<u32>,
    pub cache_read_tokens: Option<u32>,
    pub request_id: Option<String>,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandProjection {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// `command`、`skill` 或 `mcp_skill`。
    pub kind: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentActivityKind {
    Subagent,
    BackgroundTask,
    Compact,
    Context,
    LlmRetry,
    Workflow,
    Rewind,
    Diagnostics,
    Turn,
    Agent,
    System,
    Oauth,
}

impl AgentActivityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Subagent => "subagent",
            Self::BackgroundTask => "background_task",
            Self::Compact => "compact",
            Self::Context => "context",
            Self::LlmRetry => "llm_retry",
            Self::Workflow => "workflow",
            Self::Rewind => "rewind",
            Self::Diagnostics => "diagnostics",
            Self::Turn => "turn",
            Self::Agent => "agent",
            Self::System => "system",
            Self::Oauth => "oauth",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentActivityStatus {
    Running,
    Completed,
    Failed,
    Warning,
    Suspended,
    Cancelled,
    Info,
}

impl AgentActivityStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Warning => "warning",
            Self::Suspended => "suspended",
            Self::Cancelled => "cancelled",
            Self::Info => "info",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityProjection {
    pub id: String,
    pub kind: AgentActivityKind,
    pub status: AgentActivityStatus,
    pub label: Option<String>,
    pub is_background: Option<bool>,
    pub metrics: BTreeMap<String, u64>,
    pub attributes: BTreeMap<String, String>,
    /// RFC3339 server 观测时间。
    pub created_at: String,
    /// RFC3339 server 观测时间。
    pub updated_at: String,
}
