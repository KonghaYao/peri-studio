import type { ToolCallInfo } from '@/entities/chat/chat-view';
import {
  isPrimaryLiveMcpApp,
  liveMcpApp,
} from '@/features/mcp/mcp-apps';
import type { McpAppHistoricalCardProps } from '@peri/ui';

/** ACP 工具 title 是否为 MCP App（`mcp__{serverId}__{toolName}`）。 */
export function isMcpAppTool(tool: Pick<ToolCallInfo, 'name'>): boolean {
  return Boolean(tool.name?.startsWith('mcp__'));
}

/** 解析 MCP App 工具名；`serverId` 不得含 `__`。 */
export function parseMcpAppToolName(name: string): { serverId: string; toolName: string } | null {
  const prefix = 'mcp__';
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const split = rest.indexOf('__');
  if (split <= 0) return null;
  const serverId = rest.slice(0, split);
  const toolName = rest.slice(split + 2);
  if (!serverId || !toolName || serverId.includes('__')) return null;
  return { serverId, toolName };
}

function humanizeMcpSegment(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function mcpAppTitle(name: string): string {
  const parsed = parseMcpAppToolName(name);
  if (!parsed) return 'MCP App';
  const tool = humanizeMcpSegment(parsed.toolName);
  return tool ? `MCP App · ${tool}` : 'MCP App';
}

function mcpAppSubtitle(name: string): string | undefined {
  const parsed = parseMcpAppToolName(name);
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
  if (!self?.name) return false;
  for (const tool of tools) {
    const id = tool.toolCallId || '';
    if (!id || id === toolCallId) continue;
    if (tool.name !== self.name) continue;
    if (liveMcpApp(id)) return true;
  }
  return false;
}

/**
 * session replay 且无 live HTML 时是否应展示历史占位卡，而非 ToolCallActivity。
 * live / 刷新后仍走 ToolCallActivity（pending、policy_denied、重复调用等）。
 */
export function shouldShowMcpAppHistoricalCard(
  tool: ToolCallInfo,
  origin: 'live' | 'replay' | null | undefined,
  tools: ReadonlyArray<Pick<ToolCallInfo, 'name' | 'toolCallId'>> = [],
): boolean {
  if (!isMcpAppTool(tool)) return false;
  if (origin !== 'replay') return false;
  const toolCallId = tool.toolCallId || '';
  if (isPrimaryLiveMcpApp(toolCallId, tools)) return false;
  if (liveMcpApp(toolCallId)) return false;
  if (hasLiveMcpAppSibling(toolCallId, tools)) return false;
  return true;
}

/** MCP App 历史占位卡 props（T3 无协议/store 依赖）。 */
export function buildMcpAppHistoricalCardProps(
  tool: ToolCallInfo,
  options: {
    variant?: 'default' | 'activity';
    origin?: 'live' | 'replay' | null;
  } = {},
): McpAppHistoricalCardProps {
  const status = (tool.status || '').toLowerCase();
  const tone = status === 'failed' || status === 'error'
    ? 'failed' as const
    : status === 'running' || status === 'in_progress'
      ? 'running' as const
      : 'done' as const;
  return {
    title: mcpAppTitle(tool.name || ''),
    subtitle: mcpAppSubtitle(tool.name || ''),
    status: tone,
    variant: options.variant,
    message: historicalMcpAppMessage(options.origin ?? null),
  };
}

export function historicalMcpAppMessage(_origin?: 'live' | 'replay' | null): string {
  return 'This interactive app is not available in restored history.';
}
