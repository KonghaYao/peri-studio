// MCP Apps 装配模块行为测试：帧归属、read-only 门控与 silent error 分类。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callMcpAppTool,
  handleMcpAppCallResult,
  handleMcpAppResource,
  handleMcpAppSession,
  installMcpApps,
  liveMcpApp,
  maybeOpenCompletedMcpTool,
  openMcpApp,
  ownsMcpAppsError,
  resetMcpAppsState,
  tearDownMcpAppsForChat,
} from './mcp-apps';
import { setPrincipalRole } from './auth-state';
import type { ActionFrame, ActionOptions } from './action-contract';

import type { ToolCallInfo } from './chat-view';

function minimalTool(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return {
    toolCallId: null,
    name: null,
    status: null,
    arguments: null,
    result: null,
    resultOmitted: null,
    resultBytes: null,
    publicError: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function installTestDeps(overrides: Partial<Parameters<typeof installMcpApps>[0]> = {}) {
  setPrincipalRole('full');
  let lastFrame: ActionFrame | null = null;
  const sendAction = vi.fn((frame: ActionFrame, _label: string, _options: ActionOptions) => {
    lastFrame = frame;
    return true;
  });
  const acknowledge = vi.fn(() => undefined);
  installMcpApps({
    selectedCid: () => 'chat-1',
    ready: () => true,
    sendAction,
    acknowledge,
    ...overrides,
  });
  return { sendAction, acknowledge, lastCommandId: () => lastFrame?.commandId ?? '' };
}

afterEach(() => {
  resetMcpAppsState();
  setPrincipalRole(null);
});

describe('mcp apps frame routing', () => {
  it('mcp_app_session applies only matching open query and chains resource fetch', () => {
    const { acknowledge, lastCommandId } = installTestDeps();
    openMcpApp('chat-1', 'tool-1', {}, {});
    const commandId = lastCommandId();
    handleMcpAppSession({
      t: 'mcp_app_session',
      commandId,
      chatId: 'chat-1',
      toolCallId: 'tool-1',
      appSessionId: 'app-1',
      serverId: 'fixture',
      resourceUri: 'ui://fixture/dashboard',
    } as never);
    expect(liveMcpApp('tool-1')?.appSessionId).toBe('app-1');
    expect(acknowledge).toHaveBeenCalledWith({ commandId, status: 'committed' });
  });

  it('mcp_app_resource ignores stale queries and other chats', () => {
    const { acknowledge } = installTestDeps();
    openMcpApp('chat-1', 'tool-1', {}, {});
    handleMcpAppResource({
      t: 'mcp_app_resource',
      commandId: 'unknown',
      chatId: 'chat-1',
      appSessionId: 'app-1',
      html: '<html></html>',
      mimeType: 'text/html;profile=mcp-app',
    } as never);
    expect(liveMcpApp('tool-1')?.html).toBeNull();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('read-only principals cannot open apps', () => {
    const { sendAction } = installTestDeps();
    setPrincipalRole('read-only');
    expect(openMcpApp('chat-1', 'tool-1', {}, {})).toBe(false);
    expect(maybeOpenCompletedMcpTool(minimalTool({ toolCallId: 'tool-1', name: 'mcp__x__y', status: 'completed' }), 'live')).toBeUndefined();
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('maybeOpenCompletedMcpTool skips replay origin and non-mcp tools', () => {
    const { sendAction } = installTestDeps();
    maybeOpenCompletedMcpTool(minimalTool({ toolCallId: 't1', name: 'compact', status: 'completed' }), 'live');
    maybeOpenCompletedMcpTool(minimalTool({ toolCallId: 't2', name: 'mcp__x__y', status: 'completed' }), 'replay');
    expect(sendAction).not.toHaveBeenCalled();
  });
});

describe('mcp apps helpers', () => {
  it('ownsMcpAppsError treats silent codes as owned', () => {
    expect(ownsMcpAppsError({ message: 'policy_denied' } as never)).toBe(true);
    expect(ownsMcpAppsError({ message: 'agent_unavailable' } as never)).toBe(false);
  });

  it('tearDownMcpAppsForChat clears live sessions', () => {
    installTestDeps();
    openMcpApp('chat-1', 'tool-1', {}, {});
    tearDownMcpAppsForChat('chat-1');
    expect(liveMcpApp('tool-1')).toBeNull();
  });

  it('tearDownMcpAppsForChat only clears matching chat sessions', () => {
    installTestDeps();
    openMcpApp('chat-1', 'tool-1', {}, {});
    openMcpApp('chat-2', 'tool-2', {}, {});
    tearDownMcpAppsForChat('chat-1');
    expect(liveMcpApp('tool-1')).toBeNull();
    expect(liveMcpApp('tool-2')?.chatId).toBe('chat-2');
  });

  it('tearDownMcpAppsForChat before reopen allows silent policy retry', () => {
    const { sendAction } = installTestDeps();
    openMcpApp('chat-1', 'tool-1', {}, {});
    tearDownMcpAppsForChat('chat-1');
    expect(liveMcpApp('tool-1')).toBeNull();
    maybeOpenCompletedMcpTool(minimalTool({ toolCallId: 'tool-1', name: 'mcp__x__y', status: 'completed' }), 'live');
    expect(sendAction).toHaveBeenCalledTimes(2);
  });

  it('handleMcpAppCallResult forwards inner JSON-RPC payload', () => {
    const { acknowledge, lastCommandId } = installTestDeps();
    openMcpApp('chat-1', 'tool-1', {}, {});
    handleMcpAppSession({
      t: 'mcp_app_session',
      commandId: 'open-cmd',
      chatId: 'chat-1',
      toolCallId: 'tool-1',
      appSessionId: 'app-1',
      serverId: 'fixture',
      resourceUri: 'ui://fixture/dashboard',
    } as never);
    callMcpAppTool('app-1', {
      jsonrpc: '2.0',
      id: 'app-call-1',
      method: 'tools/call',
      params: { name: 'get-time', arguments: {} },
    });
    const callCommandId = lastCommandId();
    const listener = vi.fn();
    window.addEventListener('peri-mcp-app-call-result', listener as EventListener);
    handleMcpAppCallResult({
      t: 'mcp_app_call_result',
      commandId: callCommandId,
      chatId: 'chat-1',
      appSessionId: 'app-1',
      result: {
        jsonrpc: '2.0',
        id: 'app-call-1',
        result: { content: [{ type: 'text', text: 'ok' }] },
      },
    } as never);
    expect(listener).toHaveBeenCalledOnce();
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.result).toEqual({
      jsonrpc: '2.0',
      id: 'app-call-1',
      result: { content: [{ type: 'text', text: 'ok' }] },
    });
    expect(acknowledge).toHaveBeenCalledWith({ commandId: callCommandId, status: 'committed' });
    window.removeEventListener('peri-mcp-app-call-result', listener as EventListener);
  });
});
