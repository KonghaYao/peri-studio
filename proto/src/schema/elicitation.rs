//! Control Doc 的 elicitation 投影类型（§5.4：Agent 发起的 ACP form）。
//!
//! 与 [`super::SessionDocRoot`] 的 `pending_elicitations` map 配套；
//! 从 `control.rs` 拆出（review 问题 13：按主题拆分）。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationProjection {
    pub elicitation_id: String,
    pub message: String,
    pub fields: Vec<ElicitationFieldProjection>,
    pub status: ElicitationStatus,
    pub response_action: Option<ElicitationResponseAction>,
    /// RFC3339 server 观测时间。
    pub created_at: String,
    /// RFC3339 server 观测时间。
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationFieldProjection {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub kind: ElicitationFieldKind,
    pub required: bool,
    pub options: Vec<ElicitationOptionProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationOptionProjection {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElicitationFieldKind {
    Text,
    SingleSelect,
    MultiSelect,
}

impl ElicitationFieldKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::SingleSelect => "single_select",
            Self::MultiSelect => "multi_select",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElicitationStatus {
    Pending,
    Responding,
    Resolved,
    Expired,
}

impl ElicitationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Responding => "responding",
            Self::Resolved => "resolved",
            Self::Expired => "expired",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElicitationResponseAction {
    Accept,
    Decline,
    Cancel,
}

impl From<crate::action::ElicitationResponseAction> for ElicitationResponseAction {
    fn from(value: crate::action::ElicitationResponseAction) -> Self {
        match value {
            crate::action::ElicitationResponseAction::Accept => Self::Accept,
            crate::action::ElicitationResponseAction::Decline => Self::Decline,
            crate::action::ElicitationResponseAction::Cancel => Self::Cancel,
        }
    }
}
