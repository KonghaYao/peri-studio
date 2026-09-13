import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPathTree, FileTree } from '@peri/ui';
import { GitGraphPanel, type GitGraphCommit } from '@peri/ui';

describe('resource tree widgets', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
  });

  it('renders folders with icon rows and no chevrons', () => {
    render(() => (
      <div role="tree">
        <FileTree
          nodes={[{ id: 'src', name: 'src', path: 'src', kind: 'folder', children: [] }]}
          expandedPaths={new Set()}
          onToggleFolder={() => {}}
        />
      </div>
    ));

    const row = screen.getByRole('treeitem', { name: /src/i });
    expect(row).toHaveClass('pl-6', 'gap-5', 'h-full');
    expect(row.parentElement).toHaveClass('h-(--tree-row-height)', 'items-center');
    expect(row.querySelector('svg.lucide-chevron-right')).toBeNull();
    expect(row.querySelector('[data-file-icon]')).toBeInTheDocument();
  });

  it('builds nested SCM paths into sorted folder groups', () => {
    const tree = buildPathTree([
      { id: 'b', path: 'src/b.ts' },
      { id: 'a', path: 'src/a.ts' },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe('folder');
    expect(tree[0].children?.map((node) => node.name)).toEqual(['a.ts', 'b.ts']);
  });

  it('renders git graph table headers and commit rows', () => {
    const commits: GitGraphCommit[] = [
      {
        id: '1',
        hash: 'abc12345',
        message: 'feat: graph panel',
        author: 'Peri',
        time: '1m',
        parents: [],
        isHead: true,
      },
    ];

    render(() => <GitGraphPanel commits={commits} />);

    expect(screen.getByText('Git Graph')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('feat: graph panel')).toBeInTheDocument();
    expect(screen.getByText('abc12345')).toBeInTheDocument();
    expect(screen.getByTestId('git-graph-table')).toBeInTheDocument();
    expect(screen.getByTestId('git-graph-svg')).toBeInTheDocument();
  });
});
