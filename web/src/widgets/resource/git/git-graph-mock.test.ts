import { describe, expect, it } from 'vitest';
import { MOCK_GIT_GRAPH_COMMITS } from './git-graph-mock';

describe('MOCK_GIT_GRAPH_COMMITS', () => {
  it('contains at least five commits', () => {
    expect(MOCK_GIT_GRAPH_COMMITS.length).toBeGreaterThanOrEqual(5);
  });

  it('marks exactly one commit as HEAD', () => {
    const heads = MOCK_GIT_GRAPH_COMMITS.filter((commit) => commit.isHead);
    expect(heads.length).toBe(1);
  });

  it('includes at least one merge commit with two parents', () => {
    const merges = MOCK_GIT_GRAPH_COMMITS.filter((commit) => (commit.parents ?? []).length >= 2);
    expect(merges.length).toBeGreaterThanOrEqual(1);
  });

  it('covers branch, remote and tag ref tones', () => {
    const tones = new Set(
      MOCK_GIT_GRAPH_COMMITS
        .flatMap((commit) => commit.refs ?? [])
        .map((ref) => ref.tone ?? 'branch'),
    );
    expect(tones.has('branch')).toBe(true);
    expect(tones.has('remote')).toBe(true);
    expect(tones.has('tag')).toBe(true);
  });
});
