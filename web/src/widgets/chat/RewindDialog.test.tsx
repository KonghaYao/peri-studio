import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRewindFlow } from '@/features/runtime/rewind-assembly';
import { RewindDialog } from './RewindDialog';

afterEach(() => setRewindFlow({ kind: 'closed' }));

describe('RewindDialog', () => {
  it('shows target selection before any destructive confirmation', () => {
    setRewindFlow({
      kind: 'select_target', chatId: 'chat-1',
      candidates: [{ messageId: 'message-1', preview: 'Fix the login flow' }],
    });
    render(() => <RewindDialog open onClose={() => undefined} />);
    const panel = screen.getByRole('dialog');
    expect(panel).toHaveAttribute('data-resource-panel', 'rewind');
    expect(panel).toHaveClass('inset-y-8', 'right-52', 'left-auto', 'w-(--workbench-panel-width)', 'wide:w-(--workbench-panel-width-wide)', 'translate-x-0', 'translate-y-0', 'rounded-14', 'border-border-subtle');
    expect(panel).not.toHaveClass('w-(--container-dialog-default)');
    expect(panel).toHaveClass('max-desk:inset-y-0', 'max-desk:w-(--container-rewind-compact)', 'max-desk:rounded-none');
    expect(document.querySelector('[data-dialog-overlay]')).toHaveClass('bg-transparent', 'max-desk:bg-scrim');
    expect(panel).toHaveTextContent('Rewind session');
    expect(screen.getByRole('heading', { name: 'Rewind session', hidden: true })).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Close rewind panel' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose a message to rewind to' })).toBeInTheDocument();
    expect(screen.getByText(/Messages after it will be removed/)).toBeInTheDocument();
    const target = screen.getByRole('option', { name: /Fix the login flow/ });
    expect(screen.getByRole('listbox', { name: 'Rewind target message' })).toContainElement(target);
    expect(screen.queryByRole('button', { name: 'Rewind session and files' })).not.toBeInTheDocument();
  });

  it('shows a flat empty state when there are no rewind targets', () => {
    setRewindFlow({ kind: 'select_target', chatId: 'chat-1', candidates: [] });
    render(() => <RewindDialog open onClose={() => undefined} />);
    expect(screen.getByText('No user messages')).toBeInTheDocument();
    expect(screen.getByText('The current session has no user messages to rewind to.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Rewind target message' })).not.toBeInTheDocument();
  });

  it('shows normalized file impact only after a fingerprint-bound preview', () => {
    setRewindFlow({
      kind: 'confirm', chatId: 'chat-1', candidates: [],
      candidate: { messageId: 'message-1', preview: 'Fix the login flow' },
      previewFingerprint: 'a'.repeat(64),
      fileChanges: [{ path: 'src/main.rs', kind: 'edit' }],
    });
    render(() => <RewindDialog open onClose={() => undefined} />);
    expect(screen.getByText('src/main.rs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rewind session and files' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Confirm the rewind impact' })).toBeInTheDocument();
  });

  it('never offers retry when execution delivery is unknown', () => {
    setRewindFlow({ kind: 'delivery_unknown', chatId: 'chat-1', detail: 'The server has not confirmed the result yet.' });
    render(() => <RewindDialog open onClose={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('re-execution is not offered');
    expect(screen.queryByRole('button', { name: /retry|re-execute|query again/i })).not.toBeInTheDocument();
  });

  it('cannot close while destructive execution is in flight', async () => {
    const onClose = vi.fn();
    setRewindFlow({
      kind: 'executing', chatId: 'chat-1', commandId: 'command-1',
      candidate: { messageId: 'message-1', preview: 'Fix the login flow' },
      fileChanges: [{ path: 'src/main.rs', kind: 'edit' }],
    });
    render(() => <RewindDialog open onClose={onClose} />);
    const closeButton = screen.getByRole('button', { name: 'Close rewind panel' });
    expect(closeButton).toBeDisabled();
    await fireEvent.click(closeButton);
    expect(onClose).not.toHaveBeenCalled();
  });
});
