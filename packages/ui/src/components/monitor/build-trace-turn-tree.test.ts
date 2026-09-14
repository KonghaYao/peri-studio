import { describe, expect, it } from 'vitest';
import {
  buildTraceTurnSections,
  buildTraceTurnTree,
  collectTraceTurnTreeNodeIds,
  defaultIsNoiseObservation,
  findTraceTurnTreeNode,
  type MonitorTraceObservationFlat,
} from './build-trace-turn-tree';

const base = (overrides: Partial<MonitorTraceObservationFlat> & Pick<MonitorTraceObservationFlat, 'id'>): MonitorTraceObservationFlat => ({
  parentId: null,
  type: 'SPAN',
  name: overrides.id,
  startTime: '2025-01-01T00:00:00.000Z',
  endTime: '2025-01-01T00:00:01.000Z',
  level: 'DEFAULT',
  ...overrides,
});

describe('defaultIsNoiseObservation', () => {
  it('treats stage-* spans as noise unless ERROR', () => {
    expect(defaultIsNoiseObservation(base({ id: 'a', name: 'stage-reason' }))).toBe(true);
    expect(defaultIsNoiseObservation(base({ id: 'b', name: 'stage-act', level: 'ERROR' }))).toBe(false);
    expect(defaultIsNoiseObservation(base({ id: 'c', name: 'agent-run' }))).toBe(false);
  });
});

describe('buildTraceTurnTree', () => {
  it('links parent-child and sorts by startTime', () => {
    const observations = [
      base({ id: 'child', parentId: 'root', startTime: '2025-01-01T00:00:02.000Z' }),
      base({ id: 'root', startTime: '2025-01-01T00:00:01.000Z' }),
      base({ id: 'sibling', parentId: 'root', startTime: '2025-01-01T00:00:03.000Z' }),
    ];
    const tree = buildTraceTurnTree(observations, { omitNoise: false });
    expect(tree.map((node) => node.observation.id)).toEqual(['root']);
    expect(tree[0].children.map((node) => node.observation.id)).toEqual(['child', 'sibling']);
  });

  it('promotes orphans when parent is missing', () => {
    const observations = [base({ id: 'orphan', parentId: 'missing' })];
    expect(buildTraceTurnTree(observations)).toHaveLength(1);
  });

  it('hoists children through hidden stage-* nodes (fuse buildTree)', () => {
    const observations = [
      base({ id: 'agent', name: 'agent-run', startTime: '2025-01-01T00:00:00.000Z' }),
      base({
        id: 'stage',
        parentId: 'agent',
        name: 'stage-reason',
        startTime: '2025-01-01T00:00:01.000Z',
      }),
      base({
        id: 'gen',
        parentId: 'stage',
        type: 'GENERATION',
        name: 'plan',
        startTime: '2025-01-01T00:00:02.000Z',
      }),
    ];
    const tree = buildTraceTurnTree(observations);
    expect(tree[0].children.map((node) => node.observation.id)).toEqual(['gen']);
    expect(findTraceTurnTreeNode(tree, 'stage')).toBeNull();
  });

  it('can disable noise filtering via isNoise predicate', () => {
    const observations = [
      base({ id: 'agent', name: 'agent-run' }),
      base({ id: 'stage', parentId: 'agent', name: 'stage-reason' }),
    ];
    const tree = buildTraceTurnTree(observations, { isNoise: () => false });
    expect(tree[0].children.map((node) => node.observation.id)).toEqual(['stage']);
  });
});

describe('buildTraceTurnSections', () => {
  it('builds independent trees per turn', () => {
    const sections = buildTraceTurnSections([
      {
        id: 'turn-1',
        label: 'Turn 1',
        observations: [base({ id: 'a1' })],
      },
      {
        id: 'turn-2',
        label: 'Turn 2',
        observations: [base({ id: 'a2' })],
      },
    ]);
    expect(sections).toHaveLength(2);
    expect(sections[0].nodes[0].observation.id).toBe('a1');
    expect(sections[1].nodes[0].observation.id).toBe('a2');
  });
});

describe('collectTraceTurnTreeNodeIds', () => {
  it('respects expanded set for keyboard order', () => {
    const nodes = buildTraceTurnTree([
      base({ id: 'root', startTime: '2025-01-01T00:00:00.000Z' }),
      base({ id: 'child', parentId: 'root', startTime: '2025-01-01T00:00:01.000Z' }),
    ], { omitNoise: false });
    expect(collectTraceTurnTreeNodeIds(nodes, new Set(['root']))).toEqual(['root', 'child']);
    expect(collectTraceTurnTreeNodeIds(nodes, new Set())).toEqual(['root']);
  });
});
