import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from './Sidebar';

afterEach(() => cleanup());

describe('Sidebar', () => {
  it('toggles desktop sidebar open state from trigger', () => {
    function ToggleReadout() {
      const { open } = useSidebar();
      return <span data-testid="open-state">{open() ? 'open' : 'closed'}</span>;
    }

    render(() => (
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarContent>
            <ToggleReadout />
          </SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    ));

    expect(screen.getByTestId('open-state')).toHaveTextContent('open');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByTestId('open-state')).toHaveTextContent('closed');
  });

  it('toggles sidebar with Cmd/Ctrl+B keyboard shortcut', () => {
    function ToggleReadout() {
      const { open } = useSidebar();
      return <span data-testid="open-state">{open() ? 'open' : 'closed'}</span>;
    }

    render(() => (
      <SidebarProvider defaultOpen>
        <Sidebar>
          <SidebarContent>
            <ToggleReadout />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    ));

    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(screen.getByTestId('open-state')).toHaveTextContent('closed');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.getByTestId('open-state')).toHaveTextContent('open');
  });

  it('updates collapsible shell metadata when trigger toggles icon mode', () => {
    render(() => (
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Projects</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    ));

    const shell = document.querySelector('[data-shell-aside]');
    expect(shell).toHaveAttribute('data-state', 'expanded');
    expect(shell).not.toHaveAttribute('data-collapsible', 'icon');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(shell).toHaveAttribute('data-state', 'collapsed');
    expect(shell).toHaveAttribute('data-collapsible', 'icon');
  });

  it('toggles mobile sheet open state from trigger', () => {
    const listeners = new Map<string, () => void>();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 959px)',
      media: query,
      addEventListener: (_event: string, listener: () => void) => {
        listeners.set(query, listener);
      },
      removeEventListener: (_event: string, listener: () => void) => {
        if (listeners.get(query) === listener) listeners.delete(query);
      },
    })) as typeof window.matchMedia;

    render(() => (
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <span>Mobile sidebar</span>
          </SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    ));

    listeners.get('(max-width: 959px)')?.();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Mobile sidebar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks active menu buttons with data-active', () => {
    render(() => (
      <SidebarProvider>
        <Sidebar collapsible="none">
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive>Projects</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <main>Content</main>
        </SidebarInset>
      </SidebarProvider>
    ));

    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});
