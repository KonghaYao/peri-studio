import type {
  MonitorSummaryView,
  MonitorTraceLevel,
  MonitorTraceRowView,
} from '@peri/ui';

export type MonitorSessionErrorCode =
  | 'langfuse_not_configured'
  | 'unauthorized'
  | 'session_required'
  | 'invalid_session_id'
  | 'session_not_accessible'
  | 'langfuse_upstream_timeout'
  | 'langfuse_upstream_error'
  | 'upstream_payload_too_large'
  | 'network_error'
  | 'invalid_response';

export type MonitorSessionDto = {
  sessionId: string;
  configured: boolean;
  found: boolean;
  summary: MonitorSummaryView;
  traces: MonitorTraceRowView[];
  langfuseUrl?: string;
};

export type MonitorSessionResult =
  | { ok: true; data: MonitorSessionDto }
  | { ok: false; error: MonitorSessionErrorCode; message: string };

const MONITOR_ERROR_MESSAGES: Record<MonitorSessionErrorCode, string> = {
  langfuse_not_configured: "Couldn't load traces.",
  unauthorized: "Couldn't load traces.",
  session_required: "Couldn't load traces.",
  invalid_session_id: "Couldn't load traces.",
  session_not_accessible: "Couldn't load traces.",
  langfuse_upstream_timeout: "Couldn't load traces.",
  langfuse_upstream_error: "Couldn't load traces.",
  upstream_payload_too_large: "Couldn't load traces.",
  network_error: "Couldn't load traces.",
  invalid_response: "Couldn't load traces.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLevel(value: unknown): MonitorTraceLevel {
  return value === 'ERROR' ? 'ERROR' : 'DEFAULT';
}

function parseTrace(value: unknown): MonitorTraceRowView | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : '';
  const trace: MonitorTraceRowView = {
    id: value.id,
    name: value.name,
    timestamp,
    level: parseLevel(value.level),
  };
  if (typeof value.latencyMs === 'number' && Number.isFinite(value.latencyMs)) trace.latencyMs = value.latencyMs;
  if (typeof value.tokens === 'number' && Number.isFinite(value.tokens)) trace.tokens = value.tokens;
  if (typeof value.costUsd === 'number' && Number.isFinite(value.costUsd)) trace.costUsd = value.costUsd;
  return trace;
}

function parseSummary(value: unknown): MonitorSummaryView {
  if (!isRecord(value)) {
    return { traceCount: 0, totalTokens: 0 };
  }
  const summary: MonitorSummaryView = {
    traceCount: typeof value.traceCount === 'number' && Number.isFinite(value.traceCount) ? value.traceCount : 0,
    totalTokens: typeof value.totalTokens === 'number' && Number.isFinite(value.totalTokens) ? value.totalTokens : 0,
  };
  if (typeof value.totalCostUsd === 'number' && Number.isFinite(value.totalCostUsd)) {
    summary.totalCostUsd = value.totalCostUsd;
  }
  if (typeof value.lastTimestamp === 'string' && value.lastTimestamp) {
    summary.lastTimestamp = value.lastTimestamp;
  }
  return summary;
}

export function parseMonitorSessionDto(body: unknown): MonitorSessionDto | null {
  if (!isRecord(body) || typeof body.sessionId !== 'string') return null;
  const traces = Array.isArray(body.traces)
    ? body.traces.map(parseTrace).filter((trace): trace is MonitorTraceRowView => trace !== null)
    : [];
  return {
    sessionId: body.sessionId,
    configured: body.configured === true,
    found: body.found === true,
    summary: parseSummary(body.summary),
    traces,
    langfuseUrl: typeof body.langfuseUrl === 'string' && body.langfuseUrl ? body.langfuseUrl : undefined,
  };
}

export function monitorSessionErrorMessage(code: MonitorSessionErrorCode): string {
  return MONITOR_ERROR_MESSAGES[code];
}

async function parseErrorResponse(response: Response): Promise<MonitorSessionResult> {
  try {
    const body = (await response.json()) as { error?: unknown };
    const code = typeof body.error === 'string' ? body.error : 'invalid_response';
    if (code in MONITOR_ERROR_MESSAGES) {
      return {
        ok: false,
        error: code as MonitorSessionErrorCode,
        message: monitorSessionErrorMessage(code as MonitorSessionErrorCode),
      };
    }
  } catch {
    // fall through
  }
  return {
    ok: false,
    error: 'invalid_response',
    message: monitorSessionErrorMessage('invalid_response'),
  };
}

export async function fetchSessionTraces(
  sessionId: string,
  options: {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): Promise<MonitorSessionResult> {
  const fetcher = options.fetcher ?? fetch;
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'session_required',
      message: monitorSessionErrorMessage('session_required'),
    };
  }

  try {
    const response = await fetcher(
      `/api/monitor/session?sessionId=${encodeURIComponent(trimmed)}`,
      {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: options.signal,
      },
    );

    if (!response.ok) return parseErrorResponse(response);

    const body = await response.json();
    const data = parseMonitorSessionDto(body);
    if (!data) {
      return {
        ok: false,
        error: 'invalid_response',
        message: monitorSessionErrorMessage('invalid_response'),
      };
    }
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    return {
      ok: false,
      error: 'network_error',
      message: monitorSessionErrorMessage('network_error'),
    };
  }
}
