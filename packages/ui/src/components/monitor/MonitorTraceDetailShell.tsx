import { Show, splitProps, type Component } from 'solid-js';
import { ArrowLeft, X } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { Button, IconButton } from '../Button';
import { EmptyState } from '../EmptyState';
import { InlineNotice } from '../InlineNotice';
import { LoadingState } from '../LoadingState';
import { formatMonitorTraceName } from './format';
import { MonitorObservationDetailShell } from './MonitorObservationDetailShell';
import { MonitorObservationTree } from './MonitorObservationTree';
import {
  monitorDetailHeaderClass,
  monitorDetailTitleClass,
  monitorPanelClass,
  monitorStateClass,
} from './monitor-panel-layout';
import type { MonitorObservationView, MonitorTraceDetailState } from './types';

export type MonitorTraceDetailShellProps = {
  embedded?: boolean;
  traceName: string;
  observations: MonitorObservationView[];
  state: MonitorTraceDetailState;
  errorMessage?: string;
  selectedObservation?: MonitorObservationView | null;
  onBack?: () => void;
  onClose?: () => void;
  onObservationSelect?: (observation: MonitorObservationView) => void;
  onObservationBack?: () => void;
  onRetry?: () => void;
  class?: string;
  'data-testid'?: string;
};

/** T3 · Langfuse trace drill-in 壳（Back + 名称 + observation 树）。 */
export const MonitorTraceDetailShell: Component<MonitorTraceDetailShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'embedded',
    'traceName',
    'observations',
    'state',
    'errorMessage',
    'selectedObservation',
    'onBack',
    'onClose',
    'onObservationSelect',
    'onObservationBack',
    'onRetry',
    'class',
  ]);

  const rootClass = () => cn(
    monitorPanelClass,
    local.embedded ? 'min-h-0 flex-1' : 'h-full w-full',
    local.class,
  );

  const selectedObservation = () => local.selectedObservation ?? null;

  return (
    <Show
      when={selectedObservation()}
      keyed
      fallback={(
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'monitor-trace-detail-shell'}
      class={rootClass()}
      aria-label="Trace detail"
    >
      <div class={monitorDetailHeaderClass}>
        <Show when={local.onBack}>
          {(back) => (
            <IconButton
              label="Back to traces"
              size="compact"
              variant="ghost"
              class="border-0 bg-transparent text-content-muted hover:text-content-primary"
              onClick={() => back()()}
            >
              <ArrowLeft size={14} strokeWidth={1.7} />
            </IconButton>
          )}
        </Show>
        <h2 class={monitorDetailTitleClass}>{formatMonitorTraceName(local.traceName)}</h2>
        <Show when={local.onClose}>
          {(close) => (
            <IconButton
              label="Close trace detail"
              size="compact"
              variant="ghost"
              class="border-0 bg-transparent text-content-muted hover:text-content-primary"
              onClick={() => close()()}
            >
              <X size={14} strokeWidth={1.7} />
            </IconButton>
          )}
        </Show>
      </div>

      <Show when={local.state === 'loading'}>
        <div class={monitorStateClass}>
          <LoadingState label="Loading trace…" class="justify-center" />
        </div>
      </Show>

      <Show when={local.state === 'error'}>
        <div class={monitorStateClass}>
          <InlineNotice tone="danger" class="max-w-full items-center gap-6 py-9 text-11 leading-16" role="alert">
            <div class="flex min-w-0 flex-1 flex-col items-center gap-8 text-center">
              <span class="min-w-0">{local.errorMessage ?? "Couldn't load trace."}</span>
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

      <Show when={local.state === 'ready'}>
        <Show
          when={local.observations.length > 0}
          fallback={(
            <div class={monitorStateClass}>
              <EmptyState
                variant="inline"
                class="border-0 bg-transparent py-24"
                title="No observations for this trace."
              />
            </div>
          )}
        >
          <MonitorObservationTree
            observations={local.observations}
            onSelect={local.onObservationSelect}
          />
        </Show>
      </Show>
    </div>
      )}
    >
      {(observation) => (
        <MonitorObservationDetailShell
          embedded={local.embedded}
          observation={observation}
          onBack={local.onObservationBack}
          onClose={local.onClose}
          class={local.class}
          data-testid="monitor-observation-detail"
        />
      )}
    </Show>
  );
};
