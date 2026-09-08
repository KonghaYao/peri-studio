import type { AgentInfo } from '@/entities/chat/control-view';
import type { ChatEntry } from '@/entities/chat/chat-view';

/** Control Doc agent.public_error 兜底：Chat entry 尚无 error 时在 composer 区展示。 */
export function selectAgentPublicErrorNotice(
  agent: AgentInfo | null | undefined,
  turnActive: boolean,
  entries: ChatEntry[],
): { code: string | null; message: string | null } | null {
  const err = agent?.publicError;
  if (!err?.code && !err?.message) return null;
  if (turnActive) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.role !== 'assistant') continue;
    if (entry.error?.code || entry.error?.message) return null;
    break;
  }
  return err;
}
