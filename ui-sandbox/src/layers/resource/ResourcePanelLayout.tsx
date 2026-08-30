import { createSignal } from 'solid-js';
import { CodeXml } from 'lucide-solid';
import { FileTree, type FileTreeNode } from '@/components/blocks/resource';
import { GitFileIcon } from '@/components/blocks/git';

const EXPLORER_DEMO: FileTreeNode[] = [
  {
    id: 'src',
    name: 'src',
    path: 'src',
    kind: 'folder',
    children: [
      {
        id: 'src/web',
        name: 'web',
        path: 'src/web',
        kind: 'folder',
        children: [
          { id: 'composer', name: 'Composer.tsx', path: 'src/web/Composer.tsx', kind: 'file' },
          { id: 'status', name: 'StatusArea.tsx', path: 'src/web/StatusArea.tsx', kind: 'file' },
        ],
      },
    ],
  },
];

/** Tier 4 · 资源面板组合：FileTree + diff 预览。 */
export function ResourcePanelLayout() {
  const [expanded, setExpanded] = createSignal(new Set(['src', 'src/web']));
  const [selected, setSelected] = createSignal('src/web/Composer.tsx');

  return (
    <div class="grid max-w-3xl grid-cols-1 gap-4 min-diff-min:grid-cols-2">
      <div class="rounded-lg border border-border-subtle bg-surface-canvas p-2 text-12" role="tree" aria-label="Explorer">
        <FileTree
          nodes={EXPLORER_DEMO}
          expandedPaths={expanded()}
          onToggleFolder={(path) => {
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            });
          }}
          selectedPath={selected()}
          onSelect={(node) => setSelected(node.path)}
          renderFileIcon={(node) => <GitFileIcon path={node.path} />}
        />
      </div>
      <div class="rounded-lg border border-border-subtle p-3">
        <div class="mb-2 flex items-center gap-2 text-12 font-medium text-content-primary"><CodeXml size={14} class="text-content-muted" />diff preview</div>
        <div class="overflow-hidden rounded-md border border-border-subtle font-mono text-11 leading-relaxed">
          <div class="bg-success-soft px-2.5 text-success-strong">+ export function installAppBridge() {'{'}</div>
          <div class="bg-danger-soft px-2.5 text-danger-strong">- export function installBridge() {'{'}</div>
          <div class="px-2.5 text-content-muted">&nbsp;&nbsp;const channel = createChannel();</div>
        </div>
      </div>
    </div>
  );
}
