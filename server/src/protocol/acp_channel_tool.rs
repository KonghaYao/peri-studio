//! ACP 1.6 工具事件的无损、受预算约束规范化。

use serde_json::{Map, Value};

use peri_studio_proto::schema::{PublicError, ToolCallKind, ToolCallStatus};

use crate::state::normalized::{EventBody, ToolCallPatch, ToolJsonPatch};

use super::{
    acp_channel::{AcpChannel, TOOL_ARGUMENTS_MAX_BYTES},
    acp_channel_parse::{public_error, string_field, truncate_text, MapError},
};
use crate::protocol::mcp_name::parse_mcp_tool_name;

const TOOL_CALL_ID_MAX_BYTES: usize = 256;

impl AcpChannel {
    pub(crate) fn map_raw_tool_patch(
        &self,
        payload: &Map<String, Value>,
        update_kind: &str,
        now: &str,
    ) -> Result<EventBody, MapError> {
        let tool_call_id = validated_tool_call_id(payload)?;
        let status = string_field(payload, "status", "status")
            .as_deref()
            .map(tool_status)
            .or((update_kind == "tool_call").then_some(ToolCallStatus::Pending));
        let terminal = status.is_some_and(is_terminal);
        let failed = matches!(status, Some(ToolCallStatus::Error));
        let mut error = public_error(payload);
        if failed && error.is_none() {
            error = Some(PublicError {
                code: "agent_error".to_string(),
                message: "Tool call failed".to_string(),
            });
        }
        Ok(EventBody::ToolCallPatched {
            turn_id: string_field(payload, "turnId", "turn_id").unwrap_or_default(),
            tool_call_id,
            patch: ToolCallPatch {
                name: string_field(payload, "name", "name").map(|name| truncate_text(&name)),
                kind: string_field(payload, "kind", "kind")
                    .as_deref()
                    .map(tool_kind),
                status,
                arguments: self.argument_patch(
                    payload,
                    "arguments",
                    "rawInput",
                    mcp_fields_from_name(string_field(payload, "name", "name").as_deref())
                        .mcp_tool_name
                        .is_some(),
                ),
                content: json_patch(payload, "content", TOOL_ARGUMENTS_MAX_BYTES),
                append_content: false,
                locations: json_patch(payload, "locations", TOOL_ARGUMENTS_MAX_BYTES),
                result: first_json_patch(payload, &["result", "rawOutput", "output"]),
                public_error: error,
                created_at: (update_kind == "tool_call").then(|| now.to_string()),
                completed_at: terminal.then(|| now.to_string()),
                ..mcp_fields_from_name(
                    string_field(payload, "name", "name").as_deref(),
                )
            },
        })
    }

    pub(crate) fn map_acp_tool_patch(
        &self,
        update: &Map<String, Value>,
        update_kind: &str,
        now: &str,
    ) -> Result<EventBody, MapError> {
        let tool_call_id = validated_tool_call_id(update)?;
        let status_text = string_field(update, "status", "status");
        let status = status_text.as_deref().map(tool_status);
        let terminal = status.is_some_and(is_terminal);
        let failed = matches!(status, Some(ToolCallStatus::Error));
        let name = string_field(update, "title", "title")
            .or_else(|| string_field(update, "name", "name"));
        let content = json_patch(update, "content", TOOL_ARGUMENTS_MAX_BYTES);
        let patch = ToolCallPatch {
            name: name.as_ref().map(|name| truncate_text(name)),
            kind: string_field(update, "kind", "kind")
                .as_deref()
                .map(tool_kind),
            status,
            arguments: self.argument_patch(
                update,
                "rawInput",
                "input",
                mcp_fields_from_name(name.as_deref()).mcp_tool_name.is_some(),
            ),
            content,
            append_content: false,
            locations: json_patch(update, "locations", TOOL_ARGUMENTS_MAX_BYTES),
            result: first_json_patch(update, &["rawOutput", "output"]),
            public_error: failed.then(|| PublicError {
                code: "agent_error".to_string(),
                message: string_field(update, "title", "title")
                    .map(|message| truncate_text(&message))
                    .unwrap_or_else(|| "Tool call failed".to_string()),
            }),
            created_at: (update_kind == "tool_call").then(|| now.to_string()),
            completed_at: terminal.then(|| now.to_string()),
            ..mcp_fields_from_name(name.as_deref())
        };
        Ok(EventBody::ToolCallPatched {
            turn_id: String::new(),
            tool_call_id,
            patch,
        })
    }

    pub(crate) fn map_acp_tool_content_chunk(
        &self,
        update: &Map<String, Value>,
    ) -> Result<EventBody, MapError> {
        let tool_call_id = validated_tool_call_id(update)?;
        let content = json_patch(update, "content", TOOL_ARGUMENTS_MAX_BYTES);
        if matches!(content, ToolJsonPatch::Unchanged) {
            return Err(MapError::MissingField);
        }
        Ok(EventBody::ToolCallPatched {
            turn_id: String::new(),
            tool_call_id,
            patch: ToolCallPatch {
                content,
                append_content: true,
                ..ToolCallPatch::default()
            },
        })
    }

    fn argument_patch(
        &self,
        update: &Map<String, Value>,
        primary: &str,
        fallback: &str,
        keep_oversized_for_mcp_app: bool,
    ) -> ToolJsonPatch {
        let Some(value) = update.get(primary).or_else(|| update.get(fallback)) else {
            return ToolJsonPatch::Unchanged;
        };
        let bytes = json_bytes(value);
        if bytes > TOOL_ARGUMENTS_MAX_BYTES {
            self.oversized_tool_arguments
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            // MCP App 首屏需要 arguments（如 canvas source）；Chat Doc 仍由聚合器按 4KB 省略。
            let keep = keep_oversized_for_mcp_app
                || value
                    .get("source")
                    .and_then(Value::as_str)
                    .is_some_and(|source| !source.is_empty());
            if keep && bytes <= 1024 * 1024 {
                return value_patch(value);
            }
            return ToolJsonPatch::Omitted {
                bytes: bytes as u64,
            };
        }
        value_patch(value)
    }
}

pub(crate) fn validated_tool_call_id(value: &Map<String, Value>) -> Result<String, MapError> {
    let id = string_field(value, "toolCallId", "tool_call_id").ok_or(MapError::MissingField)?;
    // ID 是关联键，禁止截断造成碰撞；超预算帧整体拒绝。
    if id.is_empty() || id.len() > TOOL_CALL_ID_MAX_BYTES {
        return Err(MapError::MissingField);
    }
    Ok(id)
}

pub(crate) fn optional_validated_tool_call_id(
    value: &Map<String, Value>,
) -> Result<Option<String>, MapError> {
    if value.contains_key("toolCallId") || value.contains_key("tool_call_id") {
        validated_tool_call_id(value).map(Some)
    } else {
        Ok(None)
    }
}

pub(crate) fn tool_kind(value: &str) -> ToolCallKind {
    match value {
        "read" => ToolCallKind::Read,
        "edit" | "write" => ToolCallKind::Edit,
        "delete" => ToolCallKind::Delete,
        "move" => ToolCallKind::Move,
        "search" => ToolCallKind::Search,
        "execute" | "shell" | "bash" => ToolCallKind::Execute,
        "think" => ToolCallKind::Think,
        "fetch" => ToolCallKind::Fetch,
        "switch_mode" | "switchMode" => ToolCallKind::SwitchMode,
        _ => ToolCallKind::Other,
    }
}

pub(crate) fn tool_status(value: &str) -> ToolCallStatus {
    // ACP wire status 大小写不一；在协议边界统一为小写再映射。
    match value.to_ascii_lowercase().as_str() {
        "pending" => ToolCallStatus::Pending,
        "in_progress" | "running" | "streaming" => ToolCallStatus::Running,
        "awaiting_permission" | "awaitingpermission" => ToolCallStatus::AwaitingPermission,
        "completed" | "complete" | "done" | "success" | "succeeded" | "finished" | "ok" => {
            ToolCallStatus::Completed
        }
        "failed" | "error" => ToolCallStatus::Error,
        "cancelled" | "canceled" => ToolCallStatus::Cancelled,
        // ACP v2 自定义扩展（`_foo`）与未知值：保持进行中，避免把 Running 降级为 Pending。
        s if s.starts_with('_') => ToolCallStatus::Running,
        _ => ToolCallStatus::Running,
    }
}

fn is_terminal(status: ToolCallStatus) -> bool {
    matches!(
        status,
        ToolCallStatus::Completed | ToolCallStatus::Error | ToolCallStatus::Cancelled
    )
}

fn mcp_fields_from_name(name: Option<&str>) -> ToolCallPatch {
    let Some(parsed) = name.and_then(parse_mcp_tool_name) else {
        return ToolCallPatch::default();
    };
    ToolCallPatch {
        mcp_server_id: Some(parsed.server_id),
        mcp_tool_name: Some(parsed.tool_name),
        ..ToolCallPatch::default()
    }
}

fn first_json_patch(update: &Map<String, Value>, keys: &[&str]) -> ToolJsonPatch {
    keys.iter()
        .find_map(|key| update.get(*key))
        .map(value_patch)
        .unwrap_or_default()
}

fn json_patch(update: &Map<String, Value>, key: &str, budget: usize) -> ToolJsonPatch {
    let Some(value) = update.get(key) else {
        return ToolJsonPatch::Unchanged;
    };
    let bytes = json_bytes(value);
    if bytes > budget {
        return ToolJsonPatch::Omitted {
            bytes: bytes as u64,
        };
    }
    value_patch(value)
}

fn value_patch(value: &Value) -> ToolJsonPatch {
    if value.is_null() {
        ToolJsonPatch::Clear
    } else {
        ToolJsonPatch::Set {
            value: value.clone(),
        }
    }
}

fn json_bytes(value: &Value) -> usize {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}
