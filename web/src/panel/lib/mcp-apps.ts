// MCP Apps 特性装配（对标 lib/mcp.ts）：查询表、瞬时帧、live session 生命周期。
// 不 import store.ts；依赖由 store 通过 installMcpApps 注入。

import { createSignal } from 'solid-js';
import * as H from '@/shared/protocol/client';
import { readOnly } from './auth-state';
import type {
  McpAppCallResultFrame,
  McpAppResourceFrame,
  McpAppSessionFrame,
} from '@/shared/protocol/client';
import type { Ack, ActionError, ActionFrame, ActionOptions } from './action-contract';
import type { ToolCallInfo } from '@/entities/chat/chat-view';

export interface LiveMcpAppSession {
  chatId: string;
  toolCallId: string;
  appSessionId: string;
  serverId: string;
  resourceUri: string;
  html: string | null;
  mimeType: string | null;
  csp: string | null;
  toolInput: unknown;
  toolResult: unknown;
}

const mcpAppsQueries = new Map<string, { kind: 'open' | 'resource' | 'call'; chatId: string; toolCallId?: string; appSessionId?: string }>();
const [liveApps, setLiveApps] = createSignal<Record<string, LiveMcpAppSession>>({});
const [appHeights, setAppHeights] = createSignal<Record<string, number>>({});
const pendingAppCalls = new Map<string, {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}>();

function failPendingCall(commandId: string, error: Error): void {
  const pending = pendingAppCalls.get(commandId);
  if (!pending) return;
  pendingAppCalls.delete(commandId);
  pending.reject(error);
}

interface McpAppsDeps {
  selectedCid: () => string | null;
  ready: () => boolean;
  sendAction: (frame: ActionFrame, label: string, options: ActionOptions) => boolean;
  acknowledge: (ack: Ack) => void;
}

let deps: McpAppsDeps | null = null;

export function installMcpApps(d: McpAppsDeps): void {
  deps = d;
}

export function resetMcpAppsState(): void {
  for (const commandId of [...pendingAppCalls.keys()]) {
    failPendingCall(commandId, new Error('MCP App session reset'));
  }
  setLiveApps({});
  setAppHeights({});
  mcpAppsQueries.clear();
}

export function tearDownMcpAppsForChat(chatId: string | null): void {
  if (!chatId) {
    resetMcpAppsState();
    return;
  }
  const removed: string[] = [];
  setLiveApps((current) => {
    const next = { ...current };
    for (const [toolCallId, session] of Object.entries(current)) {
      if (session.chatId === chatId) {
        delete next[toolCallId];
        removed.push(toolCallId);
      }
    }
    return next;
  });
  setAppHeights((heights) => {
    const next = { ...heights };
    for (const toolCallId of removed) delete next[toolCallId];
    return next;
  });
  for (const [commandId, query] of mcpAppsQueries.entries()) {
    if (query.chatId === chatId) {
      mcpAppsQueries.delete(commandId);
      failPendingCall(commandId, new Error('MCP App session torn down'));
    }
  }
}

export function liveMcpApp(toolCallId: string): LiveMcpAppSession | null {
  return liveApps()[toolCallId] ?? null;
}

export function liveMcpAppHeight(toolCallId: string): number {
  return appHeights()[toolCallId] ?? MCP_APP_DEFAULT_HEIGHT;
}

/** 同一 resourceUri（或同名 MCP 工具）只展示最新一份 live iframe。 */
export function mcpAppIdentity(
  tool: Pick<ToolCallInfo, 'name' | 'toolCallId'>,
  session: LiveMcpAppSession | null,
): string {
  const uri = session?.resourceUri?.trim();
  if (uri) return `uri:${uri}`;
  const name = tool.name?.trim();
  if (name) return `name:${name}`;
  return `id:${tool.toolCallId || ''}`;
}

export function isPrimaryLiveMcpApp(
  toolCallId: string,
  tools: ReadonlyArray<Pick<ToolCallInfo, 'name' | 'toolCallId'>> = [],
): boolean {
  if (!toolCallId) return false;
  const session = liveMcpApp(toolCallId);
  if (!session?.html) return false;
  const uri = session.resourceUri.trim();
  if (uri) {
    let latest = '';
    for (const [id, live] of Object.entries(liveApps())) {
      if (live.chatId !== session.chatId || !live.html) continue;
      if (live.resourceUri.trim() === uri) latest = id;
    }
    return latest === toolCallId;
  }
  const self = tools.find((tool) => (tool.toolCallId || '') === toolCallId);
  const key = mcpAppIdentity(self ?? { name: null, toolCallId }, session);
  let latest = '';
  for (const tool of tools) {
    const id = tool.toolCallId || '';
    const live = liveMcpApp(id);
    if (!live?.html) continue;
    if (mcpAppIdentity(tool, live) === key) latest = id;
  }
  return latest === toolCallId;
}

export function sandboxOrigin(): string {
  const port = Number(import.meta.env.VITE_SANDBOX_PORT || (Number(location.port || 8456) + 1));
  return `${location.protocol}//${location.hostname}:${port}`;
}

export function maybeOpenCompletedMcpTool(tool: ToolCallInfo, origin: 'live' | 'replay' | null | undefined): void {
  const chatId = deps?.selectedCid();
  if (!chatId || !deps?.ready() || readOnly() || origin === 'replay') return;
  if ((tool.status || '').toLowerCase() !== 'completed') return;
  if (!tool.name?.startsWith('mcp__')) return;
  if (liveApps()[tool.toolCallId || '']) return;
  openMcpApp(chatId, tool.toolCallId || '', tool.arguments, tool.result);
}

export function openMcpApp(chatId: string, toolCallId: string, toolInput: unknown, toolResult: unknown): boolean {
  if (!deps?.ready() || readOnly()) return false;
  const frame = H.mcpAppOpen(chatId, toolCallId);
  mcpAppsQueries.set(frame.commandId, { kind: 'open', chatId, toolCallId });
  const sent = deps.sendAction(frame, 'Open MCP App', {
    onTimeout: () => mcpAppsQueries.delete(frame.commandId),
    onError: () => mcpAppsQueries.delete(frame.commandId),
  });
  if (!sent) mcpAppsQueries.delete(frame.commandId);
  else {
    console.info('[mcp-apps] open', {
      chatId,
      toolCallId,
      snapshot: describeMcpAppPayload(toolResult),
    });
    setLiveApps((apps) => ({
      ...apps,
      [toolCallId]: {
        chatId,
        toolCallId,
        appSessionId: '',
        serverId: '',
        resourceUri: '',
        html: null,
        mimeType: null,
        csp: null,
        toolInput,
        toolResult,
      },
    }));
    setAppHeights((heights) => ({ ...heights, [toolCallId]: MCP_APP_DEFAULT_HEIGHT }));
  }
  return sent;
}

export function requestMcpAppResource(appSessionId: string): boolean {
  const chatId = deps?.selectedCid();
  if (!chatId || !deps?.ready() || readOnly()) return false;
  const frame = H.mcpAppResource(chatId, appSessionId);
  mcpAppsQueries.set(frame.commandId, { kind: 'resource', chatId, appSessionId });
  const sent = deps.sendAction(frame, 'Fetch MCP App HTML', {
    onTimeout: () => mcpAppsQueries.delete(frame.commandId),
    onError: () => mcpAppsQueries.delete(frame.commandId),
  });
  if (!sent) mcpAppsQueries.delete(frame.commandId);
  return sent;
}

export function callMcpAppTool(
  appSessionId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const chatId = deps?.selectedCid();
  if (!chatId || !deps?.ready() || readOnly()) {
    return Promise.reject(new Error('MCP App tool call unavailable'));
  }
  const frame = H.mcpAppCall(chatId, appSessionId, payload);
  mcpAppsQueries.set(frame.commandId, { kind: 'call', chatId, appSessionId });
  const sent = deps.sendAction(frame, 'MCP App tool call', {
    onTimeout: () => {
      mcpAppsQueries.delete(frame.commandId);
      failPendingCall(frame.commandId, new Error('MCP App tool call timed out'));
    },
    onError: (err) => {
      mcpAppsQueries.delete(frame.commandId);
      failPendingCall(frame.commandId, new Error(err.message || 'MCP App tool call failed'));
    },
  });
  if (!sent) {
    mcpAppsQueries.delete(frame.commandId);
    return Promise.reject(new Error('MCP App tool call not sent'));
  }
  return new Promise((resolve, reject) => {
    pendingAppCalls.set(frame.commandId, { resolve, reject });
  });
}

export const MCP_APPS_PROTOCOL = '2026-01-26';
export const MCP_APP_DEFAULT_HEIGHT = 400;
export const MCP_APP_MAX_HEIGHT = 720;
export const MCP_APP_MAX_WIDTH = 720;
export const MCP_APP_HOST_VERSION = '0.2.0';

export function mcpAppInlineMaxHeight(): number {
  if (typeof window === 'undefined') return MCP_APP_MAX_HEIGHT;
  return Math.min(MCP_APP_MAX_HEIGHT, Math.max(MCP_APP_DEFAULT_HEIGHT, Math.round(window.innerHeight * 0.7)));
}

/** 官方 App Bridge 的 `McpUiInitializeResult`：hostInfo.version 与 hostCapabilities 必填。 */
export function mcpUiInitializeResult(theme: 'light' | 'dark'): Record<string, unknown> {
  return {
    protocolVersion: MCP_APPS_PROTOCOL,
    hostInfo: { name: 'peri-studio', version: MCP_APP_HOST_VERSION },
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

export function setMcpAppHeight(toolCallId: string, height: number): void {
  const maxHeight = mcpAppInlineMaxHeight();
  setAppHeights((heights) => ({
    ...heights,
    [toolCallId]: Math.min(Math.max(height, 120), maxHeight),
  }));
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

export function handleMcpAppSession(frame: H.DownstreamFrame): void {
  const response = frame as unknown as McpAppSessionFrame;
  const query = mcpAppsQueries.get(response.commandId);
  if (!query || query.kind !== 'open' || query.chatId !== response.chatId || response.chatId !== deps!.selectedCid()) return;
  mcpAppsQueries.delete(response.commandId);
  setLiveApps((apps) => {
    const current = apps[response.toolCallId];
    if (!current) return apps;
    return {
      ...apps,
      [response.toolCallId]: {
        ...current,
        appSessionId: response.appSessionId,
        serverId: response.serverId,
        resourceUri: response.resourceUri,
      },
    };
  });
  requestMcpAppResource(response.appSessionId);
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
}

export function handleMcpAppResource(frame: H.DownstreamFrame): void {
  const response = frame as unknown as McpAppResourceFrame;
  const query = mcpAppsQueries.get(response.commandId);
  if (!query || query.kind !== 'resource' || query.chatId !== response.chatId || response.chatId !== deps!.selectedCid()) {
    console.warn('[mcp-apps] resource ignored', {
      commandId: response.commandId,
      frameChatId: response.chatId,
      selectedChatId: deps?.selectedCid() ?? null,
      queryKind: query?.kind ?? null,
    });
    return;
  }
  mcpAppsQueries.delete(response.commandId);
  setLiveApps((apps) => {
    const entry = Object.entries(apps).find(([, session]) => session.appSessionId === response.appSessionId);
    if (!entry) {
      console.warn('[mcp-apps] resource has no live session', { appSessionId: response.appSessionId });
      return apps;
    }
    const [toolCallId, session] = entry;
    const toolResult = response.toolResult ?? session.toolResult;
    console.info('[mcp-apps] resource', {
      toolCallId,
      appSessionId: response.appSessionId,
      htmlChars: response.html.length,
      usedEphemeralToolResult: response.toolResult != null,
      toolResult: describeMcpAppPayload(toolResult),
    });
    return {
      ...apps,
      [toolCallId]: {
        ...session,
        html: response.html,
        mimeType: response.mimeType,
        csp: response.csp ?? null,
        toolResult,
      },
    };
  });
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
}

export function ownsMcpAppsError(err: ActionError): boolean {
  const silent = new Set(['capability_disabled', 'policy_denied', 'unsupported', 'stale_session']);
  return silent.has(err.message || '') || mcpAppsQueries.has(err.commandId || '');
}

export function handleMcpAppCallResult(frame: H.DownstreamFrame): void {
  const response = frame as unknown as McpAppCallResultFrame;
  const query = mcpAppsQueries.get(response.commandId);
  if (!query || query.kind !== 'call' || query.chatId !== response.chatId || response.chatId !== deps!.selectedCid()) return;
  mcpAppsQueries.delete(response.commandId);
  const pending = pendingAppCalls.get(response.commandId);
  pendingAppCalls.delete(response.commandId);
  const payload = response.result;
  if (pending && payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const rpc = payload as Record<string, unknown>;
    if (rpc.error !== undefined) {
      pending.reject(new Error('MCP App tool call returned error'));
    } else if (rpc.result && typeof rpc.result === 'object' && !Array.isArray(rpc.result)) {
      pending.resolve(rpc.result as Record<string, unknown>);
    } else {
      pending.resolve({ content: [] });
    }
  } else {
    pending?.reject(new Error('MCP App tool call result missing'));
  }
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
}
