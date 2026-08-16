//! Rewind 响应归一化（拆分自 session_rewind.rs，原文件 700 行）。
//!
//! 拆分动机：查询轨道的第二道严格归一化边界（candidates 摘要清洗、preview
//! 文件变更的路径安全清洗）与查询 RPC 主流程在主题上相互独立。本文件收敛
//! `normalize_candidates` / `normalize_preview` / `normalize_relative_path`
//! 三个纯函数；调用方（SessionRewindQueryRun::execute）保留在父模块
//! `session_rewind.rs`，共享常量（MAX_*）与校验 helper（validate_message_id）
//! 经 `super::` 引用，以 `pub(super)` 暴露（等价于拆分前父模块内的私有
//! 可见域），不改变任何分支语义、错误消息与边界常量。

use std::path::{Component, Path};

use peri_studio_proto::ack::{ActionError, ErrorCode};
use peri_studio_proto::frame::Frame;
use peri_studio_proto::rewind::{
    RewindCandidate, RewindCandidatesFrame, RewindFileChange, RewindFileChangeKind,
    RewindPreviewFrame,
};

use super::{
    error, validate_message_id, MAX_CANDIDATES, MAX_FILE_CHANGES, MAX_PATH_BYTES,
    MAX_PREVIEW_BYTES,
};

pub(super) fn normalize_candidates(
    command_id: &str,
    chat_id: &str,
    response: &serde_json::Value,
) -> Result<Frame, ActionError> {
    let messages = response
        .get("result")
        .and_then(|result| result.get("messages"))
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| invalid_response(command_id))?;
    if messages.len() > MAX_CANDIDATES {
        return Err(invalid_response(command_id));
    }
    let mut candidates = Vec::with_capacity(messages.len());
    for message in messages {
        let message_id = message
            .get("id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| invalid_response(command_id))?;
        validate_message_id(message_id).map_err(|_| invalid_response(command_id))?;
        let preview = message
            .get("preview")
            .and_then(serde_json::Value::as_str)
            .map(|preview| preview.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|preview| !preview.is_empty() && preview.len() <= MAX_PREVIEW_BYTES)
            .ok_or_else(|| invalid_response(command_id))?;
        candidates.push(RewindCandidate {
            message_id: message_id.to_string(),
            preview,
        });
    }
    Ok(Frame::RewindCandidates(RewindCandidatesFrame {
        command_id: command_id.to_string(),
        chat_id: chat_id.to_string(),
        candidates,
    }))
}

pub(super) fn normalize_preview(
    command_id: &str,
    chat_id: &str,
    target_message_id: &str,
    response: &serde_json::Value,
) -> Result<Frame, ActionError> {
    let result = response
        .get("result")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| invalid_response(command_id))?;
    let fingerprint = result
        .get("preview_fingerprint")
        .and_then(serde_json::Value::as_str)
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| invalid_response(command_id))?;
    let raw_changes = result
        .get("file_changes")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| invalid_response(command_id))?;
    if raw_changes.len() > MAX_FILE_CHANGES {
        return Err(invalid_response(command_id));
    }
    let mut file_changes = Vec::with_capacity(raw_changes.len());
    for change in raw_changes {
        let path = change
            .get("path")
            .and_then(serde_json::Value::as_str)
            .and_then(normalize_relative_path)
            .ok_or_else(|| invalid_response(command_id))?;
        let kind = match change.get("kind").and_then(serde_json::Value::as_str) {
            Some("write") => RewindFileChangeKind::Write,
            Some("edit") => RewindFileChangeKind::Edit,
            _ => return Err(invalid_response(command_id)),
        };
        file_changes.push(RewindFileChange { path, kind });
    }
    Ok(Frame::RewindPreview(RewindPreviewFrame {
        command_id: command_id.to_string(),
        chat_id: chat_id.to_string(),
        target_message_id: target_message_id.to_string(),
        preview_fingerprint: fingerprint.to_ascii_lowercase(),
        file_changes,
    }))
}

fn normalize_relative_path(raw: &str) -> Option<String> {
    if raw.is_empty()
        || raw.len() > MAX_PATH_BYTES
        || raw.chars().any(|character| character.is_control())
    {
        return None;
    }
    let path = Path::new(raw);
    if path.is_absolute() {
        return None;
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => parts.push(part.to_str()?),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    let normalized = parts.join("/");
    (normalized.len() <= MAX_PATH_BYTES).then_some(normalized)
}

fn invalid_response(command_id: &str) -> ActionError {
    error(
        command_id,
        ErrorCode::AgentUnavailable,
        "Agent returned an invalid rewind response",
        false,
    )
}
