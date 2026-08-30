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
      class="project-sidebar relative flex h-full min-h-0 flex-col border-r border-border-subtle bg-surface-overlay"
      aria-label="Projects and sessions"
    >
      <Show when={props.nav}>
        <div class="shrink-0 px-1.5 pt-2 pb-1">{props.nav}</div>
      </Show>
      <div class="sidebar-scroll-shell min-h-0 flex-1 px-1.5">
        <div class="min-h-0 h-full overflow-auto pb-2 ui-scrollbar">{props.children}</div>
        <div class="sidebar-scroll-mist" aria-hidden="true" />
      </div>
      <div class="sidebar-mist-divider" aria-hidden="true" />
      <div class="sidebar-footer flex h-12 shrink-0 items-center gap-2 px-2.5">
        <span
          class="account-avatar grid size-7 shrink-0 place-items-center rounded-full bg-surface-muted text-11 font-medium text-content-secondary"
          aria-hidden="true"
        >
          A
        </span>
        <span class="min-w-0 flex-1 truncate text-13 text-content-primary">Account</span>
        <IconButton
          size="sm"
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
