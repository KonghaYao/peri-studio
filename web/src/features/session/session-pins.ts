import type { ProjectSessionInfo } from '@/entities/registry/registry-view';

export interface SessionPin {
  projectId: string;
  sessionId: string;
}

export interface SessionPinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storageKey = (principalId: string): string =>
  `peri_studio:pinned_sessions:${encodeURIComponent(principalId)}`;

const browserStorage = (): SessionPinStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const identityKey = (session: Pick<SessionPin, 'projectId' | 'sessionId'>): string =>
  JSON.stringify([session.projectId, session.sessionId]);

const normalizePins = (value: unknown): SessionPin[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const pins: SessionPin[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { projectId?: unknown; sessionId?: unknown };
    if (typeof candidate.projectId !== 'string' || !candidate.projectId) continue;
    if (typeof candidate.sessionId !== 'string' || !candidate.sessionId) continue;
    const pin = { projectId: candidate.projectId, sessionId: candidate.sessionId };
    const key = identityKey(pin);
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push(pin);
  }
  return pins;
};

export const readPinnedSessions = (
  principalId: string | null,
  storage: SessionPinStorage | null | undefined = undefined,
): SessionPin[] => {
  if (!principalId) return [];
  const source = storage === undefined ? browserStorage() : storage;
  if (!source) return [];
  try {
    const value = source.getItem(storageKey(principalId));
    return value ? normalizePins(JSON.parse(value)) : [];
  } catch {
    return [];
  }
};

export const writePinnedSessions = (
  principalId: string | null,
  pins: readonly SessionPin[],
  storage: SessionPinStorage | null | undefined = undefined,
): void => {
  if (!principalId) return;
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return;
  try {
    target.setItem(storageKey(principalId), JSON.stringify(normalizePins(pins)));
  } catch {
    // 本地偏好不可用时仍保留当前页面的内存态，不影响会话导航。
  }
};

export const togglePinnedSession = (
  pins: readonly SessionPin[],
  session: Pick<ProjectSessionInfo, 'projectId' | 'id'>,
): SessionPin[] => {
  const current = normalizePins(pins);
  const target: SessionPin = { projectId: session.projectId, sessionId: session.id };
  const targetKey = identityKey(target);
  const index = current.findIndex((pin) => identityKey(pin) === targetKey);
  if (index < 0) return [...current, target];
  return [...current.slice(0, index), ...current.slice(index + 1)];
};

/** 按用户显式 pin 的顺序取目录条目，不读取 lastOpenedAt，避免点击导致重排。 */
export const selectPinnedSessions = <S extends Pick<ProjectSessionInfo, 'projectId' | 'id'>>(
  sessions: readonly S[],
  pins: readonly SessionPin[],
): S[] => {
  const byIdentity = new Map(sessions.map((session) => [identityKey({ projectId: session.projectId, sessionId: session.id }), session]));
  const selected: S[] = [];
  const seen = new Set<string>();
  for (const pin of normalizePins(pins)) {
    const key = identityKey(pin);
    const session = byIdentity.get(key);
    if (!session || seen.has(key)) continue;
    seen.add(key);
    selected.push(session);
  }
  return selected;
};
