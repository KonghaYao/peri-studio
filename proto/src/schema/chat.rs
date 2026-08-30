//! Chat Doc 类型镜像（§5.3，`CHAT_DOC_SCHEMA_VERSION = 1`）。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::{
    BlockVisibility, EntryKind, EntryOrigin, EntryRole, EntryStatus, PublicError, ToolCallKind,
    ToolCallStatus,
};

/// Chat Doc 根对象（§5.3）。
///
/// 无 `committed_commands`：去重记录在 server command outbox（§4.4），不随
/// Doc 生命周期存亡（架构顾问 P0-1）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDocRoot {
    /// == [`crate::version::CHAT_DOC_SCHEMA_VERSION`]。
    pub schema_version: u32,
    /// 每次成功投影 +1；与 schema_version 分离（§5.6）。
    pub projection_version: u32,
    /// `Y.Array<String>`，与 entries 分离便于局部更新/未来分页。
    pub entry_order: Vec<String>,
    pub entries: HashMap<String, ChatEntry>,
    pub tool_calls: HashMap<String, ToolCallProjection>,
}

/// Chat Entry（§5.3）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEntry {
    /// 派生规则：`{turnId}:user` / `{turnId}:assistant` / tool: 按 toolCallId。
    pub entry_id: String,
    pub turn_id: Option<String>,
    pub kind: EntryKind,
    pub role: EntryRole,
    pub status: EntryStatus,
    pub author_user_id: Option<String>,
    /// 创建该 user entry 的 Hub browser action。additive 字段：ACP 回放、
    /// assistant/system entry、以及关联契约之前写入的快照上均缺省。
    #[serde(default)]
    pub source_command_id: Option<String>,
    /// 该 entry 属于当前 runtime，还是由 `session/load` 回放重建。
    /// 旧快照上缺省。
    #[serde(default)]
    pub origin: Option<EntryOrigin>,
    /// 仅当该回放 entry 的每个 producer event 都携带 Peri 协商的
    /// `periReplay: true` 标记时为 `true`。live 与旧 entry 为 `None`；
    /// `false` 是显式的推断/降级回放。
    #[serde(default)]
    pub replay_verified: Option<bool>,
    /// RFC3339。
    pub created_at: String,
    pub completed_at: Option<String>,
    /// `Y.Array<String>`。
    pub block_order: Vec<String>,
    pub blocks: HashMap<String, ContentBlock>,
    /// 脱敏公开错误，不含内部细节。
    pub error: Option<PublicError>,
}

/// 内容块（§5.3）。镜像内部判别形态（tag `"kind"`），非线协议。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContentBlock {
    /// 流式文本用 Y.Text（避免每 token 替换完整字符串）。
    Text { block_id: String, text: String },
    /// hidden 内容绝不发给无权客户端（§5.3）。
    Reasoning {
        block_id: String,
        text: String,
        visibility: BlockVisibility,
    },
    ToolCall {
        block_id: String,
        tool_call_id: String,
    },
    /// 只存引用，不嵌入内容。
    Resource {
        block_id: String,
        resource_id: String,
        media_type: String,
        name: String,
    },
}

/// 工具调用投影（§5.3）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallProjection {
    pub tool_call_id: String,
    pub turn_id: String,
    pub name: String,
    /// ACP 权威 kind；旧快照缺失时安全降级为 other。
    #[serde(default)]
    pub kind: ToolCallKind,
    pub status: ToolCallStatus,
    /// 过滤内部/敏感字段后投影。
    pub arguments: Option<serde_json::Value>,
    /// Hub 有意省略了超过公开预算的参数。
    #[serde(default)]
    pub arguments_omitted: Option<bool>,
    /// 省略/保留前观测到的紧凑 JSON 字节长度。
    #[serde(default)]
    pub arguments_bytes: Option<u64>,
    /// ACP 工具展示内容与位置；均为已验证、受预算约束的 JSON 投影。
    #[serde(default)]
    pub content: Option<serde_json::Value>,
    #[serde(default)]
    pub content_omitted: Option<bool>,
    #[serde(default)]
    pub content_bytes: Option<u64>,
    #[serde(default)]
    pub locations: Option<serde_json::Value>,
    #[serde(default)]
    pub locations_omitted: Option<bool>,
    #[serde(default)]
    pub locations_bytes: Option<u64>,
    /// 超大结果仅保留受授权资源引用。
    pub result: Option<serde_json::Value>,
    /// Hub 有意省略了结果：其序列化投影超过公开 tool-result 预算。
    /// 旧快照上为 None。
    #[serde(default)]
    pub result_omitted: Option<bool>,
    /// 省略/保留前观测到的紧凑 JSON 字节长度。
    #[serde(default)]
    pub result_bytes: Option<u64>,
    pub public_error: Option<PublicError>,
    pub permission_id: Option<String>,
    /// Hub 观测到的开始时间。schema 支持之前的快照上可选。
    #[serde(default)]
    pub started_at: Option<String>,
    /// Hub 观测到的结束时间。这不是 ACP 上报的执行指标。
    #[serde(default)]
    pub completed_at: Option<String>,
    /// MCP Apps：从 effective 名 `mcp__{serverId}__{toolName}` 拆出的 server 键。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_server_id: Option<String>,
    /// MCP Apps：MCP 本地 tool 名（非 effective 名）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_tool_name: Option<String>,
    /// MCP Apps：成功 open 后的 `ui://` resource URI（有界公开字段）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_resource_uri: Option<String>,
    /// MCP Apps：当前 live app session（刷新后不复活；仅在线消费）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_app_session_id: Option<String>,
}
