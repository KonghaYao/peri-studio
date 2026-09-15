import type { ToolCallInfo } from '@/entities/chat/chat-view';

export type ParsedMcpAppToolName = { serverId: string; toolName: string };

const MCP_PREFIX = 'mcp__';
const ARGUMENT_NAME_KEYS = ['name', 'toolName', 'tool_name', 'tool'] as const;
/** Peri ExecuteExtraTool 用 `params`；其它 agent 还可能用 arguments/input/extra。 */
const ARGUMENT_NESTED_KEYS = ['params', 'arguments', 'args', 'input', 'rawInput', 'extra'] as const;
const MAX_ARGUMENT_UNWRAP_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 对象或 JSON 字符串对象（Peri/ACP 偶发把 MCP 入参序列化成 string）。 */
function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseEffectiveMcpAppName(name: string): ParsedMcpAppToolName | null {
  if (!name.startsWith(MCP_PREFIX)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const split = rest.indexOf('__');
  if (split <= 0) return null;
  const serverId = rest.slice(0, split);
  const toolName = rest.slice(split + 2);
  if (!serverId || !toolName || serverId.includes('__')) return null;
  return { serverId, toolName };
}

/**
 * 从 ACP title/name 取出 effective 名。
 * Cursor 等 agent 常把工具写成 `execute extra tool \`mcp__server__tool\``，而不是裸 `mcp__*`。
 */
export function extractMcpAppEffectiveName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const backtick = trimmed.match(/`mcp__[^\s`]+`/);
  if (backtick) return backtick[0].slice(1, -1);
  const token = trimmed.match(/(?:^|[^A-Za-z0-9_])(mcp__[^\s`"'),\]}>]+)/);
  return token?.[1] ?? null;
}

/** 解析 MCP App 工具名；`serverId` 不得含 `__`。兼容 title 包装。 */
export function parseMcpAppToolName(name: string): ParsedMcpAppToolName | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const direct = parseEffectiveMcpAppName(trimmed);
  if (direct) return direct;
  const extracted = extractMcpAppEffectiveName(trimmed);
  return extracted ? parseEffectiveMcpAppName(extracted) : null;
}

function parseMcpAppToolFromArguments(args: unknown): ParsedMcpAppToolName | null {
  const record = parseJsonObject(args);
  if (!record) return null;
  for (const key of ARGUMENT_NAME_KEYS) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const parsed = parseMcpAppToolName(value);
    if (parsed) return parsed;
  }
  const serverId = typeof record.serverId === 'string'
    ? record.serverId
    : typeof record.server === 'string' ? record.server : '';
  const toolName = typeof record.toolName === 'string'
    ? record.toolName
    : typeof record.tool_name === 'string' ? record.tool_name : '';
  if (serverId && toolName && !serverId.includes('__')) return { serverId, toolName };
  return null;
}

/** 从 tool call 的 title/name 或调度信封参数解析 MCP App。 */
export function parseMcpAppToolFromCall(
  tool: Pick<ToolCallInfo, 'name'> & { arguments?: unknown },
): ParsedMcpAppToolName | null {
  if (tool.name) {
    const parsed = parseMcpAppToolName(tool.name);
    if (parsed) return parsed;
  }
  return parseMcpAppToolFromArguments(tool.arguments);
}

/** ACP 工具是否为 MCP App（含 Cursor extra-tool title 包装）。 */
export function isMcpAppTool(tool: Pick<ToolCallInfo, 'name'> & { arguments?: unknown }): boolean {
  return parseMcpAppToolFromCall(tool) !== null;
}

/** 同 identity 比较键：优先 effective MCP 名。 */
export function mcpAppCallIdentity(
  tool: Pick<ToolCallInfo, 'name' | 'toolCallId'> & { arguments?: unknown },
): string {
  const parsed = parseMcpAppToolFromCall(tool);
  if (parsed) return `mcp:${parsed.serverId}__${parsed.toolName}`;
  const name = tool.name?.trim();
  if (name) return `name:${name}`;
  return `id:${tool.toolCallId || ''}`;
}

function looksLikeCanvasTsx(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const hasDefaultExport = trimmed.includes('export default');
  const hasCanvasImport = trimmed.includes('peri/canvas') || trimmed.includes('cursor/canvas');
  return hasDefaultExport && (hasCanvasImport || trimmed.includes('function '));
}

function presentArgumentKeys(value: unknown): string[] {
  const record = parseJsonObject(value);
  if (record) return Object.keys(record).sort();
  if (typeof value === 'string') return ['<json-string>'];
  if (value == null) return [];
  return [`<${Array.isArray(value) ? 'array' : typeof value}>`];
}

function missingSourceError(raw: unknown): { ok: false; message: string; presentKeys: string[] } {
  const presentKeys = presentArgumentKeys(raw);
  const keys = presentKeys.length > 0 ? presentKeys.join(', ') : '(none)';
  return {
    ok: false,
    message: `Missing canvas source in tool arguments. Present keys: ${keys}.`,
    presentKeys,
  };
}

function shouldUnwrapExtraToolEnvelope(
  current: Record<string, unknown>,
  nested: Record<string, unknown>,
): boolean {
  const outerIsMcpTool = parseMcpAppToolFromArguments(current) !== null;
  const innerIsMcpTool = parseMcpAppToolFromArguments(nested) !== null;
  const innerHasSource = typeof nested.source === 'string';
  const innerHasNested = ARGUMENT_NESTED_KEYS.some((key) => parseJsonObject(nested[key]) !== null);
  const outerName = typeof current.name === 'string' ? current.name : '';
  const outerTitleIsWrappedMcp = extractMcpAppEffectiveName(outerName) !== null;
  return outerIsMcpTool || innerIsMcpTool || innerHasSource || innerHasNested || outerTitleIsWrappedMcp;
}

/** 递归去掉 extra-tool 调度信封，留下真正的 MCP 工具参数（含 Peri `tool_name`/`params`）。 */
export function unwrapMcpAppToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  let current = { ...args };
  for (let depth = 0; depth < MAX_ARGUMENT_UNWRAP_DEPTH; depth += 1) {
    const nestedKey = ARGUMENT_NESTED_KEYS.find((key) => parseJsonObject(current[key]) !== null);
    if (!nestedKey) break;
    const nested = parseJsonObject(current[nestedKey]);
    if (!nested || !shouldUnwrapExtraToolEnvelope(current, nested)) break;
    current = { ...nested };
  }
  return current;
}

function sourceFromValue(value: unknown, depth = 0): string {
  if (depth > MAX_ARGUMENT_UNWRAP_DEPTH) return '';
  if (typeof value === 'string') {
    const asObject = parseJsonObject(value);
    if (asObject) return sourceFromValue(asObject, depth + 1);
    return looksLikeCanvasTsx(value) ? value.trim() : '';
  }
  if (!isRecord(value)) return '';
  if (typeof value.source === 'string' && value.source.trim()) return value.source.trim();
  const structured = value.structuredContent;
  if (isRecord(structured) && typeof structured.source === 'string' && structured.source.trim()) {
    return structured.source.trim();
  }
  for (const key of ARGUMENT_NESTED_KEYS) {
    const found = sourceFromValue(value[key], depth + 1);
    if (found) return found;
  }
  if (Array.isArray(value.content)) {
    for (const block of value.content) {
      const found = sourceFromValue(block, depth + 1);
      if (found) return found;
      if (isRecord(block) && typeof block.text === 'string' && looksLikeCanvasTsx(block.text)) {
        return block.text.trim();
      }
    }
  }
  if (typeof value.text === 'string' && looksLikeCanvasTsx(value.text)) return value.text.trim();
  return '';
}

function argumentRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJsonObject(value);
  return parsed ? { ...parsed } : {};
}

/** 从历史 tool call 提取 Host 重跑参数；仅当入参真正缺失时返回英文错误文案。 */
export function validateMcpAppReopenArguments(
  parsed: ParsedMcpAppToolName,
  tool: Pick<ToolCallInfo, 'arguments' | 'argumentsOmitted' | 'content' | 'result' | 'name'>,
): { ok: true; arguments: Record<string, unknown> } | { ok: false; message: string; presentKeys: string[] } {
  const raw = argumentRecord(tool.arguments);
  const args = unwrapMcpAppToolArguments(raw);
  if (parsed.toolName !== 'show_canvas') {
    return { ok: true, arguments: args };
  }
  const source = sourceFromValue(args)
    || sourceFromValue(raw)
    || sourceFromValue(tool.content)
    || sourceFromValue(tool.result)
    || (typeof tool.name === 'string' && looksLikeCanvasTsx(tool.name) ? tool.name.trim() : '');
  if (!source) return missingSourceError(tool.arguments ?? raw);
  if (typeof args.source === 'string' && args.source.trim()) {
    return { ok: true, arguments: args };
  }
  return { ok: true, arguments: { ...args, source } };
}

/** canvas MCP 目录未列工具名时：已列出的 server 且工具数≥2 视为带 `show_canvas_demo`。 */
export function mcpServerHasShowCanvasDemo(
  serverId: string,
  servers: ReadonlyArray<{ name: string; toolsCount?: number }>,
): boolean {
  const server = servers.find((item) => item.name === serverId);
  return Boolean(server && (server.toolsCount ?? 0) >= 2);
}
