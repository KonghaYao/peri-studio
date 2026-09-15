import { describe, expect, it } from 'vitest';
import { resolveQueryState } from './query-section-state';

describe('resolveQueryState', () => {
  it('returns loading when data is undefined and no error', () => {
    expect(
      resolveQueryState({ data: undefined, error: null, isPending: true, isFetching: true }, () => false),
    ).toEqual({ kind: 'loading', isFetching: true });
  });

  it('returns error when data is undefined and error is set', () => {
    const error = new Error('boom');
    expect(
      resolveQueryState({ data: undefined, error, isPending: false, isFetching: false }, () => false),
    ).toEqual({ kind: 'error', error, isFetching: false });
  });

  it('returns content with stale error when data exists', () => {
    const error = new Error('stale');
    expect(
      resolveQueryState({ data: [1], error, isPending: false, isFetching: true }, (data) => data.length === 0),
    ).toEqual({
      kind: 'content',
      data: [1],
      isEmpty: false,
      staleError: error,
      isFetching: true,
    });
  });
});
