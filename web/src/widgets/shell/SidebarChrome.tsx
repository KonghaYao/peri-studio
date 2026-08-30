import type { JSX } from 'solid-js';
import { Button, Icon, IconButton } from '../../components/ui';
import { useAuthActions } from '../../panel/lib/auth-hook';
import { CircleHelp } from 'lucide-solid';

interface SidebarChromeProps {
  children: JSX.Element;
  onOpenSystem?: () => void;
}

function PeriMark() { return <Icon class="size-20!"><circle cx="10" cy="10" r="6" /><path d="M10 4v12M4 10h12M5.8 5.8l8.4 8.4M14.2 5.8l-8.4 8.4" /></Icon>; }

export function SidebarChrome(props: SidebarChromeProps) {
  const auth = useAuthActions();

  return <nav class="project-sidebar relative flex h-full min-h-0 flex-col border-r border-divider bg-sidebar-bg px-12 desk:px-10 wide:px-12" aria-label="Projects & Sessions">
    <div class="sidebar-workspace-header sticky top-0 z-12 -mx-12 mb-10 border-b border-divider bg-sidebar-bg px-12 desk:-mx-10 desk:px-10 wide:-mx-12 wide:px-12">
      <div class="brand-row flex h-54 items-center gap-3 px-4">
        <span class="grid size-32 place-items-center rounded-10 border border-border-subtle bg-surface text-text-primary" aria-hidden="true"><PeriMark /></span>
        <strong class="sr-only">Peri</strong>
      </div>
    </div>
    {props.children}
    <div class="sidebar-footer -mx-12 flex h-54 items-center gap-5 border-t border-divider px-16 text-text-muted desk:-mx-10 wide:-mx-12">
      <IconButton label="Account" title="Account controls are not connected yet" disabled class="account-entry mr-auto border-0 bg-transparent"><span class="account-avatar grid size-24 place-items-center rounded-6 border border-border-subtle bg-surface text-11 font-550 text-text-secondary" aria-hidden="true">A</span></IconButton>
      <IconButton label="System information" disabled={!props.onOpenSystem} onClick={props.onOpenSystem} class="border-0 bg-transparent text-text-muted"><CircleHelp size={17} strokeWidth={1.7} /></IconButton>
      <Button class="account-logout sr-only" onClick={auth?.logout}>Log out</Button>
    </div>
  </nav>;
}
