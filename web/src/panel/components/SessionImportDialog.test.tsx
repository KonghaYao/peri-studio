import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { SessionImportDialog, type SessionImportDialogProps } from './SessionImportDialog';

function props(overrides: Partial<SessionImportDialogProps> = {}): SessionImportDialogProps {
  return {
    open: true,
    project: { id: 'p1', name: 'Perihelion', cwd: '/repo', instanceId: 'local', createdAt: null, updatedAt: null, archivedAt: null },
    sessions: [
      { sessionId: 'acp-one', title: 'Architecture refactor', status: null, updatedAt: '2026-08-13T10:00:00Z', cwd: '/repo' },
      { sessionId: 'acp-other', title: 'Other directory', status: null, updatedAt: null, cwd: '/other' },
    ],
    discovering: false,
    onDiscover: vi.fn(() => true),
    onClose: vi.fn(),
    onImport: vi.fn(() => true),
    ...overrides,
  };
}

describe('SessionImportDialog', () => {
  it('discovers project sessions when opened and exposes retry after failure', () => {
    const onDiscover = vi.fn((_projectId, _committed, failed) => { failed('ACP instance temporarily unavailable'); return true; });
    render(() => <SessionImportDialog {...props({ sessions: [], onDiscover })} />);
    expect(onDiscover).toHaveBeenCalledWith('p1', expect.any(Function), expect.any(Function));
    expect(screen.getByRole('alert')).toHaveTextContent('ACP instance temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh ACP sessions' }));
    expect(onDiscover).toHaveBeenCalledTimes(2);
  });

  it('shows a non-interactive loading state while discovery is running', () => {
    render(() => <SessionImportDialog {...props({ sessions: [], discovering: true })} />);
    expect(screen.getByText('Reading ACP sessions…')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search sessions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import selected session' })).toBeDisabled();
  });

  it('shows only cwd-scoped candidates and filters by stable id', () => {
    render(() => <SessionImportDialog {...props()} />);
    expect(screen.getByRole('button', { name: /Architecture refactor/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Other directory/ })).not.toBeInTheDocument();
    fireEvent.input(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: 'missing' } });
    expect(screen.getByText('No sessions to import')).toBeInTheDocument();
  });

  it('closes only after the import commits', () => {
    const onClose = vi.fn();
    let commit = () => {};
    const onImport = vi.fn((_projectId, _sessionId, onCommitted) => { commit = onCommitted; return true; });
    render(() => <SessionImportDialog {...props({ onClose, onImport })} />);
    fireEvent.click(screen.getByRole('button', { name: /Architecture refactor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected session' }));
    expect(onImport).toHaveBeenCalledWith('p1', 'acp-one', expect.any(Function), expect.any(Function));
    expect(onClose).not.toHaveBeenCalled();
    commit();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows an explicit fact-only review before import', () => {
    render(() => <SessionImportDialog {...props()} />);
    expect(screen.queryByRole('region', { name: 'Pending import details' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Architecture refactor/ }));
    const review = screen.getByRole('region', { name: 'Pending import details' });
    expect(review).toHaveTextContent('Architecture refactor');
    expect(review).toHaveTextContent('/repo');
    expect(review).toHaveTextContent('acp-one');
    expect(review).toHaveTextContent('ACP does not provide a message preview');
    expect(screen.getByRole('button', { name: /Architecture refactor/ })).toHaveAttribute('aria-controls', 'import-session-review');
  });

  it('cannot submit a selection hidden by search or catalog refresh', () => {
    const onImport = vi.fn(() => true);
    const view = render(() => <SessionImportDialog {...props({ onImport })} />);
    fireEvent.click(screen.getByRole('button', { name: /Architecture refactor/ }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: 'missing' } });
    expect(screen.getByRole('button', { name: 'Import selected session' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Import selected session' }));
    expect(onImport).not.toHaveBeenCalled();
    view.unmount();
  });

  it('retains selection and dialog context after a definite failure', () => {
    const onClose = vi.fn();
    const onImport = vi.fn((_projectId, _sessionId, _committed, failed) => { failed('failed'); return true; });
    render(() => <SessionImportDialog {...props({ onClose, onImport })} />);
    fireEvent.click(screen.getByRole('button', { name: /Architecture refactor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected session' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Architecture refactor/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Import selected session' })).not.toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The server rejected this import');
  });

  it('distinguishes an uncertain timeout from a definite rejection', () => {
    const onImport = vi.fn((_projectId, _sessionId, _committed, failed) => { failed('uncertain'); return true; });
    render(() => <SessionImportDialog {...props({ onImport })} />);
    fireEvent.click(screen.getByRole('button', { name: /Architecture refactor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected session' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The import result is not confirmed yet');
    expect(screen.getByRole('alert')).toHaveTextContent('Do not create a duplicate request');
  });
});
