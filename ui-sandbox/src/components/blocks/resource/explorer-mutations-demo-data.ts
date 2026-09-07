import type { FileTreeNode } from './FileTree';

/** Mock workspace tree for Explorer mutations demos (wire not connected). */
export function createExplorerMutationsDemoTree(): FileTreeNode[] {
  return [
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
            {
              id: 'src/web/Composer.tsx',
              name: 'Composer.tsx',
              path: 'src/web/Composer.tsx',
              kind: 'file',
            },
            {
              id: 'src/web/index.ts',
              name: 'index.ts',
              path: 'src/web/index.ts',
              kind: 'file',
            },
          ],
        },
        {
          id: 'src/lib',
          name: 'lib',
          path: 'src/lib',
          kind: 'folder',
          children: [],
        },
      ],
    },
    {
      id: 'README.md',
      name: 'README.md',
      path: 'README.md',
      kind: 'file',
    },
  ];
}

export type ExplorerMutationsDemoMode =
  | 'idle'
  | 'inline-new-file'
  | 'inline-rename'
  | 'delete-file'
  | 'delete-folder-recursive'
  | 'move-dialog'
  | 'conflict'
  | 'disabled'
  | 'pending';

export const EXPLORER_MUTATIONS_DEMO_MODES: { id: ExplorerMutationsDemoMode; label: string }[] = [
  { id: 'idle', label: 'Idle (interactive)' },
  { id: 'inline-new-file', label: 'Inline new file' },
  { id: 'inline-rename', label: 'Inline rename' },
  { id: 'delete-file', label: 'Delete file' },
  { id: 'delete-folder-recursive', label: 'Delete folder (recursive)' },
  { id: 'move-dialog', label: 'Move to…' },
  { id: 'conflict', label: 'Version conflict' },
  { id: 'disabled', label: 'Disabled (read-only)' },
  { id: 'pending', label: 'Pending mutation' },
];
