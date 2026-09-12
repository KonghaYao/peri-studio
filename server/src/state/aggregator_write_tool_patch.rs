//! ACP 工具 patch 到 Chat Doc 投影的单调合并规则。

use peri_studio_proto::schema::{ToolCallProjection, ToolCallStatus};

use crate::state::normalized::{ToolCallPatch, ToolJsonPatch};

use super::{aggregator::TOOL_RESULT_MAX_BYTES, aggregator_write_helpers::advance_tool_status};

pub(super) fn tool_terminal(status: ToolCallStatus) -> bool {
    matches!(
        status,
        ToolCallStatus::Completed | ToolCallStatus::Error | ToolCallStatus::Cancelled
    )
}

pub(super) fn apply_projection_patch(
    tc: &mut ToolCallProjection,
    patch: &ToolCallPatch,
    was_terminal: bool,
) {
    if let Some(status) = patch.status {
        tc.status = advance_tool_status(tc.status, status, false);
    }
    apply_arguments_patch(tc, &patch.arguments, was_terminal);
    apply_content_patch(tc, &patch.content, patch.append_content, was_terminal);
    apply_locations_patch(tc, &patch.locations, was_terminal);

    // 第一帧终态拥有结论；晚到帧只可补充原先缺失的输出证据。
    let may_fill_result = !was_terminal || (tc.result.is_none() && tc.result_omitted != Some(true));
    if may_fill_result {
        apply_result_patch(tc, &patch.result, was_terminal);
    }
    if tc.public_error.is_none() {
        tc.public_error = patch.public_error.clone();
    }
    if tc.completed_at.is_none() && tool_terminal(tc.status) {
        tc.completed_at = patch.completed_at.clone();
    }
    if patch.mcp_server_id.is_some() {
        tc.mcp_server_id = patch.mcp_server_id.clone();
    }
    if patch.mcp_tool_name.is_some() {
        tc.mcp_tool_name = patch.mcp_tool_name.clone();
    }
    if patch.mcp_resource_uri.is_some() {
        tc.mcp_resource_uri = patch.mcp_resource_uri.clone();
    }
    if patch.mcp_app_session_id.is_some() {
        tc.mcp_app_session_id = patch.mcp_app_session_id.clone();
    }
}

fn apply_arguments_patch(tc: &mut ToolCallProjection, patch: &ToolJsonPatch, terminal: bool) {
    match patch {
        ToolJsonPatch::Unchanged => {}
        ToolJsonPatch::Clear if !terminal => {
            tc.arguments = None;
            tc.arguments_omitted = Some(false);
            tc.arguments_bytes = None;
        }
        ToolJsonPatch::Set { value } if !terminal || tc.arguments.is_none() => {
            let bytes = json_len(value);
            let omitted = bytes.is_none_or(|size| size > TOOL_RESULT_MAX_BYTES as u64);
            tc.arguments = (!omitted).then(|| value.clone());
            tc.arguments_omitted = Some(omitted);
            tc.arguments_bytes = bytes;
        }
        ToolJsonPatch::Omitted { bytes } if !terminal || tc.arguments.is_none() => {
            tc.arguments = None;
            tc.arguments_omitted = Some(true);
            tc.arguments_bytes = Some(*bytes);
        }
        _ => {}
    }
}

fn apply_content_patch(
    tc: &mut ToolCallProjection,
    patch: &ToolJsonPatch,
    append: bool,
    terminal: bool,
) {
    if append {
        let chunk_bytes = match patch {
            ToolJsonPatch::Set { value } => json_len(value),
            ToolJsonPatch::Omitted { bytes } => Some(*bytes),
            _ => return,
        };
        let Some(chunk_bytes) = chunk_bytes else {
            tc.content = None;
            tc.content_omitted = Some(true);
            tc.content_bytes = Some(u64::MAX);
            return;
        };
        // content_bytes 是完整 JSON 数组的累计观测量；一旦超预算便不再
        // 保留内容，后续 chunk 只做 O(1) 计数，避免反复克隆增长数组。
        let separator = u64::from(tc.content_bytes.is_some());
        let base = tc.content_bytes.unwrap_or(2);
        let observed = base
            .checked_add(separator)
            .and_then(|size| size.checked_add(chunk_bytes))
            .unwrap_or(u64::MAX);
        let omitted_chunk = matches!(patch, ToolJsonPatch::Omitted { .. });
        if tc.content_omitted == Some(true)
            || omitted_chunk
            || observed > TOOL_RESULT_MAX_BYTES as u64
        {
            tc.content = None;
            tc.content_omitted = Some(true);
            tc.content_bytes = Some(observed);
            return;
        }
        let mut items = tc
            .content
            .take()
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default();
        let ToolJsonPatch::Set { value } = patch else {
            unreachable!("omitted chunk returned above")
        };
        items.push(value.clone());
        tc.content = Some(serde_json::Value::Array(items));
        tc.content_omitted = Some(false);
        tc.content_bytes = Some(observed);
        return;
    }
    apply_bounded_value_patch(
        &mut tc.content,
        &mut tc.content_omitted,
        &mut tc.content_bytes,
        patch,
        terminal,
    );
}

fn apply_locations_patch(tc: &mut ToolCallProjection, patch: &ToolJsonPatch, terminal: bool) {
    apply_bounded_value_patch(
        &mut tc.locations,
        &mut tc.locations_omitted,
        &mut tc.locations_bytes,
        patch,
        terminal,
    );
}

fn apply_bounded_value_patch(
    slot: &mut Option<serde_json::Value>,
    omitted: &mut Option<bool>,
    bytes: &mut Option<u64>,
    patch: &ToolJsonPatch,
    terminal: bool,
) {
    match patch {
        ToolJsonPatch::Clear if !terminal => {
            *slot = None;
            *omitted = Some(false);
            *bytes = None;
        }
        ToolJsonPatch::Set { value } if !terminal || slot.is_none() => {
            *slot = Some(value.clone());
            *omitted = Some(false);
            *bytes = json_len(value);
        }
        ToolJsonPatch::Omitted { bytes: observed } if !terminal || slot.is_none() => {
            *slot = None;
            *omitted = Some(true);
            *bytes = Some(*observed);
        }
        _ => {}
    }
}

fn apply_result_patch(tc: &mut ToolCallProjection, patch: &ToolJsonPatch, terminal: bool) {
    match patch {
        ToolJsonPatch::Clear if !terminal => {
            tc.result = None;
            tc.result_omitted = Some(false);
            tc.result_bytes = None;
        }
        ToolJsonPatch::Set { value } => {
            let bytes = json_len(value);
            let omitted = bytes.is_none_or(|size| size > TOOL_RESULT_MAX_BYTES as u64);
            tc.result = (!omitted).then(|| value.clone());
            tc.result_omitted = Some(omitted);
            tc.result_bytes = bytes;
        }
        ToolJsonPatch::Omitted { bytes } => {
            tc.result = None;
            tc.result_omitted = Some(true);
            tc.result_bytes = Some(*bytes);
        }
        _ => {}
    }
}

fn json_len(value: &serde_json::Value) -> Option<u64> {
    serde_json::to_vec(value)
        .ok()
        .and_then(|bytes| u64::try_from(bytes.len()).ok())
}
