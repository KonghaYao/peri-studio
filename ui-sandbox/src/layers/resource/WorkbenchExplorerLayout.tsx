import { createSignal } from 'solid-js';
import { FileTree, type FileTreeNode } from '@/components/blocks/resource';
import { GitFileIcon } from '@/components/blocks/git';

export const WORKBENCH_EXPLORER_DEMO: FileTreeNode[] = [
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

/** Workbench 内窄栏 Explorer：复用 FileTree。 */
export function WorkbenchExplorerLayout(props: {
  selectedPath: string;
  onSelectPath: (path: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(new Set(['src', 'src/web']));

  return (
    <div class="px-4 py-8 text-12" role="tree" aria-label="Explorer">
      <FileTree
        nodes={WORKBENCH_EXPLORER_DEMO}
        expandedPaths={expanded()}
        onToggleFolder={(path) => {
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          });
        }}
        selectedPath={props.selectedPath}
        onSelect={(node) => props.onSelectPath(node.path)}
        renderFileIcon={(node) => <GitFileIcon path={node.path} />}
      />
    </div>
  );
}
