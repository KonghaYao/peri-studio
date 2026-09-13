import type { MonitorObservationView, MonitorTraceDetailView } from '@peri/ui';

export type MonitorTraceErrorCode =
  | 'langfuse_not_configured'
  | 'unauthorized'
  | 'session_required'
  | 'invalid_session_id'
  | 'session_not_accessible'
  | 'trace_required'
  | 'invalid_trace_id'
  | 'trace_not_found'
  | 'langfuse_upstream_timeout'
  | 'langfuse_upstream_error'
  | 'upstream_payload_too_large'
  | 'network_error'
  | 'invalid_response';

export type MonitorTraceResult =
  | { ok: true; data: MonitorTraceDetailView }
  | { ok: false; error: MonitorTraceErrorCode; message: string };

const MONITOR_TRACE_ERROR_MESSAGES: Record<MonitorTraceErrorCode, string> = {
  langfuse_not_configured: "Couldn't load trace.",
  unauthorized: "Couldn't load trace.",
  session_required: "Couldn't load trace.",
  invalid_session_id: "Couldn't load trace.",
  session_not_accessible: "Couldn't load trace.",
  trace_required: "Couldn't load trace.",
  invalid_trace_id: "Couldn't load trace.",
  trace_not_found: "Couldn't load trace.",
  langfuse_upstream_timeout: "Couldn't load trace.",
  langfuse_upstream_error: "Couldn't load trace.",
  upstream_payload_too_large: "Couldn't load trace.",
  network_error: "Couldn't load trace.",
  invalid_response: "Couldn't load trace.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseObservationLevel(value: unknown): MonitorObservationView['level'] {
  switch (value) {
    case 'ERROR':
      return 'ERROR';
    case 'WARNING':
      return 'WARNING';
    case 'DEBUG':
      return 'DEBUG';
    default:
      return 'DEFAULT';
  }
}

function parseObservation(value: unknown): MonitorObservationView | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  const observation: MonitorObservationView = {
    id: value.id,
    name: value.name,
    kind: typeof value.kind === 'string' && value.kind ? value.kind : 'SPAN',
    level: parseObservationLevel(value.level),
  };
  if (typeof value.latencyMs === 'number' && Number.isFinite(value.latencyMs)) {
    observation.latencyMs = value.latencyMs;
  }
  if (typeof value.model === 'string' && value.model) observation.model = value.model;
  if (typeof value.tokens === 'number' && Number.isFinite(value.tokens)) observation.tokens = value.tokens;
  if (typeof value.inputTokens === 'number' && Number.isFinite(value.inputTokens)) {
    observation.inputTokens = value.inputTokens;
  }
  if (typeof value.outputTokens === 'number' && Number.isFinite(value.outputTokens)) {
    observation.outputTokens = value.outputTokens;
  }
  if (typeof value.inputPreview === 'string' && value.inputPreview) {
    observation.inputPreview = value.inputPreview;
  }
  if (typeof value.outputPreview === 'string' && value.outputPreview) {
    observation.outputPreview = value.outputPreview;
  }
  if (value.inputTruncated === true) observation.inputTruncated = true;
  if (value.outputTruncated === true) observation.outputTruncated = true;
  if (typeof value.scoreValue === 'string' && value.scoreValue) {
    observation.scoreValue = value.scoreValue;
  }
  if (typeof value.scoreDataType === 'string' && value.scoreDataType) {
    observation.scoreDataType = value.scoreDataType;
  }
  if (Array.isArray(value.children)) {
    observation.children = value.children
      .map(parseObservation)
      .filter((child): child is MonitorObservationView => child !== null);
  }
  return observation;
}

/** 树列表渲染：剥离详情专用 IO / score 字段。 */
export function stripObservationForTree(observation: MonitorObservationView): MonitorObservationView {
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

export function stripObservationsForTree(observations: MonitorObservationView[]): MonitorObservationView[] {
  return observations.map(stripObservationForTree);
}

export function findObservationById(
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

export function parseMonitorTraceDto(body: unknown): MonitorTraceDetailView | null {
  if (!isRecord(body) || typeof body.sessionId !== 'string' || typeof body.traceId !== 'string') {
    return null;
  }
  const observations = Array.isArray(body.observations)
    ? body.observations.map(parseObservation).filter((item): item is MonitorObservationView => item !== null)
    : [];
  return {
    sessionId: body.sessionId,
    traceId: body.traceId,
    name: typeof body.name === 'string' ? body.name : 'Untitled trace',
    observations,
  };
}

export function monitorTraceErrorMessage(code: MonitorTraceErrorCode): string {
  return MONITOR_TRACE_ERROR_MESSAGES[code];
}

async function parseErrorResponse(response: Response): Promise<MonitorTraceResult> {
  try {
    const body = (await response.json()) as { error?: unknown };
    const code = typeof body.error === 'string' ? body.error : 'invalid_response';
    if (code in MONITOR_TRACE_ERROR_MESSAGES) {
      return {
        ok: false,
        error: code as MonitorTraceErrorCode,
        message: monitorTraceErrorMessage(code as MonitorTraceErrorCode),
      };
    }
  } catch {
    // fall through
  }
  return {
    ok: false,
    error: 'invalid_response',
    message: monitorTraceErrorMessage('invalid_response'),
  };
}

export async function fetchTraceDetail(
  sessionId: string,
  traceId: string,
  options: {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): Promise<MonitorTraceResult> {
  const fetcher = options.fetcher ?? fetch;
  const trimmedSessionId = sessionId.trim();
  const trimmedTraceId = traceId.trim();
  if (!trimmedSessionId) {
    return {
      ok: false,
      error: 'session_required',
      message: monitorTraceErrorMessage('session_required'),
    };
  }
  if (!trimmedTraceId) {
    return {
      ok: false,
      error: 'trace_required',
      message: monitorTraceErrorMessage('trace_required'),
    };
  }

  try {
    const params = new URLSearchParams({
      sessionId: trimmedSessionId,
      traceId: trimmedTraceId,
    });
    const response = await fetcher(`/api/monitor/trace?${params.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: options.signal,
    });

    if (!response.ok) return parseErrorResponse(response);

    const body = await response.json();
    const data = parseMonitorTraceDto(body);
    if (!data) {
      return {
        ok: false,
        error: 'invalid_response',
        message: monitorTraceErrorMessage('invalid_response'),
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
      message: monitorTraceErrorMessage('network_error'),
    };
  }
}
