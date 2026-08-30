import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { observedDuration, ToolCallCard } from './ToolCallCard';
import type { ToolCallInfo } from '@/entities/chat/chat-view';

const base: ToolCallInfo = {
  toolCallId: 'tool-123456789', name: 'shell', kind: 'execute', status: 'completed',
  arguments: { command: 'pwd' }, result: { exitCode: 0 }, publicError: null,
  resultOmitted: false, resultBytes: 14,
  startedAt: '2026-08-13T00:00:00.000Z', completedAt: '2026-08-13T00:00:01.250Z',
};

describe('ToolCallCard', () => {
  it('shows structured execution facts and honest observed duration', () => {
    render(() => <ToolCallCard toolCall={base} />);
    expect(screen.getByText('shell')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('1.3 s')).toBeInTheDocument();
    expect(screen.getAllByText('pwd')).toHaveLength(1);
    expect(document.querySelector('.tool-card__body')).toBeNull();
    fireEvent.click(document.querySelector('summary')!);
    expect(document.querySelector('.tool-card__body')).toBeInTheDocument();
    expect(screen.getAllByText(/pwd/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Copy Command' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Output' })).toBeInTheDocument();
  });

  it('keeps public errors compact until requested and never renders payload markup as HTML', () => {
    render(() => <ToolCallCard toolCall={{ ...base, status: 'error', result: null, publicError: { code: 'DENIED', message: '<img src=x onerror=alert(1)>' } }} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(document.querySelector('details')?.open).toBe(false);
    fireEvent.click(document.querySelector('summary')!);
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('details')?.open).toBe(true);
  });

  it('suppresses absent, invalid, and negative timing', () => {
    expect(observedDuration(null, base.completedAt)).toBeNull();
    expect(observedDuration('bad', base.completedAt)).toBeNull();
    expect(observedDuration(base.completedAt, base.startedAt)).toBeNull();
  });

  it('distinguishes an explicitly omitted result from an empty result', () => {
    const { unmount } = render(() => <ToolCallCard toolCall={{ ...base, result: null, resultOmitted: true, resultBytes: 8192 }} />);
    fireEvent.click(document.querySelector('summary')!);
    expect(screen.getByText('Output not loaded')).toBeInTheDocument();
    expect(screen.getByText(/of about 8.0 KB/)).toBeInTheDocument();
    expect(screen.queryByText('The tool returned no displayable output.')).not.toBeInTheDocument();
    unmount();
    render(() => <ToolCallCard toolCall={{ ...base, result: null, resultOmitted: false, resultBytes: null }} />);
    fireEvent.click(document.querySelector('summary')!);
    expect(screen.getByText('The tool returned no displayable output.')).toBeInTheDocument();
  });

  it('shows a public error and omission provenance independently', () => {
    render(() => <ToolCallCard toolCall={{ ...base, status: 'error', result: null, resultOmitted: true, resultBytes: 5000, publicError: { code: 'TOO_LARGE', message: 'safe failure' } }} />);
    fireEvent.click(document.querySelector('summary')!);
    expect(screen.getByText(/TOO_LARGE: safe failure/)).toBeInTheDocument();
    expect(screen.getByText('Output not loaded')).toBeInTheDocument();
  });

  it('does not interpret missing legacy provenance as an explicit empty result', () => {
    render(() => <ToolCallCard toolCall={{ ...base, result: null, resultOmitted: null, resultBytes: null }} />);
    fireEvent.click(document.querySelector('summary')!);
    expect(screen.getByText(/legacy projection did not record/)).toBeInTheDocument();
    expect(screen.queryByText('The tool returned no displayable output.')).not.toBeInTheDocument();
  });

  it('renders the server-authoritative permission wait without claiming an empty result', () => {
    render(() => <ToolCallCard toolCall={{ ...base, status: 'awaitingPermission', result: null, resultOmitted: false, completedAt: null }} />);
    expect(screen.getByText('Approval')).toBeInTheDocument();
    expect(screen.queryByText('The tool returned no displayable output.')).not.toBeInTheDocument();
  });

  it('uses the production token geometry and highlights only active work', () => {
    const { unmount } = render(() => <ToolCallCard toolCall={{ ...base, status: 'running', completedAt: null }} />);
    const active = document.querySelector('.tool-card__summary');
    expect(active).toHaveClass('min-h-(--pattern-row-height)', 'bg-selected');
    expect(document.querySelector('.tool-card')).toHaveClass('border-0');
    expect(document.querySelector('.tool-card')).not.toHaveClass('border-b', 'border-divider');
    expect(active).toHaveClass('grid-cols-[minmax(0,1fr)_auto_18px]', 'px-0');
    expect(active?.querySelector('.tool-card__identity')).toHaveClass('inline-flex', 'items-baseline', 'gap-6');
    expect(active?.querySelector('.tool-card__mark')).toHaveClass('absolute', '-left-18', 'top-1/2', '-translate-y-1/2');
    unmount();

    render(() => <ToolCallCard toolCall={base} />);
    expect(document.querySelector('.tool-card__summary')).not.toHaveClass('bg-selected');
  });

  it('keeps the compact input immediately after the tool title', () => {
    render(() => <ToolCallCard toolCall={{ ...base, name: 'Bash', arguments: { command: 'pwd && git status' } }} />);
    const identity = document.querySelector('.tool-card__identity')!;
    expect(identity.children[0]).toHaveTextContent('Bash');
    expect(identity.children[1]).toHaveTextContent('pwd && git status');
    expect(identity).toHaveClass('inline-flex');
  });

  it('keeps long tool names from displacing the compact input and status', () => {
    render(() => <ToolCallCard toolCall={{ ...base, name: 'An unexpectedly long namespaced tool implementation', arguments: { command: 'pwd' } }} />);
    const identity = document.querySelector('.tool-card__identity')!;
    expect(identity).toHaveClass('overflow-hidden');
    expect(identity.children[0]).toHaveClass('max-w-[40%]', 'shrink', 'text-ellipsis');
    expect(identity.children[1]).toHaveClass('flex-1', 'min-w-0', 'text-ellipsis');
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('prefers the Read file path over pagination arguments in the compact row', () => {
    render(() => <ToolCallCard toolCall={{
      ...base,
      name: 'Read',
      kind: 'read',
      arguments: { limit: 2_000, offset: 0, file_path: '/workspace/src/main.rs' },
    }} />);

    expect(document.querySelector('.tool-card__summary')).toHaveTextContent('/workspace/src/main.rs');
    expect(document.querySelector('.tool-card__summary')).not.toHaveTextContent('2000');
  });

  it('presents shell command and output as tool-specific evidence', () => {
    render(() => <ToolCallCard toolCall={{
      ...base,
      name: 'Bash',
      kind: 'execute',
      arguments: { command: 'cargo test -p peri-studio', cwd: '/workspace', env: { CI: '1' }, timeout: 120_000 },
      result: { stdout: '', output: 'test result: ok', stderr: '', exitCode: 0 },
    }} />);

    fireEvent.click(document.querySelector('.tool-card__summary')!);
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

    fireEvent.click(document.querySelector('.tool-card__summary')!);
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

    fireEvent.click(document.querySelector('.tool-card__summary')!);
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
    fireEvent.click(document.querySelector('.tool-card__summary')!);
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
