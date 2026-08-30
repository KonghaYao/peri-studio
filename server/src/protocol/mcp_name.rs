//! MCP 工具 effective 名 `mcp__{serverId}__{toolName}` 解析。

/// 从 ACP 工具 title/name 拆出的 MCP 本地标识。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMcpToolName {
    pub server_id: String,
    pub tool_name: String,
}

/// 解析 `mcp__server__tool`；`serverId` 不得含 `__`，否则视为普通工具。
pub fn parse_mcp_tool_name(name: &str) -> Option<ParsedMcpToolName> {
    const PREFIX: &str = "mcp__";
    if !name.starts_with(PREFIX) {
        return None;
    }
    let rest = &name[PREFIX.len()..];
    let (server_id, tool_name) = rest.split_once("__")?;
    if server_id.is_empty() || tool_name.is_empty() || server_id.contains("__") {
        return None;
    }
    Some(ParsedMcpToolName {
        server_id: server_id.to_string(),
        tool_name: tool_name.to_string(),
    })
}

#[cfg(test)]
#[path = "mcp_name_test.rs"]
mod mcp_name_test;
