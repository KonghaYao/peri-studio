import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@peri/ui';

/** T2 Sidebar 静态布局演示（collapsible=none，避免 catalog 内 fixed 壳层溢出）。 */
export function SidebarLayoutDemo() {
  return (
    <SidebarProvider>
      <div class="flex h-280 overflow-hidden rounded-8 border border-border-subtle">
        <Sidebar collapsible="none">
          <SidebarHeader class="border-b border-border-faint px-12 py-10 text-13 font-medium">
            Workspace
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Navigation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive>Projects</SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton>Sessions</SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton>Automations</SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset class="p-16">
          <p class="m-0 text-13 text-content-secondary">
            Main content beside the sidebar shell. Icon and offcanvas modes use Cmd/Ctrl+B and are
            covered in package tests.
          </p>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
