import { render } from '@solidjs/testing-library';
import { SidebarProvider } from '@peri/ui';
import type { JSX } from 'solid-js';
import { SHELL_SIDEBAR_DEFAULT_WIDTH } from './shell-sidebar-layout';

/** ProjectSidebar / SidebarChrome 单测须由 AppShell 级 SidebarProvider 包裹。 */
export function renderWithSidebarProvider(ui: () => JSX.Element) {
  return render(() => (
    <SidebarProvider
      defaultOpen
      class="flex h-dvh flex-col"
      style={{ width: `${SHELL_SIDEBAR_DEFAULT_WIDTH}px` }}
    >
      {ui()}
    </SidebarProvider>
  ));
}
