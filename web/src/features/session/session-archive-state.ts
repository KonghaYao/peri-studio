import { sessionProjectedLiveChatId } from './recovery-state';

function projectedLiveChatTurnActive(input: {
  sessionId: string;
  projectedLiveChatId: string;
  selectedSessionId: string | null;
  selectedChatId: string | null;
  selectedTurnActive: boolean;
  chatTurnActive: Record<string, boolean>;
}): boolean {
  if (input.chatTurnActive[input.projectedLiveChatId] === true) return true;
  return (
    input.selectedSessionId === input.sessionId
    && input.selectedChatId === input.projectedLiveChatId
    && input.selectedTurnActive
  );
}

/** 归档前的客户端 loading 判定：只拦 catalog 恢复中、session/open 尚未投影 live、或 agent 仍在跑的会话。 */
export function sessionArchiveLooksLoading(input: {
  sessionId: string;
  lifecycle: string;
  activeChatId?: string | null;
  openingSessionId: string | null;
  selectedSessionId: string | null;
  selectedChatId: string | null;
  chatStatuses: Record<string, string>;
  chatTurnActive: Record<string, boolean>;
  selectedTurnActive: boolean;
}): boolean {
  if (['activating', 'pending'].includes(input.lifecycle)) return true;

  const projectedLiveChatId = sessionProjectedLiveChatId(
    { activeChatId: input.activeChatId ?? null },
    input.chatStatuses,
  );

  if (input.openingSessionId === input.sessionId && !projectedLiveChatId) return true;

  if (!projectedLiveChatId) return false;

  return projectedLiveChatTurnActive({
    sessionId: input.sessionId,
    projectedLiveChatId,
    selectedSessionId: input.selectedSessionId,
    selectedChatId: input.selectedChatId,
    selectedTurnActive: input.selectedTurnActive,
    chatTurnActive: input.chatTurnActive,
  });
}
