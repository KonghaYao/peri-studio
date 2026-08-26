import { createMemo, For, type JSX } from 'solid-js';
import { Button, Icon, IconButton } from '../../components/ui';
import { readOnly } from '../lib/auth-state';
import { selectActiveProjects } from '../lib/project-catalog';
import { createProjectSession, creatingSessionProjectId, projects, registryHydrated } from '../store';
import { useAuthActions } from '../lib/auth-hook';

interface SidebarChromeProps {
  children: JSX.Element;
  onSearch: () => void;
  onOpenSystem?: () => void;
}

function SearchIcon() { return <Icon><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" /></Icon>; }
function ComposeIcon() { return <Icon><path d="M12.5 4.5h3v3M15.5 4.5l-7.8 7.8-3.2.8.8-3.2 7.2-7.2" /><path d="M9 4H4.5v11.5H16V11" /></Icon>; }
function PullRequestIcon() { return <Icon><circle cx="5" cy="4" r="1.5" /><circle cx="5" cy="16" r="1.5" /><circle cx="15" cy="16" r="1.5" /><path d="M5 5.5v9M9 5h2a4 4 0 0 1 4 4v5.5M9 5l2-2M9 5l2 2" /></Icon>; }
function SitesIcon() { return <Icon><rect x="3.5" y="3.5" width="5" height="5" rx="1" /><rect x="11.5" y="3.5" width="5" height="5" rx="1" /><rect x="3.5" y="11.5" width="5" height="5" rx="1" /><path d="M11.5 14h5M14 11.5v5" /></Icon>; }
function ClockIcon() { return <Icon><circle cx="10" cy="10" r="7" /><path d="M10 6v4l-2.5 2" /></Icon>; }
function PluginIcon() { return <Icon><path d="M7 4v3M13 4v3M5 7h10v2a5 5 0 0 1-5 5 5 5 0 0 1-5-5zM10 14v3" /></Icon>; }
function BellIcon() { return <Icon><path d="M5 13h10l-1.5-2V8a3.5 3.5 0 0 0-7 0v3zM8.5 15.5h3" /></Icon>; }
function VoiceIcon() { return <Icon><path d="M3 9v2M6 6v8M9 4v12M12 7v6M15 5v10M18 8v4" /></Icon>; }
function HelpIcon() { return <Icon><circle cx="10" cy="10" r="7" /><path d="M8.2 7.7a2 2 0 1 1 2.8 1.8c-.8.4-1 1-1 1.7M10 14.5h.01" /></Icon>; }
function PeriMark() { return <Icon class="size-20!"><circle cx="10" cy="10" r="6" /><path d="M10 4v12M4 10h12M5.8 5.8l8.4 8.4M14.2 5.8l-8.4 8.4" /></Icon>; }

const PLACEHOLDER_NAV_ITEMS = [
  { label: 'Pull requests', title: 'Pull request review is not connected yet', icon: PullRequestIcon },
  { label: 'Sites', title: 'Sites are not connected yet', icon: SitesIcon },
  { label: 'Scheduled', title: 'Scheduled tasks are not connected yet', icon: ClockIcon },
  { label: 'Plugins', title: 'Plugin management is not connected yet', icon: PluginIcon },
] as const;

export function SidebarChrome(props: SidebarChromeProps) {
  const auth = useAuthActions();
  const activeProjects = createMemo(() => selectActiveProjects(projects()));
  const canStartSession = () => !readOnly() && activeProjects().length === 1 && !creatingSessionProjectId();
  const startSession = () => {
    const [project] = activeProjects();
    if (project) createProjectSession(project.id);
  };

  return <nav class="project-sidebar relative flex h-full min-h-0 flex-col border-r border-divider bg-sidebar-bg px-12 desk:px-10 wide:px-12" aria-label="Projects & Sessions">
    <div class="sidebar-workspace-header sticky top-0 z-12 -mx-12 mb-10 border-b border-divider bg-sidebar-bg px-12 desk:-mx-10 desk:px-10 wide:-mx-12 wide:px-12">
      <div class="brand-row flex h-54 items-center gap-3 px-4">
        <span class="mr-auto grid size-32 place-items-center rounded-10 border border-border-subtle bg-surface text-text-primary" aria-hidden="true"><PeriMark /></span>
        <strong class="sr-only">Peri</strong>
        <IconButton label="New session" disabled={!canStartSession()} onClick={startSession} class="new-session-button size-32 min-h-32 border-0 bg-transparent text-text-primary"><ComposeIcon /></IconButton>
        <IconButton label="Search sessions" disabled={!registryHydrated()} onClick={props.onSearch} class="size-32 min-h-32 border-0 bg-transparent text-text-muted"><SearchIcon /></IconButton>
        <IconButton label="Notifications" title="Notifications are not connected yet" disabled class="size-32 min-h-32 border-0 bg-transparent text-text-muted disabled:opacity-45"><BellIcon /></IconButton>
      </div>
      <div class="workspace-actions flex h-42 items-center justify-between px-4 text-text-muted">
        <For each={PLACEHOLDER_NAV_ITEMS}>{(item) => <IconButton label={item.label} title={item.title} disabled class="size-30 min-h-30 border-0 bg-transparent text-text-muted disabled:opacity-40"><item.icon /></IconButton>}</For>
      </div>
    </div>
    {props.children}
    <div class="sidebar-footer -mx-12 flex h-54 items-center gap-5 border-t border-divider px-16 text-text-muted desk:-mx-10 wide:-mx-12">
      <IconButton label="Account" disabled={!props.onOpenSystem} onClick={props.onOpenSystem} class="account-entry mr-auto size-32 min-h-32 rounded-full border-0 bg-transparent p-0"><span class="account-avatar grid size-28 place-items-center rounded-full border border-border-subtle bg-surface text-11 font-550 text-text-secondary" aria-hidden="true">A</span></IconButton>
      <IconButton label="Voice" title="Voice is not connected yet" disabled class="size-32 min-h-32 border-0 bg-transparent text-text-muted disabled:opacity-40"><VoiceIcon /></IconButton>
      <IconButton label="Help and system information" disabled={!props.onOpenSystem} onClick={props.onOpenSystem} class="size-32 min-h-32 border-0 bg-transparent text-text-muted"><HelpIcon /></IconButton>
      <Button class="account-logout sr-only" onClick={auth?.logout}>Log out</Button>
    </div>
  </nav>;
}
