import { createSignal, For, Show } from 'solid-js';
import { File, FolderOpen } from 'lucide-solid';
import { Button } from '@/components/ui';
import { ButtonGroup } from '@/components/ui/ButtonGroup';
import { cn } from '@/lib/cn';

type DropTargetKind = 'none' | 'root' | 'folder';

type TreeNode =
  | { kind: 'folder'; path: string; name: string; children: TreeNode[] }
  | { kind: 'file'; path: string; name: string };

const DEMO_TREE: TreeNode[] = [
  {
    kind: 'folder',
    path: 'src',
    name: 'src',
    children: [
      {
        kind: 'folder',
        path: 'src/web',
        name: 'web',
        children: [{ kind: 'file', path: 'src/web/Composer.tsx', name: 'Composer.tsx' }],
      },
    ],
  },
];

function ExplorerDropTreeNode(props: {
  node: TreeNode;
  depth: number;
  dropTargetPath: string | null;
}) {
  const paddingLeft = () => `calc(6px + ${props.depth} * 12px)`;

  if (props.node.kind === 'file') {
    return (
      <div
        role="treeitem"
        class="flex w-full items-center gap-1.5 rounded-md pr-2 hover:bg-interaction-hover"
        style={{ 'min-height': 'var(--resource-tree-row)', 'padding-left': paddingLeft() }}
      >
        <File size={14} class="shrink-0 text-content-muted" />
        <span class="truncate text-12 text-content-primary">{props.node.name}</span>
      </div>
    );
  }

  const node = props.node;
  const isTarget = () => props.dropTargetPath === node.path;

  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-expanded
        data-drop-target-path={node.path}
        class={cn(
          'explorer-upload-treeitem flex w-full items-center gap-1.5 rounded-md border-0 bg-transparent pr-2 text-left text-content-primary',
          isTarget() ? 'explorer-upload-treeitem--drop-target bg-interaction-hover' : 'hover:bg-interaction-hover',
        )}
        style={{ 'min-height': 'var(--resource-tree-row)', 'padding-left': paddingLeft() }}
      >
        <FolderOpen size={14} class="shrink-0 text-content-muted" />
        <span class="min-w-0 flex-1 truncate font-medium">{node.name}</span>
      </button>
      <div role="group">
        <For each={node.children}>
          {(child) => (
            <ExplorerDropTreeNode node={child} depth={props.depth + 1} dropTargetPath={props.dropTargetPath} />
          )}
        </For>
      </div>
    </>
  );
}

/** Tier 4 · Explorer 文件夹/root drop target 与批次进度 demo。 */
export function ExplorerUploadDropLayout() {
  const [target, setTarget] = createSignal<DropTargetKind>('folder');
  const [showDirectoryAlert, setShowDirectoryAlert] = createSignal(false);
  const [batchProgress, setBatchProgress] = createSignal<{ done: number; total: number } | null>({ done: 2, total: 5 });
  const [liveTarget, setLiveTarget] = createSignal('Upload target: folder web');

  const dropTargetPath = () => (target() === 'folder' ? 'src/web' : null);

  const applyTarget = (next: DropTargetKind) => {
    setTarget(next);
    setShowDirectoryAlert(false);
    if (next === 'root') setLiveTarget('Upload target: workspace root');
    else if (next === 'folder') setLiveTarget('Upload target: folder web');
    else setLiveTarget('');
  };

  return (
    <div class="flex max-w-sm flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant={target() === 'none' ? 'primary' : 'default'} onClick={() => applyTarget('none')}>
          No target
        </Button>
        <Button size="sm" variant={target() === 'root' ? 'primary' : 'default'} onClick={() => applyTarget('root')}>
          Root drop
        </Button>
        <Button size="sm" variant={target() === 'folder' ? 'primary' : 'default'} onClick={() => applyTarget('folder')}>
          Folder web
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setShowDirectoryAlert(true);
            setLiveTarget('Folders are not supported yet. Upload files instead.');
          }}
        >
          Simulate directory drop
        </Button>
      </div>

      <Show when={batchProgress()}>
        {(progress) => (
          <p role="status" class="text-11 text-content-secondary">
            Uploading {progress().done} of {progress().total} files…
          </p>
        )}
      </Show>

      <div
        role="tree"
        aria-label="Workspace files"
        class={cn(
          'explorer-upload-tree rounded-md px-1 py-2 text-12',
          target() === 'root' && 'explorer-upload-tree--drop-root',
        )}
      >
        <For each={DEMO_TREE}>
          {(node) => <ExplorerDropTreeNode node={node} depth={0} dropTargetPath={dropTargetPath()} />}
        </For>

        <Show when={target() === 'root'}>
          <p role="status" class="mt-2 px-1 text-11 text-accent-solid">
            Upload to workspace root
          </p>
        </Show>
        <Show when={target() === 'folder'}>
          <p role="status" class="mt-2 px-1 text-11 text-accent-solid">
            Upload to web
          </p>
        </Show>
      </div>

      <Show when={showDirectoryAlert()}>
        <p role="alert" class="text-11 text-danger-strong">
          Folders are not supported yet. Upload files instead.
        </p>
      </Show>

      <p aria-live="polite" class="min-h-5 text-11 text-content-muted">
        {liveTarget()}
      </p>

      <ButtonGroup aria-label="Batch controls">
        <Button
          size="sm"
          variant="ghost"
          class="rounded-none border-r border-border-subtle"
          onClick={() => setBatchProgress(null)}
        >
          Hide batch progress
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setBatchProgress({ done: 4, total: 5 })}>
          Show 4/5
        </Button>
      </ButtonGroup>
    </div>
  );
}
