import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ChatProjection } from './chat-projection';

function addMessage(doc: Y.Doc, id: string, textValue: string): Y.Text {
  const root = doc.getMap<unknown>('root');
  const entries = root.get('entries') as Y.Map<unknown>;
  const order = root.get('entry_order') as Y.Array<string>;
  const entry = new Y.Map<unknown>();
  const blocks = new Y.Map<unknown>();
  const blockOrder = new Y.Array<string>();
  const block = new Y.Map<unknown>();
  const text = new Y.Text();
  entries.set(id, entry);
  order.push([id]);
  entry.set('turn_id', id);
  entry.set('kind', 'message');
  entry.set('role', 'assistant');
  entry.set('status', 'streaming');
  entry.set('created_at', '2026-08-24T00:00:00Z');
  entry.set('blocks', blocks);
  entry.set('block_order', blockOrder);
  blocks.set(`${id}:text`, block);
  blockOrder.push([`${id}:text`]);
  block.set('kind', 'text');
  block.set('text', text);
  text.insert(0, textValue);
  return text;
}

function chatDoc(): Y.Doc {
  const doc = new Y.Doc();
  const root = doc.getMap<unknown>('root');
  root.set('schema_version', 1);
  root.set('projection_version', 1);
  root.set('entry_order', new Y.Array<string>());
  root.set('entries', new Y.Map<unknown>());
  root.set('tool_calls', new Y.Map<unknown>());
  return doc;
}

describe('ChatProjection', () => {
  it('reprojects only the streaming tail in a two-thousand-entry transcript', () => {
    const doc = chatDoc();
    let tail = new Y.Text();
    doc.transact(() => {
      for (let index = 0; index < 2_000; index += 1) {
        tail = addMessage(doc, `entry-${index}`, `message-${index}`);
      }
    });
    const projection = new ChatProjection();
    const initial = projection.project(doc);
    const first = initial.view.entries[0];
    const middle = initial.view.entries[1_000];
    const previousTail = initial.view.entries[1_999];

    tail.insert(tail.length, ' streamed');
    const updated = projection.project(doc);

    expect(updated.changedEntryIds).toEqual(['entry-1999']);
    expect(updated.orderChanged).toBe(false);
    expect(updated.view.entries[0]).toBe(first);
    expect(updated.view.entries[1_000]).toBe(middle);
    expect(updated.view.entries[1_999]).not.toBe(previousTail);
    expect(updated.view.entries[1_999]?.text).toBe('message-1999 streamed');
    projection.dispose();
  });

  it('adds one ordered entry without replacing existing entry objects', () => {
    const doc = chatDoc();
    addMessage(doc, 'first', 'one');
    addMessage(doc, 'second', 'two');
    const projection = new ChatProjection();
    const initial = projection.project(doc);

    addMessage(doc, 'third', 'three');
    const updated = projection.project(doc);

    expect(updated.orderChanged).toBe(true);
    expect(updated.changedEntryIds).toEqual(['third']);
    expect(updated.view.entries.map((entry) => entry.id)).toEqual(['first', 'second', 'third']);
    expect(updated.view.entries[0]).toBe(initial.view.entries[0]);
    expect(updated.view.entries[1]).toBe(initial.view.entries[1]);
    projection.dispose();
  });

  it('hides a stale unknown user delivery after the assistant turn is already terminal', () => {
    const doc = chatDoc();
    const root = doc.getMap<unknown>('root');
    const entries = root.get('entries') as Y.Map<unknown>;
    const order = root.get('entry_order') as Y.Array<string>;
    const user = new Y.Map<unknown>();
    const blocks = new Y.Map<unknown>();
    const blockOrder = new Y.Array<string>();
    const block = new Y.Map<unknown>();
    const text = new Y.Text();
    entries.set('turn-1:user', user);
    order.insert(0, ['turn-1:user']);
    user.set('turn_id', 'turn-1');
    user.set('kind', 'message');
    user.set('role', 'user');
    user.set('status', 'pending');
    user.set('delivery_schema_version', 2);
    user.set('delivery_state', 'delivery_unknown');
    user.set('created_at', '2026-08-24T00:00:00Z');
    user.set('blocks', blocks);
    user.set('block_order', blockOrder);
    blocks.set('text', block);
    blockOrder.push(['text']);
    block.set('kind', 'text');
    block.set('text', text);
    text.insert(0, 'already ran');
    addMessage(doc, 'turn-1:assistant', 'done');
    (entries.get('turn-1:assistant') as Y.Map<unknown>).set('turn_id', 'turn-1');
    (entries.get('turn-1:assistant') as Y.Map<unknown>).set('status', 'completed');

    const projection = new ChatProjection();
    const view = projection.project(doc).view;
    expect(view.entries[0]?.deliveryState).toBe('completed');
    expect(view.entries[1]?.status).toBe('completed');
    projection.dispose();
  });

  it('reprojects only the entry that owns an updated tool call', () => {
    const doc = chatDoc();
    addMessage(doc, 'first', 'one');
    addMessage(doc, 'second', 'two');
    const root = doc.getMap<unknown>('root');
    const entries = root.get('entries') as Y.Map<unknown>;
    const tools = root.get('tool_calls') as Y.Map<unknown>;
    for (const id of ['first', 'second']) {
      const entry = entries.get(id) as Y.Map<unknown>;
      const blocks = entry.get('blocks') as Y.Map<unknown>;
      const order = entry.get('block_order') as Y.Array<string>;
      const block = new Y.Map<unknown>();
      const tool = new Y.Map<unknown>();
      blocks.set(`${id}:tool`, block);
      order.push([`${id}:tool`]);
      block.set('kind', 'tool_call');
      block.set('tool_call_id', `${id}:tool`);
      tools.set(`${id}:tool`, tool);
      tool.set('turn_id', id);
      tool.set('name', 'shell');
      tool.set('status', 'pending');
    }
    const projection = new ChatProjection();
    const initial = projection.project(doc);

    const firstTool = tools.get('first:tool') as Y.Map<unknown>;
    firstTool.set('status', 'completed');
    const updated = projection.project(doc);

    expect(updated.changedEntryIds).toEqual(['first']);
    expect(updated.view.entries[0]).not.toBe(initial.view.entries[0]);
    expect(updated.view.entries[1]).toBe(initial.view.entries[1]);
    expect(updated.view.entries[0]?.toolCalls[0]?.status).toBe('completed');
    projection.dispose();
  });

  it('rebuilds ownership when order removal leaves an old entry map behind', () => {
    const doc = chatDoc();
    addMessage(doc, 'old-owner', 'old');
    addMessage(doc, 'remaining', 'new');
    const root = doc.getMap<unknown>('root');
    const entries = root.get('entries') as Y.Map<unknown>;
    const tools = root.get('tool_calls') as Y.Map<unknown>;
    const oldOwner = entries.get('old-owner') as Y.Map<unknown>;
    const remaining = entries.get('remaining') as Y.Map<unknown>;
    oldOwner.set('turn_id', 'shared-turn');
    remaining.set('turn_id', 'shared-turn');
    const block = new Y.Map<unknown>();
    (oldOwner.get('blocks') as Y.Map<unknown>).set('shared-tool-block', block);
    (oldOwner.get('block_order') as Y.Array<string>).push(['shared-tool-block']);
    block.set('kind', 'tool_call');
    block.set('tool_call_id', 'shared-tool');
    const tool = new Y.Map<unknown>();
    tools.set('shared-tool', tool);
    tool.set('turn_id', 'shared-turn');
    tool.set('name', 'shell');
    tool.set('status', 'completed');
    const projection = new ChatProjection();
    const initial = projection.project(doc);
    expect(initial.view.entries[1]?.toolCalls).toHaveLength(0);

    (root.get('entry_order') as Y.Array<string>).delete(0, 1);
    const updated = projection.project(doc);

    expect(updated.view.entries.map((entry) => entry.id)).toEqual(['remaining']);
    expect(updated.view.entries[0]?.toolCalls.map((item) => item.toolCallId)).toEqual(['shared-tool']);
    projection.dispose();
  });

  it('attaches an orphan tool only to the final assistant for one turn', () => {
    const doc = chatDoc();
    addMessage(doc, 'first-assistant', 'first');
    addMessage(doc, 'final-assistant', 'final');
    const root = doc.getMap<unknown>('root');
    const entries = root.get('entries') as Y.Map<unknown>;
    (entries.get('first-assistant') as Y.Map<unknown>).set('turn_id', 'shared-turn');
    (entries.get('final-assistant') as Y.Map<unknown>).set('turn_id', 'shared-turn');
    const tool = new Y.Map<unknown>();
    (root.get('tool_calls') as Y.Map<unknown>).set('orphan-tool', tool);
    tool.set('turn_id', 'shared-turn');
    tool.set('name', 'shell');
    tool.set('status', 'completed');

    const projection = new ChatProjection();
    const view = projection.project(doc).view;

    expect(view.entries[0]?.toolCalls).toHaveLength(0);
    expect(view.entries[1]?.toolCalls.map((item) => item.toolCallId)).toEqual(['orphan-tool']);
    projection.dispose();
  });
});
