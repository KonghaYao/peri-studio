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

  it('shows only a breathing loading signal overlayed in the title gutter', () => {
    render(() => <ProjectSessionRow {...props({ state: { label: 'Agent is working', tone: 'busy' } })} />);

    const loading = screen.getByTestId('session-loading-wave');
    const copy = screen.getByTestId('session-copy');
    expect(loading).toHaveAttribute('aria-label', 'Agent is working');
    expect(loading).toHaveAttribute('data-tone', 'busy');
    expect(loading).toHaveClass('absolute', 'left-8', '-translate-y-1/2');
    expect(loading.querySelector('[data-testid="session-loading-wave-halo"]')).toHaveClass('animate-ping', 'motion-reduce:animate-none');
    expect(screen.getByTestId('session-loading-wave-core')).toHaveClass('bg-success-solid');
    expect(screen.getByTestId('session-row')).toContainElement(loading);
    expect(screen.getByRole('button', { name: /^Architecture refactor/ })).not.toContainElement(loading);
    expect(loading.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(copy.querySelector(':scope > svg')).toBeNull();
    expect(screen.getByTestId('session-menu')).toBeInTheDocument();
    expect(screen.getByText('Architecture refactor')).toHaveClass('text-13', 'text-content-primary');
  });

  it('does not render a status lamp for idle or ready sessions', () => {
    const { unmount } = render(() => <ProjectSessionRow {...props({ state: { label: 'Ready', tone: 'ready' } })} />);
    expect(screen.queryByTestId('session-loading-wave')).not.toBeInTheDocument();
    unmount();

    render(() => <ProjectSessionRow {...props({ state: { label: 'Idle', tone: 'idle' } })} />);
    expect(screen.queryByTestId('session-loading-wave')).not.toBeInTheDocument();
  });

  it('renders a static danger lamp and a pulsing attention lamp', () => {
    const { unmount } = render(() => <ProjectSessionRow {...props({ state: { label: 'Crashed', tone: 'danger', detail: 'Run exited abnormally · session kept' } })} />);
    const danger = screen.getByTestId('session-loading-wave');
    expect(danger).toHaveAttribute('data-tone', 'danger');
    expect(danger).toHaveClass('absolute', 'left-8');
    expect(screen.getByTestId('session-loading-wave-core')).toHaveClass('bg-danger-solid');
    expect(screen.queryByTestId('session-loading-wave-halo')).not.toBeInTheDocument();
    unmount();

    render(() => <ProjectSessionRow {...props({ state: { label: 'Approval', tone: 'attention', detail: 'Awaiting your permission' } })} />);
    expect(screen.getByTestId('session-loading-wave')).toHaveAttribute('data-tone', 'attention');
    expect(screen.getByTestId('session-loading-wave-core')).toHaveClass('bg-warning-solid');
    expect(screen.getByTestId('session-loading-wave-halo')).toHaveClass('animate-ping');
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
    const renameDialog = screen.getByRole('dialog', { name: 'Rename Architecture refactor' });
    expect(renameDialog.firstElementChild).toHaveClass('ui-popover');
    expect(screen.getByTestId('rename-popover')).toBeInTheDocument();
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
