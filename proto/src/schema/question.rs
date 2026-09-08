//! Control Doc 的 AskUserQuestion 投影类型（§5.4：与 elicitation 并列，不混 schema）。
//!
//! Yjs 根键 `pending_questions`（snake_case）；map 内字段 camelCase，与 permission 投影一致。

use serde::{Deserialize, Serialize};

/// 单个交互问题项（来自 acp-link `interactive_question` 的 `questions[]` 元素）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionItemProjection {
    pub question: String,
    pub header: Option<String>,
    pub options: Vec<QuestionOptionProjection>,
    pub multi_select: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOptionProjection {
    pub label: String,
    pub description: Option<String>,
}

/// Session Doc 根 map `pending_questions` 的条目（按 questionId 键控）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionProjection {
    pub question_id: String,
    pub status: QuestionStatus,
    pub questions: Vec<QuestionItemProjection>,
    pub description: Option<String>,
    /// RFC3339；与 acp-link 60s 自动空答案对齐。
    pub expires_at: String,
    /// CAS 成功后按问题顺序序列化的答案 JSON；创建时为 None。
    pub answer: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionStatus {
    Pending,
    Responding,
    Resolved,
    Expired,
}

impl QuestionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Responding => "responding",
            Self::Resolved => "resolved",
            Self::Expired => "expired",
        }
    }
}

/// 单题答案：单选 string，多选 string[]（与 Fenix `QuestionAnswer` 对齐）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum QuestionAnswer {
    Single(String),
    Multiple(Vec<String>),
}
