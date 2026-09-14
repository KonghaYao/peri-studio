import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpAppFrameShell } from './McpAppFrameShell';
import type { McpAppHostSessionView } from './types';

const bindHost = vi.fn(async () => ({ close: vi.fn(async () => undefined) }));

const session: McpAppHostSessionView = {
  toolCallId: 'tool-1',
  appSessionId: 'app-1',
  html: '<html></html>',
  csp: null,
  toolInput: { prompt: 'hi' },
  toolResult: { content: [] },
};

function renderShell(overrides: {
  height?: () => number;
  onHeightChange?: (toolCallId: string, height: number) => void;
} = {}) {
  return render(() => (
    <McpAppFrameShell
      session={() => session}
      height={overrides.height ?? (() => 400)}
      bindings={{
        resolveSandboxOrigin: () => 'http://127.0.0.1:8457',
        onCallTool: async () => ({ content: [] }),
        onHeightChange: overrides.onHeightChange,
      }}
      bindHost={bindHost}
    />
  ));
}

afterEach(() => {
  bindHost.mockClear();
});

describe('McpAppFrameShell', () => {
  it('binds the host once for the iframe lifetime', () => {
    const onHeightChange = vi.fn();
    const view = renderShell({ onHeightChange });
    expect(bindHost).toHaveBeenCalledTimes(1);
    onHeightChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Open fullscreen' }));
    expect(screen.getByRole('dialog', { name: 'MCP App' })).toBeInTheDocument();
    expect(bindHost).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
    expect(screen.queryByRole('dialog', { name: 'MCP App' })).not.toBeInTheDocument();
    expect(bindHost).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(bindHost).toHaveBeenCalledTimes(1);
  });

  it('exits fullscreen on Escape without rebinding', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open fullscreen' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'MCP App' })).not.toBeInTheDocument();
    expect(bindHost).toHaveBeenCalledTimes(1);
  });
});
