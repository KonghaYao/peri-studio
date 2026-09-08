import type { ChatBlock } from '@/entities/chat/chat-view';

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
): 'activity' | 'normal' {
  if (unit.kind === 'tool_group') return 'activity';
  const index = blocks.findIndex((block) => block.id === unit.blockId);
  if (index < 0) return 'normal';
  return blockActivityDensity(blocks, index);
}

/** 将 blocks 拆成稳定 id 的 layout unit（连续 activity tool 合并为一组）。 */
export function buildAssistantLayoutUnits(blocks: readonly ChatBlock[]): AssistantLayoutUnit[] {
  const units: AssistantLayoutUnit[] = [];
  let index = 0;
  while (index < blocks.length) {
    const density = blockActivityDensity(blocks, index);
    if (density === 'normal') {
      const block = blocks[index];
      units.push({ kind: 'block', id: `block:${block.id}`, blockId: block.id });
      index += 1;
      continue;
    }

    if (isToolBlock(blocks[index])) {
      const blockIds: string[] = [];
      while (index < blocks.length && isToolBlock(blocks[index]) && blockActivityDensity(blocks, index) === 'activity') {
        blockIds.push(blocks[index].id);
        index += 1;
      }
      units.push({ kind: 'tool_group', id: `tools:${blockIds.join('|')}`, blockIds });
      continue;
    }

    const block = blocks[index];
    units.push({ kind: 'block', id: `block:${block.id}`, blockId: block.id });
    index += 1;
  }
  return units;
}

/** 将 layout unit 按 activity 轨分组，供 chat-activity-chain 容器使用。 */
export function buildConversationRowGroups(blocks: readonly ChatBlock[]): ConversationRowGroup[] {
  const units = buildAssistantLayoutUnits(blocks);
  const groups: ConversationRowGroup[] = [];
  let activityUnitIds: string[] = [];

  const flushActivity = () => {
    if (activityUnitIds.length === 0) return;
    groups.push({ kind: 'activity', id: `activity:${activityUnitIds.join('|')}`, unitIds: [...activityUnitIds] });
    activityUnitIds = [];
  };

  for (const unit of units) {
    if (layoutUnitActivityDensity(blocks, unit) === 'activity') {
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

/** Reasoning 与邻接 tool 同属紧凑活动轨；带正文的 reasoning 若不与 tool 相邻则保持正文节奏。 */
export function blockActivityDensity(blocks: readonly ChatBlock[], index: number): 'activity' | 'normal' {
  const block = blocks[index];
  if (block.kind === 'tool_call') return 'activity';
  if (block.kind !== 'reasoning') return 'normal';

  let prev = index - 1;
  while (prev >= 0 && blocks[prev].kind === 'reasoning') prev -= 1;
  let next = index + 1;
  while (next < blocks.length && blocks[next].kind === 'reasoning') next += 1;

  const adjacentTool = isToolBlock(blocks[prev]) || isToolBlock(blocks[next]);
  return adjacentTool ? 'activity' : 'normal';
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
