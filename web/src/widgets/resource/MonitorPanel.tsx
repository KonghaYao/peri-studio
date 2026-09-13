import { MonitorPanelShell, MonitorTraceDetailShell, type MonitorObservationView, type MonitorPanelState, type MonitorSummaryView, type MonitorTraceDetailState, type MonitorTraceRowView } from '@peri/ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { fetchSessionTraces } from '@/features/monitor/session';
import {
  fetchTraceDetail,
  findObservationById,
  stripObservationsForTree,
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
  const [selectedObservationId, setSelectedObservationId] = createSignal<string | null>(null);
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
    setSelectedObservationId(null);
    setSelectedObservationId(null);
  };

  const clearObservationDetail = () => {
    setSelectedObservationId(null);
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
    setSelectedObservationId(null);

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
          state={state()}
          summary={summary()}
          traces={traces()}
          errorMessage={errorMessage()}
          onRetry={reload}
          onTraceSelect={handleTraceSelect}
          data-testid="monitor-panel"
        />
      )}
    >
      {(trace) => (
        <MonitorTraceDetailShell
          embedded={props.embedded}
          traceName={trace().name}
          observations={stripObservationsForTree(detailObservations())}
          selectedObservation={
            selectedObservationId()
              ? findObservationById(detailObservations(), selectedObservationId()!)
              : null
          }
          state={detailState()}
          errorMessage={detailErrorMessage()}
          onBack={clearDetail}
          onClose={clearDetail}
          onObservationSelect={(observation) => setSelectedObservationId(observation.id)}
          onObservationBack={clearObservationDetail}
          onRetry={() => {
            const sessionId = selectedSessionId();
            if (!sessionId) return;
            void loadTraceDetail(sessionId, trace());
          }}
          data-testid="monitor-trace-detail"
        />
      )}
    </Show>
  );
}
