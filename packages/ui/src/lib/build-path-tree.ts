import type { FileTreeNode } from '../components/FileTree';

/** 将扁平文件路径列表构建为 Explorer / SCM 共用的树节点。 */
export function buildPathTree(
  items: Array<{ id: string; path: string; meta?: FileTreeNode['meta'] }>,
): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const folders = new Map<string, FileTreeNode>();

  for (const item of items) {
    const parts = item.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let currentChildren = root;
    let currentPath = '';

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isFile = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isFile) {
        currentChildren.push({
          id: item.id,
          name: part,
          path: item.path,
          kind: 'file',
          meta: item.meta,
        });
      } else {
        let folder = folders.get(currentPath);
        if (!folder) {
          folder = {
            id: currentPath,
            name: part,
            path: currentPath,
            kind: 'folder',
            children: [],
          };
          folders.set(currentPath, folder);
          currentChildren.push(folder);
        }
        currentChildren = folder.children ?? [];
      }
    }
  }

  return sortTreeNodes(root);
}

export function folderPathsFromItems(items: Array<{ path: string }>): Set<string> {
  const paths = new Set<string>();
  for (const item of items) {
    const parts = item.path.split('/').filter(Boolean);
    let current = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      current = current ? `${current}/${parts[index]}` : parts[index];
      paths.add(current);
    }
  }
  return paths;
}

function sortTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  const sorted = [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  for (const node of sorted) {
    if (node.children) node.children = sortTreeNodes(node.children);
  }

  return sorted;
}
