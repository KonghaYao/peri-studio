import { describe, expect, it } from 'vitest';
import type { ToolCallInfo } from '@/entities/chat/chat-view';
import {
  buildMcpAppHistoricalCardProps,
  historicalMcpAppMessage,
  hasLiveMcpAppSibling,
  isMcpAppTool,
  parseMcpAppToolName,
  shouldShowMcpAppHistoricalCard,
} from './mcp-app-display';
import {
  handleMcpAppResource,
  handleMcpAppSession,
  installMcpApps,
  openMcpApp,
  resetMcpAppsState,
} from './mcp-apps';
import { setPrincipalRole } from '@/features/auth/auth-state';

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

describe('mcp app display helpers', () => {
  it('detects and parses MCP App tool names', () => {
    expect(isMcpAppTool({ name: 'mcp__cursor-canvas__show_canvas' })).toBe(true);
    expect(isMcpAppTool({ name: 'Read' })).toBe(false);
    expect(parseMcpAppToolName('mcp__cursor-canvas__show_canvas')).toEqual({
      serverId: 'cursor-canvas',
      toolName: 'show_canvas',
    });
    expect(parseMcpAppToolName('compact')).toBeNull();
  });

  it('builds historical card props with replay-specific copy', () => {
    const props = buildMcpAppHistoricalCardProps(
      minimalTool({ name: 'mcp__cursor-canvas__show_canvas', status: 'completed' }),
      { origin: 'replay', variant: 'activity' },
    );
    expect(props.title).toBe('MCP App · show canvas');
    expect(props.subtitle).toBe('cursor canvas');
    expect(props.message).toBe(historicalMcpAppMessage('replay'));
    expect(props.variant).toBe('activity');
  });

  it('shows historical card for replayed MCP tools without live HTML', () => {
    expect(shouldShowMcpAppHistoricalCard(
      minimalTool({ toolCallId: 'tool-1', name: 'mcp__x__y', status: 'completed' }),
      'replay',
    )).toBe(true);
    expect(shouldShowMcpAppHistoricalCard(
      minimalTool({ toolCallId: 'tool-1', name: 'Read', status: 'completed' }),
      'replay',
    )).toBe(false);
  });

  it('keeps live MCP tools on ToolCallActivity while HTML is pending', () => {
    expect(shouldShowMcpAppHistoricalCard(
      minimalTool({ toolCallId: 'tool-1', name: 'mcp__x__y', status: 'running' }),
      'live',
    )).toBe(false);
    expect(shouldShowMcpAppHistoricalCard(
      minimalTool({ toolCallId: 'tool-1', name: 'mcp__x__y', status: 'completed' }),
      'live',
    )).toBe(false);
    expect(shouldShowMcpAppHistoricalCard(
      minimalTool({ toolCallId: 'tool-1', name: 'mcp__x__y', status: 'completed' }),
      null,
    )).toBe(false);
  });

  it('keeps duplicate live MCP tools on ToolCallActivity when another iframe is primary', () => {
    setPrincipalRole('full');
    let lastCommandId = '';
    installMcpApps({
      selectedCid: () => 'chat-1',
      ready: () => true,
      sendAction: (frame) => {
        lastCommandId = frame.commandId;
        return true;
      },
      acknowledge: () => undefined,
    });
    const tools = [
      minimalTool({ toolCallId: 'tool-1', name: 'mcp__sales-dashboard__get_dashboard' }),
      minimalTool({ toolCallId: 'tool-2', name: 'mcp__sales-dashboard__get_dashboard' }),
    ];
    openMcpApp('chat-1', 'tool-2', {}, {});
    expect(hasLiveMcpAppSibling('tool-1', tools)).toBe(true);
    expect(shouldShowMcpAppHistoricalCard(tools[0], 'live', tools)).toBe(false);
    handleMcpAppSession({
      t: 'mcp_app_session',
      commandId: lastCommandId,
      chatId: 'chat-1',
      toolCallId: 'tool-2',
      appSessionId: 'app-2',
      serverId: 'sales-dashboard',
      resourceUri: 'ui://dashboard/app.html',
    });
    handleMcpAppResource({
      t: 'mcp_app_resource',
      commandId: lastCommandId,
      chatId: 'chat-1',
      appSessionId: 'app-2',
      html: '<html></html>',
      mimeType: 'text/html;profile=mcp-app',
    });
    expect(shouldShowMcpAppHistoricalCard(tools[0], 'live', tools)).toBe(false);
    resetMcpAppsState();
    setPrincipalRole(null);
  });
});
