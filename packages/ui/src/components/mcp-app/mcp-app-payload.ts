import {
  MCP_APPS_PROTOCOL,
  MCP_APP_HOST_NAME,
  MCP_APP_HOST_VERSION,
  MCP_APP_MAX_WIDTH,
  mcpAppInlineMaxHeight,
} from './mcp-app-layout';

/** 官方 App Bridge 的 `McpUiInitializeResult`：hostInfo.version 与 hostCapabilities 必填。 */
export function mcpUiInitializeResult(theme: 'light' | 'dark'): Record<string, unknown> {
  return {
    protocolVersion: MCP_APPS_PROTOCOL,
    hostInfo: { name: MCP_APP_HOST_NAME, version: MCP_APP_HOST_VERSION },
    hostCapabilities: {
      openLinks: {},
      serverTools: {},
    },
    hostContext: {
      theme,
      displayMode: 'inline',
      platform: 'web',
      containerDimensions: { maxHeight: mcpAppInlineMaxHeight(), maxWidth: MCP_APP_MAX_WIDTH },
    },
  };
}

/** App Bridge `ui/notifications/tool-input` params：arguments 必须是 object。 */
export function asToolInputParams(value: unknown): { arguments: Record<string, unknown> } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { arguments: value as Record<string, unknown> };
  }
  return { arguments: {} };
}

/** 诊断用：只描述形状与长度，不打印 HTML / TSX / token。 */
export function describeMcpAppPayload(value: unknown): Record<string, unknown> {
  if (value == null) return { present: false };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { present: true, kind: Array.isArray(value) ? 'array' : typeof value };
  }
  const record = value as Record<string, unknown>;
  const structured = record.structuredContent;
  const structuredRecord = structured && typeof structured === 'object' && !Array.isArray(structured)
    ? structured as Record<string, unknown>
    : null;
  const source = structuredRecord && typeof structuredRecord.source === 'string' ? structuredRecord.source : null;
  const content = Array.isArray(record.content) ? record.content : null;
  const first = content?.[0];
  const firstText = first && typeof first === 'object' && !Array.isArray(first) && typeof (first as { text?: unknown }).text === 'string'
    ? (first as { text: string }).text
    : '';
  let jsonChars = -1;
  try {
    jsonChars = JSON.stringify(value).length;
  } catch {
    jsonChars = -1;
  }
  return {
    present: true,
    keys: Object.keys(record).slice(0, 16),
    contentBlocks: content?.length ?? 0,
    firstTextChars: firstText.length,
    hasStructuredContent: structuredRecord != null,
    structuredKeys: structuredRecord ? Object.keys(structuredRecord).slice(0, 16) : [],
    sourceChars: source?.length ?? 0,
    jsonChars,
  };
}

/** App Bridge `ui/notifications/tool-result` params 必须是 CallToolResult 对象，不能是字符串。 */
export function asCallToolResult(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.content)) return record;
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
  }
  if (typeof value === 'string') {
    return { content: [{ type: 'text', text: value }] };
  }
  return { content: [] };
}
