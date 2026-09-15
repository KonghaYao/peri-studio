// MCP Apps 装配模块行为测试：帧归属、read-only 门控与 silent error 分类。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callMcpAppTool,
  handleMcpAppsActionError,
  handleMcpAppCallResult,
  handleMcpAppInvoke,
  handleMcpAppResource,
  handleMcpAppSession,
  installMcpApps,
  isMcpAppReopenDisabled,
  isMcpAppReopenPending,
  isMcpAppServerConnected,
  isPrimaryLiveMcpApp,
  liveMcpApp,
  liveMcpAppHeight,
  maybeOpenCompletedMcpTool,
  mcpAppInlineMaxHeight,
  MCP_APP_DEFAULT_HEIGHT,
  openMcpApp,
  ownsMcpAppsError,
  reopenMcpApp,
  resetMcpAppsState,
  setMcpAppHeight,
  tearDownMcpAppsForChat,
} from './mcp-apps';
import { setMcpServers } from './mcp';
import { installPanelErrors } from '@/features/message/panel-errors';
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
  setMcpServers([]);
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

  it('maybeOpenCompletedMcpTool skips non-mcp tools and waits for MCP server registration', () => {
    const { sendAction } = installTestDeps();
    maybeOpenCompletedMcpTool(minimalTool({ toolCallId: 't1', name: 'compact', status: 'completed' }), 'live');
    maybeOpenCompletedMcpTool(minimalTool({ toolCallId: 't2', name: 'mcp__x__y', status: 'completed' }), 'replay');
    expect(sendAction).not.toHaveBeenCalled();
    expect(isMcpAppServerConnected('mcp__x__y')).toBe(false);
  });

  it('maybeOpenCompletedMcpTool skips replayed MCP tools even when the server is connected', () => {
    const { sendAction } = installTestDeps();
    setMcpServers([{
      name: 'x',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 1,
      resourcesCount: 1,
    }]);
    const tool = minimalTool({ toolCallId: 't2', name: 'mcp__x__y', status: 'completed' });
    maybeOpenCompletedMcpTool(tool, 'replay');
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('maybeOpenCompletedMcpTool uses explicit chatId when selectedCid is empty', () => {
    const { sendAction } = installTestDeps({ selectedCid: () => null, currentCid: () => 'chat-2' });
    setMcpServers([{
      name: 'x',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 1,
      resourcesCount: 1,
    }]);
    const tool = minimalTool({ toolCallId: 't2', name: 'mcp__x__y', status: 'completed' });
    maybeOpenCompletedMcpTool(tool, 'live', 'chat-explicit');
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction.mock.calls[0]?.[0].payload).toMatchObject({ chatId: 'chat-explicit' });
  });

  it('maybeOpenCompletedMcpTool opens live MCP tools once the server connects', () => {
    const { sendAction } = installTestDeps();
    const tool = minimalTool({ toolCallId: 't2', name: 'mcp__x__y', status: 'completed' });
    maybeOpenCompletedMcpTool(tool, 'live');
    expect(sendAction).not.toHaveBeenCalled();
    setMcpServers([{
      name: 'x',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 1,
      resourcesCount: 1,
    }]);
    maybeOpenCompletedMcpTool(tool, 'live');
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction.mock.calls[0]?.[0].type).toBe('mcp/app-open');
    maybeOpenCompletedMcpTool(tool, 'live');
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  it('isMcpAppReopenDisabled only gates read-only, pending, and missing identity', () => {
    installTestDeps({ selectedCid: () => null, currentCid: () => 'chat-2' });
    const tool = minimalTool({
      toolCallId: 'tool-replay',
      name: 'mcp__cursor-canvas__show_canvas',
      status: 'completed',
      arguments: { source: 'export default function App() { return null; }' },
    });
    expect(isMcpAppReopenDisabled(tool, 'chat-1')).toBe(false);
    expect(isMcpAppReopenDisabled(tool, null)).toBe(false);
    expect(isMcpAppReopenDisabled(tool, 'chat-1', { reopenPending: true })).toBe(true);
    expect(isMcpAppReopenDisabled(tool, 'chat-1', { readOnly: true })).toBe(true);
    installTestDeps({ selectedCid: () => null, currentCid: () => null });
    expect(isMcpAppReopenDisabled(tool, null)).toBe(true);
    expect(isMcpAppReopenDisabled(
      minimalTool({ toolCallId: '', name: 'mcp__cursor-canvas__show_canvas' }),
      'chat-1',
    )).toBe(true);
    expect(isMcpAppReopenDisabled(
      minimalTool({ toolCallId: 'tool-replay', name: 'Read' }),
      'chat-1',
    )).toBe(true);
    expect(isMcpAppReopenDisabled(tool, 'chat-1')).toBe(false);
  });

  it('reopenMcpApp sends invoke even when MCP server list is empty', () => {
    const { sendAction } = installTestDeps();
    const tool = minimalTool({
      toolCallId: 'tool-replay',
      name: 'mcp__cursor-canvas__show_canvas',
      status: 'completed',
      arguments: { source: 'export default function App() { return null; }' },
    });
    expect(reopenMcpApp(tool, 'chat-1')).toBe(true);
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction.mock.calls[0]![0].type).toBe('mcp/app-invoke');
  });

  it('reopenMcpApp ignores truncated tool results when arguments include source', () => {
    const { sendAction } = installTestDeps();
    const tool = minimalTool({
      toolCallId: 'tool-replay',
      name: 'mcp__cursor-canvas__show_canvas',
      status: 'completed',
      arguments: { source: 'export default function App() { return null; }' },
      result: null,
      resultOmitted: true,
      resultBytes: 5000,
    });
    expect(reopenMcpApp(tool, 'chat-1')).toBe(true);
    expect(sendAction.mock.calls[0]?.[0].payload).toMatchObject({
      toolName: 'show_canvas',
      arguments: { source: 'export default function App() { return null; }' },
    });
  });

  it('reopenMcpApp sends mcp/app-invoke instead of reopening the historical toolCallId', () => {
    const { sendAction } = installTestDeps();
    setMcpServers([{
      name: 'cursor-canvas',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 2,
      resourcesCount: 1,
    }]);
    const tool = minimalTool({
      toolCallId: 'tool-replay',
      name: 'mcp__cursor-canvas__show_canvas',
      status: 'completed',
      arguments: { source: 'export default function App() { return null; }' },
    });
    expect(reopenMcpApp(tool)).toBe(true);
    expect(sendAction).toHaveBeenCalledTimes(1);
    const frame = sendAction.mock.calls[0]![0];
    expect(frame.type).toBe('mcp/app-invoke');
    expect(frame.payload).toMatchObject({
      chatId: 'chat-1',
      sourceToolCallId: 'tool-replay',
      serverId: 'cursor-canvas',
      toolName: 'show_canvas',
      arguments: { source: 'export default function App() { return null; }' },
    });
    expect(isMcpAppReopenPending('tool-replay')).toBe(true);
  });

  it('reopenMcpApp and maybeOpenCompletedMcpTool accept Cursor extra-tool titles', () => {
    const { sendAction } = installTestDeps();
    setMcpServers([{
      name: 'cursor-canvas',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 2,
      resourcesCount: 1,
    }]);
    const wrapped = 'execute extra tool `mcp__cursor-canvas__show_canvas`';
    expect(isMcpAppServerConnected(wrapped)).toBe(true);
    const liveTool = minimalTool({
      toolCallId: 'tool-live',
      name: wrapped,
      status: 'completed',
      arguments: {
        tool_name: 'mcp__cursor-canvas__show_canvas',
        params: { source: 'export default function App() { return null; }' },
      },
    });
    maybeOpenCompletedMcpTool(liveTool, 'live');
    expect(sendAction.mock.calls[0]?.[0].type).toBe('mcp/app-open');
    expect(liveMcpApp('tool-live')?.toolInput).toEqual({
      source: 'export default function App() { return null; }',
    });
    const replayTool = minimalTool({
      toolCallId: 'tool-replay',
      name: wrapped,
      status: 'completed',
      arguments: { source: 'export default function App() { return null; }' },
    });
    expect(reopenMcpApp(replayTool)).toBe(true);
    expect(sendAction.mock.calls[1]?.[0].type).toBe('mcp/app-invoke');
    expect(sendAction.mock.calls[1]?.[0].payload).toMatchObject({
      serverId: 'cursor-canvas',
      toolName: 'show_canvas',
    });
  });

  it('reopenMcpApp unwraps double-nested extra-tool arguments into invoke payload', () => {
    const { sendAction } = installTestDeps();
    setMcpServers([{
      name: 'cursor-canvas',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 2,
      resourcesCount: 1,
    }]);
    const wrapped = 'execute extra tool `mcp__cursor-canvas__show_canvas`';
    const tool = minimalTool({
      toolCallId: 'tool-replay',
      name: wrapped,
      status: 'completed',
      arguments: {
        name: 'execute extra tool',
        arguments: {
          name: 'mcp__cursor-canvas__show_canvas',
          arguments: { source: 'export default function App() { return null; }' },
        },
      },
    });
    expect(reopenMcpApp(tool, 'chat-1')).toBe(true);
    expect(sendAction.mock.calls[0]?.[0].payload).toMatchObject({
      serverId: 'cursor-canvas',
      toolName: 'show_canvas',
      arguments: { source: 'export default function App() { return null; }' },
    });
  });

  it('reopenMcpApp sends inner params from Peri ExecuteExtraTool arguments', () => {
    const { sendAction } = installTestDeps();
    const source = 'import { Stack } from "peri/canvas";\n\nexport default function Hello() { return null; }';
    const tool = minimalTool({
      toolCallId: 'tool-replay',
      name: 'execute extra tool `mcp__cursor-canvas__show_canvas`',
      status: 'completed',
      arguments: {
        tool_name: 'mcp__cursor-canvas__show_canvas',
        params: {
          title: 'cursor-canvas hello',
          canvasId: 'cursor-canvas-hello',
          source,
        },
      },
    });
    expect(reopenMcpApp(tool, 'chat-1')).toBe(true);
    expect(sendAction.mock.calls[0]?.[0].payload).toMatchObject({
      serverId: 'cursor-canvas',
      toolName: 'show_canvas',
      arguments: {
        title: 'cursor-canvas hello',
        canvasId: 'cursor-canvas-hello',
        source,
      },
    });
  });

  it('reopenMcpApp falls back to show_canvas_demo only when source is gone and server lists multiple tools', () => {
    const { sendAction } = installTestDeps();
    setMcpServers([{
      name: 'cursor-canvas',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 3,
      resourcesCount: 1,
    }]);
    const tool = minimalTool({
      toolCallId: 'tool-replay',
      name: 'execute extra tool `mcp__cursor-canvas__show_canvas`',
      status: 'completed',
      arguments: { tool_name: 'mcp__cursor-canvas__show_canvas', params: {} },
      argumentsOmitted: true,
    });
    expect(reopenMcpApp(tool, 'chat-1')).toBe(true);
    expect(sendAction.mock.calls[0]?.[0].payload).toMatchObject({
      serverId: 'cursor-canvas',
      toolName: 'show_canvas_demo',
      arguments: {},
    });
  });

  it('handleMcpAppsActionError abandons failed open attempts for silent policy errors', () => {
    const { sendAction } = installTestDeps();
    setMcpServers([{
      name: 'x',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 1,
      resourcesCount: 1,
    }]);
    const tool = minimalTool({ toolCallId: 'tool-1', name: 'mcp__x__y', status: 'completed' });
    maybeOpenCompletedMcpTool(tool, 'live');
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(liveMcpApp('tool-1')).not.toBeNull();
    expect(handleMcpAppsActionError({
      commandId: sendAction.mock.calls[0]![0].commandId,
      message: 'policy_denied',
    } as never)).toBe(true);
    expect(liveMcpApp('tool-1')).toBeNull();
    maybeOpenCompletedMcpTool(tool, 'live');
    expect(sendAction).toHaveBeenCalledTimes(2);
  });

  it('maybeOpenCompletedMcpTool does not reopen tools that already have live HTML', () => {
    const { sendAction, lastCommandId } = installTestDeps();
    setMcpServers([{
      name: 'fixture',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 1,
      resourcesCount: 1,
    }]);
    openMcpApp('chat-1', 'tool-1', {}, {});
    handleMcpAppSession({
      t: 'mcp_app_session',
      commandId: lastCommandId(),
      chatId: 'chat-1',
      toolCallId: 'tool-1',
      appSessionId: 'app-1',
      serverId: 'fixture',
      resourceUri: 'ui://fixture/dashboard',
    } as never);
    handleMcpAppResource({
      t: 'mcp_app_resource',
      commandId: lastCommandId(),
      chatId: 'chat-1',
      appSessionId: 'app-1',
      html: '<html></html>',
      mimeType: 'text/html;profile=mcp-app',
    } as never);
    const callsBefore = sendAction.mock.calls.length;
    maybeOpenCompletedMcpTool(minimalTool({ toolCallId: 'tool-1', name: 'mcp__fixture__get_dashboard', status: 'completed' }), 'live');
    expect(sendAction.mock.calls.length).toBe(callsBefore);
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
    setMcpServers([{
      name: 'x',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 1,
      resourcesCount: 1,
    }]);
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

  it('handleMcpAppInvoke clears reopen pending and acknowledges the invoke query', () => {
    const { acknowledge, sendAction } = installTestDeps();
    setMcpServers([{
      name: 'cursor-canvas',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 1,
      resourcesCount: 1,
    }]);
    const tool = minimalTool({
      toolCallId: 'tool-replay',
      name: 'mcp__cursor-canvas__show_canvas',
      status: 'completed',
      arguments: { source: 'export default function App() { return null; }' },
    });
    reopenMcpApp(tool);
    const commandId = sendAction.mock.calls[0]![0].commandId;
    handleMcpAppInvoke({
      t: 'mcp_app_invoke',
      commandId,
      chatId: 'chat-1',
      sourceToolCallId: 'tool-replay',
      toolCallId: 'tool-new',
      serverId: 'cursor-canvas',
    } as never);
    expect(isMcpAppReopenPending('tool-replay')).toBe(false);
    expect(acknowledge).toHaveBeenCalledWith({ commandId, status: 'committed' });
  });

  it('handleMcpAppsActionError surfaces invoke failures once', () => {
    const { sendAction } = installTestDeps();
    const errors: unknown[] = [];
    installPanelErrors({
      setPersistentErrors: (updater) => { errors.push(typeof updater === 'function' ? updater([]) : updater); },
      hasUncertain: () => false,
      forget: () => undefined,
      hasPending: () => false,
      retry: () => null,
      toast: () => undefined,
    });
    setMcpServers([{
      name: 'cursor-canvas',
      transport: 'stdio',
      connectionStatus: 'connected',
      oauthStatus: 'none',
      toolsCount: 1,
      resourcesCount: 1,
    }]);
    reopenMcpApp(minimalTool({
      toolCallId: 'tool-replay',
      name: 'mcp__cursor-canvas__show_canvas',
      status: 'completed',
      arguments: { source: 'export default function App() { return null; }' },
    }));
    const commandId = sendAction.mock.calls[0]![0].commandId;
    expect(handleMcpAppsActionError({
      commandId,
      message: 'unsupported',
    } as never)).toBe(true);
    expect(isMcpAppReopenPending('tool-replay')).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    const persisted = errors.at(-1) as Array<{ title: string; detail: string; commandId: string | null }>;
    expect(persisted[0]).toMatchObject({
      title: 'Could not reopen MCP App',
      detail: 'This Peri agent does not support reopening MCP Apps yet. Upgrade Peri to a version with peri/mcp/invoke.',
      commandId: null,
    });
  });

  it('handleMcpAppsActionError maps agent_unavailable without leaking commandId', () => {
    const { sendAction } = installTestDeps();
    const errors: unknown[] = [];
    installPanelErrors({
      setPersistentErrors: (updater) => { errors.push(typeof updater === 'function' ? updater([]) : updater); },
      hasUncertain: () => false,
      forget: () => undefined,
      hasPending: () => false,
      retry: () => null,
      toast: () => undefined,
    });
    reopenMcpApp(minimalTool({
      toolCallId: 'tool-replay',
      name: 'mcp__cursor-canvas__show_canvas',
      status: 'completed',
      arguments: { source: 'export default function App() { return null; }' },
    }));
    const commandId = sendAction.mock.calls[0]![0].commandId;
    expect(handleMcpAppsActionError({
      commandId,
      message: 'agent_unavailable',
    } as never)).toBe(true);
    const persisted = errors.at(-1) as Array<{ detail: string; commandId: string | null }>;
    expect(persisted[0]).toMatchObject({
      detail: 'The agent is not available. Check that the session is running and try again.',
      commandId: null,
    });
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
