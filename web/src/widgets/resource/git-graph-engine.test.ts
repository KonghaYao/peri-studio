import { describe, expect, it } from 'vitest';
import { layoutGitGraph } from '@peri/ui';

describe('git-graph-engine', () => {
  it('lays out a linear history with one node per commit', () => {
    const layout = layoutGitGraph(
      [
        { hash: 'c2', parents: ['c1'] },
        { hash: 'c1', parents: [] },
      ],
      'c2',
    );

    expect(layout.nodes).toHaveLength(2);
    expect(layout.paths.length).toBeGreaterThan(0);
    expect(layout.vertexColors).toHaveLength(2);
    expect(layout.contentWidth).toBeGreaterThan(0);
  });

  it('assigns distinct branch colors for a merge commit', () => {
    const layout = layoutGitGraph(
      [
        { hash: 'merge', parents: ['main', 'feature'] },
        { hash: 'main', parents: [] },
        { hash: 'feature', parents: [] },
      ],
      'merge',
    );

    expect(layout.nodes.length).toBeGreaterThanOrEqual(2);
    expect(new Set(layout.vertexColors).size).toBeGreaterThan(1);
  });
});
