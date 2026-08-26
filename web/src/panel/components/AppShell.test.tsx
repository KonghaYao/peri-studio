import { fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ProjectSidebar', () => ({
  ProjectSidebar: () => <div data-testid="project-sidebar" />,
}));
vi.mock('./ChatView', () => ({ ChatView: (props: { onOpenResources?: () => void; onOpenMcp?: () => void; onOpenSystem?: () => void }) => <><button type="button" onClick={props.onOpenResources}>Open workspace resources</button><button type="button" onClick={props.onOpenMcp}>Open MCP resources</button><button type="button" onClick={props.onOpenSystem}>Open machine resources</button></> }));
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
    expect(shell().style.gridTemplateColumns).toBe('480px auto minmax(0, 1fr)');
  });

  it('keeps the desktop sidebar at its current width', () => {
    render(() => <AppShell />);

    expect(screen.getByTestId('project-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toBeInTheDocument();
    expect(shell().style.gridTemplateColumns).toBe('242px auto minmax(0, 1fr)');
    expect(screen.getByRole('complementary', { name: 'Workspace resources' })).toBeInTheDocument();
  });

  it('opens filesystem and Git resources from the compact chat header', async () => {
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
    expect(screen.getByRole('button', { name: 'Source Control' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MCP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Machines' })).toBeInTheDocument();
  });

  it('opens MCP and machine control in the shared compact resource workbench', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    render(() => <AppShell />);

    await fireEvent.click(screen.getByRole('button', { name: 'Open machine resources' }));
    expect(screen.getByRole('dialog', { name: 'Workspace resources' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Machines' })).toHaveAttribute('aria-pressed', 'true');
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
