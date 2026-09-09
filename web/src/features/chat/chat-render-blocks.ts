import type { ChatBlock, ChatEntry } from '@/entities/chat/chat-view';

export type ActivityBoundary = {
  previousTool: boolean;
  nextTool: boolean;
};

const NO_ACTIVITY_BOUNDARY: ActivityBoundary = {
  previousTool: false,
  nextTool: false,
};

export type ActivitySegmentItem =
  | { kind: 'reasoning'; block: Extract<ChatBlock, { kind: 'reasoning' }> }
  | { kind: 'tool_group'; blocks: Extract<ChatBlock, { kind: 'tool_call' }>[] };

export type ConversationSegment =
  | { kind: 'content'; blocks: ChatBlock[] }
  | { kind: 'activity'; items: ActivitySegmentItem[] };

export function activityItemKey(item: ActivitySegmentItem): string {
  if (item.kind === 'reasoning') return `reasoning:${item.block.id}`;
  return `tools:${item.blocks.map((block) => block.id).join(',')}`;
}

export function segmentKey(segment: ConversationSegment): string {
  if (segment.kind === 'content') {
    return `content:${segment.blocks.map((block) => block.id).join('\x1f')}`;
  }
  return `activity:${segment.items.map(activityItemKey).join('\x1f')}`;
}

/** 单条 assistant 消息的稳定渲染单元（按 block id，避免 Solid For 因新对象引用重挂载）。 */
export type AssistantLayoutUnit =
  | { kind: 'block'; id: string; blockId: string }
  | { kind: 'tool_group'; id: string; blockIds: string[] };

export type ConversationRowGroup =
  | { kind: 'surface'; id: string; unitIds: string[] }
  | { kind: 'activity'; id: string; unitIds: string[] };

export function layoutUnitActivityDensity(
  blocks: readonly ChatBlock[],
  unit: AssistantLayoutUnit,
  boundary: ActivityBoundary = NO_ACTIVITY_BOUNDARY,
): 'activity' | 'normal' {
  if (unit.kind === 'tool_group') return 'activity';
  const index = blocks.findIndex((block) => block.id === unit.blockId);
  if (index < 0) return 'normal';
  return blockActivityDensity(blocks, index, boundary);
}

/** 将 blocks 拆成稳定 id 的 layout unit（连续 activity tool 合并为一组）。 */
export function buildAssistantLayoutUnits(
  blocks: readonly ChatBlock[],
  boundary: ActivityBoundary = NO_ACTIVITY_BOUNDARY,
): AssistantLayoutUnit[] {
  const units: AssistantLayoutUnit[] = [];
  let index = 0;
  while (index < blocks.length) {
    const density = blockActivityDensity(blocks, index, boundary);
    if (density === 'normal') {
      const block = blocks[index];
      units.push({ kind: 'block', id: `block:${block.id}`, blockId: block.id });
      index += 1;
      continue;
    }

    if (isToolBlock(blocks[index])) {
      const blockIds: string[] = [];
      while (index < blocks.length && isToolBlock(blocks[index]) && blockActivityDensity(blocks, index, boundary) === 'activity') {
        blockIds.push(blocks[index].id);
        index += 1;
      }
      units.push({ kind: 'tool_group', id: `tools:${blockIds.join('|')}`, blockIds });
      continue;
    }

    const block = blocks[index];
    if (skipConsecutiveEmptyActivityReasoning(blocks, units, index, boundary)) {
      index += 1;
      continue;
    }
    units.push({ kind: 'block', id: `block:${block.id}`, blockId: block.id });
    index += 1;
  }
  return units;
}

/** 将 layout unit 按 activity 轨分组，供 chat-activity-chain 容器使用。 */
export function buildConversationRowGroups(
  blocks: readonly ChatBlock[],
  boundary: ActivityBoundary = NO_ACTIVITY_BOUNDARY,
): ConversationRowGroup[] {
  const units = buildAssistantLayoutUnits(blocks, boundary);
  const groups: ConversationRowGroup[] = [];
  let activityUnitIds: string[] = [];

  const flushActivity = () => {
    if (activityUnitIds.length === 0) return;
    groups.push({ kind: 'activity', id: `activity:${activityUnitIds.join('|')}`, unitIds: [...activityUnitIds] });
    activityUnitIds = [];
  };

  for (const unit of units) {
    if (layoutUnitActivityDensity(blocks, unit, boundary) === 'activity') {
      activityUnitIds.push(unit.id);
      continue;
    }
    flushActivity();
    groups.push({ kind: 'surface', id: unit.id, unitIds: [unit.id] });
  }
  flushActivity();
  return groups;
}

function isToolBlock(block: ChatBlock | undefined): block is Extract<ChatBlock, { kind: 'tool_call' }> {
  return block?.kind === 'tool_call';
}

function isReasoningBlock(block: ChatBlock | undefined): block is Extract<ChatBlock, { kind: 'reasoning' }> {
  return block?.kind === 'reasoning';
}

function entryBlocksForActivity(entry: ChatEntry): ChatBlock[] {
  if (entry.blocks.length > 0) return entry.blocks;
  return [
    ...entry.reasoning.map((reasoning, index) => ({
      kind: 'reasoning' as const,
      id: reasoning.id || `${entry.id}:reasoning:${index}`,
      reasoning,
    })),
    ...entry.toolCalls.map((toolCall, index) => ({
      kind: 'tool_call' as const,
      id: toolCall.toolCallId || `${entry.id}:tool:${index}`,
      toolCall,
    })),
    ...(entry.text ? [{ kind: 'text' as const, id: `${entry.id}:text`, text: entry.text }] : []),
    ...entry.resources.map((resource, index) => ({
      kind: 'resource' as const,
      id: resource.resourceId || `${entry.id}:resource:${index}`,
      resource,
    })),
  ];
}

function nearestCrossEntryBlockIsTool(
  entries: readonly ChatEntry[],
  entryIndex: number,
  direction: -1 | 1,
): boolean {
  const current = entries[entryIndex];
  if (current?.role !== 'assistant' || !current.turnId) return false;

  for (let index = entryIndex + direction; index >= 0 && index < entries.length; index += direction) {
    const entry = entries[index];
    if (entry.role !== 'assistant' || entry.turnId !== current.turnId) return false;
    const blocks = entryBlocksForActivity(entry);
    for (
      let blockIndex = direction < 0 ? blocks.length - 1 : 0;
      blockIndex >= 0 && blockIndex < blocks.length;
      blockIndex += direction
    ) {
      const block = blocks[blockIndex];
      if (block.kind === 'reasoning') continue;
      return block.kind === 'tool_call';
    }
  }
  return false;
}

/** 同一 turn 可投影为多条 assistant entry；在 entry 边界补齐 Reasoning 与 tool 的邻接关系。 */
export function activityBoundaryAt(entries: readonly ChatEntry[], entryIndex: number): ActivityBoundary {
  return {
    previousTool: nearestCrossEntryBlockIsTool(entries, entryIndex, -1),
    nextTool: nearestCrossEntryBlockIsTool(entries, entryIndex, 1),
  };
}

function sameAssistantTurn(current: ChatEntry | undefined, neighbor: ChatEntry | undefined): boolean {
  return Boolean(
    current?.role === 'assistant'
    && neighbor?.role === 'assistant'
    && current.turnId
    && neighbor.turnId === current.turnId,
  );
}

function entryActivityEdges(entries: readonly ChatEntry[], entryIndex: number) {
  const entry = entries[entryIndex];
  if (!entry) return { first: false, last: false };
  const groups = buildConversationRowGroups(entryBlocksForActivity(entry), activityBoundaryAt(entries, entryIndex));
  return {
    first: groups[0]?.kind === 'activity',
    last: groups.at(-1)?.kind === 'activity',
  };
}

/** 同一 turn 的相邻 assistant entry 各自渲染轨道时，标记需要跨消息间距续接的边缘。 */
export function activityContinuationAt(
  entries: readonly ChatEntry[],
  entryIndex: number,
): { before: boolean; after: boolean } {
  const current = entries[entryIndex];
  const currentEdges = entryActivityEdges(entries, entryIndex);
  const previousContinues = sameAssistantTurn(current, entries[entryIndex - 1])
    && currentEdges.first
    && entryActivityEdges(entries, entryIndex - 1).last;
  const nextContinues = sameAssistantTurn(current, entries[entryIndex + 1])
    && currentEdges.last
    && entryActivityEdges(entries, entryIndex + 1).first;
  return { before: previousContinues, after: nextContinues };
}

/** Reasoning 与同回合邻接 tool 同属紧凑活动轨；带正文的 reasoning 若不与 tool 相邻则保持正文节奏。 */
export function blockActivityDensity(
  blocks: readonly ChatBlock[],
  index: number,
  boundary: ActivityBoundary = NO_ACTIVITY_BOUNDARY,
): 'activity' | 'normal' {
  const block = blocks[index];
  if (block.kind === 'tool_call') return 'activity';
  if (block.kind !== 'reasoning') return 'normal';

  let prev = index - 1;
  while (prev >= 0 && blocks[prev].kind === 'reasoning') prev -= 1;
  let next = index + 1;
  while (next < blocks.length && blocks[next].kind === 'reasoning') next += 1;

  const adjacentTool = isToolBlock(blocks[prev])
    || isToolBlock(blocks[next])
    || (prev < 0 && boundary.previousTool)
    || (next >= blocks.length && boundary.nextTool);
  return adjacentTool ? 'activity' : 'normal';
}

function isEmptyReasoningBlock(block: ChatBlock): boolean {
  return block.kind === 'reasoning' && !block.reasoning.text.trim();
}

/** 活动轨内 Reasoning 始终保留渲染槽位；空正文由组件渲染为无文案轨道段。 */
export function shouldRenderActivityReasoningBlock(
  blocks: readonly ChatBlock[],
  blockIndex: number,
  entryStreaming: boolean,
  boundary: ActivityBoundary = NO_ACTIVITY_BOUNDARY,
): boolean {
  const block = blocks[blockIndex];
  if (!block || block.kind !== 'reasoning') return true;
  if (blockActivityDensity(blocks, blockIndex, boundary) !== 'activity') return true;
  if (!isEmptyReasoningBlock(block)) return true;
  return entryStreaming || blockActivityDensity(blocks, blockIndex, boundary) === 'activity';
}

function skipConsecutiveEmptyActivityReasoning(
  blocks: readonly ChatBlock[],
  units: AssistantLayoutUnit[],
  index: number,
  boundary: ActivityBoundary,
): boolean {
  const block = blocks[index];
  if (!isReasoningBlock(block) || !isEmptyReasoningBlock(block)) return false;
  if (blockActivityDensity(blocks, index, boundary) !== 'activity') return false;
  const prev = units[units.length - 1];
  if (prev?.kind !== 'block') return false;
  const prevBlock = blocks.find((candidate) => candidate.id === prev.blockId);
  return Boolean(prevBlock && isReasoningBlock(prevBlock) && isEmptyReasoningBlock(prevBlock));
}

function pushActivityItem(items: ActivitySegmentItem[], item: ActivitySegmentItem) {
  items.push(item);
}

function flushActivity(segments: ConversationSegment[], activityItems: ActivitySegmentItem[]) {
  if (activityItems.length === 0) return;
  segments.push({ kind: 'activity', items: [...activityItems] });
  activityItems.length = 0;
}

function flushContent(segments: ConversationSegment[], contentBlocks: ChatBlock[]) {
  if (contentBlocks.length === 0) return;
  segments.push({ kind: 'content', blocks: [...contentBlocks] });
  contentBlocks.length = 0;
}

/**
 * 将单条 entry 的 blocks 投影为正文段与连续活动链（thinking + tool），不打乱 block_order。
 */
export function buildConversationSegments(blocks: readonly ChatBlock[]): ConversationSegment[] {
  const segments: ConversationSegment[] = [];
  const contentBlocks: ChatBlock[] = [];
  const activityItems: ActivitySegmentItem[] = [];

  let index = 0;
  while (index < blocks.length) {
    const density = blockActivityDensity(blocks, index);
    const block = blocks[index];

    if (density === 'normal') {
      flushActivity(segments, activityItems);
      contentBlocks.push(block);
      index += 1;
      continue;
    }

    flushContent(segments, contentBlocks);

    if (isToolBlock(block)) {
      const run: Extract<ChatBlock, { kind: 'tool_call' }>[] = [];
      while (index < blocks.length && isToolBlock(blocks[index])) {
        const toolBlock = blocks[index];
        if (!isToolBlock(toolBlock)) break;
        run.push(toolBlock);
        index += 1;
      }
      pushActivityItem(activityItems, { kind: 'tool_group', blocks: run });
      continue;
    }

    if (isReasoningBlock(block)) {
      pushActivityItem(activityItems, { kind: 'reasoning', block });
      index += 1;
      continue;
    }

    index += 1;
  }

  flushContent(segments, contentBlocks);
  flushActivity(segments, activityItems);
  return segments;
}
