//! MCP 工具 effective 名 `mcp__{serverId}__{toolName}` 解析。
//!
//! Cursor 等 agent 常把 ACP `title` 写成 `execute extra tool \`mcp__server__tool\``，
//! 而不是裸 effective 名；解析必须从包装 title 里取出 token。

/// 从 ACP 工具 title/name 拆出的 MCP 本地标识。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMcpToolName {
    pub server_id: String,
    pub tool_name: String,
}

/// 解析 `mcp__server__tool`；`serverId` 不得含 `__`，否则视为普通工具。
/// 兼容 Cursor extra-tool 包装 title。
pub fn parse_mcp_tool_name(name: &str) -> Option<ParsedMcpToolName> {
    let trimmed = name.trim();
    parse_mcp_effective_name(trimmed).or_else(|| {
        extract_mcp_effective_token(trimmed).and_then(parse_mcp_effective_name)
    })
}

fn parse_mcp_effective_name(name: &str) -> Option<ParsedMcpToolName> {
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

fn extract_mcp_effective_token(name: &str) -> Option<&str> {
    if let Some(start) = name.find("`mcp__") {
        let inner_start = start + 1;
        if let Some(rel_end) = name[inner_start..].find('`') {
            return Some(&name[inner_start..inner_start + rel_end]);
        }
    }
    let idx = name.find("mcp__")?;
    if idx > 0 {
        let prev = name[..idx].chars().next_back()?;
        if prev.is_ascii_alphanumeric() || prev == '_' {
            return None;
        }
    }
    let rest = &name[idx..];
    let end = rest
        .find(|c: char| {
            c.is_whitespace() || matches!(c, '`' | '"' | '\'' | ',' | ')' | ']' | '}' | '>')
        })
        .unwrap_or(rest.len());
    Some(&rest[..end])
}

#[cfg(test)]
#[path = "mcp_name_test.rs"]
mod mcp_name_test;
