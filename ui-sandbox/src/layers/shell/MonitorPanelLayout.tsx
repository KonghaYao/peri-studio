import {
  Button,
  MonitorPanelShell,
  MonitorTraceDetailShell,
  type MonitorObservationView,
  type MonitorPanelState,
  type MonitorSummaryView,
  type MonitorTraceRowView,
} from '@peri/ui';
import { For, Show, createSignal } from 'solid-js';

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
    name: '',
    timestamp: '2026-09-13T07:50:00.000Z',
    latencyMs: 640,
    tokens: 1800,
    level: 'DEFAULT',
  },
];

const DEMO_OBSERVATIONS: MonitorObservationView[] = [
  {
    id: 'agent-run',
    name: 'agent-run',
    kind: 'SPAN',
    latencyMs: 6880,
    level: 'DEFAULT',
    children: [
      {
        id: 'stage-reason',
        name: 'stage-reason',
        kind: 'SPAN',
        latencyMs: 6850,
        level: 'DEFAULT',
        children: [
          {
            id: 'step-1',
            name: 'step-1',
            kind: 'GENERATION',
            latencyMs: 6850,
            level: 'DEFAULT',
            model: 'gpt-4.1',
            inputTokens: 24538,
            outputTokens: 70,
            tokens: 24140,
            inputPreview: '{"messages":[{"role":"user","content":"Summarize the trace."}]}',
            outputPreview: '{"role":"assistant","content":"Done."}',
          },
        ],
      },
      {
        id: 'cache-hit-rate-low',
        name: 'cache-hit-rate-low',
        kind: 'SCORE',
        level: 'DEFAULT',
        scoreValue: '0.18',
        scoreDataType: 'NUMERIC',
      },
    ],
  },
];

function stripObservationForTree(observation: MonitorObservationView): MonitorObservationView {
  const {
    inputPreview: _inputPreview,
    outputPreview: _outputPreview,
    inputTruncated: _inputTruncated,
    outputTruncated: _outputTruncated,
    scoreValue: _scoreValue,
    scoreDataType: _scoreDataType,
    children,
    ...rest
  } = observation;
  return {
    ...rest,
    children: children?.map(stripObservationForTree),
  };
}

function findObservationById(
  observations: MonitorObservationView[],
  id: string,
): MonitorObservationView | null {
  for (const observation of observations) {
    if (observation.id === id) return observation;
    if (observation.children?.length) {
      const match = findObservationById(observation.children, id);
      if (match) return match;
    }
  }
  return null;
}

const DEMO_STATES: MonitorPanelState[] = [
  'loading',
  'empty-session',
  'empty-traces',
  'error',
  'ready',
];

/** Langfuse Monitor layer：mock traces、drill-in 与状态切换。 */
export function MonitorPanelLayout() {
  const [state, setState] = createSignal<MonitorPanelState>('ready');
  const [selectedTrace, setSelectedTrace] = createSignal<MonitorTraceRowView | null>(null);
  const [selectedObservationId, setSelectedObservationId] = createSignal<string | null>(null);

  const clearTrace = () => {
    setSelectedTrace(null);
    setSelectedObservationId(null);
  };

  return (
    <section class="flex h-full min-h-0 w-full flex-col gap-12" aria-label="Monitor panel layout">
      <div class="flex flex-wrap gap-6">
        <For each={DEMO_STATES}>
          {(demoState) => (
            <Button
              size="compact"
              variant={state() === demoState ? 'primary' : 'ghost'}
              class="border-0!"
              onClick={() => {
                clearTrace();
                setState(demoState);
              }}
            >
              {demoState}
            </Button>
          )}
        </For>
      </div>
      <div class="h-(--workbench-frame-height) min-h-0 overflow-hidden rounded-lg border border-border-subtle">
        <Show
          when={selectedTrace()}
          fallback={(
            <MonitorPanelShell
              embedded
              state={state()}
              summary={state() === 'ready' ? DEMO_SUMMARY : null}
              traces={state() === 'ready' ? DEMO_TRACES : []}
              errorMessage={state() === 'error' ? "Couldn't load traces." : undefined}
              onRetry={state() === 'error' ? () => setState('ready') : undefined}
              onTraceSelect={(trace) => {
                setSelectedTrace(trace);
                setSelectedObservationId(null);
              }}
            />
          )}
        >
          {(trace) => (
            <MonitorTraceDetailShell
              embedded
              traceName={trace().name}
              observations={DEMO_OBSERVATIONS.map(stripObservationForTree)}
              selectedObservation={
                selectedObservationId()
                  ? findObservationById(DEMO_OBSERVATIONS, selectedObservationId()!)
                  : null
              }
              state="ready"
              onBack={clearTrace}
              onClose={clearTrace}
              onObservationSelect={(observation) => setSelectedObservationId(observation.id)}
              onObservationBack={() => setSelectedObservationId(null)}
            />
          )}
        </Show>
      </div>
    </section>
  );
}
