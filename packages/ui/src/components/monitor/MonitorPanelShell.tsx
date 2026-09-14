import { For, Show, splitProps, type Component } from 'solid-js';
import { asAccessor, type MaybeAccessor } from '../../lib/maybe-accessor';
import { cn } from '../../lib/cn';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { InlineNotice } from '../InlineNotice';
import { LoadingState } from '../LoadingState';
import {
  formatMonitorTraceMeta,
  formatMonitorTraceName,
  monitorSummaryItems,
} from './format';
import {
  monitorListClass,
  monitorPanelClass,
  monitorStateClass,
  monitorSummaryClass,
  monitorSummaryItemClass,
  monitorTraceButtonClass,
  monitorTraceErrorClass,
  monitorTraceMetaClass,
  monitorTraceNameClass,
} from './monitor-panel-layout';
import type {
  MonitorPanelState,
  MonitorSummaryView,
  MonitorTraceRowView,
} from './types';

export type MonitorPanelShellProps = {
  embedded?: boolean;
  summary?: MaybeAccessor<MonitorSummaryView | null>;
  traces: MaybeAccessor<MonitorTraceRowView[]>;
  state: MaybeAccessor<MonitorPanelState>;
  errorMessage?: MaybeAccessor<string | undefined>;
  onRetry?: () => void;
  onTraceSelect?: (trace: MonitorTraceRowView) => void;
  class?: string;
  'data-testid'?: string;
};

/** T3 · Langfuse Monitor 内容壳（无 header；WorkbenchPanelChrome 由 T4 提供）。 */
export const MonitorPanelShell: Component<MonitorPanelShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'embedded',
    'summary',
    'traces',
    'state',
    'errorMessage',
    'onRetry',
    'onTraceSelect',
    'class',
  ]);

  const rootClass = () => cn(
    monitorPanelClass,
    local.embedded ? 'min-h-0 flex-1' : 'h-full w-full',
    local.class,
  );

  const state = () => asAccessor(local.state)();
  const traces = asAccessor(local.traces);
  const summary = () => (local.summary === undefined ? undefined : asAccessor(local.summary)());
  const errorMessage = () => (local.errorMessage === undefined ? undefined : asAccessor(local.errorMessage)());

  return (
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'monitor-panel-shell'}
      class={rootClass()}
      aria-label="Langfuse monitor"
    >
      <Show when={state() === 'loading'}>
        <div class={monitorStateClass}>
          <LoadingState label="Loading traces…" class="justify-center" />
        </div>
      </Show>

      <Show when={state() === 'empty-session'}>
        <div class={monitorStateClass}>
          <EmptyState
            variant="inline"
            class="border-0 bg-transparent py-24"
            title="Select a project session to view traces."
          />
        </div>
      </Show>

      <Show when={state() === 'error'}>
        <div class={monitorStateClass}>
          <InlineNotice tone="danger" class="max-w-full items-center gap-6 py-9 text-11 leading-16" role="alert">
            <div class="flex min-w-0 flex-1 flex-col items-center gap-8 text-center">
              <span class="min-w-0">{errorMessage() ?? "Couldn't load traces."}</span>
              <Show when={local.onRetry}>
                {(retry) => (
                  <Button
                    size="compact"
                    variant="ghost"
                    class="shrink-0 border-0! bg-transparent! px-3 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8"
                    onClick={() => retry()()}
                  >
                    Retry
                  </Button>
                )}
              </Show>
            </div>
          </InlineNotice>
        </div>
      </Show>

      <Show when={state() === 'empty-traces'}>
        <div class={monitorStateClass}>
          <EmptyState
            variant="inline"
            class="border-0 bg-transparent py-24"
            title="No traces yet for this session."
            description="Traces appear after the agent reports to Langfuse with this session id."
          />
        </div>
      </Show>

      <Show when={state() === 'ready'}>
        <Show when={summary()}>
          {(summaryView) => (
            <div class={monitorSummaryClass} data-testid="monitor-summary">
              <For each={monitorSummaryItems(summaryView())}>
                {(item) => <span class={monitorSummaryItemClass}>{item}</span>}
              </For>
            </div>
          )}
        </Show>

        <div class={monitorListClass} data-testid="monitor-trace-list" role="list">
          <For each={traces()}>
            {(trace) => {
              const displayName = () => formatMonitorTraceName(trace.name);
              const meta = () => formatMonitorTraceMeta(trace);
              return (
                <Show
                  when={local.onTraceSelect}
                  fallback={(
                    <div class={monitorTraceButtonClass} data-testid={`monitor-trace-${trace.id}`}>
                      <span class={monitorTraceNameClass}>{displayName()}</span>
                      <Show when={trace.level === 'ERROR'}>
                        <span class={monitorTraceErrorClass}>Error</span>
                      </Show>
                      <Show when={meta()}>
                        {(value) => <span class={monitorTraceMetaClass}>{value()}</span>}
                      </Show>
                    </div>
                  )}
                >
                  {(select) => (
                    <button
                      type="button"
                      class={monitorTraceButtonClass}
                      data-testid={`monitor-trace-${trace.id}`}
                      onClick={() => select()(trace)}
                    >
                      <span class={monitorTraceNameClass}>{displayName()}</span>
                      <Show when={trace.level === 'ERROR'}>
                        <span class={monitorTraceErrorClass}>Error</span>
                      </Show>
                      <Show when={meta()}>
                        {(value) => <span class={monitorTraceMetaClass}>{value()}</span>}
                      </Show>
                    </button>
                  )}
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};
