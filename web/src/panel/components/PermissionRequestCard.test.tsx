import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { PermissionRequestCard } from './PermissionRequestCard';

const permission = {
  permissionId: 'permission-123456789', turnId: 'turn-1', toolCallId: 'tool-123456789',
  title: 'Run shell command', description: "Read the current project's Git status", status: 'pending',
  expiresAt: '2026-08-13T12:00:00Z', decision: null,
};

describe('PermissionRequestCard', () => {
  it('submits only the first security decision and exposes known request facts', () => {
    const resolve = vi.fn();
    const view = render(() => <PermissionRequestCard permission={permission} readOnly={false} onResolve={resolve} />);
    expect(screen.getByText('Run shell command')).toBeInTheDocument();
    expect(screen.getByText("Read the current project's Git status")).toBeInTheDocument();
    expect(screen.queryByText('Permission needed')).not.toBeInTheDocument();
    expect(screen.getByText('tool tool-123…')).toHaveAttribute('title', 'tool-123456789');
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(resolve).toHaveBeenCalledExactlyOnceWith('allow');
    view.unmount();
  });

  it('locks both opposing decisions while delivery is pending', () => {
    render(() => <PermissionRequestCard permission={permission} decision={{ commandId: 'cmd-1', permissionId: permission.permissionId, decision: 'allow', phase: 'pending', retryable: false }} readOnly={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Allowing/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(screen.getByLabelText('Run shell command')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Allowing');
  });

  it('keeps the lock and explains uncertainty instead of offering a contrary decision', () => {
    render(() => <PermissionRequestCard permission={permission} decision={{ commandId: 'cmd-1', permissionId: permission.permissionId, decision: 'deny', phase: 'uncertain', retryable: false }} readOnly={false} onResolve={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Deny not confirmed');
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
  });

  it('fails closed when a malformed projection has no permission identity', () => {
    const resolve = vi.fn();
    render(() => <PermissionRequestCard permission={{ ...permission, permissionId: null }} readOnly={false} onResolve={resolve} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(resolve).not.toHaveBeenCalled();
  });
});
