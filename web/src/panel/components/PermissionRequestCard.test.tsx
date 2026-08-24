import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionRequestCard } from './PermissionRequestCard';

const permission = {
  permissionId: 'permission-123456789', turnId: 'turn-1', toolCallId: 'tool-123456789',
  title: 'Run shell command', description: "Read the current project's Git status", options: ['allowOnce', 'allowSession', 'deny'] as Array<'allowOnce' | 'allowSession' | 'deny'>, status: 'pending',
  expiresAt: '2099-08-13T12:00:00Z', decision: null,
  optionIds: { allowOnce: 'allow-once', allowSession: 'allow-session', deny: 'reject-once' },
};

describe('PermissionRequestCard', () => {
  afterEach(() => vi.useRealTimers());

  it('submits only the first security decision and exposes known request facts', () => {
    const resolve = vi.fn();
    const view = render(() => <PermissionRequestCard permission={permission} readOnly={false} onResolve={resolve} />);
    expect(screen.getByText('Run shell command')).toBeInTheDocument();
    expect(screen.getByText("Read the current project's Git status")).toBeInTheDocument();
    expect(screen.queryByText('Permission needed')).not.toBeInTheDocument();
    expect(screen.getByText('tool tool-123…')).toHaveAttribute('title', 'tool-123456789');
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(resolve).toHaveBeenCalledExactlyOnceWith('allow', 'allow-once');
    view.unmount();
  });

  it('locks both opposing decisions while delivery is pending', () => {
    render(() => <PermissionRequestCard permission={permission} decision={{ commandId: 'cmd-1', permissionId: permission.permissionId, decision: 'allow', phase: 'pending', retryable: false }} readOnly={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Allow once/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(screen.getByLabelText('Run shell command')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Allowing');
  });

  it('keeps the lock and explains uncertainty instead of offering a contrary decision', () => {
    render(() => <PermissionRequestCard permission={permission} decision={{ commandId: 'cmd-1', permissionId: permission.permissionId, decision: 'deny', phase: 'uncertain', retryable: false }} readOnly={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Deny not confirmed');
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Denying/ })).toBeDisabled();
    expect(screen.getByLabelText('Run shell command')).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('button', { name: 'Retry with original request' })).not.toBeInTheDocument();
  });

  it('offers the original command only after a definitely retryable delivery failure', () => {
    const retry = vi.fn();
    render(() => <PermissionRequestCard permission={permission} decision={{ commandId: 'cmd-1', permissionId: permission.permissionId, decision: 'allow', phase: 'uncertain', retryable: true }} readOnly={false} onResolve={vi.fn()} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Retry available');
    fireEvent.click(screen.getByRole('button', { name: 'Retry with original request' }));
    expect(retry).toHaveBeenCalledExactlyOnceWith('cmd-1');
  });

  it('closes mutation affordances for a read-only principal', () => {
    render(() => <PermissionRequestCard permission={permission} readOnly onResolve={vi.fn()} />);
    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
  });

  it('fails closed when a malformed projection has no permission identity', () => {
    const resolve = vi.fn();
    render(() => <PermissionRequestCard permission={{ ...permission, permissionId: null }} readOnly={false} onResolve={resolve} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(resolve).not.toHaveBeenCalled();
  });

  it('discloses when the only available grant lasts for the session', () => {
    const resolve = vi.fn();
    render(() => <PermissionRequestCard permission={{ ...permission, options: ['allowSession', 'deny'] }} readOnly={false} onResolve={resolve} />);
    expect(screen.getByRole('button', { name: 'Allow for this session' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Allow once' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow for this session' }));
    expect(resolve).toHaveBeenCalledWith('allow', 'allow-session');
  });

  it('fails closed when the projection has no recognized allow scope', () => {
    render(() => <PermissionRequestCard permission={{ ...permission, options: ['deny'] }} readOnly={false} onResolve={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Allow/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });

  it('fails closed when a modern projection omits an opaque option identity', () => {
    const resolve = vi.fn();
    render(() => <PermissionRequestCard permission={{ ...permission, optionIds: {} }} readOnly={false} onResolve={resolve} />);
    expect(screen.getByText('Some permission options unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps cancellation available when ACP offers no reject option', () => {
    const resolve = vi.fn();
    render(() => <PermissionRequestCard permission={{ ...permission, options: ['allowOnce'], optionIds: { allowOnce: 'allow-once' } }} readOnly={false} onResolve={resolve} />);
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(resolve).toHaveBeenCalledExactlyOnceWith('deny', undefined);
  });

  it('shows a live countdown and fails closed at the projected deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-13T12:00:00.000Z');
    const resolve = vi.fn();
    const view = render(() => <PermissionRequestCard
      permission={{ ...permission, expiresAt: '2026-08-13T12:01:05.000Z' }}
      readOnly={false}
      onResolve={resolve}
    />);

    expect(screen.getByText('Expires in 1m 5s')).toBeInTheDocument();
    vi.advanceTimersByTime(6_000);
    expect(screen.getByText('Expires in 59s')).toBeInTheDocument();
    vi.advanceTimersByTime(59_000);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(resolve).not.toHaveBeenCalled();
    view.unmount();

    render(() => <PermissionRequestCard
      permission={{ ...permission, expiresAt: '2026-08-13T12:01:05.000Z' }}
      decision={{ commandId: 'cmd-expired', permissionId: permission.permissionId, decision: 'allow', phase: 'uncertain', retryable: true }}
      readOnly={false}
      onResolve={vi.fn()}
      onRetry={vi.fn()}
    />);
    expect(screen.getByRole('alert')).toHaveTextContent('Allow not confirmed · Request expired');
    expect(screen.getByRole('button', { name: 'Retry with original request' })).toBeDisabled();
    expect(screen.queryByText('Retry available')).not.toBeInTheDocument();
  });

  it('fails closed for explicitly malformed expirations while preserving legacy absence', () => {
    const malformed = render(() => <PermissionRequestCard
      permission={{ ...permission, expiresAt: '123' }}
      readOnly={false}
      onResolve={vi.fn()}
    />);
    expect(screen.getByText('Expiration unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    malformed.unmount();

    const wrongType = render(() => <PermissionRequestCard
      permission={{ ...permission, expiresAt: null }}
      readOnly={false}
      onResolve={vi.fn()}
    />);
    expect(screen.getByText('Expiration unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    wrongType.unmount();

    render(() => <PermissionRequestCard
      permission={{ ...permission, expiresAt: undefined }}
      readOnly={false}
      onResolve={vi.fn()}
    />);
    expect(screen.queryByText(/Expir/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });
});
