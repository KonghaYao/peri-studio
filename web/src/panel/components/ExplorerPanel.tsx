import { For, Show, createSignal } from 'solid-js';
import { Icon, IconButton, LoadingState } from '../../components/ui';
import { openFilePreview, openResourceDirectory, resourceWorkspace } from '../store';
import type { ResourceEntry } from '../lib/resource-view';

function ChevronIcon() { return <Icon size="small"><path d="m7 4 6 6-6 6" /></Icon>; }
function FolderIcon() { return <Icon size="small"><path d="M3 5.5h5l1.5 2H17v8.5H3z" /></Icon>; }
function FileIcon() { return <Icon size="small"><path d="M5 2.8h6l4 4V17H5z" /><path d="M11 2.8V7h4" /></Icon>; }
function MoreIcon() { return <Icon size="small"><circle cx="4" cy="10" r=".7" fill="currentColor" /><circle cx="10" cy="10" r=".7" fill="currentColor" /><circle cx="16" cy="10" r=".7" fill="currentColor" /></Icon>; }

export function ExplorerPanel() {
  const [expanded, setExpanded] = createSignal(new Set<string>(['']));
  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else { next.add(path); openResourceDirectory(path); }
      return next;
    });
  };
  return <section class="flex min-h-0 flex-1 flex-col" aria-label="Explorer">
    <div class="resource-section-title flex h-28 items-center border-b border-divider px-8 text-10 font-650 uppercase tracking-6 text-text-secondary">
      <span>Files</span><IconButton label="Explorer actions" class="ml-auto size-24 min-h-24 border-0 bg-transparent text-text-muted"><MoreIcon /></IconButton>
    </div>
    <div class="ui-scrollbar min-h-0 flex-1 overflow-auto py-3" role="tree" aria-label="Workspace files">
      <Show when={resourceWorkspace().directories['']} fallback={<LoadingState label="Loading files" class="m-8 p-8! text-left!" />}>
        <FileLevel path="" depth={0} expanded={expanded()} onToggle={toggle} />
      </Show>
    </div>
  </section>;
}

function FileLevel(props: { path: string; depth: number; expanded: Set<string>; onToggle: (path: string) => void }) {
  const entries = () => resourceWorkspace().directories[props.path]?.entries ?? [];
  const nextCursor = () => resourceWorkspace().directories[props.path]?.nextCursor;
  return <>
    <For each={entries()}>{(entry) => <FileRow entry={entry} depth={props.depth} expanded={props.expanded} onToggle={props.onToggle} />}</For>
    <Show when={nextCursor()}>{(cursor) => <button type="button" class="h-24 w-full border-0 bg-transparent text-left text-11 text-accent hover:bg-hover" style={{ 'padding-left': `${26 + props.depth * 13}px` }} onClick={() => openResourceDirectory(props.path, cursor())}>Load more…</button>}</Show>
  </>;
}

function FileRow(props: { entry: ResourceEntry; depth: number; expanded: Set<string>; onToggle: (path: string) => void }) {
  const path = () => String(props.entry.path ?? '');
  const directory = () => props.entry.kind === 'directory';
  const open = () => props.expanded.has(path());
  return <>
    <button
      type="button"
      role="treeitem"
      aria-expanded={directory() ? open() : undefined}
      class="group flex h-24 w-full items-center border-0 bg-transparent pr-6 text-left text-12 text-text-primary hover:bg-hover focus-visible:bg-selected focus-visible:outline-none"
      style={{ 'padding-left': `${6 + props.depth * 13}px` }}
      onClick={() => directory() ? props.onToggle(path()) : openFilePreview(path())}
      title={path()}
    >
      <span class={`mr-1 grid size-14 place-items-center text-text-muted ${directory() ? '' : 'opacity-0'}`}><ChevronIcon /></span>
      <span class="mr-5 text-text-muted">{directory() ? <FolderIcon /> : <FileIcon />}</span>
      <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{String(props.entry.name ?? path())}</span>
    </button>
    <Show when={directory() && open()}>
      <Show when={resourceWorkspace().directories[path()]} fallback={<div class="h-24 text-11 text-text-faint" style={{ 'padding-left': `${32 + props.depth * 13}px` }}>Loading…</div>}>
        <FileLevel path={path()} depth={props.depth + 1} expanded={props.expanded} onToggle={props.onToggle} />
      </Show>
    </Show>
  </>;
}
