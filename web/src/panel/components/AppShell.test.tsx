import { fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ProjectSidebar', () => ({
  ProjectSidebar: (props: { collapsed?: boolean; onToggleCollapsed?: () => void }) => <div data-testid="project-sidebar" data-collapsed={String(!!props.collapsed)}><button aria-label="Toggle sidebar" onClick={props.onToggleCollapsed}>Toggle sidebar</button></div>,
}));
vi.mock('./ChatView', () => ({ ChatView: () => <div /> }));
vi.mock('./SettingsDialog', () => ({ SettingsDialog: () => null }));
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

    expect(handle).toHaveAttribute('aria-valuenow', '304');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '328');

    fireEvent.pointerDown(handle, { button: 0 });
    expect(document.body).toHaveClass('sidebar-resizing');
    fireEvent.pointerMove(window, { clientX: 600 });
    expect(handle).toHaveAttribute('aria-valuenow', '480');
    fireEvent.pointerUp(window);
    expect(document.body).not.toHaveClass('sidebar-resizing');
    expect(shell().style.gridTemplateColumns).toBe('480px minmax(0, 1fr)');
  });

  it('collapses to a rail and restores the saved desktop width', () => {
    render(() => <AppShell />);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(screen.getByTestId('project-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByRole('separator', { name: 'Resize sidebar' })).not.toBeInTheDocument();
    expect(shell().style.gridTemplateColumns).toBe('64px minmax(0, 1fr)');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(screen.getByTestId('project-sidebar')).toHaveAttribute('data-collapsed', 'false');
    expect(shell().style.gridTemplateColumns).toBe('304px minmax(0, 1fr)');
  });
});
