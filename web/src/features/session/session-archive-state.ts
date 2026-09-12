import { sessionHasLiveRuntime } from './recovery-state';

/** 归档前的客户端 loading 判定：只拦真正打开中 / 仍有活 runtime 的工作 turn。 */
export function sessionArchiveLooksLoading(input: {
  sessionId: string;
  lifecycle: string;
  activeChatId?: string | null;
  openingSessionId: string | null;
  selectedSessionId: string | null;
  chatStatuses: Record<string, string>;
  selectedTurnActive: boolean;
}): boolean {
  if (input.openingSessionId === input.sessionId) return true;
  if (['activating', 'pending'].includes(input.lifecycle)) return true;
  if (input.selectedSessionId !== input.sessionId || !input.selectedTurnActive) return false;
  return sessionHasLiveRuntime(
    { activeChatId: input.activeChatId ?? null },
    input.chatStatuses,
  );
}
