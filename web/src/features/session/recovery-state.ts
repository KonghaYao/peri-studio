// live runtime 状态集：终态（进程已结束）与 gap（§8.3 对账确认无进程
// 存活证据——会话仍可恢复，但当前不视为运行中）。live 判定用于把会话投影
// 的 activeChatId（ChatRegistry 运行态）过滤为「确实在运行」的 runtime hint。
const TERMINAL_RUNTIME = new Set(['ended', 'closed', 'crashed', 'gap']);

/** Registry chat 是否仍有进程存活证据（与 `retainLiveRuntimeHints` 同一集合）。 */
export function isLiveRuntimeStatus(status: string | null | undefined): boolean {
  return !TERMINAL_RUNTIME.has(String(status || '').toLowerCase());
}

export function sessionHasLiveRuntime(
  session: { activeChatId?: string | null },
  chatStatuses: Record<string, string>,
): boolean {
  const chatId = session.activeChatId;
  return !!chatId && isLiveRuntimeStatus(chatStatuses[chatId]);
}

export const retainLiveRuntimeHints = <S extends { id: string; activeChatId: string | null }>(
  sessions: S[],
  chats: Array<{ id: string; status: string | null }>,
  previous: readonly S[] = [],
): S[] => {
  const live = new Set(chats.filter((chat) => isLiveRuntimeStatus(chat.status)).map((chat) => chat.id));
  const previousById = new Map(previous.map((session) => [session.id, session]));
  const filtered = sessions.map((session) => {
    const activeChatId = session.activeChatId && live.has(session.activeChatId) ? session.activeChatId : null;
    const projected = activeChatId === session.activeChatId ? session : { ...session, activeChatId };
    const prior = previousById.get(session.id);
    if (!prior) return projected;
    const keys = Object.keys(projected) as Array<keyof S>;
    return keys.length === Object.keys(prior).length && keys.every((key) => projected[key] === prior[key])
      ? prior
      : projected;
  });
  if (filtered.length === previous.length && filtered.every((session, index) => session === previous[index])) {
    return previous as S[];
  }
  if (filtered.length === sessions.length && filtered.every((session, index) => session === sessions[index])) {
    return sessions;
  }
  return filtered;
};

export const cleanSessionTitle = (title: unknown): string => {
  const raw = String(title || '')
    .replace(/<system-reminder>[\s\S]*$/i, '')
    .replace(/<\/??system-reminder[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return 'Untitled session';
  return raw.length > 72 ? `${raw.slice(0, 69).trimEnd()}…` : raw;
};

export const formatRelativeTime = (value: unknown, now: number = Date.now()): string => {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: timestamp < new Date(now).setFullYear(new Date(now).getFullYear() - 1) ? 'numeric' : undefined }).format(timestamp);
};

/** 侧栏行尾紧凑时间（对齐 sandbox：1m / 5h / 2d）。 */
export const formatCompactRelativeTime = (value: unknown, now: number = Date.now()): string => {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '—';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return formatRelativeTime(value, now);
};

export const shortSessionId = (sessionId: unknown): string => {
  const value = String(sessionId || '');
  return value ? value.slice(-8) : 'Unknown ID';
};

export const sessionDisplayTitle = (title: unknown, stableId: unknown): string => {
  const cleaned = cleanSessionTitle(title);
  if (!['New conversation', 'Untitled session'].includes(cleaned)) return cleaned;
  return `${cleaned} · …${shortSessionId(stableId)}`;
};

export interface ConnectionProblem {
  code: number | null;
  title: string;
  detail: string;
  action: 'reconnect' | 'login';
}

export const connectionProblemForClose = (code: unknown): ConnectionProblem => {
  if (code === 4500) return {
    code, title: 'Local Agent instance went offline',
    detail: 'The server is still reachable, but no ACP instance is available. Reconnect after confirming the instance process is running.',
    action: 'reconnect',
  };
  if (code === 4501) return {
    code, title: 'Connection to the server timed out',
    detail: 'Network issues or page sleep interrupted the heartbeat. Your sessions are still saved on the server.',
    action: 'reconnect',
  };
  if (code === 4502) return {
    code, title: 'Login state expired',
    detail: 'The access token expired, was revoked, or the server restarted. Please sign in again.',
    action: 'login',
  };
  return {
    code: typeof code === 'number' && Number.isFinite(code) ? code : null,
    title: 'Connection stopped',
    detail: 'The connection ended unexpectedly. Your durable sessions are not lost.',
    action: 'reconnect',
  };
};
