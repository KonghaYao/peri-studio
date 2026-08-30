import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPrincipalRole } from '../../panel/lib/auth-state';
import {
  handleMcpAppResource,
  handleMcpAppSession,
  installMcpApps,
  openMcpApp,
  resetMcpAppsState,
  setMcpAppHeight,
} from '../../panel/lib/mcp-apps';

const { bindMcpAppHost } = vi.hoisted(() => ({
  bindMcpAppHost: vi.fn(async () => ({ close: vi.fn(async () => undefined) })),
}));
vi.mock('../../panel/lib/mcp-app-host', () => ({ bindMcpAppHost }));

import { McpAppFrame } from './McpAppFrame';

function seedLiveApp(): void {
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
  openMcpApp('chat-1', 'tool-1', { prompt: 'hi' }, { content: [] });
  handleMcpAppSession({
    t: 'mcp_app_session',
    commandId: lastCommandId,
    chatId: 'chat-1',
    toolCallId: 'tool-1',
    appSessionId: 'app-1',
    serverId: 'fixture',
    resourceUri: 'ui://fixture/canvas',
  } as never);
  handleMcpAppResource({
    t: 'mcp_app_resource',
    commandId: lastCommandId,
    chatId: 'chat-1',
    appSessionId: 'app-1',
    html: '<html></html>',
    mimeType: 'text/html;profile=mcp-app',
    toolResult: { content: [{ type: 'text', text: 'ok' }] },
  } as never);
}

afterEach(() => {
  resetMcpAppsState();
  setPrincipalRole(null);
  bindMcpAppHost.mockClear();
});

describe('McpAppFrame', () => {
  it('binds the host once for the iframe lifetime', () => {
    seedLiveApp();
    const view = render(() => <McpAppFrame toolCallId="tool-1" />);
    expect(bindMcpAppHost).toHaveBeenCalledTimes(1);
    setMcpAppHeight('tool-1', 360);
    expect(bindMcpAppHost).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Open fullscreen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open fullscreen' }));
    expect(screen.getByRole('dialog', { name: 'MCP App' })).toBeInTheDocument();
    expect(bindMcpAppHost).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
    expect(screen.queryByRole('dialog', { name: 'MCP App' })).not.toBeInTheDocument();
    expect(bindMcpAppHost).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(bindMcpAppHost).toHaveBeenCalledTimes(1);
  });

  it('exits fullscreen on Escape without rebinding', () => {
    seedLiveApp();
    render(() => <McpAppFrame toolCallId="tool-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open fullscreen' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'MCP App' })).not.toBeInTheDocument();
    expect(bindMcpAppHost).toHaveBeenCalledTimes(1);
  });
});
