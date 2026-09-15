import type { ToolCallInfo } from '@/entities/chat/chat-view';
import {
  isPrimaryLiveMcpApp,
  liveMcpApp,
  mcpAppOpenInProgress,
} from '@/features/mcp/mcp-apps';
import {
  isMcpAppTool,
  mcpAppCallIdentity,
  parseMcpAppToolFromCall,
} from '@/features/mcp/mcp-app-tool';
import type { McpAppHistoricalCardProps } from '@peri/ui';

export { isMcpAppTool, parseMcpAppToolName } from '@/features/mcp/mcp-app-tool';
export { validateMcpAppReopenArguments } from '@/features/mcp/mcp-app-tool';

function humanizeMcpSegment(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function mcpAppTitleFromParsed(parsed: ReturnType<typeof parseMcpAppToolFromCall>): string {
  if (!parsed) return 'MCP App';
  const tool = humanizeMcpSegment(parsed.toolName);
  return tool ? `MCP App · ${tool}` : 'MCP App';
}

function mcpAppSubtitleFromParsed(parsed: ReturnType<typeof parseMcpAppToolFromCall>): string | undefined {
  if (!parsed) return undefined;
  const server = humanizeMcpSegment(parsed.serverId);
  return server || undefined;
}

/** 同一 chat 内是否已有其它 tool call 持有同 identity 的 live / pending session。 */
export function hasLiveMcpAppSibling(
  toolCallId: string,
  tools: ReadonlyArray<Pick<ToolCallInfo, 'name' | 'toolCallId'>>,
): boolean {
  if (!toolCallId) return false;
  const self = tools.find((tool) => (tool.toolCallId || '') === toolCallId);
  if (!self) return false;
  const selfKey = mcpAppCallIdentity(self);
  for (const tool of tools) {
    const id = tool.toolCallId || '';
    if (!id || id === toolCallId) continue;
    if (mcpAppCallIdentity(tool) !== selfKey) continue;
    if (liveMcpApp(id)) return true;
  }
  return false;
}

function isTerminalMcpAppTool(tool: ToolCallInfo): boolean {
  if (!isMcpAppTool(tool)) return false;
  const status = (tool.status || '').toLowerCase();
  if (status === 'running' || status === 'in_progress' || status === 'pending') return false;
  if (status.includes('permission') || status.includes('awaiting')) return false;
  return status.length > 0;
}

/**
 * 已完成且无 live HTML 的 MCP App 是否应展示历史占位卡，而非 ToolCallActivity。
 * replay 与 live（open 失败/未跑/刷新后无 lease）均适用；open 进行中仍走 activity。
 */
export function shouldShowMcpAppHistoricalCard(
  tool: ToolCallInfo,
  _origin: 'live' | 'replay' | null | undefined,
  tools: ReadonlyArray<Pick<ToolCallInfo, 'name' | 'toolCallId'>> = [],
): boolean {
  if (!isTerminalMcpAppTool(tool)) return false;
  const toolCallId = tool.toolCallId || '';
  if (isPrimaryLiveMcpApp(toolCallId, tools)) return false;
  if (mcpAppOpenInProgress(toolCallId)) return false;
  if (hasLiveMcpAppSibling(toolCallId, tools)) return false;
  return true;
}

/** MCP App 历史占位卡 props（T3 无协议/store 依赖）。 */
export function buildMcpAppHistoricalCardProps(
  tool: ToolCallInfo,
  options: {
    variant?: 'default' | 'activity';
    origin?: 'live' | 'replay' | null;
    reopenDisabled?: boolean;
    reopenPending?: boolean;
    onReopen?: () => void;
  } = {},
): McpAppHistoricalCardProps {
  const status = (tool.status || '').toLowerCase();
  const tone = status === 'failed' || status === 'error'
    ? 'failed' as const
    : status === 'running' || status === 'in_progress'
      ? 'running' as const
      : 'done' as const;
  const parsed = parseMcpAppToolFromCall(tool);
  return {
    title: mcpAppTitleFromParsed(parsed),
    subtitle: mcpAppSubtitleFromParsed(parsed),
    status: tone,
    variant: options.variant,
    message: historicalMcpAppMessage(options.origin ?? null),
    reopenLabel: options.onReopen ? 'Reopen app' : undefined,
    reopenDisabled: options.reopenDisabled,
    reopenPending: options.reopenPending,
    onReopen: options.onReopen,
  };
}

export function historicalMcpAppMessage(origin?: 'live' | 'replay' | null): string {
  if (origin === 'replay') {
    return "This app isn't available in restored history.";
  }
  return 'Not available after reload.';
}
