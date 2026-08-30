use super::{parse_mcp_tool_name, ParsedMcpToolName};

#[test]
fn parse_valid_mcp_tool_name() {
    assert_eq!(
        parse_mcp_tool_name("mcp__official-apps-fixture__get-time"),
        Some(ParsedMcpToolName {
            server_id: "official-apps-fixture".into(),
            tool_name: "get-time".into(),
        })
    );
    assert_eq!(
        parse_mcp_tool_name("mcp__docs__search"),
        Some(ParsedMcpToolName {
            server_id: "docs".into(),
            tool_name: "search".into(),
        })
    );
}

#[test]
fn parse_rejects_invalid_shapes() {
    assert_eq!(parse_mcp_tool_name("compact"), None);
    assert_eq!(parse_mcp_tool_name("mcp__only"), None);
    assert_eq!(parse_mcp_tool_name("mcp____tool"), None);
    assert_eq!(parse_mcp_tool_name(""), None);
    // tool 名可含 `__`；仅 serverId 不得含 `__`
    assert!(parse_mcp_tool_name("mcp__bad__id__tool").is_some());
}
