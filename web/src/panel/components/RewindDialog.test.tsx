import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRewindFlow } from '../lib/rewind-assembly';
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
    expect(panel).toHaveClass('inset-y-8', 'right-52', 'left-auto', 'w-[264px]', 'wide:w-[310px]', 'translate-x-0', 'translate-y-0', 'rounded-14', 'border-border-subtle');
    expect(panel).not.toHaveClass('w-[min(400px,calc(100vw-2*var(--space-20)))]');
    expect(panel).toHaveClass('max-[959px]:inset-y-0', 'max-[959px]:w-[min(92vw,360px)]', 'max-[959px]:rounded-none');
    expect(document.querySelector('[data-dialog-overlay]')).toHaveClass('bg-transparent', 'max-[959px]:bg-scrim');
    expect(screen.getByRole('heading', { name: 'Rewind session' })).toHaveClass('uppercase', 'text-11');
    expect(screen.getByRole('button', { name: 'Close rewind panel' })).toBeInTheDocument();
    const target = screen.getByRole('option', { name: /Fix the login flow/ });
    expect(screen.getByRole('listbox', { name: 'Rewind target message' })).toContainElement(target);
    expect(screen.queryByRole('button', { name: 'Rewind session and files' })).not.toBeInTheDocument();
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
