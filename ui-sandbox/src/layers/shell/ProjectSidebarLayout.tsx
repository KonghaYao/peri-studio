import { createSignal, For, Show } from 'solid-js';
import { ArchivedBrowserList, ProjectRowAccessory, SessionRowAccessory } from '@/components/blocks/chrome';
import { cn } from '@/lib/catalog-ui';
import {
  Archive,
  CloudOff,
  Folder,
  FolderOpen,
  LayoutGrid,
  ListFilter,
  MessageSquarePlus,
  Pin,
  Plus,
  Search,
  Settings,
  Workflow,
} from 'lucide-solid';
import { Dialog, IconButton, Input } from '@/lib/catalog-ui';

const ARCHIVED_DEMO = [
  { id: 'arch-1', title: 'legacy-ws-proto', subtitle: 'Session · peri-studio' },
  { id: 'arch-2', title: 'token-audit', subtitle: 'Project · /audit' },
  { id: 'arch-3', title: 'Spike notes', subtitle: 'Session · cellp' },
];

type SessionItem = {
  id: string;
  title: string;
  time: string;
  live?: boolean;
  unread?: boolean;
  pinned?: boolean;
};

type WorkspaceItem = {
  id: string;
  name: string;
  sessions: SessionItem[];
  hint?: string;
};

type MachineItem = {
  id: string;
  name: string;
  online: boolean;
  workspaces: WorkspaceItem[];
};

type PinnedItem = {
  id: string;
  title: string;
  time: string;
  live?: boolean;
  unread?: boolean;
};

const PINNED: PinnedItem[] = [
  { id: 'pin-1', title: 'Design draft style and token board', time: '1m', live: true },
  { id: 'pin-2', title: 'System capacity and session recovery', time: '5m', unread: true },
  { id: 'pin-3', title: 'Composer layout polish', time: '1h' },
];

const MACHINES: MachineItem[] = [
  {
    id: 'mac',
    name: 'MacBook Pro',
    online: true,
    workspaces: [
      { id: 'cellp', name: 'cellp', sessions: [], hint: 'No agents yet' },
      { id: 'canvas', name: 'peri-canvas', sessions: [], hint: 'No agents yet' },
      {
        id: 'peri',
        name: 'peri-studio',
        sessions: [
          { id: 's1', title: 'Design workspace state', time: '2m', live: true },
          { id: 's2', title: 'Fix session restore', time: '18m' },
          { id: 's3', title: 'Release preparation', time: '1h' },
        ],
      },
      {
        id: 'remote',
        name: 'remote',
        sessions: [
          { id: 's4', title: 'online-supadev', time: '20h' },
          { id: 's5', title: 'Cellp database migration', time: '22h' },
          { id: 's6', title: 'online-canvas', time: '1d' },
        ],
      },
    ],
  },
  {
    id: 'build',
    name: 'Build host',
    online: false,
    workspaces: [
      {
        id: 'artifacts',
        name: 'build-artifacts',
        sessions: [{ id: 's7', title: 'Nightly bundle audit', time: '3d' }],
      },
    ],
  },
];

function SectionHeader(props: { title: string; icon?: unknown; children?: unknown }) {
  return (
    <div class="flex items-center gap-4 px-10 pb-4 pt-12">
      <span class="flex min-w-0 flex-1 items-center gap-6 text-12 text-content-muted">
        <Show when={props.icon}>
          <span class="grid size-16 shrink-0 place-items-center text-content-faint">{props.icon as never}</span>
        </Show>
        {props.title}
      </span>
      {props.children as never}
    </div>
  );
}

function NavAction(props: { icon: unknown; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      class="flex w-full min-h-36 items-center gap-10 rounded-md px-10 text-left text-13 text-content-primary transition-colors duration-(--duration-fast) hover:bg-interaction-hover"
      onClick={props.onClick}
    >
      <span class="grid size-16 shrink-0 place-items-center text-content-muted">{props.icon as never}</span>
      {props.label}
    </button>
  );
}

function SessionRow(props: {
  session: SessionItem;
  selected?: boolean;
  indent?: number;
  onClick?: () => void;
}) {
  return (
    <div
      class={cn(
        'group/row relative min-w-0 rounded-md transition-colors duration-(--duration-fast)',
        props.selected ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
      )}
      style={{
        'min-height': '36px',
        'padding-left': props.indent ? `calc(10px + ${props.indent}px)` : undefined,
      }}
    >
      <button
        type="button"
        class="flex min-h-36 w-full min-w-0 items-center rounded-md pl-10 pr-64 text-left"
        onClick={props.onClick}
      >
        <span class="session-copy min-w-0 flex-1 truncate text-13 text-content-primary">{props.session.title}</span>
      </button>
      <SessionRowAccessory
        time={props.session.time}
        live={props.session.live}
        unread={props.session.unread}
        pinned={props.session.pinned}
      />
    </div>
  );
}

/** 侧栏：Pinned + Machine → Workspace → Sessions。 */
export function ProjectSidebarLayout() {
  const [expandedWorkspaces, setExpandedWorkspaces] = createSignal(new Set(['peri', 'remote']));
  const [selectedId, setSelectedId] = createSignal('pin-1');
  const [archivedBrowserOpen, setArchivedBrowserOpen] = createSignal(false);
  const [archivedBrowserWorkspace, setArchivedBrowserWorkspace] = createSignal<string | null>(null);
  const [archivedQuery, setArchivedQuery] = createSignal('');

  const workspaceMenuItems = [
    { id: 'archived', label: 'Archived', icon: <Archive size={14} strokeWidth={1.7} /> },
    { id: 'archive-project', label: 'Archive project', icon: <Archive size={14} strokeWidth={1.7} />, danger: true },
  ];

  const archivedResults = () => {
    const needle = archivedQuery().trim().toLocaleLowerCase();
    if (!needle) return ARCHIVED_DEMO;
    return ARCHIVED_DEMO.filter((item) => (
      item.title.toLocaleLowerCase().includes(needle)
      || item.subtitle.toLocaleLowerCase().includes(needle)
    ));
  };

  const toggleWorkspace = (id: string) => {
    setExpandedWorkspaces((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <nav
      class="flex h-(--container-settings-tall) w-(--shell-sidebar-width) flex-col border border-border-faint bg-surface-overlay"
      aria-label="Projects and sessions"
    >
      <div class="shrink-0 px-6 pt-8 pb-4">
        <NavAction icon={<MessageSquarePlus size={16} strokeWidth={1.7} />} label="New session" />
        <NavAction icon={<Search size={16} strokeWidth={1.7} />} label="Search" />
        <NavAction icon={<Workflow size={16} strokeWidth={1.7} />} label="Automations" />
        <NavAction icon={<LayoutGrid size={16} strokeWidth={1.7} />} label="Customize" />
      </div>

      <div class="sidebar-scroll-shell px-6">
        <div class="sidebar-scroll min-h-0 h-full overflow-auto pb-8">
        <SectionHeader title="Pinned" icon={<Pin size={14} strokeWidth={1.7} />} />
        <div class="flex flex-col gap-2 pb-4">
          <For each={PINNED}>
            {(item) => (
              <SessionRow
                session={{ ...item, pinned: true }}
                selected={selectedId() === item.id}
                onClick={() => setSelectedId(item.id)}
              />
            )}
          </For>
        </div>

        <SectionHeader title="Workspaces">
          <IconButton size="sm" showTooltip={false} label="Filter workspaces" class="size-28 shrink-0 text-content-muted">
            <ListFilter size={15} strokeWidth={1.7} />
          </IconButton>
          <IconButton size="sm" showTooltip={false} label="New workspace" class="size-28 shrink-0 text-content-muted">
            <Folder size={15} strokeWidth={1.7} />
          </IconButton>
        </SectionHeader>

        <For each={MACHINES}>
          {(machine) => (
            <section class="pb-4">
              <div class="group/instance relative flex min-h-28 items-center gap-8 px-10 text-11 text-content-muted">
                <span class="min-w-0 flex-1 truncate">{machine.name}</span>
                <Show when={!machine.online}>
                  <span class="flex shrink-0 items-center gap-4 text-danger-solid">
                    <CloudOff size={13} strokeWidth={1.8} aria-hidden="true" />
                    <span>Offline</span>
                  </span>
                </Show>
                <IconButton
                  size="sm"
                  showTooltip={false}
                  label="New project"
                  class="pointer-events-none absolute right-4 top-1/2 size-28 -translate-y-1/2 border-0 bg-transparent text-content-muted opacity-0 transition-opacity duration-(--duration-fast) group-hover/instance:pointer-events-auto group-hover/instance:opacity-100"
                >
                  <Plus size={15} strokeWidth={1.7} />
                </IconButton>
              </div>

              <For each={machine.workspaces}>
                {(workspace) => {
                  const open = () => expandedWorkspaces().has(workspace.id);
                  const hasSessions = () => workspace.sessions.length > 0;
                  return (
                    <div class="min-w-0">
                      <div class="group/workspace relative min-w-0 rounded-md hover:bg-interaction-hover focus-within:bg-interaction-hover">
                        <button
                          type="button"
                          class="flex w-full min-w-0 items-start gap-8 pl-10 pr-56 py-4 text-left"
                          aria-expanded={open()}
                          onClick={() => toggleWorkspace(workspace.id)}
                        >
                          <span class="mt-2 shrink-0 text-content-muted">
                            <Show when={open()} fallback={<Folder size={15} strokeWidth={1.7} />}>
                              <FolderOpen size={15} strokeWidth={1.7} />
                            </Show>
                          </span>
                          <span class="min-w-0 flex-1 py-2">
                            <span class="min-w-0 flex-1 truncate text-13 text-content-primary">{workspace.name}</span>
                            <Show when={workspace.hint && !open()}>
                              <span class="mt-2 block truncate text-11 sidebar-mist-hint">{workspace.hint}</span>
                            </Show>
                          </span>
                        </button>
                        <ProjectRowAccessory
                          count={hasSessions() ? workspace.sessions.length : undefined}
                          menuItems={workspaceMenuItems}
                          onMenuSelect={(id) => {
                            if (id === 'archived') {
                              setArchivedBrowserWorkspace(workspace.name);
                              setArchivedBrowserOpen(true);
                            }
                          }}
                        />
                      </div>

                      <Show when={open()}>
                        <div class="flex flex-col gap-2 pb-4">
                          <Show
                            when={hasSessions()}
                            fallback={
                              <div class="px-10 py-4 pl-36 text-11 sidebar-mist-hint">{workspace.hint ?? 'No sessions yet'}</div>
                            }
                          >
                            <For each={workspace.sessions}>
                              {(session) => (
                                <SessionRow
                                  session={session}
                                  indent={16}
                                  selected={selectedId() === session.id}
                                  onClick={() => setSelectedId(session.id)}
                                />
                              )}
                            </For>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </section>
          )}
        </For>
        </div>
        <div class="sidebar-scroll-mist" aria-hidden="true" />
      </div>

      <Dialog
        open={archivedBrowserOpen()}
        onOpenChange={(open) => {
          setArchivedBrowserOpen(open);
          if (!open) setArchivedBrowserWorkspace(null);
        }}
        title={archivedBrowserWorkspace() ? `${archivedBrowserWorkspace()} · Archived` : 'Archived'}
        width="min(520px, calc(100vw - 56px))"
      >
        <div class="grid gap-14">
          <Input
            aria-label="Search archived sessions"
            value={archivedQuery()}
            onInput={(event) => setArchivedQuery(event.currentTarget.value)}
            placeholder="Search session title or ID"
          />
          <ArchivedBrowserList items={archivedResults()} />
          <p class="m-0 text-12 text-content-muted">
            Restored items return to the sidebar list. Archiving only hides them; nothing is deleted.
          </p>
        </div>
      </Dialog>

      <div class="sidebar-mist-divider" aria-hidden="true" />
      <div class="flex h-48 shrink-0 items-center gap-8 px-10">
        <span class="grid size-28 shrink-0 place-items-center rounded-full bg-surface-muted text-11 font-medium text-content-secondary">C</span>
        <span class="min-w-0 flex-1 truncate text-13 text-content-primary">Christopher13</span>
        <IconButton size="sm" showTooltip={false} label="Settings" class="shrink-0 text-content-muted">
          <Settings size={16} strokeWidth={1.7} />
        </IconButton>
      </div>
    </nav>
  );
}
