import type { ChatBlock, ChatEntry, ToolCallInfo } from '@/entities/chat/chat-view';
import { blocksForChatEntry } from '@/features/chat/chat-render-blocks';

type ToolBlock = Extract<ChatBlock, { kind: 'tool_call' }>;

const NON_TERMINAL = new Set([
  'pending',
  'running',
  'in_progress',
  'awaiting_permission',
  'awaitingpermission',
]);

function toolStatusRank(status: string | null | undefined): number {
  const normalized = (status ?? '').toLowerCase();
  if (NON_TERMINAL.has(normalized)) return 0;
  return 1;
}

function isLegacyToolBlockId(blockId: string): boolean {
  return blockId.startsWith('legacy-tool:');
}

/** 同一 toolCallId 的两行里保留更可信的一条：终态优先，其次非 legacy block，最后保留更晚出现的。 */
export function pickPreferredToolBlock(left: ToolBlock, right: ToolBlock): ToolBlock {
  const leftRank = toolStatusRank(left.toolCall.status);
  const rightRank = toolStatusRank(right.toolCall.status);
  if (leftRank !== rightRank) return rightRank > leftRank ? right : left;

  const leftLegacy = isLegacyToolBlockId(left.id);
  const rightLegacy = isLegacyToolBlockId(right.id);
  if (leftLegacy !== rightLegacy) return leftLegacy ? right : left;

  return right;
}

export function resolveHiddenToolBlocks(entries: readonly ChatEntry[]): Map<string, Set<string>> {
  const hidden = new Map<string, Set<string>>();
  const canonical = new Map<string, { entryId: string; blockId: string; block: ToolBlock }>();

  const hide = (entryId: string, blockId: string) => {
    const blockIds = hidden.get(entryId) ?? new Set<string>();
    blockIds.add(blockId);
    hidden.set(entryId, blockIds);
  };

  for (const entry of entries) {
    for (const block of blocksForChatEntry(entry)) {
      if (block.kind !== 'tool_call') continue;
      const toolCallId = block.toolCall.toolCallId || '';
      if (!toolCallId) continue;

      const previous = canonical.get(toolCallId);
      if (!previous) {
        canonical.set(toolCallId, { entryId: entry.id, blockId: block.id, block });
        continue;
      }

      const preferred = pickPreferredToolBlock(previous.block, block);
      if (preferred === block) {
        hide(previous.entryId, previous.blockId);
        canonical.set(toolCallId, { entryId: entry.id, blockId: block.id, block });
      } else {
        hide(entry.id, block.id);
      }
    }
  }

  return hidden;
}

export function visibleToolBlocksForEntry(
  entry: ChatEntry,
  hidden: ReadonlyMap<string, ReadonlySet<string>>,
): ToolBlock[] {
  const hiddenIds = hidden.get(entry.id);
  return blocksForChatEntry(entry).filter((block): block is ToolBlock => {
    if (block.kind !== 'tool_call') return false;
    return !hiddenIds?.has(block.id);
  });
}

export function visibleToolCallsForEntry(
  entry: ChatEntry,
  hidden: ReadonlyMap<string, ReadonlySet<string>>,
): ToolCallInfo[] {
  return visibleToolBlocksForEntry(entry, hidden).map((block) => block.toolCall);
}
