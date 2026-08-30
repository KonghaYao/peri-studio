import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Button, IconButton } from '@/shared/ui';
import { useAuthActions } from '../../panel/lib/auth-hook';
import { Settings } from 'lucide-solid';

interface SidebarChromeProps {
  children: JSX.Element;
  nav?: JSX.Element;
  onOpenSystem?: () => void;
}

export function SidebarChrome(props: SidebarChromeProps) {
  const auth = useAuthActions();

  return (
    <nav
      data-testid="project-sidebar"
      class="project-sidebar relative flex h-full min-h-0 flex-col border-r border-border-faint bg-surface-overlay"
      aria-label="Projects and sessions"
    >
      <Show when={props.nav}>
        <div class="shrink-0 px-6 pt-8 pb-4">{props.nav}</div>
      </Show>
      <div class="sidebar-scroll-shell min-h-0 flex-1 px-6">
        <div class="sidebar-scroll min-h-0 h-full overflow-auto pb-8 ui-scrollbar">{props.children}</div>
        <div class="sidebar-scroll-mist" aria-hidden="true" />
      </div>
      <div class="sidebar-mist-divider" aria-hidden="true" />
      <div class="sidebar-footer flex h-48 shrink-0 items-center gap-8 px-10">
        <span
          class="account-avatar grid size-28 shrink-0 place-items-center rounded-full bg-surface-muted text-11 font-medium text-content-secondary"
          aria-hidden="true"
        >
          A
        </span>
        <span class="min-w-0 flex-1 truncate text-13 text-content-primary">Account</span>
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
        <Button class="account-logout sr-only" onClick={auth?.logout}>Log out</Button>
      </div>
    </nav>
  );
}
