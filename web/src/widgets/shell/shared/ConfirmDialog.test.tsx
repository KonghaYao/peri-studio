// ConfirmDialog 行为测试：AlertDialog 确认弹窗契约。
// ChatHeader（关闭运行实例）与 ProjectSidebar（归档项目 / 归档会话）
// 三处的确认交互断言自此统一在此验证。

import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('renders eyebrow, title, description and a danger primary action', async () => {
    render(() => <ConfirmDialog
      open
      eyebrow="Project management"
      title="Archive “Perihelion”?"
      description="The project will be hidden from the sidebar; its 5 saved sessions will not be deleted."
      confirmLabel="Archive project"
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />);

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    expect(screen.getByText('Project management')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Archive “Perihelion”?' })).toBeInTheDocument();
    expect(screen.getByText(/hidden from the sidebar/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Archive project' });
    expect(confirm).toBeEnabled();
    expect(confirm).not.toHaveAttribute('variant');
    expect(confirm).toHaveClass('text-danger');
    expect(screen.queryByText(/Warning|running instance/i)).not.toBeInTheDocument();
  });

  it('renders the warning line only when provided', async () => {
    render(() => <ConfirmDialog
      open
      title="Close the current running instance?"
      description="The session and history on the left are kept."
      warning="The Agent is still working. Closing the instance stops the current generation and running tools."
      confirmLabel="Close instance"
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />);

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    expect(screen.getByText('The Agent is still working. Closing the instance stops the current generation and running tools.')).toBeInTheDocument();
    expect(screen.queryByText('Project management')).not.toBeInTheDocument();
  });

  it('delegates cancel and confirm, respecting busy and disabled states', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(() => <ConfirmDialog
      open
      title="Archive “session”?"
      description="The session will be hidden from the current project list."
      cancelDisabled
      confirmBusy
      confirmDisabled
      confirmLabel="Archive session"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />);

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    const cancel = screen.getByRole('button', { name: /Cancel/ });
    const confirm = screen.getByRole('button', { name: /Archive session/ });
    expect(cancel).toBeDisabled();
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(cancel);
    fireEvent.click(confirm);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls back when the actions are available', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(() => <ConfirmDialog
      open
      title="Archive project?"
      description="The project will be hidden from the sidebar."
      confirmLabel="Archive project"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />);

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Archive project' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('leaves a controlled confirm dialog mounted after Archive so the parent can wait for commit', async () => {
    const onConfirm = vi.fn();
    render(() => <ConfirmDialog
      open
      title="Archive “session”?"
      description="The session will be hidden from the current project list."
      confirmLabel="Archive session"
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />);

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Archive session' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(document.querySelector('[data-alert-dialog-overlay]')).toBeInTheDocument();
  });
});
