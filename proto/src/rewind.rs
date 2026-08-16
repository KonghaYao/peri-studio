//! 安全、能力门控的 Peri rewind 查询响应。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindCandidate {
    pub message_id: String,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindCandidatesFrame {
    pub command_id: String,
    pub chat_id: String,
    pub candidates: Vec<RewindCandidate>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RewindFileChangeKind {
    Write,
    Edit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindFileChange {
    pub path: String,
    pub kind: RewindFileChangeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindPreviewFrame {
    pub command_id: String,
    pub chat_id: String,
    pub target_message_id: String,
    pub preview_fingerprint: String,
    pub file_changes: Vec<RewindFileChange>,
}
