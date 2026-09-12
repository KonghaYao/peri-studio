import { createSignal, Show } from 'solid-js';
import { FileTree, fileTreeDropRootClass, type FileTreeNode } from '@peri/ui';
import { Button } from '@/lib/catalog-ui';
import { ButtonGroup } from '@/lib/catalog-ui';
import { cn } from '@/lib/catalog-ui';

type DropTargetKind = 'none' | 'root' | 'folder';

const DEMO_TREE: FileTreeNode[] = [
  {
    id: 'src',
    kind: 'folder',
    path: 'src',
    name: 'src',
    children: [
      {
        id: 'src/web',
        kind: 'folder',
        path: 'src/web',
        name: 'web',
        children: [
          {
            id: 'src/web/Composer.tsx',
            kind: 'file',
            path: 'src/web/Composer.tsx',
            name: 'Composer.tsx',
          },
        ],
      },
    ],
  },
];

/** Tier 4 · Explorer 文件夹/root drop target 与批次进度 demo。 */
export function ExplorerUploadDropLayout() {
  const [target, setTarget] = createSignal<DropTargetKind>('folder');
  const [showDirectoryAlert, setShowDirectoryAlert] = createSignal(false);
  const [batchProgress, setBatchProgress] = createSignal<{ done: number; total: number } | null>({ done: 2, total: 5 });
  const [liveTarget, setLiveTarget] = createSignal('Upload target: folder web');
  const [expandedPaths, setExpandedPaths] = createSignal(new Set(['src', 'src/web']));

  const dropTargetPath = () => (target() === 'folder' ? 'src/web' : null);

  const applyTarget = (next: DropTargetKind) => {
    setTarget(next);
    setShowDirectoryAlert(false);
    if (next === 'root') setLiveTarget('Upload target: workspace root');
    else if (next === 'folder') setLiveTarget('Upload target: folder web');
    else setLiveTarget('');
  };

  const toggleFolder = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div class="flex max-w-sm flex-col gap-16">
      <div class="flex flex-wrap gap-8">
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
          'explorer-upload-tree rounded-md px-4 py-8 text-12',
          target() === 'root' && fileTreeDropRootClass,
        )}
      >
        <FileTree
          nodes={DEMO_TREE}
          expandedPaths={expandedPaths()}
          onToggleFolder={toggleFolder}
          dropTargetPath={dropTargetPath()}
        />

        <Show when={target() === 'root'}>
          <p role="status" class="mt-8 px-4 text-11 text-accent-solid">
            Upload to workspace root
          </p>
        </Show>
        <Show when={target() === 'folder'}>
          <p role="status" class="mt-8 px-4 text-11 text-accent-solid">
            Upload to web
          </p>
        </Show>
      </div>

      <Show when={showDirectoryAlert()}>
        <p role="alert" class="text-11 text-danger-strong">
          Folders are not supported yet. Upload files instead.
        </p>
      </Show>

      <p aria-live="polite" class="min-h-20 text-11 text-content-muted">
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
