import { createSignal, For, Show } from 'solid-js';
import { IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  CloudOff,
  Folder,
  FolderOpen,
  LayoutGrid,
  ListFilter,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Settings,
  Workflow,
} from 'lucide-solid';

type SessionItem = {
  id: string;
  title: string;
  time: string;
  live?: boolean;
  unread?: boolean;
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
    <div class="flex items-center gap-1 px-2.5 pb-1 pt-3">
      <span class="flex min-w-0 flex-1 items-center gap-1.5 text-12 text-content-muted">
        <Show when={props.icon}>
          <span class="grid size-4 shrink-0 place-items-center text-content-faint">{props.icon as never}</span>
        </Show>
        {props.title}
      </span>
      {props.children as never}
    </div>
  );
}

function RowTail(props: {
  time: string;
  live?: boolean;
  unread?: boolean;
  moreLabel?: string;
  pinOnHover?: boolean;
}) {
  const hoverAction = () => props.moreLabel || props.pinOnHover;
  return (
    <span class="relative flex h-6 w-12 shrink-0 items-center justify-end">
      <span
        class={cn(
          'flex items-center gap-1.5 tabular-nums text-11 text-content-muted transition-opacity duration-(--duration-fast)',
          hoverAction() && 'group-hover/row:opacity-0',
        )}
      >
        <Show when={props.live}>
          <span class="relative flex size-1.5">
            <span class="absolute inline-flex size-full animate-ping rounded-full bg-success-solid opacity-30" />
            <span class="relative inline-flex size-1.5 rounded-full bg-success-solid" />
          </span>
        </Show>
        <Show when={props.unread}>
          <span class="size-1.5 rounded-full bg-accent-solid" aria-label="Unread" />
        </Show>
        <span>{props.time}</span>
      </span>
      <Show when={props.pinOnHover}>
        <span
          class="absolute right-0 grid size-6 place-items-center text-content-muted opacity-0 transition-opacity duration-(--duration-fast) group-hover/row:opacity-100"
          aria-hidden="true"
        >
          <Pin size={14} strokeWidth={1.7} />
        </span>
      </Show>
      <Show when={props.moreLabel}>
        <IconButton
          size="sm"
          label={props.moreLabel!}
          class="absolute right-0 size-6 border-0 bg-surface-overlay/90 text-content-muted opacity-0 shadow-sm transition-opacity duration-(--duration-fast) group-hover/row:opacity-100"
        >
          <MoreHorizontal size={14} />
        </IconButton>
      </Show>
    </span>
  );
}

function NavAction(props: { icon: unknown; label: string }) {
  return (
    <button
      type="button"
      class="flex w-full min-h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-13 text-content-primary transition-colors duration-(--duration-fast) hover:bg-interaction-hover"
    >
      <span class="grid size-4 shrink-0 place-items-center text-content-muted">{props.icon as never}</span>
      {props.label}
    </button>
  );
}

function SessionRow(props: {
  title: string;
  time: string;
  selected?: boolean;
  live?: boolean;
  unread?: boolean;
  indent?: number;
  pinned?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      class={cn(
        'group/row flex w-full min-w-0 items-center rounded-md px-2.5 text-left transition-colors duration-(--duration-fast)',
        props.selected ? 'bg-sidebar-selected' : 'hover:bg-interaction-hover',
      )}
      style={{
        'min-height': '32px',
        'padding-left': props.indent ? `calc(10px + ${props.indent}px)` : undefined,
      }}
      onClick={props.onClick}
    >
      <span class="min-w-0 flex-1 truncate text-13 text-content-primary">{props.title}</span>
      <RowTail
        time={props.time}
        live={props.live}
        unread={props.unread}
        pinOnHover={props.pinned}
        moreLabel={props.pinned ? undefined : 'Session actions'}
      />
    </button>
  );
}

/** 侧栏：Pinned + Machine → Workspace → Sessions。 */
export function ProjectSidebarLayout() {
  const [expandedWorkspaces, setExpandedWorkspaces] = createSignal(new Set(['peri', 'remote']));
  const [selectedId, setSelectedId] = createSignal('pin-1');

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
      class="flex h-[min(680px,78vh)] w-[var(--shell-sidebar-width)] flex-col border border-border-subtle bg-surface-overlay"
      aria-label="Projects and sessions"
    >
      <div class="shrink-0 px-1.5 pt-2 pb-1">
        <NavAction icon={<MessageSquarePlus size={16} strokeWidth={1.7} />} label="New session" />
        <NavAction icon={<Search size={16} strokeWidth={1.7} />} label="Search" />
        <NavAction icon={<Workflow size={16} strokeWidth={1.7} />} label="Automations" />
        <NavAction icon={<LayoutGrid size={16} strokeWidth={1.7} />} label="Customize" />
      </div>

      <div class="sidebar-scroll-shell px-1.5">
        <div class="min-h-0 h-full overflow-auto pb-2">
        <SectionHeader title="Pinned" icon={<Pin size={14} strokeWidth={1.7} />} />
        <div class="flex flex-col gap-0.5 pb-1">
          <For each={PINNED}>
            {(item) => (
              <SessionRow
                title={item.title}
                time={item.time}
                live={item.live}
                unread={item.unread}
                pinned
                selected={selectedId() === item.id}
                onClick={() => setSelectedId(item.id)}
              />
            )}
          </For>
        </div>

        <SectionHeader title="Workspaces">
          <IconButton size="sm" label="Filter workspaces" class="size-7 shrink-0 text-content-muted">
            <ListFilter size={15} strokeWidth={1.7} />
          </IconButton>
          <IconButton size="sm" label="New workspace" class="size-7 shrink-0 text-content-muted">
            <Folder size={15} strokeWidth={1.7} />
          </IconButton>
        </SectionHeader>

        <For each={MACHINES}>
          {(machine) => (
            <section class="pb-1">
              <div class="flex min-h-7 items-center gap-2 px-2.5 text-11 text-content-muted">
                <span class="min-w-0 flex-1 truncate">{machine.name}</span>
                <Show when={!machine.online}>
                  <span class="flex shrink-0 items-center gap-1 text-danger-solid">
                    <CloudOff size={13} strokeWidth={1.8} aria-hidden="true" />
                    <span>Offline</span>
                  </span>
                </Show>
              </div>

              <For each={machine.workspaces}>
                {(workspace) => {
                  const open = () => expandedWorkspaces().has(workspace.id);
                  const hasSessions = () => workspace.sessions.length > 0;
                  return (
                    <div class="min-w-0">
                      <div
                        class="group/workspace relative min-w-0 rounded-md hover:bg-interaction-hover focus-within:bg-interaction-hover"
                      >
                        <button
                          type="button"
                          class="flex w-full min-w-0 items-start gap-2 px-2.5 py-1 text-left"
                          aria-expanded={open()}
                          onClick={() => toggleWorkspace(workspace.id)}
                        >
                          <span class="mt-0.5 shrink-0 text-content-muted">
                            <Show when={open()} fallback={<Folder size={15} strokeWidth={1.7} />}>
                              <FolderOpen size={15} strokeWidth={1.7} />
                            </Show>
                          </span>
                          <span class="min-w-0 flex-1 py-0.5">
                            <span class="flex min-w-0 items-center gap-2">
                              <span class="min-w-0 flex-1 truncate text-13 text-content-primary">{workspace.name}</span>
                              <Show when={hasSessions()}>
                                <span
                                  class={cn(
                                    'shrink-0 tabular-nums text-11 text-content-muted transition-opacity duration-(--duration-fast)',
                                    'group-hover/workspace:opacity-0 group-focus-within/workspace:opacity-0',
                                  )}
                                >
                                  {workspace.sessions.length}
                                </span>
                              </Show>
                            </span>
                            <Show when={workspace.hint && !open()}>
                              <span class="mt-0.5 block truncate text-11 sidebar-mist-hint">{workspace.hint}</span>
                            </Show>
                          </span>
                        </button>
                        <IconButton
                          size="sm"
                          label={`New session in ${workspace.name}`}
                          class="absolute right-1 top-1 z-1 border-0 bg-surface-overlay/90 text-content-muted opacity-0 shadow-sm pointer-events-none transition-opacity duration-(--duration-fast) group-hover/workspace:pointer-events-auto group-hover/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                        >
                          <Plus size={15} strokeWidth={1.7} />
                        </IconButton>
                      </div>

                      <Show when={open()}>
                        <div class="flex flex-col gap-0.5 pb-1">
                          <Show
                            when={hasSessions()}
                            fallback={
                              <div class="px-2.5 py-1 pl-9 text-11 sidebar-mist-hint">{workspace.hint ?? 'No sessions yet'}</div>
                            }
                          >
                            <For each={workspace.sessions}>
                              {(session) => (
                                <SessionRow
                                  title={session.title}
                                  time={session.time}
                                  live={session.live}
                                  unread={session.unread}
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

      <div class="sidebar-mist-divider" aria-hidden="true" />
      <div class="flex h-12 shrink-0 items-center gap-2 px-2.5">
        <span class="grid size-7 shrink-0 place-items-center rounded-full bg-surface-muted text-11 font-medium text-content-secondary">C</span>
        <span class="min-w-0 flex-1 truncate text-13 text-content-primary">Christopher13</span>
        <IconButton size="sm" label="Settings" class="shrink-0 text-content-muted">
          <Settings size={16} strokeWidth={1.7} />
        </IconButton>
      </div>
    </nav>
  );
}
