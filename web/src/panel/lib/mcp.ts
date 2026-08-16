// MCP 特性装配模块（P3 自 store.ts 拆出）。
//
// 封闭特性整体迁出：mcpServers/mcpOAuthEvents/mcpAuthorization/mcpLoading
// 信号 + 五个动作（refreshMcpServers..clearMcpAuthorization）+ mcpQueries
// 查询表 + onFrame 三个 mcp case，只被 McpPanel 消费。
//
// 依赖纪律：本模块不 import store.ts。运行时依赖（selectedCid/ready/
// sendAction/acknowledge）由 store 组合根通过 installMcp 注入；readOnly
// 直接取自 lib/auth-state（lib 模块之间可互相 import）。

import { createSignal } from 'solid-js';
import * as H from './protocol';
import { readOnly } from './auth-state';
import type { McpOAuthAuthorizationFrame, McpOAuthFrame, McpServerInfo } from './protocol';
import type { Ack, ActionFrame, ActionOptions } from './action-contract';

export const [mcpServers, setMcpServers] = createSignal<McpServerInfo[]>([]);
export const [mcpOAuthEvents, setMcpOAuthEvents] = createSignal<Record<string, McpOAuthFrame>>({});
export const [mcpAuthorization, setMcpAuthorization] = createSignal<McpOAuthAuthorizationFrame | null>(null);
export const [mcpLoading, setMcpLoading] = createSignal(false);

// 查询表：commandId → 查询意图，防止迟到的下行帧误落当前 UI 状态。
const mcpQueries = new Map<string, { kind: 'list' | 'authorization'; chatId: string; flowId?: string }>();

interface McpDeps {
  selectedCid: () => string | null;
  ready: () => boolean;
  sendAction: (frame: ActionFrame, label: string, options: ActionOptions) => boolean;
  acknowledge: (ack: Ack) => void;
}

let deps: McpDeps | null = null;

/** store 组合根装配入口：注入来自 store 的运行时依赖（须在使用前调用一次）。 */
export function installMcp(d: McpDeps): void {
  deps = d;
}

export function refreshMcpServers(): boolean {
  const chatId = deps!.selectedCid();
  if (!chatId || !deps!.ready()) return false;
  const frame = H.mcpList(chatId);
  mcpQueries.set(frame.commandId, { kind: 'list', chatId });
  setMcpLoading(true);
  const sent = deps!.sendAction(frame, 'Refresh MCP servers', {
    onTimeout: () => { mcpQueries.delete(frame.commandId); setMcpLoading(false); },
    onError: () => { mcpQueries.delete(frame.commandId); setMcpLoading(false); },
  });
  if (!sent) { mcpQueries.delete(frame.commandId); setMcpLoading(false); }
  return sent;
}

export function startMcpOAuth(serverName: string): boolean {
  const chatId = deps!.selectedCid();
  if (!chatId || !deps!.ready() || readOnly()) return false;
  setMcpAuthorization(null);
  return deps!.sendAction(H.mcpOAuthStart(chatId, serverName), 'Start MCP authorization', {
    cb: () => refreshMcpServers(),
  });
}

export function requestMcpAuthorization(flowId: string): boolean {
  const chatId = deps!.selectedCid();
  if (!chatId || !deps!.ready() || readOnly()) return false;
  const frame = H.mcpOAuthAuthorization(chatId, flowId);
  mcpQueries.set(frame.commandId, { kind: 'authorization', chatId, flowId });
  const sent = deps!.sendAction(frame, 'Fetch authorization URL', {
    onTimeout: () => mcpQueries.delete(frame.commandId),
    onError: () => mcpQueries.delete(frame.commandId),
  });
  if (!sent) mcpQueries.delete(frame.commandId);
  return sent;
}

export function cancelMcpOAuth(flowId: string): boolean {
  const chatId = deps!.selectedCid();
  if (!chatId || !deps!.ready() || readOnly()) return false;
  setMcpAuthorization(null);
  return deps!.sendAction(H.mcpOAuthCancel(chatId, flowId), 'Cancel MCP authorization', {
    cb: () => refreshMcpServers(),
  });
}

export function clearMcpAuthorization(): void { setMcpAuthorization(null); }

// ── onFrame 下行帧处理（store.onFrame 委托）──────────────────────────

export function handleMcpServers(frame: H.DownstreamFrame): void {
  const response = frame as unknown as H.McpServersFrame;
  const query = mcpQueries.get(response.commandId);
  if (!query || query.kind !== 'list' || query.chatId !== response.chatId || response.chatId !== deps!.selectedCid()) return;
  mcpQueries.delete(response.commandId);
  setMcpServers(response.servers);
  setMcpLoading(false);
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
}

export function handleMcpOAuth(frame: H.DownstreamFrame): void {
  const event = frame as unknown as McpOAuthFrame;
  if (event.chatId !== deps!.selectedCid()) return;
  setMcpOAuthEvents((events) => ({ ...events, [event.flowId]: event }));
  if (event.status !== 'authorization_needed' && mcpAuthorization()?.flowId === event.flowId) {
    setMcpAuthorization(null);
  }
}

export function handleMcpOAuthAuthorization(frame: H.DownstreamFrame): void {
  const response = frame as unknown as McpOAuthAuthorizationFrame;
  const query = mcpQueries.get(response.commandId);
  if (!query || query.kind !== 'authorization' || query.chatId !== response.chatId
    || query.flowId !== response.flowId || response.chatId !== deps!.selectedCid()) return;
  mcpQueries.delete(response.commandId);
  setMcpAuthorization(response);
  deps!.acknowledge({ commandId: response.commandId, status: 'committed' });
}

// ── 重置（selectChat / clearCurrentSelection / resetAuthenticatedSession）──

export function resetMcpState(): void {
  setMcpServers([]);
  setMcpOAuthEvents({});
  setMcpAuthorization(null);
  setMcpLoading(false);
  mcpQueries.clear();
}
