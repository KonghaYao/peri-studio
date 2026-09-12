import type { FileTreeNode } from '@peri/ui';

export function cloneExplorerTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.map((n) => ({
    ...n,
    children: n.children ? cloneExplorerTree(n.children) : undefined,
  }));
}

export function findExplorerNode(nodes: FileTreeNode[], path: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.kind === 'folder' && node.children) {
      const found = findExplorerNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

export function parentDirectoryPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

export function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  return `${parent}/${name}`;
}

export function siblingBasenames(nodes: FileTreeNode[], parentPath: string, excludePath?: string): Set<string> {
  const names = new Set<string>();
  const visit = (list: FileTreeNode[]) => {
    for (const node of list) {
      if (node.path === excludePath) continue;
      if (parentDirectoryPath(node.path) === parentPath) names.add(node.name);
    }
  };
  const walk = (list: FileTreeNode[]) => {
    visit(list);
    for (const node of list) {
      if (node.kind === 'folder' && node.children) walk(node.children);
    }
  };
  walk(nodes);
  return names;
}

export type BasenameValidation =
  | { ok: true }
  | { ok: false; message: string };

export function validateExplorerBasename(name: string, siblings: Set<string>): BasenameValidation {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: 'Name cannot be empty.' };
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return { ok: false, message: 'Name cannot contain slashes.' };
  }
  if (trimmed === '.' || trimmed === '..') return { ok: false, message: 'Invalid name.' };
  if (trimmed.length > 255) return { ok: false, message: 'Name is too long.' };
  if (siblings.has(trimmed)) return { ok: false, message: 'Name already exists.' };
  return { ok: true };
}

export function removeNodeAtPath(nodes: FileTreeNode[], path: string): FileTreeNode[] {
  return nodes
    .filter((n) => n.path !== path)
    .map((n) =>
      n.kind === 'folder' && n.children
        ? { ...n, children: removeNodeAtPath(n.children, path) }
        : n,
    );
}

export function renameNodeAtPath(nodes: FileTreeNode[], targetPath: string, newName: string): FileTreeNode[] {
  const newPath = joinPath(parentDirectoryPath(targetPath), newName);

  const patchNode = (node: FileTreeNode): FileTreeNode => {
    if (node.path === targetPath) {
      return { ...node, name: newName, path: newPath, id: newPath };
    }
    let path = node.path;
    if (node.path.startsWith(`${targetPath}/`)) {
      path = newPath + node.path.slice(targetPath.length);
    }
    const children = node.kind === 'folder' && node.children ? node.children.map(patchNode) : undefined;
    return { ...node, path, id: path, children };
  };

  return nodes.map(patchNode);
}

export function addChildNode(nodes: FileTreeNode[], parentPath: string, child: FileTreeNode): FileTreeNode[] {
  if (parentPath === '') {
    return [...nodes, child];
  }
  return nodes.map((n) => {
    if (n.kind === 'folder' && n.path === parentPath) {
      return { ...n, children: [...(n.children ?? []), child] };
    }
    if (n.kind === 'folder' && n.children) {
      return { ...n, children: addChildNode(n.children, parentPath, child) };
    }
    return n;
  });
}

export function resolveNewItemParent(activePath: string | undefined, nodes: FileTreeNode[]): string {
  if (!activePath) return '';
  const node = findExplorerNode(nodes, activePath);
  if (!node) return '';
  if (node.kind === 'folder') return node.path;
  return parentDirectoryPath(node.path);
}

export function folderChildCount(nodes: FileTreeNode[], folderPath: string): number {
  const folder = findExplorerNode(nodes, folderPath);
  if (!folder || folder.kind !== 'folder') return 0;
  return folder.children?.length ?? 0;
}
