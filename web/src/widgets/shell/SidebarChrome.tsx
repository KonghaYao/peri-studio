import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  ProjectSidebarShell,
  Sidebar,
  SidebarRail,
} from '@peri/ui';
import { Settings } from 'lucide-solid';
import { canOfferInstall, handleInstallMenuAction } from '@/features/pwa/pwa-install-prompt';

interface SidebarChromeProps {
  children: JSX.Element;
  nav?: JSX.Element;
  onOpenSystem?: () => void;
  onInstall?: () => void;
}

/** 须由 AppShell 的 SidebarProvider 包裹；collapse 状态由壳层网格列宽承接。 */
export function SidebarChrome(props: SidebarChromeProps) {
  const offerInstall = () => canOfferInstall();
  const chooseInstall = () => {
    if (props.onInstall) props.onInstall();
    else handleInstallMenuAction();
  };

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
              <DropdownMenu placement="top-end">
                <DropdownMenuTrigger
                  as={IconButton}
                  size="sm"
                  showTooltip={false}
                  label="Settings"
                  disabled={!props.onOpenSystem && !offerInstall()}
                  class="ui-titlebar-no-drag shrink-0 text-content-muted"
                >
                  <Settings size={16} strokeWidth={1.7} />
                </DropdownMenuTrigger>
                <DropdownMenuContent class="ui-titlebar-no-drag ui-menu min-w-180" aria-label="Settings">
                  <Show when={offerInstall()}>
                    <DropdownMenuItem onSelect={chooseInstall}>Install</DropdownMenuItem>
                  </Show>
                  <DropdownMenuItem disabled={!props.onOpenSystem} onSelect={props.onOpenSystem}>
                    System
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        />
      </Sidebar>
      <SidebarRail class="max-desk:hidden" />
    </div>
  );
}
