import { fireEvent, render, screen } from '@solidjs/testing-library';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../widgets/sidebar/ProjectSidebar', () => ({
  ProjectSidebar: (props: { onOpenSystem?: () => void }) => <div data-testid="project-sidebar"><button type="button" onClick={props.onOpenSystem}>System information</button></div>,
}));
vi.mock('@/widgets/chat/ChatView', () => ({ ChatView: (props: { onOpenResources?: () => void; onOpenMcp?: () => void }) => <><button type="button" onClick={props.onOpenResources}>Open workspace resources</button><button type="button" onClick={props.onOpenMcp}>Open MCP resources</button></> }));
vi.mock('./shared/ProjectDrawer', () => ({
  ProjectDrawer: (props: { children: JSX.Element; ref?: (element: HTMLElement) => void }) => <aside ref={props.ref}>{props.children}</aside>,
}));

import { AppShell } from './AppShell';
import { resetResourceProject, setResourceFilePreview } from '@/features/resource/resource-store';

function shell() {
  return screen.getByTestId('app-shell');
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
    resetResourceProject();
  });

  it('avoids arbitrary tailwind bracket sizing outside the resize handle', () => {
    const source = readFileSync(join(import.meta.dirname, 'AppShell.tsx'), 'utf8');
    const sizingUtilities = ['pr-[', 'pl-[', 'pt-[', 'pb-[', 'w-[', 'h-[', 'min-w-[', 'max-w-[', 'min-h-[', 'max-h-[', 'size-[', 'top-[', 'shadow-[', 'tracking-['];

    for (const utility of sizingUtilities) {
      expect(source.includes(utility)).toBe(false);
    }
    expect(source).toMatch(/cursor-col-resize/);
  });

  it('resizes within accessible keyboard and pointer limits', () => {
    render(() => <AppShell />);
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    const grip = handle.querySelector('span')!;

    expect(handle).toHaveAttribute('aria-valuenow', '242');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '266');

    fireEvent.pointerDown(grip, { button: 0 });
    expect(handle).toHaveClass('cursor-col-resize');
    fireEvent.pointerMove(window, { clientX: 600 });
    expect(handle).toHaveAttribute('aria-valuenow', '480');
    fireEvent.pointerUp(window);
    expect(handle).not.toHaveClass('cursor-col-resize');
    expect(shell().style.gridTemplateColumns).toBe('480px minmax(0, 1fr) auto');
  });

  it('collapses the desktop sidebar column from the keyboard shortcut', () => {
    render(() => <AppShell />);

    expect(shell().style.gridTemplateColumns).toBe('242px minmax(0, 1fr) auto');
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(shell().style.gridTemplateColumns).toBe('0px minmax(0, 1fr) auto');
    expect(screen.queryByRole('separator', { name: 'Resize sidebar' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(shell().style.gridTemplateColumns).toBe('242px minmax(0, 1fr) auto');
  });

  it('keeps the desktop sidebar at its current width', () => {
    render(() => <AppShell />);

    expect(screen.getByTestId('project-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toBeInTheDocument();
    expect(shell().style.gridTemplateColumns).toBe('242px minmax(0, 1fr) auto');
    const conversation = screen.getByTestId('conversation-pane');
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

  it('keeps chat in the conversation pane when Git Graph is open on desktop', () => {
    render(() => <AppShell initialResourceView="graph" />);

    expect(screen.getByTestId('conversation-pane')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open workspace resources' })).toBeInTheDocument();
    expect(screen.getByTestId('git-graph-view')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close Git Graph' })).not.toBeInTheDocument();
  });

  it('floats file preview on the left while keeping chat and the resource workbench on desktop', () => {
    render(() => <AppShell initialResourceView="explorer" />);
    setResourceFilePreview({
      requestId: 'shell-file',
      path: 'src/main.ts',
      loading: false,
      mode: 'text',
      url: '/api/resource-blobs/blob-1',
      contentType: 'text/plain',
      size: 12,
      text: 'export {};\n',
    });

    expect(screen.getByTestId('conversation-pane')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open workspace resources' })).toBeInTheDocument();
    expect(screen.getByTestId('resource-workbench-panel')).toBeInTheDocument();
    const previewPanel = screen.getByTestId('resource-file-preview-panel');
    expect(previewPanel).toHaveAttribute('data-panel-anchor', 'left');
    expect(previewPanel).toHaveAttribute('data-width-profile', 'preview');
    expect(screen.getByTestId('resource-file-editor')).toBeInTheDocument();
    expect(screen.getByText('export {};')).toBeInTheDocument();
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
