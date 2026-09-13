import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTree, type FileTreeNode } from './FileTree';

afterEach(() => cleanup());

const demoNodes: FileTreeNode[] = [
  {
    id: 'src',
    name: 'src',
    path: 'src',
    kind: 'folder',
    children: [{ id: 'src/a', name: 'a.ts', path: 'src/a.ts', kind: 'file' }],
  },
  {
    id: 'lib',
    name: 'lib',
    path: 'lib',
    kind: 'folder',
    children: [{ id: 'lib/b', name: 'b.ts', path: 'lib/b.ts', kind: 'file' }],
  },
  { id: 'readme', name: 'README.md', path: 'README.md', kind: 'file' },
];

describe('FileTree', () => {
  it('keeps existing rows mounted when another folder expands', () => {
    const [expanded, setExpanded] = createSignal(new Set<string>(['src']));
    const mounts: string[] = [];
    render(() => (
      <div role="tree">
        <FileTree
          nodes={demoNodes}
          expandedPaths={expanded()}
          onToggleFolder={(path) => {
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            });
          }}
          onNodeMount={(node) => { mounts.push(node.path); }}
        />
      </div>
    ));

    const src = screen.getByRole('treeitem', { name: /^src$/ });
    const readme = screen.getByRole('treeitem', { name: /README\.md/ });
    const nested = screen.getByRole('treeitem', { name: /a\.ts/ });
    expect(mounts.filter((path) => path === 'src')).toHaveLength(1);
    const mountedBefore = mounts.length;

    fireEvent.click(screen.getByRole('treeitem', { name: /^lib$/ }));

    expect(screen.getByRole('treeitem', { name: /^src$/ })).toBe(src);
    expect(screen.getByRole('treeitem', { name: /README\.md/ })).toBe(readme);
    expect(screen.getByRole('treeitem', { name: /a\.ts/ })).toBe(nested);
    expect(screen.getByRole('treeitem', { name: /b\.ts/ })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /^lib$/ })).toHaveAttribute('aria-expanded', 'true');
    expect(mounts.filter((path) => path === 'src')).toHaveLength(1);
    expect(mounts.filter((path) => path === 'README.md')).toHaveLength(1);
    expect(mounts.filter((path) => path === 'src/a.ts')).toHaveLength(1);
    expect(mounts.length).toBe(mountedBefore + 1);
  });

  it('aligns folder and file row geometry', () => {
    render(() => (
      <div role="tree">
        <FileTree
          nodes={demoNodes}
          expandedPaths={new Set(['src'])}
          onToggleFolder={() => {}}
        />
      </div>
    ));

    const folderRow = screen.getByRole('treeitem', { name: /^src$/ });
    const fileRow = screen.getByRole('treeitem', { name: /a\.ts/ });
    expect(folderRow).toHaveClass('pl-6', 'gap-5', 'h-full');
    expect(fileRow).toHaveClass('pl-6', 'gap-5', 'h-full');
    expect(folderRow.parentElement).toHaveClass('h-(--tree-row-height)', 'items-center');
    expect(fileRow.parentElement).toHaveClass('h-(--tree-row-height)', 'items-center');
  });

  it('updates aria-expanded on the same folder row without remounting it', () => {
    const [expanded, setExpanded] = createSignal(new Set<string>());
    const mounts: string[] = [];
    render(() => (
      <div role="tree">
        <FileTree
          nodes={demoNodes}
          expandedPaths={expanded()}
          onToggleFolder={(path) => {
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            });
          }}
          onNodeMount={(node) => { mounts.push(node.path); }}
        />
      </div>
    ));

    const src = screen.getByRole('treeitem', { name: /^src$/ });
    expect(src).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(src);
    expect(screen.getByRole('treeitem', { name: /^src$/ })).toBe(src);
    expect(src).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: /a\.ts/ })).toBeTruthy();
    expect(mounts.filter((path) => path === 'src')).toHaveLength(1);
  });
});
