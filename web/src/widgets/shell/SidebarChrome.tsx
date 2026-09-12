import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import {
  IconButton,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@peri/ui';
import { Settings } from 'lucide-solid';

interface SidebarChromeProps {
  children: JSX.Element;
  nav?: JSX.Element;
  onOpenSystem?: () => void;
}

/** 须由 AppShell 的 SidebarProvider 包裹；collapse 状态由壳层网格列宽承接。 */
export function SidebarChrome(props: SidebarChromeProps) {
  return (
    <div class="group relative flex h-full min-h-0 w-full flex-col overflow-visible" data-side="left">
      <Sidebar
        collapsible="none"
        role="navigation"
        aria-label="Projects and sessions"
        data-testid="project-sidebar"
        class="project-sidebar relative h-full min-h-0 w-full flex-col border-r border-border-faint bg-surface-overlay text-content-primary"
      >
        <Show when={props.nav}>
          <SidebarHeader class="shrink-0 gap-0 border-0 p-0 px-6 pt-8 pb-4">
            {props.nav}
          </SidebarHeader>
        </Show>
        <div class="sidebar-scroll-shell min-h-0 flex-1 px-6">
          <SidebarContent class="sidebar-scroll min-h-0 h-full gap-0 overflow-auto p-0 pb-8">
            {props.children}
          </SidebarContent>
          <div class="sidebar-scroll-mist" aria-hidden="true" />
        </div>
        <div class="sidebar-mist-divider" aria-hidden="true" />
        <SidebarFooter class="sidebar-footer flex h-48 shrink-0 flex-row items-center gap-8 border-0 p-0 px-10">
          <span class="min-w-0 flex-1" aria-hidden="true" />
          <IconButton
            size="sm"
            showTooltip={false}
            label="System information"
            disabled={!props.onOpenSystem}
            onClick={props.onOpenSystem}
            class="shrink-0 text-content-muted"
          >
            <Settings size={16} strokeWidth={1.7} />
          </IconButton>
        </SidebarFooter>
      </Sidebar>
      <SidebarRail class="max-desk:hidden" />
    </div>
  );
}
