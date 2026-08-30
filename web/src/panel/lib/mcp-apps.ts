// MCP Apps 特性装配（对标 lib/mcp.ts）：查询表、瞬时帧、live session 生命周期。
// 不 import store.ts；依赖由 store 通过 installMcpApps 注入。

import { createSignal } from 'solid-js';
import * as H from './protocol';
import { readOnly } from './auth-state';
import type {
  McpAppCallResultFrame,
  McpAppResourceFrame,
  McpAppSessionFrame,
} from './protocol';
import type { Ack, ActionError, ActionFrame, ActionOptions } from './action-contract';
import type { ToolCallInfo } from './chat-view';

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
  height: number;
}

const mcpAppsQueries = new Map<string, { kind: 'open' | 'resource' | 'call'; chatId: string; toolCallId?: string; appSessionId?: string }>();
const [liveApps, setLiveApps] = createSignal<Record<string, LiveMcpAppSession>>({});

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
  setLiveApps({});
  mcpAppsQueries.clear();
}

export function tearDownMcpAppsForChat(chatId: string | null): void {
  if (!chatId) {
    resetMcpAppsState();
    return;
  }
  setLiveApps((current) => {
    const next = { ...current };
    for (const [toolCallId, session] of Object.entries(current)) {
      if (session.chatId === chatId) delete next[toolCallId];
    }
    return next;
  });
  for (const [commandId, query] of mcpAppsQueries.entries()) {
    if (query.chatId === chatId) mcpAppsQueries.delete(commandId);
  }
}

export function liveMcpApp(toolCallId: string): LiveMcpAppSession | null {
  return liveApps()[toolCallId] ?? null;
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
        height: 240,
      },
    }));
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

export function callMcpAppTool(appSessionId: string, payload: Record<string, unknown>): boolean {
  const chatId = deps?.selectedCid();
  if (!chatId || !deps?.ready() || readOnly()) return false;
  const frame = H.mcpAppCall(chatId, appSessionId, payload);
  mcpAppsQueries.set(frame.commandId, { kind: 'call', chatId, appSessionId });
  return deps.sendAction(frame, 'MCP App tool call', {
    onTimeout: () => mcpAppsQueries.delete(frame.commandId),
    onError: () => mcpAppsQueries.delete(frame.commandId),
  });
}

export function setMcpAppHeight(toolCallId: string, height: number): void {
  const maxHeight = 480;
  setLiveApps((apps) => {
    const current = apps[toolCallId];
    if (!current) return apps;
    return { ...apps, [toolCallId]: { ...current, height: Math.min(Math.max(height, 120), maxHeight) } };
  });
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
  if (!query || query.kind !== 'resource' || query.chatId !== response.chatId || response.chatId !== deps!.selectedCid()) return;
  mcpAppsQueries.delete(response.commandId);
  setLiveApps((apps) => {
    const entry = Object.entries(apps).find(([, session]) => session.appSessionId === response.appSessionId);
    if (!entry) return apps;
    const [toolCallId, session] = entry;
    return {
      ...apps,
      [toolCallId]: {
        ...session,
        html: response.html,
        mimeType: response.mimeType,
        csp: response.csp ?? null,
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
  window.dispatchEvent(new CustomEvent('peri-mcp-app-call-result', { detail: response }));
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
}
