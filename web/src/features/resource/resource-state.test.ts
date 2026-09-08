import { describe, expect, it } from 'vitest';
import { initialResourceWorkspace, reduceResourceView } from './resource-state';
import type { ResourceView } from '@/entities/resource/resource-view';

const baseView = (patch: Partial<ResourceView>): ResourceView => ({
  docId: 'resource:view-1',
  viewId: 'view-1',
  projectId: 'project-1',
  viewType: 'git_log_page',
  repoId: 'repo-1',
  entries: [],
  meta: {},
  ...patch,
});

describe('reduceResourceView git log', () => {
  it('merges git log pages with the same generation and head oid', () => {
    const state = {
      ...initialResourceWorkspace(),
      projectId: 'project-1',
      repositories: [{ id: 'repo-1', root: '', name: 'repo', generation: 'g1', groups: {} }],
    };
    const first = reduceResourceView(state, baseView({
      sourceGeneration: 'g1',
      meta: { head_oid: 'head-1' },
      entries: [{ id: 'c1', oid: 'c1', message: 'one' }],
      nextCursor: 'g1.50',
    }));
    const second = reduceResourceView(first.state, baseView({
      docId: 'resource:view-2',
      viewId: 'view-2',
      sourceGeneration: 'g1',
      meta: { head_oid: 'head-1' },
      entries: [{ id: 'c2', oid: 'c2', message: 'two' }],
    }));

    expect(second.state.repositories[0].log).toEqual({
      commits: [{ id: 'c1', oid: 'c1', message: 'one' }, { id: 'c2', oid: 'c2', message: 'two' }],
      nextCursor: undefined,
      sourceGeneration: 'g1',
      headOid: 'head-1',
    });
  });

  it('replaces accumulated log when head oid changes', () => {
    const state = {
      ...initialResourceWorkspace(),
      projectId: 'project-1',
      repositories: [{
        id: 'repo-1', root: '', name: 'repo', generation: 'g1', groups: {},
        log: { commits: [{ id: 'old', oid: 'old', message: 'old' }], sourceGeneration: 'g1', headOid: 'head-1' },
      }],
    };
    const next = reduceResourceView(state, baseView({
      sourceGeneration: 'g1',
      meta: { head_oid: 'head-2' },
      entries: [{ id: 'new', oid: 'new', message: 'new' }],
    }));

    expect(next.state.repositories[0].log?.commits).toEqual([{ id: 'new', oid: 'new', message: 'new' }]);
  });

  it('does not route unknown views into git groups', () => {
    const state = {
      ...initialResourceWorkspace(),
      projectId: 'project-1',
      repositories: [{ id: 'repo-1', root: '', name: 'repo', generation: 'g1', groups: {} }],
    };
    const next = reduceResourceView(state, baseView({
      viewType: 'future_view' as ResourceView['viewType'],
      groupId: undefined,
    }));

    expect(next.state).toBe(state);
    expect(next.state.repositories[0].groups).toEqual({});
  });

  it('reopens from start when a stale pagination page arrives after head changes', () => {
    const state = {
      ...initialResourceWorkspace(),
      projectId: 'project-1',
      repositories: [{
        id: 'repo-1', root: '', name: 'repo', generation: 'g1', groups: {},
        log: {
          commits: [{ id: 'c1', oid: 'c1', message: 'one' }],
          sourceGeneration: 'g1',
          headOid: 'head-1',
          nextCursor: 'g1.50',
        },
      }],
    };
    const next = reduceResourceView(state, baseView({
      sourceGeneration: 'g1',
      meta: { head_oid: 'head-2' },
      entries: [{ id: 'c2', oid: 'c2', message: 'two' }],
    }));

    expect(next.state.repositories[0].log).toBeUndefined();
    expect(next.followups).toEqual([{
      key: 'log:repo-1:start',
      payload: { kind: 'git-log-page', repoId: 'repo-1', expectedGeneration: 'g1' },
    }]);
  });

  it('stores head oid from git repository meta and clears log when it changes', () => {
    const state = {
      ...initialResourceWorkspace(),
      projectId: 'project-1',
      repositories: [{
        id: 'repo-1', root: '', name: 'repo', generation: 'g1', headOid: 'head-1', groups: {},
        log: { commits: [{ id: 'c1', oid: 'c1' }], sourceGeneration: 'g1', headOid: 'head-1' },
      }],
    };
    const next = reduceResourceView(state, {
      ...baseView({ viewType: 'git_repository' }),
      sourceGeneration: 'g1',
      meta: { root: '/repo', head_oid: 'head-2' },
      entries: [],
    });

    expect(next.state.repositories[0].headOid).toBe('head-2');
    expect(next.state.repositories[0].log).toBeUndefined();
  });
});
