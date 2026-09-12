import type { ControlView } from '@/entities/chat/control-view';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';
import { sessionDisplayTitle } from '@/features/session/recovery-state';

/** 解析 Chat 顶栏标题：优先持久 session，回退 runtime chat 标题。 */
export function resolveChatHeaderTitle(input: {
  sessions: ProjectSessionInfo[];
  selectedSessionId: string | null;
  chatHead: ControlView | null;
}): string {
  const logical = input.sessions.find((session) => session.id === input.selectedSessionId);
  if (logical) return sessionDisplayTitle(logical.title, logical.id);
  return input.chatHead?.chat?.title || 'New conversation';
}
