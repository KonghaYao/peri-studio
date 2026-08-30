import { fireEvent, render, screen, cleanup } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import { ProjectSessionRow, type ProjectSessionRowProps } from './ProjectSessionRow';

const session: ProjectSessionInfo = {
  id: 'acp-12345678',
  projectId: 'p1',
  title: 'Architecture refactor',
  lifecycle: 'ready',
  updatedAt: '2026-08-13T10:00:00Z',
  lastOpenedAt: null,
  activeChatId: null,
  archivedAt: null,
};

function props(overrides: Partial<ProjectSessionRowProps> = {}): ProjectSessionRowProps {
  return {
    session,
    state: { label: 'Not started · session saved', tone: 'idle' },
    selected: false,
    navigationBusy: false,
    readOnly: false,
    renameOpen: false,
    menuOpen: false,
    replacementBusy: false,
    pinned: false,
    onNavigate: vi.fn(),
    onOpen: vi.fn(),
    onSelectRuntime: vi.fn(),
    onRenameOpenChange: vi.fn(),
    onMenuOpenChange: vi.fn(),
    onRename: vi.fn(() => true),
    onCreateReplacement: vi.fn(),
    onArchiveRequest: vi.fn(),
    onTogglePin: vi.fn(),
    ...overrides,
  };
}

describe('ProjectSessionRow', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows only a breathing loading signal and keeps the session title icon-free', () => {
    render(() => <ProjectSessionRow {...props({ state: { label: 'Agent is working', tone: 'busy' } })} />);

    const loading = screen.getByRole('status', { name: 'Agent is working' });
    expect(loading).toHaveClass('session-loading-wave');
    expect(loading.querySelector('.session-loading-wave__halo')).toHaveClass('animate-ping', 'motion-reduce:animate-none');
    expect(loading.querySelector('.session-loading-wave__core')).toHaveClass('bg-success-solid');
    expect(screen.getByRole('button', { name: /^Architecture refactor/ }).querySelector(':scope > svg')).toBeNull();
    expect(screen.getByRole('button', { name: 'Session actions' })).toHaveClass('session-menu');
    expect(screen.getByText('Architecture refactor')).toHaveClass('text-13', 'text-content-primary');
  });

  it('does not render status dots for idle, ready, warning, or failed sessions', () => {
    const { unmount } = render(() => <ProjectSessionRow {...props({ state: { label: 'Ready', tone: 'ready' } })} />);
    expect(document.querySelector('.session-status-dot')).toBeNull();
    expect(document.querySelector('.session-loading-wave')).toBeNull();
    unmount();

    render(() => <ProjectSessionRow {...props({ state: { label: 'Failed', tone: 'danger' } })} />);
    expect(document.querySelector('.session-status-dot')).toBeNull();
    expect(document.querySelector('.session-loading-wave')).toBeNull();
  });

  it('delegates server-authoritative opening without navigating early', () => {
    const value = props();
    render(() => <ProjectSessionRow {...value} />);

    fireEvent.click(screen.getByRole('button', { name: /^Architecture refactor/ }));

    expect(value.onOpen).toHaveBeenCalledWith('acp-12345678', value.onNavigate);
    expect(value.onNavigate).not.toHaveBeenCalled();
  });

  it('lets read-only users select an already running chat locally', () => {
    const value = props({
      readOnly: true,
      session: { ...session, activeChatId: 'chat-live' },
    });
    render(() => <ProjectSessionRow {...value} />);

    fireEvent.click(screen.getByRole('button', { name: /^Architecture refactor/ }));

    expect(value.onSelectRuntime).toHaveBeenCalledWith('acp-12345678', 'chat-live');
    expect(value.onNavigate).toHaveBeenCalledOnce();
    expect(value.onOpen).not.toHaveBeenCalled();
  });

  it('uses the shared popover surface for a controlled rename form', () => {
    render(() => <ProjectSessionRow {...props({ renameOpen: true })} />);
    expect(screen.getByRole('dialog', { name: 'Rename Architecture refactor' })).toHaveClass('ui-popover');
    expect(screen.getByRole('textbox', { name: 'Session name' }).closest('form')).toHaveClass('rename-popover');
  });

  it('submits a trimmed rename and closes only after committed', async () => {
    let commit: (() => void) | undefined;
    const value = props({
      renameOpen: true,
      onRename: vi.fn((_id, _name, onCommitted) => {
        commit = onCommitted;
        return true;
      }),
    });
    render(() => <ProjectSessionRow {...value} />);

    fireEvent.input(screen.getByRole('textbox', { name: 'Session name' }), { target: { value: '  New name  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(value.onRename).toHaveBeenCalledWith('acp-12345678', 'New name', expect.any(Function), expect.any(Function));
    expect(value.onRenameOpenChange).not.toHaveBeenCalledWith(false);
    commit?.();
    expect(value.onRenameOpenChange).toHaveBeenCalledWith(false);
  });

  it('exposes archive as a direct action in the floating button group', () => {
    const value = props();
    render(() => <ProjectSessionRow {...value} />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive session' }));

    expect(value.onArchiveRequest).toHaveBeenCalledWith('acp-12345678');
  });

  it('keeps rename in the overflow menu while pin and archive stay visible on hover', () => {
    const value = props({ menuOpen: true });
    render(() => <ProjectSessionRow {...value} />);

    expect(screen.getByRole('button', { name: 'Pin session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive session' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Rename session' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Archive session' })).not.toBeInTheDocument();
  });

  it('keeps pin state explicit with a direct toggle action', () => {
    const value = props({ pinned: true });
    render(() => <ProjectSessionRow {...value} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unpin session' }));
    expect(value.onTogglePin).toHaveBeenCalledOnce();
  });

  it('allows archiving a session with a live runtime through server metadata', () => {
    const value = props({
      session: { ...session, activeChatId: 'chat-live' },
    });
    render(() => <ProjectSessionRow {...value} />);

    const archive = screen.getByRole('button', { name: 'Archive session' });
    expect(archive).toBeEnabled();
    fireEvent.click(archive);
    expect(value.onArchiveRequest).toHaveBeenCalledWith('acp-12345678');
  });
});
