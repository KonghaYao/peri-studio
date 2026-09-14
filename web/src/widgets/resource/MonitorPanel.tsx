import {
  Button,
  EmptyState,
  IconButton,
  InlineNotice,
  IoTabsShell,
  IoViewer,
  JsonTree,
  LoadingState,
  MonitorObservationTypeBadge,
  MonitorPanelShell,
  MonitorTimelineShell,
  MonitorTraceTurnTree,
  MonitorTraceTurnTreeShell,
  type MonitorObservationView,
  type MonitorPanelState,
  type MonitorSummaryView,
  type MonitorTraceDetailState,
  type MonitorTraceRowView,
} from '@peri/ui';
import { ArrowLeft, X } from 'lucide-solid';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import {
  buildMonitorTimelineSegments,
  buildObservationMetadata,
  flattenMonitorObservations,
  observationIoInput,
  observationIoOutput,
} from '@/features/monitor/flat-observations';
import { fetchSessionTraces } from '@/features/monitor/session';
import {
  fetchTraceDetail,
  findObservationById,
} from '@/features/monitor/trace';
import { selectedSessionId, turnActive } from '@/store';

const MONITOR_POLL_INTERVAL_MS = 15_000;

type MonitorPanelProps = {
  /** 嵌在 workbench 面板内；标题与 Refresh 由 workbench 头部负责。 */
  embedded?: boolean;
  /** 面板可见时启用拉取与轮询；省略时视为始终可见。 */
  visible?: boolean;
  /** 显式刷新（header Refresh 按钮）。 */
  refreshToken?: number;
};

function MonitorTraceDetailPanel(props: {
  embedded?: boolean;
  trace: MonitorTraceRowView;
  state: () => MonitorTraceDetailState;
  observations: () => MonitorObservationView[];
  errorMessage: () => string | undefined;
  selectedObservationId: () => string | null | undefined;
  omitNoise: () => boolean;
  onBack: () => void;
  onRetry: () => void;
  onSelectObservation: (id: string) => void;
  onSelectTraceRoot: () => void;
  onOmitNoiseChange: (value: boolean) => void;
}) {
  const flatObservations = createMemo(() => (
    flattenMonitorObservations(props.observations(), props.trace.timestamp)
  ));
  const timelineSegments = createMemo(() => buildMonitorTimelineSegments(flatObservations()));

  const selectedObservation = () => {
    const selectedId = props.selectedObservationId();
    if (typeof selectedId !== 'string') return null;
    return findObservationById(props.observations(), selectedId);
  };

  const showDetailPlaceholder = () => props.selectedObservationId() === undefined;

  const rootClass = () => (
    props.embedded
      ? 'flex min-h-0 flex-1 flex-col bg-neutral-25'
      : 'flex h-full w-full flex-col bg-neutral-25'
  );

  return (
    <div
      data-testid="monitor-trace-detail"
      class={rootClass()}
      aria-label="Trace detail"
    >
      <div class="flex shrink-0 items-center gap-8 border-b border-border-subtle px-8 py-8">
        <IconButton
          label="Back to traces"
          size="compact"
          variant="ghost"
          class="border-0 bg-transparent text-content-muted hover:text-content-primary"
          onClick={props.onBack}
        >
          <ArrowLeft size={14} strokeWidth={1.7} />
        </IconButton>
        <h2 class="min-w-0 flex-1 truncate text-12 font-600 text-content-primary">{props.trace.name}</h2>
        <IconButton
          label="Close trace detail"
          size="compact"
          variant="ghost"
          class="border-0 bg-transparent text-content-muted hover:text-content-primary"
          onClick={props.onBack}
        >
          <X size={14} strokeWidth={1.7} />
        </IconButton>
      </div>

      <Show when={props.state() === 'loading'}>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center p-16 text-center">
          <LoadingState label="Loading trace…" class="justify-center" />
        </div>
      </Show>

      <Show when={props.state() === 'error'}>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center p-16 text-center">
          <InlineNotice tone="danger" class="max-w-full items-center gap-6 py-9 text-11 leading-16" role="alert">
            <div class="flex min-w-0 flex-1 flex-col items-center gap-8 text-center">
              <span class="min-w-0">{props.errorMessage() ?? "Couldn't load trace."}</span>
              <Button
                size="compact"
                variant="ghost"
                class="shrink-0 border-0! bg-transparent! px-3 font-650 text-danger underline pointer-coarse:min-h-44 pointer-coarse:px-8"
                onClick={props.onRetry}
              >
                Retry
              </Button>
            </div>
          </InlineNotice>
        </div>
      </Show>

      <Show when={props.state() === 'ready'}>
        <Show
          when={props.observations().length > 0}
          fallback={(
            <div class="flex min-h-0 flex-1 flex-col items-center justify-center p-16 text-center">
              <EmptyState
                variant="inline"
                class="border-0 bg-transparent py-24"
                title="No observations for this trace."
              />
            </div>
          )}
        >
          <div class="flex min-h-0 flex-1 flex-col">
            <Show when={timelineSegments().length > 0}>
              <div
                class="shrink-0 border-b border-border-subtle bg-surface p-8"
                data-testid="monitor-trace-timeline"
              >
                <MonitorTimelineShell
                  class="h-180"
                  segments={timelineSegments()}
                  heatmap
                  selectedId={typeof props.selectedObservationId() === 'string'
                    ? props.selectedObservationId()
                    : null}
                  onSelect={props.onSelectObservation}
                />
              </div>
            </Show>
            <MonitorTraceTurnTreeShell
              class="min-h-0 flex-1"
              showDetailPlaceholder={showDetailPlaceholder()}
              tree={(
              <MonitorTraceTurnTree
                observations={flatObservations()}
                omitNoise={props.omitNoise()}
                onOmitNoiseChange={props.onOmitNoiseChange}
                showOmitNoiseToggle
                traceRoot={{
                  name: props.trace.name,
                  latencyMs: props.trace.latencyMs,
                }}
                selectedTraceRoot={props.selectedObservationId() === null}
                selectedId={typeof props.selectedObservationId() === 'string'
                  ? props.selectedObservationId()
                  : null}
                onTraceRootSelect={props.onSelectTraceRoot}
                onSelect={props.onSelectObservation}
                enableKeyboardNav
              />
            )}
            detail={(
              <Show
                when={props.selectedObservationId() === null}
                fallback={(
                  <Show when={selectedObservation()} keyed>
                    {(observation) => (
                      <div class="flex flex-col gap-12" data-testid="monitor-observation-detail">
                        <div class="flex flex-wrap items-center gap-8">
                          <h4 class="text-14 font-600 text-content-primary">{observation.name}</h4>
                          <MonitorObservationTypeBadge type={observation.kind} />
                        </div>
                        <IoTabsShell
                          renderInput={() => <IoViewer data={observationIoInput(observation)} />}
                          renderOutput={() => <IoViewer data={observationIoOutput(observation)} />}
                          renderMetadata={() => (
                            <JsonTree data={buildObservationMetadata(observation)} defaultCollapsedDepth={1} />
                          )}
                        />
                      </div>
                    )}
                  </Show>
                )}
              >
                <div class="flex flex-col gap-8">
                  <h4 class="text-14 font-600 text-content-primary">Trace root</h4>
                  <p class="text-12 text-content-secondary">
                    Select an observation in the tree to inspect input and output.
                  </p>
                  <JsonTree
                    data={{
                      traceId: props.trace.id,
                      name: props.trace.name,
                      timestamp: props.trace.timestamp,
                      latencyMs: props.trace.latencyMs ?? null,
                      tokens: props.trace.tokens ?? null,
                      observations: flatObservations().length,
                    }}
                    defaultCollapsedDepth={1}
                  />
                </div>
              </Show>
            )}
            />
          </div>
        </Show>
      </Show>
    </div>
  );
}

/** Langfuse Monitor T4：store 接线、列表拉取、trace drill-in 与轮询生命周期。 */
export function MonitorPanel(props: MonitorPanelProps = {}) {
  const [state, setState] = createSignal<MonitorPanelState>('loading');
  const [summary, setSummary] = createSignal<MonitorSummaryView | null>(null);
  const [traces, setTraces] = createSignal<MonitorTraceRowView[]>([]);
  const [errorMessage, setErrorMessage] = createSignal<string | undefined>();
  const [selectedTrace, setSelectedTrace] = createSignal<MonitorTraceRowView | null>(null);
  const [detailState, setDetailState] = createSignal<MonitorTraceDetailState>('loading');
  const [detailObservations, setDetailObservations] = createSignal<MonitorObservationView[]>([]);
  const [detailErrorMessage, setDetailErrorMessage] = createSignal<string | undefined>();
  const [selectedObservationId, setSelectedObservationId] = createSignal<string | null | undefined>(undefined);
  const [omitNoise, setOmitNoise] = createSignal(true);
  let requestId = 0;
  let detailRequestId = 0;
  let abortController: AbortController | null = null;
  let detailAbortController: AbortController | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const panelVisible = () => props.visible ?? true;

  const clearPoll = () => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const clearDetail = () => {
    detailRequestId += 1;
    detailAbortController?.abort();
    setSelectedTrace(null);
    setDetailObservations([]);
    setDetailErrorMessage(undefined);
    setDetailState('loading');
    setSelectedObservationId(undefined);
    setOmitNoise(true);
  };

  const load = async (sessionId: string) => {
    const currentRequest = ++requestId;
    abortController?.abort();
    abortController = new AbortController();
    setState('loading');
    setErrorMessage(undefined);

    try {
      const result = await fetchSessionTraces(sessionId, { signal: abortController.signal });
      if (currentRequest !== requestId) return;

      if (!result.ok) {
        setSummary(null);
        setTraces([]);
        setErrorMessage(result.message);
        setState('error');
        return;
      }

      const data = result.data;
      setSummary(data.summary);
      setTraces(data.traces);
      setState(data.found ? 'ready' : 'empty-traces');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (currentRequest !== requestId) return;
      setSummary(null);
      setTraces([]);
      setErrorMessage("Couldn't load traces.");
      setState('error');
    }
  };

  const loadTraceDetail = async (sessionId: string, trace: MonitorTraceRowView) => {
    const currentRequest = ++detailRequestId;
    detailAbortController?.abort();
    detailAbortController = new AbortController();
    setSelectedTrace(trace);
    setDetailState('loading');
    setDetailErrorMessage(undefined);
    setDetailObservations([]);
    setSelectedObservationId(undefined);
    setOmitNoise(true);

    try {
      const result = await fetchTraceDetail(sessionId, trace.id, { signal: detailAbortController.signal });
      if (currentRequest !== detailRequestId) return;

      if (!result.ok) {
        setDetailErrorMessage(result.message);
        setDetailState('error');
        return;
      }

      setDetailObservations(result.data.observations);
      setSelectedTrace((current) => (
        current ? { ...current, name: result.data.name || current.name } : current
      ));
      setDetailState('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (currentRequest !== detailRequestId) return;
      setDetailErrorMessage("Couldn't load trace.");
      setDetailState('error');
    }
  };

  const reload = () => {
    clearDetail();
    const sessionId = selectedSessionId();
    if (!sessionId) {
      setSummary(null);
      setTraces([]);
      setErrorMessage(undefined);
      setState('empty-session');
      return;
    }
    void load(sessionId);
  };

  const handleTraceSelect = (trace: MonitorTraceRowView) => {
    const sessionId = selectedSessionId();
    if (!sessionId) return;
    void loadTraceDetail(sessionId, trace);
  };

  createEffect(() => {
    if (!panelVisible()) return;
    props.refreshToken;
    selectedSessionId();
    reload();
  });

  createEffect(() => {
    clearPoll();
    if (!panelVisible() || !turnActive() || selectedTrace()) return;
    const sessionId = selectedSessionId();
    if (!sessionId) return;
    pollTimer = setInterval(() => {
      if (!panelVisible() || !turnActive() || selectedTrace()) return;
      const activeSessionId = selectedSessionId();
      if (!activeSessionId) return;
      void load(activeSessionId);
    }, MONITOR_POLL_INTERVAL_MS);
  });

  onCleanup(() => {
    requestId += 1;
    detailRequestId += 1;
    abortController?.abort();
    detailAbortController?.abort();
    clearPoll();
  });

  return (
    <Show
      when={selectedTrace()}
      fallback={(
        <MonitorPanelShell
          embedded={props.embedded}
          state={state}
          summary={summary}
          traces={traces}
          errorMessage={errorMessage}
          onRetry={reload}
          onTraceSelect={handleTraceSelect}
          data-testid="monitor-panel"
        />
      )}
    >
      {(trace) => (
        <MonitorTraceDetailPanel
          embedded={props.embedded}
          trace={trace()}
          state={detailState}
          observations={detailObservations}
          errorMessage={detailErrorMessage}
          selectedObservationId={selectedObservationId}
          omitNoise={omitNoise}
          onBack={clearDetail}
          onRetry={() => {
            const sessionId = selectedSessionId();
            if (!sessionId) return;
            void loadTraceDetail(sessionId, trace());
          }}
          onSelectObservation={(id) => setSelectedObservationId(id)}
          onSelectTraceRoot={() => setSelectedObservationId(null)}
          onOmitNoiseChange={setOmitNoise}
        />
      )}
    </Show>
  );
}
