// MCP Apps 特性装配（对标 lib/mcp.ts）：查询表、瞬时帧、live session 生命周期。
// 不 import store.ts；依赖由 store 通过 installMcpApps 注入。
// Host / iframe 壳层见 @peri/ui `mcp-app` 模块。

import { createSignal } from 'solid-js';
import {
  MCP_APP_DEFAULT_HEIGHT,
  MCP_APP_MAX_HEIGHT,
  MCP_APP_MAX_WIDTH,
  MCP_APPS_PROTOCOL,
  MCP_APP_HOST_VERSION,
  mcpAppInlineMaxHeight,
  asCallToolResult,
  asToolInputParams,
  describeMcpAppPayload,
  mcpUiInitializeResult,
  type McpAppHostSessionView,
} from '@peri/ui';
import * as H from '@/shared/protocol/client';
import { readOnly } from '@/features/auth/auth-state';
import type {
  McpAppCallResultFrame,
  McpAppResourceFrame,
  McpAppSessionFrame,
} from '@/shared/protocol/client';
import type { Ack, ActionError, ActionFrame, ActionOptions } from '@/shared/protocol/action-contract';
import type { ToolCallInfo } from '@/entities/chat/chat-view';
import { mcpServers } from '@/features/mcp/mcp';
import { persistActionProblem } from '@/features/message/panel-errors';
import {
  isMcpAppTool,
  mcpAppCallIdentity,
  parseMcpAppToolFromCall,
  parseMcpAppToolName,
  mcpServerHasShowCanvasDemo,
  unwrapMcpAppToolArguments,
  validateMcpAppReopenArguments,
} from '@/features/mcp/mcp-app-tool';

export interface LiveMcpAppSession extends McpAppHostSessionView {
  chatId: string;
  serverId: string;
  resourceUri: string;
  mimeType: string | null;
}

export {
  MCP_APP_DEFAULT_HEIGHT,
  MCP_APP_MAX_HEIGHT,
  MCP_APP_MAX_WIDTH,
  MCP_APPS_PROTOCOL,
  MCP_APP_HOST_VERSION,
  mcpAppInlineMaxHeight,
  asCallToolResult,
  asToolInputParams,
  describeMcpAppPayload,
  mcpUiInitializeResult,
};

const mcpAppsQueries = new Map<string, {
  kind: 'open' | 'resource' | 'call' | 'invoke';
  chatId: string;
  toolCallId?: string;
  sourceToolCallId?: string;
  appSessionId?: string;
}>();
const [liveApps, setLiveApps] = createSignal<Record<string, LiveMcpAppSession>>({});
const [appHeights, setAppHeights] = createSignal<Record<string, number>>({});
const [reopenPendingBySource, setReopenPendingBySource] = createSignal<Record<string, boolean>>({});
const reopenTargets = new Map<string, string>();
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
  currentCid?: () => string | null;
  ready: () => boolean;
  sendAction: (frame: ActionFrame, label: string, options: ActionOptions) => boolean;
  acknowledge: (ack: Ack) => void;
  refreshMcpServers?: () => boolean;
}

let deps: McpAppsDeps | null = null;
let mcpServersRefreshQueued = false;

export function installMcpApps(d: McpAppsDeps): void {
  deps = d;
}

function resolveMcpAppChatId(chatId?: string | null): string | null {
  const explicit = chatId?.trim();
  if (explicit) return explicit;
  return deps?.selectedCid() || deps?.currentCid?.() || null;
}

function isActiveMcpAppChat(chatId: string): boolean {
  const active = resolveMcpAppChatId();
  return !!active && active === chatId;
}

function mcpAppServerConnected(serverId: string): boolean {
  const servers = mcpServers();
  if (!servers.length) return false;
  return servers.some((server) => server.name === serverId && server.connectionStatus === 'connected');
}

/** MCP server 已连接且工具所属 server 在列表中时，才尝试 open（避免 restore 时 MCP 尚未注册就占住重试槽）。 */
export function isMcpAppServerConnected(
  toolOrName: string | (Pick<ToolCallInfo, 'name'> & { arguments?: unknown }),
): boolean {
  const parsed = typeof toolOrName === 'string'
    ? parseMcpAppToolName(toolOrName)
    : parseMcpAppToolFromCall(toolOrName);
  if (!parsed) return false;
  return mcpAppServerConnected(parsed.serverId);
}

export function isMcpAppReopenPending(sourceToolCallId: string): boolean {
  return Boolean(sourceToolCallId && reopenPendingBySource()[sourceToolCallId]);
}

/** 历史卡 Reopen 是否应禁用：仅只读、进行中、或缺少重开所需身份。 */
export function isMcpAppReopenDisabled(
  tool: Pick<ToolCallInfo, 'name' | 'toolCallId' | 'arguments'>,
  chatId: string | null | undefined,
  options: { readOnly?: boolean; reopenPending?: boolean } = {},
): boolean {
  if (options.readOnly || options.reopenPending) return true;
  const resolvedChatId = chatId?.trim() || resolveMcpAppChatId();
  if (!resolvedChatId) return true;
  const sourceToolCallId = tool.toolCallId || '';
  if (!sourceToolCallId) return true;
  return !parseMcpAppToolFromCall(tool);
}

function setReopenPending(sourceToolCallId: string, pending: boolean): void {
  if (!sourceToolCallId) return;
  setReopenPendingBySource((current) => {
    if (!pending) {
      if (!(sourceToolCallId in current)) return current;
      const next = { ...current };
      delete next[sourceToolCallId];
      return next;
    }
    return { ...current, [sourceToolCallId]: true };
  });
}

function queueMcpServersRefresh(): void {
  if (mcpServersRefreshQueued || !deps?.selectedCid() || !deps.ready() || !deps.refreshMcpServers) return;
  if (mcpServers().length > 0) return;
  mcpServersRefreshQueued = true;
  deps.refreshMcpServers();
  queueMicrotask(() => { mcpServersRefreshQueued = false; });
}

function hasActiveMcpAppOpenAttempt(toolCallId: string): boolean {
  return Boolean(toolCallId && liveApps()[toolCallId]);
}

/** open 已发出但 HTML 尚未到达（仍展示 ToolCallActivity，不切历史卡）。 */
export function mcpAppOpenInProgress(toolCallId: string): boolean {
  if (!toolCallId) return false;
  const session = liveApps()[toolCallId];
  return Boolean(session && !session.html);
}

function abandonMcpAppOpen(toolCallId: string): void {
  if (!toolCallId) return;
  setLiveApps((apps) => {
    const current = apps[toolCallId];
    if (!current || current.html || current.appSessionId) return apps;
    const next = { ...apps };
    delete next[toolCallId];
    return next;
  });
  setAppHeights((heights) => {
    if (!(toolCallId in heights)) return heights;
    const next = { ...heights };
    delete next[toolCallId];
    return next;
  });
}

function isCompletedMcpAppTool(tool: ToolCallInfo): boolean {
  if (!isMcpAppTool(tool)) return false;
  const status = (tool.status || '').toLowerCase();
  if (status === 'failed' || status === 'error') return false;
  return status === 'completed';
}

export function resetMcpAppsState(): void {
  for (const commandId of [...pendingAppCalls.keys()]) {
    failPendingCall(commandId, new Error('MCP App session reset'));
  }
  setLiveApps({});
  setAppHeights({});
  setReopenPendingBySource({});
  reopenTargets.clear();
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
  return mcpAppCallIdentity(tool);
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

function mcpAppToolInput(argumentsValue: unknown): unknown {
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
    return argumentsValue;
  }
  return unwrapMcpAppToolArguments({ ...(argumentsValue as Record<string, unknown>) });
}

export function maybeOpenCompletedMcpTool(
  tool: ToolCallInfo,
  origin: 'live' | 'replay' | null | undefined,
  chatId?: string | null,
): void {
  const resolvedChatId = resolveMcpAppChatId(chatId);
  const toolCallId = tool.toolCallId || '';
  if (!resolvedChatId || !deps?.ready() || readOnly() || !toolCallId) return;
  if (origin === 'replay') return;
  if (!isCompletedMcpAppTool(tool)) return;
  if (hasActiveMcpAppOpenAttempt(toolCallId)) return;
  if (!isMcpAppServerConnected(tool)) {
    queueMcpServersRefresh();
    return;
  }
  openMcpApp(resolvedChatId, toolCallId, mcpAppToolInput(tool.arguments), tool.result);
}

function reopenInvokeErrorMessage(message: string | undefined): string {
  switch (message) {
    case 'unsupported':
      return 'This Peri agent does not support reopening MCP Apps yet. Upgrade Peri to a version with peri/mcp/invoke.';
    case 'capability_disabled':
      return 'MCP Apps are disabled on this agent. Ensure PERI_MCP_APPS is set when the agent starts.';
    case 'policy_denied':
      return 'The agent rejected the MCP App reopen request.';
    case 'stale_session':
      return 'The chat session changed before the MCP App could reopen. Try again.';
    case 'agent_unavailable':
      return 'The agent is not available. Check that the session is running and try again.';
    default:
      return 'Could not reopen the MCP App.';
  }
}

export function reopenMcpApp(tool: ToolCallInfo, chatId?: string | null): boolean {
  const resolvedChatId = resolveMcpAppChatId(chatId);
  const sourceToolCallId = tool.toolCallId || '';
  if (!resolvedChatId || !deps?.ready() || readOnly() || !sourceToolCallId) return false;
  if (isMcpAppReopenPending(sourceToolCallId)) return false;
  if (!mcpServers().length) queueMcpServersRefresh();
  const parsed = parseMcpAppToolFromCall(tool);
  if (!parsed) return false;
  const args = validateMcpAppReopenArguments(parsed, tool);
  let toolName = parsed.toolName;
  let invokeArguments: Record<string, unknown> | null = args.ok ? args.arguments : null;
  // 历史入参已被省略且无法从 content/result 还原时，仅当目录里能证明有 demo 才回退。
  if (!invokeArguments && parsed.toolName === 'show_canvas' && mcpServerHasShowCanvasDemo(parsed.serverId, mcpServers())) {
    toolName = 'show_canvas_demo';
    invokeArguments = {};
  }
  if (!invokeArguments) {
    persistActionProblem(
      'Could not reopen MCP App',
      args.ok ? 'Could not reopen the MCP App.' : 'Missing canvas source in tool arguments.',
    );
    return false;
  }
  const frame = H.mcpAppInvoke(resolvedChatId, sourceToolCallId, parsed.serverId, toolName, invokeArguments);
  mcpAppsQueries.set(frame.commandId, {
    kind: 'invoke',
    chatId: resolvedChatId,
    sourceToolCallId,
  });
  setReopenPending(sourceToolCallId, true);
  const sent = deps.sendAction(frame, 'Reopen MCP App', {
    onTimeout: () => {
      mcpAppsQueries.delete(frame.commandId);
      setReopenPending(sourceToolCallId, false);
    },
    onError: () => {
      mcpAppsQueries.delete(frame.commandId);
      setReopenPending(sourceToolCallId, false);
    },
  });
  if (!sent) {
    mcpAppsQueries.delete(frame.commandId);
    setReopenPending(sourceToolCallId, false);
  }
  return sent;
}

export function openMcpApp(chatId: string, toolCallId: string, toolInput: unknown, toolResult: unknown): boolean {
  if (!deps?.ready() || readOnly()) return false;
  const frame = H.mcpAppOpen(chatId, toolCallId);
  mcpAppsQueries.set(frame.commandId, { kind: 'open', chatId, toolCallId });
  const sent = deps.sendAction(frame, 'Open MCP App', {
    onTimeout: () => {
      mcpAppsQueries.delete(frame.commandId);
      abandonMcpAppOpen(toolCallId);
    },
    onError: () => {
      mcpAppsQueries.delete(frame.commandId);
      abandonMcpAppOpen(toolCallId);
    },
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

export function setMcpAppHeight(toolCallId: string, height: number): void {
  const maxHeight = mcpAppInlineMaxHeight();
  setAppHeights((heights) => ({
    ...heights,
    [toolCallId]: Math.min(Math.max(height, 120), maxHeight),
  }));
}

export function handleMcpAppSession(frame: H.DownstreamFrame): void {
  const response = frame as unknown as McpAppSessionFrame;
  const query = mcpAppsQueries.get(response.commandId);
  if (!query || query.kind !== 'open' || query.chatId !== response.chatId || !isActiveMcpAppChat(response.chatId)) return;
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
  if (!query || query.kind !== 'resource' || query.chatId !== response.chatId || !isActiveMcpAppChat(response.chatId)) {
    console.warn('[mcp-apps] resource ignored', {
      commandId: response.commandId,
      frameChatId: response.chatId,
      activeChatId: resolveMcpAppChatId(),
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
  const silent = new Set([
    'capability_disabled',
    'policy_denied',
    'tool_not_app_visible',
    'unsupported',
    'stale_session',
  ]);
  return silent.has(err.message || '') || mcpAppsQueries.has(err.commandId || '');
}

/** silent MCP App open 失败；invoke 显式点击失败走全局 Notification（一次）。 */
export function handleMcpAppsActionError(err: ActionError): boolean {
  const query = mcpAppsQueries.get(err.commandId || '');
  if (query?.kind === 'invoke') {
    mcpAppsQueries.delete(err.commandId || '');
    if (query.sourceToolCallId) setReopenPending(query.sourceToolCallId, false);
    persistActionProblem(
      'Could not reopen MCP App',
      reopenInvokeErrorMessage(err.message),
    );
    return true;
  }
  if (!ownsMcpAppsError(err)) return false;
  if (query?.kind === 'open' && query.toolCallId) {
    mcpAppsQueries.delete(err.commandId || '');
    abandonMcpAppOpen(query.toolCallId);
  }
  return true;
}

export function handleMcpAppInvoke(frame: H.DownstreamFrame): void {
  const response = frame as unknown as H.McpAppInvokeFrame;
  const query = mcpAppsQueries.get(response.commandId);
  if (!query || query.kind !== 'invoke' || query.chatId !== response.chatId || !isActiveMcpAppChat(response.chatId)) {
    return;
  }
  mcpAppsQueries.delete(response.commandId);
  if (query.sourceToolCallId) {
    setReopenPending(query.sourceToolCallId, false);
    reopenTargets.set(query.sourceToolCallId, response.toolCallId);
  }
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
}

export function handleMcpAppCallResult(frame: H.DownstreamFrame): void {
  const response = frame as unknown as McpAppCallResultFrame;
  const query = mcpAppsQueries.get(response.commandId);
  if (!query || query.kind !== 'call' || query.chatId !== response.chatId || !isActiveMcpAppChat(response.chatId)) return;
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
