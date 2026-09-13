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

export type MonitorPanelState =
  | 'loading'
  | 'empty-session'
  | 'empty-traces'
  | 'error'
  | 'ready';
