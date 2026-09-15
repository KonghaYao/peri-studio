/** Minimal async query projection for {@link QuerySection}. */
export interface QuerySnapshot<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
}

/** Rendering state for independently loaded query sections. */
export type QuerySectionState<T> =
  | { kind: 'loading'; isFetching: boolean }
  | { kind: 'error'; error: unknown; isFetching: boolean }
  | {
      kind: 'content';
      data: T;
      isEmpty: boolean;
      staleError: unknown | null;
      isFetching: boolean;
    };

function hasError(error: unknown): boolean {
  return error !== null && error !== undefined;
}

/** Resolve async state for {@link QuerySection}. */
export function resolveQueryState<T>(
  snapshot: QuerySnapshot<T>,
  isEmpty: (data: T) => boolean,
): QuerySectionState<T> {
  if (snapshot.data === undefined) {
    if (hasError(snapshot.error)) {
      return { kind: 'error', error: snapshot.error, isFetching: snapshot.isFetching };
    }
    return { kind: 'loading', isFetching: snapshot.isFetching };
  }

  return {
    kind: 'content',
    data: snapshot.data,
    isEmpty: isEmpty(snapshot.data),
    staleError: hasError(snapshot.error) ? snapshot.error : null,
    isFetching: snapshot.isFetching,
  };
}
