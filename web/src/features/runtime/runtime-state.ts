export type RuntimeStateTone = 'idle' | 'attention' | 'danger' | 'busy' | 'ready';

export interface RuntimeStateView {
  label: string;
  tone: RuntimeStateTone;
  detail?: string;
}

export interface RuntimeStateInput {
  hasSession: boolean;
  lifecycle?: string | null;
  isOpening?: boolean;
  hasRuntime?: boolean;
  isSelected?: boolean | null;
  chatStatus?: string | null;
  hasPendingPermission?: boolean;
  isHydrated?: boolean | null;
  turnActive?: boolean;
}

/** 连接呈现（store 的 connState 信号）；kind 保持 string 以兼容历史事件。 */
export interface ConnectionKindLike {
  kind?: string;
  text?: string;
}

const TERMINAL_STATES: Record<string, RuntimeStateView> = {
  ended: { label: 'Ended', tone: 'idle', detail: 'Run ended · session kept' },
  closed: { label: 'Closed', tone: 'idle', detail: 'Run closed · session kept' },
  crashed: { label: 'Crashed', tone: 'danger', detail: 'Run exited abnormally · session kept' },
};

/** User-facing state of one durable session and its optional runtime chat. */
export function runtimeState(input: RuntimeStateInput): RuntimeStateView {
  if (!input.hasSession) return { label: '', tone: 'idle' };
  if (input.lifecycle === 'reconciliation_required') return { label: 'Reconcile', tone: 'attention', detail: 'Reconciliation required' };
  if (input.lifecycle === 'failed') return { label: 'Failed', tone: 'danger', detail: 'Failed to open' };
  if (input.isOpening || ['activating', 'pending'].includes(input.lifecycle || '')) return { label: 'Opening', tone: 'busy', detail: 'Restoring ACP session' };
  if (!input.hasRuntime) return { label: 'Idle', tone: 'idle', detail: 'Not started · session saved' };

  const chatStatus = String(input.chatStatus || '').toLowerCase();
  if (TERMINAL_STATES[chatStatus]) return TERMINAL_STATES[chatStatus];
  if (input.hasPendingPermission) return { label: 'Approval', tone: 'attention', detail: 'Awaiting your permission' };
  if (input.isHydrated === false) return { label: 'Loading', tone: 'busy', detail: 'Loading session' };
  if (input.turnActive) return { label: 'Working', tone: 'busy', detail: 'Agent is working' };
  // Live runtime on an unselected row: process exists, but this browser has
  // not hydrated it. Do not advertise “Ready” (can type) on every live row.
  if (input.isSelected === false) return { label: 'Running', tone: 'ready', detail: 'Running · click to switch' };
  return { label: 'Ready', tone: 'ready', detail: 'Ready · session saved' };
}

/**
 * Header presentation combines durable/runtime truth with this browser's
 * transport truth. Sidebar rows intentionally keep runtime catalog state, but
 * the selected conversation must never advertise input readiness while its
 * connection cannot send an action.
 */
export function connectedRuntimeState(input: RuntimeStateInput, connection: ConnectionKindLike | null | undefined): RuntimeStateView {
  const state = runtimeState(input);
  const chatStatus = String(input.chatStatus || '').toLowerCase();
  if (!input.hasRuntime || TERMINAL_STATES[chatStatus] || connection?.kind === 'ok') return state;
  if (connection?.kind === 'err') return { label: 'Offline', tone: 'danger', detail: 'Connection stopped · session saved' };
  if (connection?.kind === 'warn') return { label: 'Reconnecting', tone: 'attention', detail: 'Reconnecting · session saved' };
  if (String(connection?.text || '').includes('Connecting')) return { label: 'Connecting', tone: 'busy', detail: 'Connecting · session saved' };
  return { label: 'Offline', tone: 'idle', detail: 'Disconnected · session saved' };
}
