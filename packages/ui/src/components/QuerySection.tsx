import { createMemo, Match, Switch, type JSX } from 'solid-js';
import {
  resolveQueryState,
  type QuerySectionState,
  type QuerySnapshot,
} from '../lib/query-section-state';
import { TableInlineError } from './TableInlineError';

/** Query handle consumed by {@link QuerySection}. */
export interface QueryHandle<T> extends QuerySnapshot<T> {
  refetch: () => Promise<unknown>;
}

export type QuerySectionProps<T> = {
  label: string;
  query: QueryHandle<T>;
  isEmpty: (data: T) => boolean;
  loading: JSX.Element;
  empty: JSX.Element;
  children: (data: T) => JSX.Element;
};

function QueryFailure(props: {
  label: string;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  onRetry: () => void;
}) {
  return (
    <TableInlineError
      class="mb-12"
      title={
        props.isStale
          ? `Could not refresh ${props.label}; showing previous data.`
          : `Could not load ${props.label}.`
      }
      error={props.error}
      isStale={props.isStale}
      retrying={props.isFetching}
      onRetry={props.onRetry}
      retryLabel={props.isFetching ? 'Retrying…' : 'Retry'}
    />
  );
}

/** T3 · Async query section with loading, error, stale-refresh, and empty slots. */
export function QuerySection<T>(props: QuerySectionProps<T>) {
  const state = createMemo(() => resolveQueryState(props.query, props.isEmpty));
  const contentState = createMemo(() => {
    const current = state();
    return current.kind === 'content' ? current : undefined;
  });
  const retry = () => void props.query.refetch();

  return (
    <Switch>
      <Match when={state().kind === 'loading'}>
        <div role="status" aria-live="polite" aria-label={`Loading ${props.label}`}>
          {props.loading}
        </div>
      </Match>
      <Match when={state().kind === 'error'}>
        <QueryFailure
          label={props.label}
          error={(state() as QuerySectionState<T> & { kind: 'error' }).error}
          isFetching={props.query.isFetching}
          isStale={false}
          onRetry={retry}
        />
      </Match>
      <Match when={contentState()}>
        {(s) => {
          const content = s() as QuerySectionState<T> & {
            kind: 'content';
            data: T;
            isEmpty: boolean;
            staleError: unknown | null;
            isFetching: boolean;
          };
          return (
            <div aria-busy={content.isFetching}>
              {content.staleError !== null && (
                <QueryFailure
                  label={props.label}
                  error={content.staleError}
                  isFetching={props.query.isFetching}
                  isStale
                  onRetry={retry}
                />
              )}
              {content.isFetching && !content.staleError && (
                <span role="status" class="sr-only">
                  Refreshing {props.label}
                </span>
              )}
              {content.isEmpty ? props.empty : props.children(content.data)}
            </div>
          );
        }}
      </Match>
    </Switch>
  );
}
