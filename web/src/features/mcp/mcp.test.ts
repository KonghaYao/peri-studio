// MCP 装配模块行为测试：帧归属校验、信号更新与重置语义。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelMcpOAuth,
  clearMcpAuthorization,
  handleMcpOAuth,
  handleMcpOAuthAuthorization,
  handleMcpServers,
  installMcp,
  mcpAuthorization,
  mcpLoading,
  mcpOAuthEvents,
  mcpServers,
  refreshMcpServers,
  requestMcpAuthorization,
  resetMcpState,
  setMcpAuthorization,
  setMcpLoading,
  setMcpOAuthEvents,
  setMcpServers,
  startMcpOAuth,
} from './mcp';
import { setPrincipalRole } from '@/features/auth/auth-state';

import type { ActionFrame, ActionOptions } from '@/shared/protocol/action-contract';

function installTestDeps(overrides: Partial<Parameters<typeof installMcp>[0]> = {}) {
  setPrincipalRole('full');
  let lastFrame: ActionFrame | null = null;
  const sendAction = vi.fn((frame: ActionFrame, _label: string, _options: ActionOptions) => {
    lastFrame = frame;
    return true;
  });
  const acknowledge = vi.fn((ack: { commandId?: string; status?: string }) => undefined);
  installMcp({
    selectedCid: () => 'chat-1',
    ready: () => true,
    sendAction,
    acknowledge,
    ...overrides,
  });
  return { sendAction, acknowledge, lastCommandId: () => lastFrame?.commandId ?? '' };
}

afterEach(() => {
  resetMcpState();
  setPrincipalRole(null);
});

describe('mcp frame routing', () => {
  it('mcp_servers applies only a matching current-chat query and acknowledges', () => {
    const { acknowledge, lastCommandId } = installTestDeps();
    refreshMcpServers();
    const commandId = lastCommandId();
    const servers = [{ name: 'github', transport: 'stdio', connectionStatus: 'disconnected', oauthStatus: 'needs_authorization', toolsCount: 0, resourcesCount: 0 }];
    handleMcpServers({ t: 'mcp_servers', commandId, chatId: 'chat-1', servers } as never);
    expect(mcpServers()).toEqual(servers);
    expect(mcpLoading()).toBe(false);
    expect(acknowledge).toHaveBeenCalledWith({ commandId, status: 'committed' });
  });

  it('mcp_servers ignores stale queries and other chats without dropping state', () => {
    const { acknowledge } = installTestDeps();
    setMcpServers([{ name: 'old', transport: 'stdio', connectionStatus: 'disconnected', oauthStatus: 'needs_authorization', toolsCount: 0, resourcesCount: 0 }]);
    // 未登记的 commandId / 不匹配的 chatId 一律忽略。
    handleMcpServers({ t: 'mcp_servers', commandId: 'unknown', chatId: 'chat-1', servers: [] } as never);
    handleMcpServers({ t: 'mcp_servers', commandId: 'command-1', chatId: 'chat-other', servers: [] } as never);
    expect(mcpServers().length).toBe(1);
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('mcp_oauth only accepts frames for the current chat and clears the grant on terminal status', () => {
    installTestDeps();
    const event = { chatId: 'chat-1', flowId: 'flow-1', serverName: 'github', status: 'authorization_needed', updatedAt: '2026-08-15T00:00:00Z' };
    handleMcpOAuth({ t: 'mcp_oauth', ...event } as never);
    expect(mcpOAuthEvents()['flow-1']).toMatchObject(event);
    handleMcpOAuth({ t: 'mcp_oauth', chatId: 'chat-other', flowId: 'flow-2', serverName: 'x', status: 'authorization_needed', updatedAt: 't' } as never);
    expect(mcpOAuthEvents()['flow-2']).toBeUndefined();

    setMcpAuthorization({ commandId: 'c', chatId: 'chat-1', flowId: 'flow-1', authorizationUrl: 'https://example.test/oauth', expiresAt: 't' });
    handleMcpOAuth({ t: 'mcp_oauth', ...event, status: 'succeeded' } as never);
    expect(mcpAuthorization()).toBeNull();
  });

  it('mcp_oauth_authorization requires an exact flow-bound query for the current chat', () => {
    const { acknowledge, lastCommandId } = installTestDeps();
    requestMcpAuthorization('flow-1');
    const commandId = lastCommandId();
    handleMcpOAuthAuthorization({ t: 'mcp_oauth_authorization', commandId, chatId: 'chat-1', flowId: 'flow-1', authorizationUrl: 'https://example.test/oauth?state=opaque', expiresAt: 't' } as never);
    expect(mcpAuthorization()?.authorizationUrl).toContain('state=opaque');
    expect(acknowledge).toHaveBeenCalledWith({ commandId, status: 'committed' });
    // 流不匹配的响应不能落位。
    resetMcpState();
    requestMcpAuthorization('flow-1');
    const nextCommandId = lastCommandId();
    handleMcpOAuthAuthorization({ t: 'mcp_oauth_authorization', commandId: nextCommandId, chatId: 'chat-1', flowId: 'flow-2', authorizationUrl: 'https://example.test/wrong', expiresAt: 't' } as never);
    expect(mcpAuthorization()).toBeNull();
  });

  it('read-only principals cannot start, request or cancel authorization', () => {
    const { sendAction } = installTestDeps();
    setPrincipalRole('read-only');
    expect(startMcpOAuth('github')).toBe(false);
    expect(requestMcpAuthorization('flow-1')).toBe(false);
    expect(cancelMcpOAuth('flow-1')).toBe(false);
    expect(sendAction).not.toHaveBeenCalled();
  });
});

describe('mcp reset semantics', () => {
  it('resetMcpState clears every signal and query table', () => {
    installTestDeps();
    setMcpServers([{ name: 'x', transport: 'stdio', connectionStatus: 'disconnected', oauthStatus: 'needs_authorization', toolsCount: 0, resourcesCount: 0 }]);
    setMcpOAuthEvents({ 'flow-1': { chatId: 'chat-1', flowId: 'flow-1', serverName: 'x', status: 'authorization_needed', updatedAt: 't' } });
    setMcpAuthorization({ commandId: 'c', chatId: 'chat-1', flowId: 'flow-1', authorizationUrl: 'u', expiresAt: 't' });
    setMcpLoading(true);
    resetMcpState();
    expect(mcpServers()).toEqual([]);
    expect(mcpOAuthEvents()).toEqual({});
    expect(mcpAuthorization()).toBeNull();
    expect(mcpLoading()).toBe(false);
  });

  it('clearMcpAuthorization only clears the authorization frame', () => {
    installTestDeps();
    setMcpAuthorization({ commandId: 'c', chatId: 'chat-1', flowId: 'flow-1', authorizationUrl: 'u', expiresAt: 't' });
    clearMcpAuthorization();
    expect(mcpAuthorization()).toBeNull();
  });
});
