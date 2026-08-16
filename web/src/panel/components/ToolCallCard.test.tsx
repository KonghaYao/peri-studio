import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { observedDuration, ToolCallCard } from './ToolCallCard';

const base = {
  toolCallId: 'tool-123456789', name: 'shell', status: 'completed',
  arguments: { command: 'pwd' }, result: { exitCode: 0 }, publicError: null,
  resultOmitted: false, resultBytes: 14,
  startedAt: '2026-08-13T00:00:00.000Z', completedAt: '2026-08-13T00:00:01.250Z',
};

describe('ToolCallCard', () => {
  it('shows structured execution facts and honest observed duration', () => {
    render(() => <ToolCallCard toolCall={base} />);
    expect(screen.getByText('shell')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Hub observed 1.3 s')).toBeInTheDocument();
    expect(screen.getByText(/"command": "pwd"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Input' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Output' })).toBeInTheDocument();
  });

  it('opens public errors without rendering payload markup as HTML', () => {
    render(() => <ToolCallCard toolCall={{ ...base, status: 'error', result: null, publicError: { code: 'DENIED', message: '<img src=x onerror=alert(1)>' } }} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
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
    expect(screen.getByText('Output not loaded')).toBeInTheDocument();
    expect(screen.getByText(/of about 8.0 KB/)).toBeInTheDocument();
    expect(screen.queryByText('The tool returned no displayable output.')).not.toBeInTheDocument();
    unmount();
    render(() => <ToolCallCard toolCall={{ ...base, result: null, resultOmitted: false, resultBytes: null }} />);
    expect(screen.getByText('The tool returned no displayable output.')).toBeInTheDocument();
  });

  it('shows a public error and omission provenance independently', () => {
    render(() => <ToolCallCard toolCall={{ ...base, status: 'error', result: null, resultOmitted: true, resultBytes: 5000, publicError: { code: 'TOO_LARGE', message: 'safe failure' } }} />);
    expect(screen.getByText(/TOO_LARGE: safe failure/)).toBeInTheDocument();
    expect(screen.getByText('Output not loaded')).toBeInTheDocument();
  });

  it('does not interpret missing legacy provenance as an explicit empty result', () => {
    render(() => <ToolCallCard toolCall={{ ...base, result: null, resultOmitted: null, resultBytes: null }} />);
    expect(screen.getByText(/legacy projection did not record/)).toBeInTheDocument();
    expect(screen.queryByText('The tool returned no displayable output.')).not.toBeInTheDocument();
  });

  it('renders the server-authoritative permission wait without claiming an empty result', () => {
    render(() => <ToolCallCard toolCall={{ ...base, status: 'awaitingPermission', result: null, resultOmitted: false, completedAt: null }} />);
    expect(screen.getByText('Waiting for your permission')).toBeInTheDocument();
    expect(screen.queryByText('The tool returned no displayable output.')).not.toBeInTheDocument();
  });
});
