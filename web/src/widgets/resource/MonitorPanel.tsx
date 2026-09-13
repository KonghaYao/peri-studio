import { MonitorPanelShell, type MonitorPanelState, type MonitorSummaryView, type MonitorTraceRowView } from '@peri/ui';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { fetchSessionTraces } from '@/features/monitor/session';
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

/** Langfuse Monitor T4：store 接线、拉取与轮询生命周期。 */
export function MonitorPanel(props: MonitorPanelProps = {}) {
  const [state, setState] = createSignal<MonitorPanelState>('loading');
  const [summary, setSummary] = createSignal<MonitorSummaryView | null>(null);
  const [traces, setTraces] = createSignal<MonitorTraceRowView[]>([]);
  const [errorMessage, setErrorMessage] = createSignal<string | undefined>();
  const [externalUrl, setExternalUrl] = createSignal<string | undefined>();
  let requestId = 0;
  let abortController: AbortController | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const panelVisible = () => props.visible ?? true;

  const clearPoll = () => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
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
        setExternalUrl(undefined);
        setErrorMessage(result.message);
        setState('error');
        return;
      }

      const data = result.data;
      setSummary(data.summary);
      setTraces(data.traces);
      setExternalUrl(data.langfuseUrl);
      setState(data.found ? 'ready' : 'empty-traces');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (currentRequest !== requestId) return;
      setSummary(null);
      setTraces([]);
      setExternalUrl(undefined);
      setErrorMessage("Couldn't load traces.");
      setState('error');
    }
  };

  const reload = () => {
    const sessionId = selectedSessionId();
    if (!sessionId) {
      setSummary(null);
      setTraces([]);
      setExternalUrl(undefined);
      setErrorMessage(undefined);
      setState('empty-session');
      return;
    }
    void load(sessionId);
  };

  createEffect(() => {
    if (!panelVisible()) return;
    props.refreshToken;
    selectedSessionId();
    reload();
  });

  createEffect(() => {
    clearPoll();
    if (!panelVisible() || !turnActive()) return;
    const sessionId = selectedSessionId();
    if (!sessionId) return;
    pollTimer = setInterval(() => {
      if (!panelVisible() || !turnActive()) return;
      const activeSessionId = selectedSessionId();
      if (!activeSessionId) return;
      void load(activeSessionId);
    }, MONITOR_POLL_INTERVAL_MS);
  });

  onCleanup(() => {
    requestId += 1;
    abortController?.abort();
    clearPoll();
  });

  return (
    <MonitorPanelShell
      embedded={props.embedded}
      state={state()}
      summary={summary()}
      traces={traces()}
      errorMessage={errorMessage()}
      externalUrl={externalUrl()}
      onRetry={reload}
      data-testid="monitor-panel"
    />
  );
}
