import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  navigateProjectSession: vi.fn(),
  openingSessionId: vi.fn(() => null as string | null),
  projectSessions: vi.fn(() => [{ id: 'acp-12345678', projectId: 'p1', title: 'New conversation', lifecycle: 'ready', updatedAt: '2026-08-13T10:00:00Z', activeChatId: null }]),
  projects: vi.fn(() => [{ id: 'p1', name: 'Perihelion', cwd: '/repo', archivedAt: null }]),
  readOnly: vi.fn(() => false),
  selectedSessionId: vi.fn(() => null),
}));
vi.mock('../../panel/store', () => store);
vi.mock('../../panel/lib/auth-state', () => ({ readOnly: store.readOnly }));

import { SessionSearch } from './SessionSearch';

describe('SessionSearch', () => {
  beforeEach(() => {
    store.navigateProjectSession.mockReset();
    store.openingSessionId.mockReturnValue(null);
  });

  it('keeps the search context until the exact open commits', async () => {
    const close = vi.fn();
    let callbacks: { onCommitted?: () => void } = {};
    store.navigateProjectSession.mockImplementation((_id, value) => { callbacks = value; return true; });
    render(() => <SessionSearch open onClose={close} />);
    fireEvent.input(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: 'New conversation' } });
    fireEvent.click(await screen.findByRole('option'));
    expect(store.navigateProjectSession).toHaveBeenCalledWith('acp-12345678', expect.any(Object));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('option')).toHaveTextContent('New conversation · …12345678');
    callbacks.onCommitted?.();
    expect(close).toHaveBeenCalledOnce();
  });

  it('retains the query and explains a definite failure inline', async () => {
    store.navigateProjectSession.mockImplementation((_id, callbacks) => { callbacks.onFailed('ACP instance offline'); return true; });
    render(() => <SessionSearch open onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Search sessions' });
    fireEvent.input(input, { target: { value: 'Perihelion' } });
    fireEvent.click(await screen.findByRole('option'));
    expect(input).toHaveValue('Perihelion');
    expect(screen.getByRole('alert')).toHaveTextContent('ACP instance offline');
  });

  it('does not imply failure or close when the open result is unknown', async () => {
    const close = vi.fn();
    store.navigateProjectSession.mockImplementation((_id, callbacks) => { callbacks.onUncertain(); return true; });
    render(() => <SessionSearch open onClose={close} />);
    const input = screen.getByRole('textbox', { name: 'Search sessions' });
    fireEvent.input(input, { target: { value: 'New conversation' } });
    fireEvent.click(await screen.findByRole('option'));
    expect(close).not.toHaveBeenCalled();
    expect(input).toHaveValue('New conversation');
    expect(screen.getByRole('alert')).toHaveTextContent('Opening is not confirmed yet');
    expect(screen.getByRole('alert')).toHaveTextContent('The current session was not switched');
  });

  it('keeps listbox keyboard navigation semantic while selecting the exact session', async () => {
    render(() => <SessionSearch open onClose={() => {}} />);
    fireEvent.input(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: 'New conversation' } });
    const listbox = await screen.findByRole('listbox', { name: 'Search results' });
    const option = screen.getByRole('option', { name: /New conversation/ });
    fireEvent.focusIn(listbox);
    await Promise.resolve();
    expect(option).toHaveFocus();
    expect(option).toHaveAttribute('aria-selected', 'false');
  });
});
