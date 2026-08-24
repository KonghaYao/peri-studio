import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { PendingPermission } from '../lib/control-view';
import type { PermissionDecisionState } from '../lib/permission-delivery';
import { PermissionQueue } from './PermissionQueue';

function permission(id: string, title: string): PendingPermission {
  return { permissionId: id, turnId: 'turn-1', toolCallId: `tool-${id}`, title, description: null, options: ['allowOnce', 'deny'], optionIds: { allowOnce: `${id}-allow`, deny: `${id}-reject` }, status: 'pending', decision: null };
}

describe('PermissionQueue', () => {
  it('makes every pending request discoverable without submitting on navigation', () => {
    const resolve = vi.fn();
    render(() => <PermissionQueue permissions={[permission('p1', 'Read file'), permission('p2', 'Run command')]} decisions={new Map()} readOnly={false} onResolve={resolve} />);

    expect(screen.getByLabelText('Pending permission requests, 2 total')).toHaveTextContent('1 / 2');
    expect(screen.getByLabelText('Pending permission requests, 2 total')).not.toHaveTextContent('pending');
    expect(screen.getByText('Read file')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next permission' }));
    expect(screen.getByText('Run command')).toBeInTheDocument();
    expect(screen.getByLabelText('Pending permission requests, 2 total')).toHaveTextContent('2 / 2');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps the selected permission identity across unrelated projection updates', () => {
    const [items, setItems] = createSignal([permission('p1', 'First item'), permission('p2', 'Second item')]);
    render(() => <PermissionQueue permissions={items()} decisions={new Map()} readOnly={false} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next permission' }));
    setItems([permission('p0', 'New prepended item'), ...items()]);

    expect(screen.getByText('Second item')).toBeInTheDocument();
    expect(screen.getByLabelText('Pending permission requests, 3 total')).toHaveTextContent('3 / 3');
  });

  it('advances predictably when the selected request disappears', () => {
    const [items, setItems] = createSignal([permission('p1', 'First item'), permission('p2', 'Second item'), permission('p3', 'Third item')]);
    render(() => <PermissionQueue permissions={items()} decisions={new Map()} readOnly={false} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next permission' }));
    setItems([permission('p1', 'First item'), permission('p3', 'Third item')]);

    expect(screen.getByText('Third item')).toBeInTheDocument();
    expect(screen.getByLabelText('Pending permission requests, 2 total')).toHaveTextContent('2 / 2');
  });

  it('applies a decision lock only to its matching permission id', () => {
    const decisions = new Map<string, PermissionDecisionState>([['p1', { commandId: 'cmd-1', permissionId: 'p1', decision: 'allow', phase: 'pending', retryable: false }]]);
    const resolve = vi.fn();
    render(() => <PermissionQueue permissions={[permission('p1', 'First item'), permission('p2', 'Second item')]} decisions={decisions} readOnly={false} onResolve={resolve} />);
    expect(screen.getByRole('button', { name: /Allow once/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next permission' }));
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(resolve).toHaveBeenCalledExactlyOnceWith('p2', 'deny', 'p2-reject');
  });
});
