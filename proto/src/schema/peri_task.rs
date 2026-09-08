//! Peri Task 轻量投影视图（Session Doc `tasks` / `task_order`）。

use serde::{Deserialize, Serialize};

/// Subagent 或 Background 任务通道种类。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeriTaskKind {
    Subagent,
    Background,
}

impl PeriTaskKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PeriTaskKind::Subagent => "subagent",
            PeriTaskKind::Background => "background",
        }
    }
}

/// 任务生命周期状态（Yjs 存 snake_case 字符串）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeriTaskStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl PeriTaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            PeriTaskStatus::Running => "running",
            PeriTaskStatus::Completed => "completed",
            PeriTaskStatus::Failed => "failed",
            PeriTaskStatus::Cancelled => "cancelled",
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            PeriTaskStatus::Completed | PeriTaskStatus::Failed | PeriTaskStatus::Cancelled
        )
    }
}

/// 任务实现子类型（started 事件携带；终态事件可省略）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeriTaskSubtype {
    Agent,
    Shell,
    Workflow,
}

impl PeriTaskSubtype {
    pub fn as_str(self) -> &'static str {
        match self {
            PeriTaskSubtype::Agent => "agent",
            PeriTaskSubtype::Shell => "shell",
            PeriTaskSubtype::Workflow => "workflow",
        }
    }
}

/// 详情面板可用性（不含 locator / 原始 result）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeriTaskDetailAvailability {
    Preview,
    Unavailable,
    Expired,
}

impl PeriTaskDetailAvailability {
    pub fn as_str(self) -> &'static str {
        match self {
            PeriTaskDetailAvailability::Preview => "preview",
            PeriTaskDetailAvailability::Unavailable => "unavailable",
            PeriTaskDetailAvailability::Expired => "expired",
        }
    }
}

/// Session Doc 中单条 Peri Task 投影（serde 镜像；Yjs 键同为 snake_case）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriTaskViewProjection {
    pub task_id: String,
    pub kind: PeriTaskKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_subtype: Option<PeriTaskSubtype>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub status: PeriTaskStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub is_background: bool,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub updated_at: String,
    pub detail_availability: PeriTaskDetailAvailability,
}
