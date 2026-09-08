// MCP Apps 装配模块行为测试：帧归属、read-only 门控与 silent error 分类。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callMcpAppTool,
  handleMcpAppCallResult,
  handleMcpAppResource,
  handleMcpAppSession,
  installMcpApps,
  isPrimaryLiveMcpApp,
  liveMcpApp,
  liveMcpAppHeight,
  maybeOpenCompletedMcpTool,
  mcpAppInlineMaxHeight,
  MCP_APP_DEFAULT_HEIGHT,
  mcpUiInitializeResult,
  asCallToolResult,
  asToolInputParams,
  describeMcpAppPayload,
  openMcpApp,
  ownsMcpAppsError,
  resetMcpAppsState,
  setMcpAppHeight,
  tearDownMcpAppsForChat,
} from './mcp-apps';
import { setPrincipalRole } from '@/features/auth/auth-state';
import type { ActionFrame, ActionOptions } from '@/shared/protocol/action-contract';

import type { ToolCallInfo } from '@/entities/chat/chat-view';

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

  it('mcp_app_resource prefers ephemeral toolResult over the Chat Doc snapshot', () => {
    const { acknowledge, lastCommandId } = installTestDeps();
    openMcpApp('chat-1', 'tool-1', {}, { content: [{ type: 'text', text: '{"truncated":true' }] });
    handleMcpAppSession({
      t: 'mcp_app_session',
      commandId: lastCommandId(),
      chatId: 'chat-1',
      toolCallId: 'tool-1',
      appSessionId: 'app-1',
      serverId: 'fixture',
      resourceUri: 'ui://fixture/dashboard',
    } as never);
    const resourceCommandId = lastCommandId();
    const source = 'export default function App() { return null }';
    handleMcpAppResource({
      t: 'mcp_app_resource',
      commandId: resourceCommandId,
      chatId: 'chat-1',
      appSessionId: 'app-1',
      html: '<html></html>',
      mimeType: 'text/html;profile=mcp-app',
      toolResult: {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { source, canvasId: 'c1' },
      },
    } as never);
    expect(liveMcpApp('tool-1')?.html).toBe('<html></html>');
    expect(liveMcpApp('tool-1')?.toolResult).toEqual({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { source, canvasId: 'c1' },
    });
    expect(acknowledge).toHaveBeenCalledWith({ commandId: resourceCommandId, status: 'committed' });
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

  it('handleMcpAppCallResult resolves the matching tools/call with inner result', async () => {
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
    const resultPromise = callMcpAppTool('app-1', {
      jsonrpc: '2.0',
      id: 'app-call-1',
      method: 'tools/call',
      params: { name: 'get-time', arguments: {} },
    });
    const callCommandId = lastCommandId();
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
    await expect(resultPromise).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
    });
    expect(acknowledge).toHaveBeenCalledWith({ commandId: callCommandId, status: 'committed' });
  });
});

describe('mcpUiInitializeResult', () => {
  it('includes hostInfo.version and hostCapabilities for App Bridge', () => {
    const result = mcpUiInitializeResult('light');
    expect(result.protocolVersion).toBe('2026-01-26');
    expect(result.hostInfo).toEqual({ name: 'peri-studio', version: '0.2.0' });
    expect(result.hostCapabilities).toEqual({ openLinks: {}, serverTools: {} });
    const hostContext = result.hostContext as {
      theme: string;
      containerDimensions: { maxHeight: number; maxWidth: number };
    };
    expect(hostContext.theme).toBe('light');
    expect(hostContext.containerDimensions.maxHeight).toBe(mcpAppInlineMaxHeight());
    expect(hostContext.containerDimensions.maxWidth).toBe(720);
  });
});

describe('live MCP App display', () => {
  function attachHtml(lastCommandId: () => string, toolCallId: string, resourceUri: string, appSessionId: string): void {
    openMcpApp('chat-1', toolCallId, {}, {});
    handleMcpAppSession({
      t: 'mcp_app_session',
      commandId: lastCommandId(),
      chatId: 'chat-1',
      toolCallId,
      appSessionId,
      serverId: 'fixture',
      resourceUri,
    } as never);
    handleMcpAppResource({
      t: 'mcp_app_resource',
      commandId: lastCommandId(),
      chatId: 'chat-1',
      appSessionId,
      html: '<html></html>',
      mimeType: 'text/html;profile=mcp-app',
    } as never);
  }

  it('keeps a usable default height and caps size-changed against the inline max', () => {
    const { lastCommandId } = installTestDeps();
    attachHtml(lastCommandId, 'tool-1', 'ui://dashboard/app.html', 'app-1');
    expect(liveMcpAppHeight('tool-1')).toBe(MCP_APP_DEFAULT_HEIGHT);
    setMcpAppHeight('tool-1', 9_000);
    expect(liveMcpAppHeight('tool-1')).toBe(mcpAppInlineMaxHeight());
  });

  it('treats the latest live session with the same resourceUri as primary', () => {
    const { lastCommandId } = installTestDeps();
    attachHtml(lastCommandId, 'tool-1', 'ui://dashboard/app.html', 'app-1');
    attachHtml(lastCommandId, 'tool-2', 'ui://dashboard/app.html', 'app-2');
    expect(isPrimaryLiveMcpApp('tool-1')).toBe(false);
    expect(isPrimaryLiveMcpApp('tool-2')).toBe(true);
  });

  it('falls back to tool name when resourceUri is still empty', () => {
    const { lastCommandId } = installTestDeps();
    attachHtml(lastCommandId, 'tool-1', '', 'app-1');
    attachHtml(lastCommandId, 'tool-2', '', 'app-2');
    const tools = [
      minimalTool({ toolCallId: 'tool-1', name: 'mcp__sales-dashboard__get_dashboard' }),
      minimalTool({ toolCallId: 'tool-2', name: 'mcp__sales-dashboard__get_dashboard' }),
    ];
    expect(isPrimaryLiveMcpApp('tool-1', tools)).toBe(false);
    expect(isPrimaryLiveMcpApp('tool-2', tools)).toBe(true);
  });
});

describe('app bridge payloads', () => {
  it('asCallToolResult wraps strings so params stay an object', () => {
    expect(asCallToolResult('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
    expect(asCallToolResult({ content: [{ type: 'text', text: 'ok' }] }).content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(asCallToolResult({ canvasId: 'c1', source: 'export default function App() { return null }' })).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ canvasId: 'c1', source: 'export default function App() { return null }' }) }],
      structuredContent: { canvasId: 'c1', source: 'export default function App() { return null }' },
    });
    expect(asCallToolResult(null)).toEqual({ content: [] });
  });

  it('describeMcpAppPayload reports source length without dumping TSX', () => {
    const source = 'export default function App() { return null }';
    expect(describeMcpAppPayload({
      content: [{ type: 'text', text: 'Canvas ready' }],
      structuredContent: { canvasId: 'c1', source },
    })).toMatchObject({
      present: true,
      hasStructuredContent: true,
      sourceChars: source.length,
      firstTextChars: 12,
    });
    expect(JSON.stringify(describeMcpAppPayload({
      content: [{ type: 'text', text: 'Canvas ready' }],
      structuredContent: { canvasId: 'c1', source },
    }))).not.toContain('export default');
  });

  it('asToolInputParams always returns an arguments object', () => {
    expect(asToolInputParams({ city: 'SF' })).toEqual({ arguments: { city: 'SF' } });
    expect(asToolInputParams('x')).toEqual({ arguments: {} });
  });
});
