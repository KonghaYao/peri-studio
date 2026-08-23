import { For, Show, createSignal } from 'solid-js';
import { Icon, IconButton, LoadingState } from '../../components/ui';
import { openFilePreview, openResourceDirectory, refreshResourceProject, resourceWorkspace } from '../store';
import type { ResourceEntry } from '../lib/resource-view';

function ChevronIcon() { return <Icon size="small"><path d="m7 4 6 6-6 6" /></Icon>; }
function FolderIcon() { return <Icon size="small"><path d="M3 5.5h5l1.5 2H17v8.5H3z" /></Icon>; }
function FileIcon() { return <Icon size="small"><path d="M5 2.8h6l4 4V17H5z" /><path d="M11 2.8V7h4" /></Icon>; }
function RefreshIcon() { return <Icon size="small"><path d="M15.5 6.5V3.8l-2 2A6 6 0 1 0 16 10" /></Icon>; }

export function ExplorerPanel() {
  const [expanded, setExpanded] = createSignal(new Set<string>(['']));
  const [activePath, setActivePath] = createSignal('');
  let tree: HTMLDivElement | undefined;
  const toggle = (path: string) => {
    setActivePath(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else { next.add(path); openResourceDirectory(path); }
      return next;
    });
  };
  const focusItem = (item: HTMLElement | undefined) => {
    if (!item) return;
    setActivePath(item.dataset.path ?? '');
    queueMicrotask(() => item.focus());
  };
  const navigateTree = (event: KeyboardEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!target || !tree) return;
    const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const index = items.indexOf(target);
    const directory = target.dataset.directory === 'true';
    const expandedNow = target.getAttribute('aria-expanded') === 'true';
    if (event.key === 'ArrowDown') focusItem(items[index + 1]);
    else if (event.key === 'ArrowUp') focusItem(items[index - 1]);
    else if (event.key === 'Home') focusItem(items[0]);
    else if (event.key === 'End') focusItem(items.at(-1));
    else if (event.key === 'ArrowRight' && directory) {
      if (!expandedNow) target.click();
      else if (Number(items[index + 1]?.getAttribute('aria-level')) > Number(target.getAttribute('aria-level'))) focusItem(items[index + 1]);
    } else if (event.key === 'ArrowLeft') {
      if (directory && expandedNow) target.click();
      else {
        const path = target.dataset.path ?? '';
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        focusItem(items.find((item) => item.dataset.path === parent));
      }
    } else if (event.key === 'Enter' || event.key === ' ') target.click();
    else return;
    event.preventDefault();
  };
  return <section class="flex min-h-0 flex-1 flex-col" aria-label="Explorer">
    <div class="resource-section-title flex h-28 items-center border-b border-divider px-8 text-10 font-650 uppercase tracking-6 text-text-secondary">
      <span>Files</span><IconButton label="Refresh Explorer" onClick={refreshResourceProject} class="ml-auto size-24 min-h-24 border-0 bg-transparent text-text-muted"><RefreshIcon /></IconButton>
    </div>
    <div ref={tree} class="ui-scrollbar min-h-0 flex-1 overflow-auto py-3" role="tree" aria-label="Workspace files" onKeyDown={navigateTree}>
      <Show when={resourceWorkspace().directories['']} fallback={<LoadingState label="Loading files" class="m-8 p-8! text-left!" />}>
        <FileLevel path="" depth={0} expanded={expanded()} activePath={activePath()} onActive={setActivePath} onToggle={toggle} />
      </Show>
    </div>
  </section>;
}

function FileLevel(props: { path: string; depth: number; expanded: Set<string>; activePath: string; onActive: (path: string) => void; onToggle: (path: string) => void }) {
  const entries = () => resourceWorkspace().directories[props.path]?.entries ?? [];
  const nextCursor = () => resourceWorkspace().directories[props.path]?.nextCursor;
  return <>
    <For each={entries()}>{(entry, index) => <FileRow entry={entry} depth={props.depth} index={index()} setSize={entries().length} expanded={props.expanded} activePath={props.activePath} onActive={props.onActive} onToggle={props.onToggle} />}</For>
    <Show when={nextCursor()}>{(cursor) => <button type="button" class="h-24 w-full border-0 bg-transparent text-left text-11 text-accent hover:bg-hover" style={{ 'padding-left': `${26 + props.depth * 13}px` }} onClick={() => openResourceDirectory(props.path, cursor())}>Load more…</button>}</Show>
  </>;
}

function FileRow(props: { entry: ResourceEntry; depth: number; index: number; setSize: number; expanded: Set<string>; activePath: string; onActive: (path: string) => void; onToggle: (path: string) => void }) {
  const path = () => String(props.entry.path ?? '');
  const directory = () => props.entry.kind === 'directory';
  const open = () => props.expanded.has(path());
  return <>
    <button
      type="button"
      role="treeitem"
      aria-expanded={directory() ? open() : undefined}
      aria-level={props.depth + 1}
      aria-posinset={props.index + 1}
      aria-setsize={props.setSize}
      data-path={path()}
      data-directory={directory() ? 'true' : 'false'}
      tabIndex={props.activePath === path() || (!props.activePath && props.depth === 0 && props.index === 0) ? 0 : -1}
      class="group flex h-24 w-full items-center border-0 bg-transparent pr-6 text-left text-12 text-text-primary hover:bg-hover focus-visible:bg-selected focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-neg-2"
      style={{ 'padding-left': `${6 + props.depth * 13}px` }}
      onClick={() => directory() ? props.onToggle(path()) : openFilePreview(path())}
      onFocus={() => props.onActive(path())}
      title={path()}
    >
      <span class={`mr-1 grid size-14 place-items-center text-text-muted transition-transform ${directory() ? '' : 'opacity-0'} ${open() ? 'rotate-90' : ''}`}><ChevronIcon /></span>
      <span class="mr-5 text-text-muted">{directory() ? <FolderIcon /> : <FileIcon />}</span>
      <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{String(props.entry.name ?? path())}</span>
    </button>
    <Show when={directory() && open()}>
      <div role="group">
        <Show when={resourceWorkspace().directories[path()]} fallback={<div class="h-24 text-11 text-text-faint" style={{ 'padding-left': `${32 + props.depth * 13}px` }}>Loading…</div>}>
          <FileLevel path={path()} depth={props.depth + 1} expanded={props.expanded} activePath={props.activePath} onActive={props.onActive} onToggle={props.onToggle} />
        </Show>
      </div>
    </Show>
  </>;
}
