import { createMemo, For, type JSX } from 'solid-js';
import { Button, Icon, IconButton } from '../../components/ui';
import { readOnly } from '../lib/auth-state';
import { primaryShortcut } from '../lib/keyboard';
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
function BackIcon() { return <Icon><path d="m12.5 4.5-5.5 5.5 5.5 5.5" /></Icon>; }
function ForwardIcon() { return <Icon><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></Icon>; }
function VoiceIcon() { return <Icon><path d="M3 9v2M6 6v8M9 4v12M12 7v6M15 5v10M18 8v4" /></Icon>; }
function HelpIcon() { return <Icon><circle cx="10" cy="10" r="7" /><path d="M8.2 7.7a2 2 0 1 1 2.8 1.8c-.8.4-1 1-1 1.7M10 14.5h.01" /></Icon>; }

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

  return <nav class="project-sidebar relative flex h-full min-h-0 flex-col bg-sidebar-bg px-12 desk:px-10 wide:px-12" aria-label="Projects & Sessions">
    <div class="sidebar-workspace-header sticky top-0 z-12 -mx-12 bg-sidebar-bg px-12 desk:-mx-10 desk:px-10 wide:-mx-12 wide:px-12">
      <div class="window-toolbar flex h-48 items-center gap-10 px-6" aria-label="Window controls">
        <span class="size-13 rounded-full bg-danger" aria-hidden="true" />
        <span class="size-13 rounded-full bg-warning" aria-hidden="true" />
        <span class="mr-12 size-13 rounded-full bg-success" aria-hidden="true" />
        <IconButton label="Back" title="Navigation history is not connected yet" disabled class="size-32 min-h-32 border-0 bg-transparent text-text-faint disabled:opacity-100"><BackIcon /></IconButton>
        <IconButton label="Forward" title="Navigation history is not connected yet" disabled class="size-32 min-h-32 border-0 bg-transparent text-text-faint disabled:opacity-100"><ForwardIcon /></IconButton>
      </div>
      <div class="brand-row flex h-60 items-center gap-5 px-6">
        <strong class="mr-auto text-17 font-650 tracking-[-.025em]">Peri</strong>
        <IconButton label="Search sessions" disabled={!registryHydrated()} onClick={props.onSearch} class="size-34 min-h-34 border-0 bg-transparent text-text-muted"><SearchIcon /></IconButton>
        <IconButton label="Notifications" title="Notifications are not connected yet" disabled class="size-34 min-h-34 border-0 bg-transparent text-text-muted disabled:opacity-100"><BellIcon /></IconButton>
      </div>
    </div>
    <div class="workspace-actions mb-16 flex flex-col gap-2">
      <Button class="new-session-button min-h-38 w-full justify-start rounded-8 border-0 bg-transparent px-8 text-14 font-550 text-text-primary disabled:opacity-100" disabled={!canStartSession()} onClick={startSession}><ComposeIcon /><span>New session</span></Button>
      <For each={PLACEHOLDER_NAV_ITEMS}>{(item) => <Button class="min-h-38 w-full justify-start rounded-8 border-0 bg-transparent px-8 text-14 text-text-secondary disabled:opacity-100" disabled title={item.title}><item.icon /><span>{item.label}</span></Button>}</For>
      <Button aria-hidden="true" tabIndex={-1} class="session-search-button sr-only border border-border-subtle" disabled><span>Search sessions</span><kbd class="border border-border-subtle">{primaryShortcut('K')}</kbd></Button>
    </div>
    {props.children}
    <Button class="onboarding-card mx-4 mb-10 min-h-[64px] justify-start rounded-16 border border-border-subtle bg-surface px-12 text-left shadow-float disabled:opacity-100" disabled title="Onboarding progress is not connected yet">
      <span class="grid size-24 place-items-center rounded-full border-2 border-divider text-10 text-text-muted" aria-hidden="true" />
      <span class="flex-1 text-14 font-550 text-text-primary">Get started</span>
      <span class="text-12 text-text-muted">0/4</span>
    </Button>
    <div class="sidebar-footer -mx-12 flex h-58 items-center gap-6 border-t border-divider px-16 text-12 text-text-muted desk:-mx-10 wide:-mx-12">
      <span class="account-avatar grid size-28 place-items-center rounded-full bg-surface text-11 font-550 text-text-secondary shadow-[inset_0_0_0_1px_var(--border-subtle)]" aria-hidden="true">A</span>
      <Button class="account-entry min-h-36 flex-1 justify-start rounded-8 border-0 bg-transparent px-5 text-14 text-text-primary hover:bg-hover pointer-coarse:min-h-44" disabled={!props.onOpenSystem} onClick={props.onOpenSystem}>Account</Button>
      <IconButton label="Voice" title="Voice is not connected yet" disabled class="size-32 min-h-32 border-0 bg-transparent text-text-muted disabled:opacity-100"><VoiceIcon /></IconButton>
      <IconButton label="Help and system information" disabled={!props.onOpenSystem} onClick={props.onOpenSystem} class="size-32 min-h-32 border-0 bg-transparent text-text-muted"><HelpIcon /></IconButton>
      <Button class="account-logout sr-only" onClick={auth?.logout}>Log out</Button>
    </div>
  </nav>;
}
