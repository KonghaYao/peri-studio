import type { JSX } from 'solid-js';
import {
  IconButton,
  ProjectSidebarShell,
  Sidebar,
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
        class="project-sidebar relative h-full min-h-0 w-full flex-col border-r border-border-faint bg-neutral-25 text-content-primary"
      >
        <ProjectSidebarShell
          embedded
          navbar={props.nav}
          body={props.children}
          footer={(
            <>
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
            </>
          )}
        />
      </Sidebar>
      <SidebarRail class="max-desk:hidden" />
    </div>
  );
}
