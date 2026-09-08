import * as Y from 'yjs';
import { readChatEntry, readChatToolCall, type ChatEntry, type ChatView } from './chat-view';
import { asArray, asMap, getStr } from '@/shared/yjs/yjs-values';

export interface ChatProjectionResult {
  view: ChatView;
  changedEntryIds: string[];
  orderChanged: boolean;
}

type DeepObserver = (events: Array<Y.YEvent<any>>) => void;

const sameStrings = (left: readonly string[], right: readonly string[]) => left.length === right.length
  && left.every((value, index) => value === right[index]);

/**
 * 将一个 chat Y.Doc 增量投影为稳定的 entry 对象图。
 * 热路径只重读 observeDeep 标记的 entry/tool；结构替换才全量重建。
 */
export class ChatProjection {
  private doc: Y.Doc | null = null;
  private root: Y.Map<unknown> | null = null;
  private observer: DeepObserver | null = null;
  private order: string[] = [];
  private entries = new Map<string, ChatEntry>();
  private refsByEntry = new Map<string, Set<string>>();
  private ownersByTool = new Map<string, Set<string>>();
  private assistantByTurn = new Map<string, string>();
  private toolTurn = new Map<string, string>();
  private toolStartedAt = new Map<string, string>();
  private orphanToolsByTurn = new Map<string, Set<string>>();
  private dirtyEntries = new Set<string>();
  private dirtyTools = new Set<string>();
  private orderDirty = false;
  private fullDirty = false;
  private initialized = false;

  project(doc: Y.Doc): ChatProjectionResult {
    if (this.doc !== doc) this.attach(doc);
    if (!this.initialized || this.fullDirty) return this.rebuild();

    const previousOrder = this.order;
    if (this.orderDirty) this.order = this.readOrder();
    const orderChanged = !sameStrings(previousOrder, this.order);
    const appendOnly = previousOrder.length <= this.order.length
      && previousOrder.every((id, index) => this.order[index] === id);
    if (orderChanged && !appendOnly) return this.rebuild();
    const entriesMap = this.entriesMap();
    const toolCalls = this.toolCallsMap();
    if (!entriesMap || !toolCalls) return this.rebuild();

    const changed = new Set<string>();
    this.syncDirtyTools(toolCalls, changed);
    if (this.fullDirty) return this.rebuild();

    for (const id of this.dirtyEntries) {
      const old = this.entries.get(id);
      const read = readChatEntry(id, entriesMap, toolCalls);
      if (!read) {
        if (old) return this.rebuild();
        continue;
      }
      if (old && (old.turnId !== read.entry.turnId || old.role !== read.entry.role)) return this.rebuild();
      this.updateEntryIndexes(id, old, read.entry, read.referencedToolIds, changed);
      this.entries.set(id, this.withLegacyTools(read.entry, read.referencedToolIds, toolCalls));
      changed.add(id);
    }

    for (const id of changed) {
      if (this.dirtyEntries.has(id)) continue;
      const read = readChatEntry(id, entriesMap, toolCalls);
      if (!read) continue;
      this.entries.set(id, this.withLegacyTools(read.entry, read.referencedToolIds, toolCalls));
    }
    for (const id of this.order) {
      if (this.entries.has(id)) continue;
      const read = readChatEntry(id, entriesMap, toolCalls);
      if (!read) continue;
      this.updateEntryIndexes(id, null, read.entry, read.referencedToolIds, changed);
      this.entries.set(id, this.withLegacyTools(read.entry, read.referencedToolIds, toolCalls));
      changed.add(id);
    }

    this.clearDirty();
    return {
      view: this.view(),
      changedEntryIds: this.orderedChanges(changed),
      orderChanged,
    };
  }

  dispose(): void {
    if (this.root && this.observer) this.root.unobserveDeep(this.observer);
    this.doc = null;
    this.root = null;
    this.observer = null;
    this.order = [];
    this.entries.clear();
    this.refsByEntry.clear();
    this.ownersByTool.clear();
    this.assistantByTurn.clear();
    this.toolTurn.clear();
    this.toolStartedAt.clear();
    this.orphanToolsByTurn.clear();
    this.clearDirty();
    this.initialized = false;
  }

  private attach(doc: Y.Doc): void {
    this.dispose();
    this.doc = doc;
    this.root = doc.getMap<unknown>('root');
    this.observer = (events) => this.observe(events);
    this.root.observeDeep(this.observer);
  }

  private observe(events: Array<Y.YEvent<any>>): void {
    for (const event of events) {
      const [section, identity] = event.path;
      if (section === 'entries') {
        if (typeof identity === 'string') this.dirtyEntries.add(identity);
        else if (event instanceof Y.YMapEvent) event.keysChanged.forEach((id) => this.dirtyEntries.add(String(id)));
        continue;
      }
      if (section === 'tool_calls') {
        if (typeof identity === 'string') this.dirtyTools.add(identity);
        else if (event instanceof Y.YMapEvent) event.keysChanged.forEach((id) => this.dirtyTools.add(String(id)));
        continue;
      }
      if (section === 'entry_order') {
        this.orderDirty = true;
        continue;
      }
      if (event.path.length === 0 && event instanceof Y.YMapEvent) {
        if (event.keysChanged.has('entries') || event.keysChanged.has('tool_calls')) this.fullDirty = true;
        if (event.keysChanged.has('entry_order')) this.orderDirty = true;
      }
    }
  }

  private rebuild(): ChatProjectionResult {
    const entriesMap = this.entriesMap();
    const toolCalls = this.toolCallsMap();
    this.order = this.readOrder();
    this.entries.clear();
    this.refsByEntry.clear();
    this.ownersByTool.clear();
    this.assistantByTurn.clear();
    this.toolTurn.clear();
    this.toolStartedAt.clear();
    this.orphanToolsByTurn.clear();
    if (toolCalls) {
      toolCalls.forEach((value, id) => {
        const map = asMap(value);
        const turnId = getStr(map, 'turn_id');
        if (turnId) this.toolTurn.set(id, turnId);
        this.toolStartedAt.set(id, getStr(map, 'started_at') || '');
      });
    }
    if (entriesMap && toolCalls) {
      for (const id of this.order) {
        if (this.entries.has(id)) continue;
        const read = readChatEntry(id, entriesMap, toolCalls);
        if (!read) continue;
        this.entries.set(id, read.entry);
        this.refsByEntry.set(id, read.referencedToolIds);
        read.referencedToolIds.forEach((toolId) => this.addToolOwner(toolId, id));
        if (read.entry.role === 'assistant' && read.entry.turnId) this.assistantByTurn.set(read.entry.turnId, id);
      }
      this.rebuildOrphanIndex();
      for (const [id, entry] of this.entries) {
        this.entries.set(id, this.withLegacyTools(entry, this.refsByEntry.get(id) ?? new Set(), toolCalls));
      }
    }
    const changed: string[] = [];
    const seen = new Set<string>();
    for (const id of this.order) {
      if (seen.has(id) || !this.entries.has(id)) continue;
      seen.add(id);
      changed.push(id);
    }
    this.initialized = true;
    this.clearDirty();
    return { view: this.view(), changedEntryIds: changed, orderChanged: true };
  }

  private syncDirtyTools(toolCalls: Y.Map<unknown>, changed: Set<string>): void {
    for (const toolId of this.dirtyTools) {
      const oldTurn = this.toolTurn.get(toolId) ?? null;
      this.removeOrphanTool(toolId, oldTurn);
      const map = asMap(toolCalls.get(toolId));
      const newTurn = getStr(map, 'turn_id');
      if (newTurn) this.toolTurn.set(toolId, newTurn);
      else this.toolTurn.delete(toolId);
      if (map) this.toolStartedAt.set(toolId, getStr(map, 'started_at') || '');
      else this.toolStartedAt.delete(toolId);
      const linkedOwners = this.ownersByTool.get(toolId);
      if (linkedOwners?.size) linkedOwners.forEach((id) => changed.add(id));
      else {
        this.addOrphanTool(toolId, newTurn);
        if (oldTurn) {
          const owner = this.assistantByTurn.get(oldTurn);
          if (owner) changed.add(owner);
        }
        if (newTurn) {
          const owner = this.assistantByTurn.get(newTurn);
          if (owner) changed.add(owner);
        }
      }
    }
  }

  private updateEntryIndexes(
    id: string,
    old: ChatEntry | null | undefined,
    entry: ChatEntry,
    nextRefs: Set<string>,
    changed: Set<string>,
  ): void {
    if (!old && entry.role === 'assistant' && entry.turnId) {
      const previous = this.assistantByTurn.get(entry.turnId);
      if (previous && previous !== id) changed.add(previous);
      this.assistantByTurn.set(entry.turnId, id);
    }
    const previousRefs = this.refsByEntry.get(id) ?? new Set<string>();
    for (const toolId of previousRefs) {
      if (nextRefs.has(toolId)) continue;
      const owners = this.ownersByTool.get(toolId);
      owners?.delete(id);
      if (!owners?.size) {
        this.ownersByTool.delete(toolId);
        const turn = this.toolTurn.get(toolId);
        this.addOrphanTool(toolId, turn);
        const orphanOwner = turn ? this.assistantByTurn.get(turn) : null;
        if (orphanOwner) changed.add(orphanOwner);
      }
    }
    for (const toolId of nextRefs) {
      if (previousRefs.has(toolId)) continue;
      const turn = this.toolTurn.get(toolId);
      const orphanOwner = turn ? this.assistantByTurn.get(turn) : null;
      if (orphanOwner && orphanOwner !== id) changed.add(orphanOwner);
      this.removeOrphanTool(toolId, turn);
      this.addToolOwner(toolId, id);
    }
    this.refsByEntry.set(id, nextRefs);
  }

  private addToolOwner(toolId: string, entryId: string): void {
    const owners = this.ownersByTool.get(toolId) ?? new Set<string>();
    owners.add(entryId);
    this.ownersByTool.set(toolId, owners);
  }

  private withLegacyTools(entry: ChatEntry, referenced: Set<string>, toolCalls: Y.Map<unknown>): ChatEntry {
    if (entry.role !== 'assistant' || !entry.turnId) return entry;
    if (this.assistantByTurn.get(entry.turnId) !== entry.id) return entry;
    const legacy: Array<{ id: string; startedAt: string; map: Y.Map<unknown> }> = [];
    for (const id of this.orphanToolsByTurn.get(entry.turnId) ?? []) {
      if (referenced.has(id)) continue;
      const map = asMap(toolCalls.get(id));
      if (map) legacy.push({ id, startedAt: this.toolStartedAt.get(id) ?? '', map });
    }
    legacy.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
    if (!legacy.length) return entry;
    const legacyCalls = legacy.map((tool) => readChatToolCall(tool.id, tool.map));
    return {
      ...entry,
      toolCalls: [...entry.toolCalls, ...legacyCalls],
      blocks: [...entry.blocks, ...legacyCalls.map((toolCall) => ({
        kind: 'tool_call' as const,
        id: `legacy-tool:${toolCall.toolCallId}`,
        toolCall,
      }))],
    };
  }

  private rebuildOrphanIndex(): void {
    this.orphanToolsByTurn.clear();
    for (const [toolId, turnId] of this.toolTurn) {
      if (!this.ownersByTool.get(toolId)?.size) this.addOrphanTool(toolId, turnId);
    }
  }

  private addOrphanTool(toolId: string, turnId: string | null | undefined): void {
    if (!turnId) return;
    const tools = this.orphanToolsByTurn.get(turnId) ?? new Set<string>();
    tools.add(toolId);
    this.orphanToolsByTurn.set(turnId, tools);
  }

  private removeOrphanTool(toolId: string, turnId: string | null | undefined): void {
    if (!turnId) return;
    const tools = this.orphanToolsByTurn.get(turnId);
    tools?.delete(toolId);
    if (!tools?.size) this.orphanToolsByTurn.delete(turnId);
  }

  private entriesMap(): Y.Map<unknown> | null {
    return asMap(this.root?.get('entries'));
  }

  private toolCallsMap(): Y.Map<unknown> | null {
    return asMap(this.root?.get('tool_calls'));
  }

  private readOrder(): string[] {
    return (asArray(this.root?.get('entry_order'))?.toArray() ?? [])
      .filter((value): value is string => typeof value === 'string');
  }

  private orderedChanges(changed: Set<string>): string[] {
    const positions = new Map(this.order.map((id, index) => [id, index]));
    return [...changed]
      .filter((id) => this.entries.has(id))
      .sort((left, right) => (positions.get(left) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right) ?? Number.MAX_SAFE_INTEGER));
  }

  private view(): ChatView {
    return {
      schemaVersion: this.root?.get('schema_version'),
      projectionVersion: this.root?.get('projection_version'),
      entries: this.order.flatMap((id) => {
        const entry = this.entries.get(id);
        return entry ? [entry] : [];
      }),
    };
  }

  private clearDirty(): void {
    this.dirtyEntries.clear();
    this.dirtyTools.clear();
    this.orderDirty = false;
    this.fullDirty = false;
  }
}
