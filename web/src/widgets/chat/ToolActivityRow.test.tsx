import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { observedDuration, ToolCallCard } from './ToolActivityRow';
import type { ToolCallInfo } from '@/entities/chat/chat-view';
import { openWorkspaceFromTool } from '@/store';

vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store')>();
  return { ...actual, openWorkspaceFromTool: vi.fn() };
});

const base: ToolCallInfo = {
  toolCallId: 'tool-123456789', name: 'shell', kind: 'execute', status: 'completed',
  arguments: { command: 'pwd' }, result: { exitCode: 0 }, publicError: null,
  resultOmitted: false, resultBytes: 14,
  startedAt: '2026-08-13T00:00:00.000Z', completedAt: '2026-08-13T00:00:01.250Z',
};

function summary() {
  return document.querySelector('[data-testid="tool-activity-row-summary"]') as HTMLElement;
}

function expandControl() {
  return document.querySelector('[data-testid="tool-activity-row-expand"]') as HTMLButtonElement;
}

describe('ToolActivityRow', () => {
  it('uses a bordered card in default variant and a compact row in activity variant', () => {
    const { unmount } = render(() => <ToolCallCard toolCall={base} />);
    const defaultRow = document.querySelector('[data-testid="tool-activity-row"]')!;
    expect(defaultRow).toHaveClass('border', 'rounded-lg');
    expect(defaultRow.querySelector('.tool-activity-row__card')).toBeNull();
    unmount();

    render(() => <ToolCallCard toolCall={base} variant="activity" />);
    const activityRow = document.querySelector('[data-testid="tool-activity-row"]')!;
    expect(activityRow).toHaveClass('tool-activity-row--activity');
    expect(activityRow).not.toHaveClass('border');
    expect(activityRow.querySelector('.tool-call-row-icon')).toHaveClass('relative', 'z-1', 'bg-surface-muted');
    expect(activityRow.querySelector('.tool-call-row-compact')).not.toHaveClass('-ml-32');
  });

  it('renders the Fenix-style tool icon selected by semantic tool kind', () => {
    render(() => <ToolCallCard toolCall={{ ...base, name: 'Grep', kind: 'other', arguments: { pattern: 'ToolCall', path: 'web/src' } }} />);
    const icon = document.querySelector('[data-tool-kind="grep"]');
    expect(icon).toBeInTheDocument();
    expect(icon?.querySelector('.lucide-search')).toBeInTheDocument();
    expect(summary()).toHaveTextContent('Searched "ToolCall"');
    expect(summary()).toHaveTextContent('in src');
  });

  it('shows structured execution facts and honest observed duration', () => {
    render(() => <ToolCallCard toolCall={base} />);
    expect(screen.getByText(/Ran \$ pwd/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.getByText('1.3s')).toBeInTheDocument();
    expect(document.querySelector('.tool-call-row-title')).toHaveTextContent(/pwd/);
    expect(document.querySelector('[data-testid="tool-activity-row-body"]')).toBeNull();
    fireEvent.click(expandControl());
    expect(document.querySelector('[data-testid="tool-activity-row-body"]')).toBeInTheDocument();
    expect(screen.getAllByText(/pwd/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Copy Command' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Output' })).toBeInTheDocument();
  });

  it('keeps public errors compact until requested and never renders payload markup as HTML', () => {
    render(() => <ToolCallCard toolCall={{ ...base, status: 'error', result: null, publicError: { code: 'DENIED', message: '<img src=x onerror=alert(1)>' } }} />);
    expect(screen.getByRole('img', { name: 'Failed' })).toBeInTheDocument();
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    expect(screen.getByText(/DENIED:/)).toBeInTheDocument();
    expect(document.querySelector('[data-testid="tool-activity-row-body"]')).toBeNull();
    fireEvent.click(expandControl());
    const body = document.querySelector('[data-testid="tool-activity-row-body"]')!;
    expect(body.textContent).toMatch(/<img src=x onerror=alert\(1\)>/);
    expect(document.querySelector('img')).toBeNull();
    expect(expandControl()).toHaveAttribute('aria-expanded', 'true');
  });

  it('suppresses absent, invalid, and negative timing', () => {
    expect(observedDuration(null, base.completedAt)).toBeNull();
    expect(observedDuration('bad', base.completedAt)).toBeNull();
    expect(observedDuration(base.completedAt, base.startedAt)).toBeNull();
  });

  it('distinguishes an explicitly omitted result from an empty result', () => {
    const { unmount } = render(() => <ToolCallCard toolCall={{ ...base, result: null, resultOmitted: true, resultBytes: 8192 }} />);
    fireEvent.click(expandControl());
    expect(screen.getByText('Output not loaded')).toBeInTheDocument();
    expect(screen.getByText(/of about 8.0 KB/)).toBeInTheDocument();
    expect(screen.queryByText('The tool returned no displayable output.')).not.toBeInTheDocument();
    unmount();
    render(() => <ToolCallCard toolCall={{ ...base, result: null, resultOmitted: false, resultBytes: null }} />);
    fireEvent.click(expandControl());
    expect(screen.getByText('The tool returned no displayable output.')).toBeInTheDocument();
  });

  it('shows a public error and omission provenance independently', () => {
    render(() => <ToolCallCard toolCall={{ ...base, status: 'error', result: null, resultOmitted: true, resultBytes: 5000, publicError: { code: 'TOO_LARGE', message: 'safe failure' } }} />);
    fireEvent.click(expandControl());
    expect(screen.getAllByText(/TOO_LARGE: safe failure/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Output not loaded')).toBeInTheDocument();
  });

  it('does not interpret missing legacy provenance as an explicit empty result', () => {
    render(() => <ToolCallCard toolCall={{ ...base, result: null, resultOmitted: null, resultBytes: null }} />);
    fireEvent.click(expandControl());
    expect(screen.getByText(/legacy projection did not record/)).toBeInTheDocument();
    expect(screen.queryByText('The tool returned no displayable output.')).not.toBeInTheDocument();
  });

  it('renders the server-authoritative permission wait without claiming an empty result', () => {
    render(() => <ToolCallCard toolCall={{ ...base, status: 'awaitingPermission', result: null, resultOmitted: false, completedAt: null }} />);
    expect(screen.getByRole('img', { name: 'Approval' })).toBeInTheDocument();
    expect(screen.queryByText('Approval')).not.toBeInTheDocument();
    expect(screen.queryByText('The tool returned no displayable output.')).not.toBeInTheDocument();
  });

  it('uses status icons for every lifecycle state', () => {
    const cases = [
      { status: 'pending', label: 'Queued' },
      { status: 'running', label: 'Running' },
      { status: 'cancelled', label: 'Cancelled' },
    ];

    for (const [index, item] of cases.entries()) {
      const { unmount } = render(() => <ToolCallCard toolCall={{ ...base, status: item.status, completedAt: index === 2 ? base.completedAt : null }} />);
      expect(screen.getByRole('img', { name: item.label })).toBeInTheDocument();
      expect(screen.queryByText(item.label)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('uses the production token geometry and highlights only active work', () => {
    const { unmount } = render(() => <ToolCallCard toolCall={{ ...base, status: 'running', completedAt: null }} />);
    const active = summary().closest('.tool-call-row-compact')!;
    expect(active).toHaveClass('is-running', 'bg-sidebar-selected');
    expect(document.querySelector('.tool-call-row-title.ui-ai-shimmer')).toBeTruthy();
    unmount();

    render(() => <ToolCallCard toolCall={base} />);
    expect(summary().closest('.tool-call-row-compact')).not.toHaveClass('is-running');
  });

  it('narrates shell commands in the Fenix-style title row', () => {
    render(() => <ToolCallCard toolCall={{ ...base, name: 'Bash', arguments: { command: 'pwd && git status' } }} />);
    const row = document.querySelector('[data-testid="tool-activity-row-summary"]')!;
    expect(row).toHaveTextContent('Ran $ pwd && git status');
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument();
  });

  it('keeps long narrations truncatable without displacing status', () => {
    render(() => <ToolCallCard toolCall={{ ...base, name: 'An unexpectedly long namespaced tool implementation', arguments: { command: 'pwd' } }} />);
    const row = document.querySelector('.tool-call-row-title')!;
    expect(row).toHaveClass('tool-call-row-title');
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument();
  });

  it('shows a cwd-relative label but opens the original absolute file path', () => {
    render(() => <ToolCallCard projectCwd="/workspace/project" toolCall={{
      ...base,
      name: 'Read',
      kind: 'read',
      arguments: { file_path: '/workspace/project/web/src/main.ts' },
    }} />);
    expect(screen.getByTestId('tool-activity-file-link')).toHaveTextContent('web/src/main.ts');
    fireEvent.click(screen.getByTestId('tool-activity-file-link'));
    expect(openWorkspaceFromTool).toHaveBeenCalledWith('/workspace/project/web/src/main.ts');
  });

  it('prefers the Read file path over pagination arguments in the compact row', () => {
    render(() => <ToolCallCard toolCall={{
      ...base,
      name: 'Read',
      kind: 'read',
      arguments: { limit: 2_000, offset: 0, file_path: '/workspace/src/main.rs' },
    }} />);

    expect(summary()).toHaveTextContent('main.rs');
    expect(summary()).not.toHaveTextContent('2000');
  });

  it('presents shell command and output as tool-specific evidence', () => {
    render(() => <ToolCallCard toolCall={{
      ...base,
      name: 'Bash',
      kind: 'execute',
      arguments: { command: 'cargo test -p peri-studio', cwd: '/workspace', env: { CI: '1' }, timeout: 120_000 },
      result: { stdout: '', output: 'test result: ok', stderr: '', exitCode: 0 },
    }} />);

    fireEvent.click(expandControl());
    expect(screen.getByText('Command')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getAllByText(/cargo test -p peri-studio/)).toHaveLength(2);
    expect(screen.getByText(/test result: ok/)).toBeInTheDocument();
    expect(screen.getByText(/\/workspace/)).toBeInTheDocument();
    expect(screen.getByText(/120000/)).toBeInTheDocument();
    expect(screen.getByText(/"CI": "1"/)).toBeInTheDocument();
  });

  it('uses only the authoritative kind and keeps unknown tools generic', () => {
    render(() => <ToolCallCard toolCall={{
      ...base,
      name: 'Open browser',
      kind: 'other',
      arguments: { file_path: '/not/a/read/tool', url: 'https://example.test' },
      result: { content: [{ type: 'text', text: 'opened' }] },
    }} />);

    fireEvent.click(expandControl());
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.queryByText('File')).not.toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('preserves Read pagination evidence instead of showing only the path', () => {
    render(() => <ToolCallCard toolCall={{
      ...base,
      name: 'Read',
      kind: 'read',
      arguments: { file_path: '/workspace/src/main.rs', offset: 40, limit: 80 },
      result: { content: [{ type: 'text', text: 'fn main() {}' }] },
    }} />);

    fireEvent.click(expandControl());
    expect(screen.getByText(/"offset": 40/)).toBeInTheDocument();
    expect(screen.getByText(/"limit": 80/)).toBeInTheDocument();
  });

  it('distinguishes omitted input and renders projected ACP content and locations on demand', () => {
    render(() => <ToolCallCard toolCall={{
      ...base,
      name: 'MCP tool',
      kind: 'other',
      arguments: null,
      argumentsOmitted: true,
      argumentsBytes: 2_048,
      content: [{ type: 'text', text: 'streamed progress' }],
      contentOmitted: true,
      contentBytes: 4_096,
      locations: [{ path: '/workspace/src/main.rs', line: 7 }],
      locationsOmitted: true,
      locationsBytes: 1_024,
    }} />);

    expect(screen.queryByText('Input not loaded')).not.toBeInTheDocument();
    fireEvent.click(expandControl());
    expect(screen.getByText('Input not loaded')).toBeInTheDocument();
    expect(screen.getByText(/about 2.0 KB/)).toBeInTheDocument();
    expect(screen.getByText('Tool content')).toBeInTheDocument();
    expect(screen.getByText('Locations')).toBeInTheDocument();
    expect(screen.getByText(/streamed progress/)).toBeInTheDocument();
    expect(screen.getByText(/main.rs/)).toBeInTheDocument();
    expect(screen.getByText('Tool content not loaded')).toBeInTheDocument();
    expect(screen.getByText('Locations not loaded')).toBeInTheDocument();
  });
});
