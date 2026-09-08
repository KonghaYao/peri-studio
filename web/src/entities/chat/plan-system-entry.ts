import type { AgentPlanEntryInfo } from './control-view';
import type { ChatEntry } from './chat-view';

export type ChatPlanEntryInfo = Pick<AgentPlanEntryInfo, 'content' | 'status' | 'activeForm'>;

export function isPlanSystemChatEntry(entry: ChatEntry): boolean {
  return entry.kind === 'system' && entry.id.startsWith('plan:');
}
