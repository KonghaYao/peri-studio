import { describe, expect, it } from 'vitest';
import { gitLogHasIncompleteDag, mapGitLogToGraphCommits } from './map-git-log';

describe('mapGitLogToGraphCommits', () => {
  it('maps wire entries to layout commits with full oid keys', () => {
    const commits = mapGitLogToGraphCommits([
      {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        short_oid: 'aaaaaaaa',
        message: 'feat: graph',
        author_name: 'Peri',
        author_date: '2026-08-30T10:00:00.000Z',
        parents: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
        refs: [{ name: 'main', kind: 'branch' }, { name: 'origin/main', kind: 'remote' }],
      },
    ], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(commits).toEqual([{
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      shortHash: 'aaaaaaaa',
      message: 'feat: graph',
      author: 'Peri',
      date: '2026-08-30T10:00:00.000Z',
      time: expect.any(String),
      parents: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
      refs: [{ label: 'main', tone: 'branch' }, { label: 'origin/main', tone: 'remote' }],
      isHead: true,
    }]);
  });

  it('marks only the head oid as current', () => {
    const [head, parent] = mapGitLogToGraphCommits([
      { id: 'head', oid: 'head', message: 'head', author_name: 'A', author_date: '', parents: ['parent'] },
      { id: 'parent', oid: 'parent', message: 'parent', author_name: 'A', author_date: '', parents: [] },
    ], 'head');

    expect(head.isHead).toBe(true);
    expect(parent.isHead).toBe(false);
  });

  it('detects incomplete dag metadata', () => {
    expect(gitLogHasIncompleteDag([
      { id: 'a', message: 'a', author: 'A', time: '1m', parentsComplete: false },
    ])).toBe(true);
    expect(gitLogHasIncompleteDag([
      { id: 'a', message: 'a', author: 'A', time: '1m', parentsComplete: true, refsComplete: true },
    ])).toBe(false);
  });
});
