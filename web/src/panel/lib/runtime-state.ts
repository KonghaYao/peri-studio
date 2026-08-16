export type RuntimeStateTone = 'idle' | 'attention' | 'danger' | 'busy' | 'ready';

export interface RuntimeStateView {
  label: string;
  tone: RuntimeStateTone;
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

const TERMINAL_LABELS: Record<string, string> = {
  ended: 'Run ended · session kept',
  closed: 'Run closed · session kept',
  crashed: 'Run exited abnormally · session kept',
};

/** User-facing state of one durable session and its optional runtime chat. */
export function runtimeState(input: RuntimeStateInput): RuntimeStateView {
  if (!input.hasSession) return { label: '', tone: 'idle' };
  if (input.lifecycle === 'reconciliation_required') return { label: 'Reconciliation required', tone: 'attention' };
  if (input.lifecycle === 'failed') return { label: 'Failed to open', tone: 'danger' };
  if (input.isOpening || ['activating', 'pending'].includes(input.lifecycle || '')) return { label: 'Restoring ACP session…', tone: 'busy' };
  if (!input.hasRuntime) return { label: 'Not started · session saved', tone: 'idle' };

  // A Registry runtime hint says that an ACP process exists; it does not mean
  // this browser has selected and hydrated that conversation. Keep the
  // sidebar honest instead of advertising “可输入” on multiple rows at once.
  if (input.isSelected === false) return { label: 'Running · click to switch', tone: 'ready' };

  const chatStatus = String(input.chatStatus || '').toLowerCase();
  if (TERMINAL_LABELS[chatStatus]) {
    return { label: TERMINAL_LABELS[chatStatus], tone: chatStatus === 'crashed' ? 'danger' : 'idle' };
  }
  if (input.hasPendingPermission) return { label: 'Awaiting your permission', tone: 'attention' };
  if (input.isHydrated === false) return { label: 'Loading session…', tone: 'busy' };
  if (input.turnActive) return { label: 'Agent is working', tone: 'busy' };
  return { label: 'Ready · session saved', tone: 'ready' };
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
  if (!input.hasRuntime || TERMINAL_LABELS[chatStatus] || connection?.kind === 'ok') return state;
  if (connection?.kind === 'err') return { label: 'Connection stopped · session saved', tone: 'danger' };
  if (connection?.kind === 'warn') return { label: 'Reconnecting · session saved', tone: 'attention' };
  if (String(connection?.text || '').includes('Connecting')) return { label: 'Connecting · session saved', tone: 'busy' };
  return { label: 'Disconnected · session saved', tone: 'idle' };
}
