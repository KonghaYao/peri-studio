import {
  Button,
  MonitorPanelShell,
  type MonitorPanelState,
  type MonitorSummaryView,
  type MonitorTraceRowView,
} from '@peri/ui';
import { For, createSignal } from 'solid-js';

const DEMO_SUMMARY: MonitorSummaryView = {
  traceCount: 12,
  totalTokens: 48200,
  totalCostUsd: 0.042,
  lastTimestamp: new Date(Date.now() - 120_000).toISOString(),
};

const DEMO_TRACES: MonitorTraceRowView[] = [
  {
    id: 'trace-1',
    name: 'turn',
    timestamp: '2026-09-13T08:00:00.000Z',
    latencyMs: 1200,
    tokens: 4100,
    costUsd: 0.003,
    level: 'DEFAULT',
  },
  {
    id: 'trace-2',
    name: 'turn',
    timestamp: '2026-09-13T07:55:00.000Z',
    latencyMs: 840,
    tokens: 2200,
    costUsd: 0.002,
    level: 'ERROR',
  },
  {
    id: 'trace-3',
    name: 'turn',
    timestamp: '2026-09-13T07:50:00.000Z',
    latencyMs: 640,
    tokens: 1800,
    level: 'DEFAULT',
  },
];

const DEMO_STATES: MonitorPanelState[] = [
  'loading',
  'empty-session',
  'empty-traces',
  'error',
  'ready',
];

/** Langfuse Monitor layer：mock traces 与状态切换。 */
export function MonitorPanelLayout() {
  const [state, setState] = createSignal<MonitorPanelState>('ready');

  return (
    <section class="flex h-full min-h-0 w-full flex-col gap-12" aria-label="Monitor panel layout">
      <div class="flex flex-wrap gap-6">
        <For each={DEMO_STATES}>
          {(demoState) => (
            <Button
              size="compact"
              variant={state() === demoState ? 'primary' : 'ghost'}
              class="border-0!"
              onClick={() => setState(demoState)}
            >
              {demoState}
            </Button>
          )}
        </For>
      </div>
      <div class="h-(--workbench-frame-height) min-h-0 overflow-hidden rounded-lg border border-border-subtle">
        <MonitorPanelShell
          embedded
          state={state()}
          summary={state() === 'ready' ? DEMO_SUMMARY : null}
          traces={state() === 'ready' ? DEMO_TRACES : []}
          errorMessage={state() === 'error' ? "Couldn't load traces." : undefined}
          onRetry={state() === 'error' ? () => setState('ready') : undefined}
          externalUrl={state() === 'ready' ? 'https://cloud.langfuse.com/project/demo/sessions/acp-demo' : undefined}
        />
      </div>
    </section>
  );
}
