import { fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../widgets/sidebar/ProjectSidebar', () => ({
  ProjectSidebar: (props: { onOpenSystem?: () => void }) => <div data-testid="project-sidebar"><button type="button" onClick={props.onOpenSystem}>System information</button></div>,
}));
vi.mock('./ChatView', () => ({ ChatView: (props: { onOpenResources?: () => void; onOpenMcp?: () => void }) => <><button type="button" onClick={props.onOpenResources}>Open workspace resources</button><button type="button" onClick={props.onOpenMcp}>Open MCP resources</button></> }));
vi.mock('./shared/ProjectDrawer', () => ({
  ProjectDrawer: (props: { children: JSX.Element; ref?: (element: HTMLElement) => void }) => <aside ref={props.ref}>{props.children}</aside>,
}));

import { AppShell } from './AppShell';

function shell() {
  return document.querySelector<HTMLElement>('.app-shell')!;
}

describe('AppShell desktop sidebar', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resizes within accessible keyboard and pointer limits', () => {
    render(() => <AppShell />);
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });

    expect(handle).toHaveAttribute('aria-valuenow', '242');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '266');

    fireEvent.pointerDown(handle, { button: 0 });
    expect(document.body).toHaveClass('sidebar-resizing');
    fireEvent.pointerMove(window, { clientX: 600 });
    expect(handle).toHaveAttribute('aria-valuenow', '480');
    fireEvent.pointerUp(window);
    expect(document.body).not.toHaveClass('sidebar-resizing');
    expect(shell().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) auto');
  });

  it('keeps the desktop sidebar at its current width', () => {
    render(() => <AppShell />);

    expect(screen.getByTestId('project-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toBeInTheDocument();
    expect(shell().style.gridTemplateColumns).toBe('242px minmax(0, 1fr) auto');
    const conversation = document.querySelector('.conversation-pane')!;
    const resources = screen.getByRole('complementary', { name: 'Workspace resources' });
    expect(resources).toBeInTheDocument();
    expect(conversation.compareDocumentPosition(resources) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens global machine information from the sidebar footer entry', async () => {
    render(() => <AppShell />);
    await fireEvent.click(screen.getByRole('button', { name: 'System information' }));
    expect(screen.getByRole('dialog', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Machines' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens only chat-scoped filesystem and MCP resources from the compact chat header', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    render(() => <AppShell />);

    const resources = screen.getByRole('button', { name: 'Open workspace resources' });
    await fireEvent.click(resources);

    expect(screen.getByRole('dialog', { name: 'Workspace resources' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explorer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MCP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Source Control' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Machines' })).not.toBeInTheDocument();
  });

  it('opens Explorer from the medium resource rail', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('1199'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    render(() => <AppShell />);

    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'false');
    await fireEvent.click(screen.getByRole('button', { name: 'Explorer' }));
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'true');
  });
});
