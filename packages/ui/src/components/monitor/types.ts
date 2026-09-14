export type MonitorTraceLevel = 'DEFAULT' | 'ERROR';

export type MonitorSummaryView = {
  traceCount: number;
  totalTokens: number;
  totalCostUsd?: number;
  lastTimestamp?: string;
};

export type MonitorTraceRowView = {
  id: string;
  name: string;
  timestamp: string;
  latencyMs?: number;
  tokens?: number;
  costUsd?: number;
  level: MonitorTraceLevel;
};

export type MonitorObservationLevel = 'DEFAULT' | 'ERROR' | 'WARNING' | 'DEBUG';

export type MonitorObservationView = {
  id: string;
  name: string;
  kind: string;
  latencyMs?: number;
  level: MonitorObservationLevel;
  model?: string;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** IoViewer / flat adapter：有界 input preview（TurnTree 列表不渲染）。 */
  inputPreview?: string;
  /** IoViewer / flat adapter：有界 output preview（TurnTree 列表不渲染）。 */
  outputPreview?: string;
  inputTruncated?: boolean;
  outputTruncated?: boolean;
  scoreValue?: string;
  scoreDataType?: string;
  children?: MonitorObservationView[];
};

export type MonitorTraceDetailView = {
  sessionId: string;
  traceId: string;
  name: string;
  observations: MonitorObservationView[];
};

export type MonitorPanelState =
  | 'loading'
  | 'empty-session'
  | 'empty-traces'
  | 'error'
  | 'ready';

export type MonitorTraceDetailState = 'loading' | 'error' | 'ready';
