import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
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
