import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { renderChat } from './chat-view';
import { parsePermissionExpiration, renderControl } from './control-view';
import { renderRegistry } from './registry-view';

describe('renderRegistry project session catalog', () => {
  it('preserves the independent archive marker without changing runtime lifecycle', () => {
    const doc = new Y.Doc();
    const sessions = new Y.Map<unknown>();
    const session = new Y.Map<unknown>();
    doc.getMap<unknown>('root').set('project_sessions', sessions);
    sessions.set('logical-1', session);
    session.set('project_id', 'project-1');
    session.set('acp_session_id', 'acp-1');
    session.set('title', 'Saved work');
    session.set('lifecycle', 'ready');
    session.set('archived_at', '2026-08-14T00:00:00Z');

    const [projectSession] = renderRegistry(doc).projectSessions;
    expect(projectSession.archivedAt).toBe('2026-08-14T00:00:00Z');
    expect(projectSession.lifecycle).toBe('ready');
  });
});

describe('renderControl chat loading projection', () => {
  it('reads the server-authoritative chat loading fact', () => {
    const doc = new Y.Doc();
    const session = new Y.Map<unknown>();
    doc.getMap<unknown>('root').set('session', session);
    session.set('loading', true);

    expect(renderControl(doc).chat?.loading).toBe(true);
  });
});

describe('permission deadline parsing', () => {
  it.each(['2026-02-30T00:00:00Z', '2026-08-24T24:00:00Z'])(
    'fails closed for a normalized but invalid RFC3339 value: %s',
    (value) => expect(parsePermissionExpiration(value)).toBeNaN(),
  );
});

describe('renderChat tool projection', () => {
  it('preserves the authoritative interleaving from block_order', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const order = new Y.Array<string>(); const entries = new Y.Map<unknown>(); const calls = new Y.Map<unknown>();
    const entry = new Y.Map<unknown>(); const blockOrder = new Y.Array<string>(); const blocks = new Y.Map<unknown>();
    root.set('entry_order', order); root.set('entries', entries); root.set('tool_calls', calls);
    entries.set('assistant', entry); order.push(['assistant']);
    entry.set('role', 'assistant'); entry.set('created_at', 'now'); entry.set('block_order', blockOrder); entry.set('blocks', blocks);

    const addText = (id: string, value: string) => {
      const block = new Y.Map<unknown>(); const text = new Y.Text();
      blocks.set(id, block); blockOrder.push([id]); block.set('kind', 'text'); block.set('text', text); text.insert(0, value);
    };
    addText('intro', 'Before tool');
    const toolBlock = new Y.Map<unknown>();
    blocks.set('tool-block', toolBlock); blockOrder.push(['tool-block']); toolBlock.set('kind', 'tool_call'); toolBlock.set('tool_call_id', 'tool-1');
    calls.set('tool-1', new Y.Map<unknown>());
    addText('outro', 'After tool');

    expect(renderChat(doc).entries[0].blocks.map((block) => [block.kind, block.id])).toEqual([
      ['text', 'intro'], ['tool_call', 'tool-block'], ['text', 'outro'],
    ]);
  });

  it('fails closed for hidden and unknown reasoning visibility', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const order = new Y.Array<string>(); const entries = new Y.Map<unknown>();
    const entry = new Y.Map<unknown>(); const blockOrder = new Y.Array<string>(); const blocks = new Y.Map<unknown>();
    root.set('entry_order', order); root.set('entries', entries);
    entries.set('assistant', entry); order.push(['assistant']);
    entry.set('created_at', 'now'); entry.set('block_order', blockOrder); entry.set('blocks', blocks);
    for (const [id, visibility, value] of [
      ['summary', 'summary', 'safe summary'],
      ['hidden', 'hidden', 'private chain'],
      ['future', 'future', 'unknown private data'],
    ]) {
      const block = new Y.Map<unknown>(); const text = new Y.Text();
      blocks.set(id, block); blockOrder.push([id]);
      block.set('kind', 'reasoning'); block.set('visibility', visibility); block.set('text', text); text.insert(0, value);
    }

    expect(renderChat(doc).entries[0].reasoning).toEqual([
      { id: 'summary', text: 'safe summary', visibility: 'summary' },
    ]);
  });

  it('reads a legacy duplicated block reference only once', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const order = new Y.Array<string>();
    const entries = new Y.Map<unknown>();
    const entry = new Y.Map<unknown>();
    const blockOrder = new Y.Array<string>();
    const blocks = new Y.Map<unknown>();
    const block = new Y.Map<unknown>();
    const text = new Y.Text();
    root.set('entry_order', order); root.set('entries', entries);
    entries.set('t:user', entry); order.push(['t:user']);
    entry.set('role', 'user'); entry.set('created_at', 'now'); entry.set('block_order', blockOrder); entry.set('blocks', blocks);
    blocks.set('t:user:text', block); blockOrder.push(['t:user:text', 't:user:text']);
    block.set('kind', 'text'); block.set('text', text); text.insert(0, '你的 pwd 在哪里');

    expect(renderChat(doc).entries[0].text).toBe('你的 pwd 在哪里');
  });

  it('reads exact prompt identity while keeping legacy entries compatible', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const order = new Y.Array<string>();
    const entries = new Y.Map<unknown>();
    root.set('entry_order', order); root.set('entries', entries);
    for (const [id, source] of [['current', 'command-1'], ['legacy', null]] as const) {
      const entry = new Y.Map<unknown>();
      entry.set('created_at', '2026-08-14T00:00:00Z');
      entry.set('blocks', new Y.Map<unknown>()); entry.set('block_order', new Y.Array<string>());
      if (source) entry.set('source_command_id', source);
      if (id === 'current') {
        entry.set('origin', 'session_replay');
        entry.set('replay_verified', true);
      }
      entries.set(id, entry); order.push([id]);
    }
    const projected = renderChat(doc).entries;
    expect(projected.map((entry) => entry.sourceCommandId)).toEqual(['command-1', null]);
    expect(projected.map((entry) => [entry.origin, entry.replayVerified])).toEqual([
      ['session_replay', true], [null, null],
    ]);
  });

  it('preserves server-projected arguments, result and public error', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const order = new Y.Array<string>();
    const entries = new Y.Map<unknown>();
    const calls = new Y.Map<unknown>();
    root.set('entry_order', order); root.set('entries', entries); root.set('tool_calls', calls);

    const entry = new Y.Map<unknown>();
    const blockOrder = new Y.Array<string>();
    const blocks = new Y.Map<unknown>();
    entries.set('turn:assistant', entry); order.push(['turn:assistant']);
    entry.set('turn_id', 'turn'); entry.set('kind', 'message'); entry.set('role', 'assistant'); entry.set('status', 'completed');
    entry.set('created_at', '2026-08-13T00:00:00Z'); entry.set('block_order', blockOrder); entry.set('blocks', blocks);

    const block = new Y.Map<unknown>();
    blocks.set('tool-block', block); blockOrder.push(['tool-block']);
    block.set('kind', 'tool_call'); block.set('tool_call_id', 'tc-1');

    const call = new Y.Map<unknown>();
    const args = new Y.Map<unknown>();
    const result = new Y.Map<unknown>();
    const error = new Y.Map<unknown>();
    calls.set('tc-1', call);
    call.set('name', 'shell'); call.set('status', 'error'); call.set('arguments', args); call.set('result', result); call.set('public_error', error);
    call.set('started_at', '2026-08-13T00:00:00.000Z'); call.set('completed_at', '2026-08-13T00:00:01.250Z'); call.set('result_omitted', false); call.set('result_bytes', 14);
    args.set('command', 'pwd'); result.set('exitCode', 1); error.set('code', 'FAILED'); error.set('message', 'safe public message');

    const [tool] = renderChat(doc).entries[0].toolCalls;
    expect(tool.arguments).toEqual({ command: 'pwd' });
    expect(tool.result).toEqual({ exitCode: 1 });
    expect(tool.publicError).toEqual({ code: 'FAILED', message: 'safe public message' });
    expect(tool.startedAt).toBe('2026-08-13T00:00:00.000Z');
    expect(tool.completedAt).toBe('2026-08-13T00:00:01.250Z');
    expect(tool.resultOmitted).toBe(false);
    expect(tool.resultBytes).toBe(14);
  });

  it('keeps timestamps optional for legacy snapshots', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const order = new Y.Array<string>(); const entries = new Y.Map<unknown>(); const calls = new Y.Map<unknown>();
    root.set('entry_order', order); root.set('entries', entries); root.set('tool_calls', calls);
    const entry = new Y.Map<unknown>(); const blockOrder = new Y.Array<string>(); const blocks = new Y.Map<unknown>();
    entries.set('e', entry); order.push(['e']); entry.set('created_at', 'old'); entry.set('block_order', blockOrder); entry.set('blocks', blocks);
    const block = new Y.Map<unknown>(); blocks.set('b', block); blockOrder.push(['b']); block.set('kind', 'tool_call'); block.set('tool_call_id', 'tc');
    calls.set('tc', new Y.Map<unknown>());
    const [tool] = renderChat(doc).entries[0].toolCalls;
    expect(tool.startedAt).toBeNull(); expect(tool.completedAt).toBeNull();
    expect(tool.resultOmitted).toBeNull(); expect(tool.resultBytes).toBeNull();
  });

  it('repairs only exact-turn legacy orphan tools in stable order without duplicating blocks', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const order = new Y.Array<string>(); const entries = new Y.Map<unknown>(); const calls = new Y.Map<unknown>();
    root.set('entry_order', order); root.set('entries', entries); root.set('tool_calls', calls);
    const entry = new Y.Map<unknown>(); const blockOrder = new Y.Array<string>(); const blocks = new Y.Map<unknown>();
    entries.set('t1:assistant', entry); order.push(['t1:assistant']);
    entry.set('turn_id', 't1'); entry.set('role', 'assistant'); entry.set('created_at', 'now'); entry.set('block_order', blockOrder); entry.set('blocks', blocks);
    const referencedBlock = new Y.Map<unknown>(); blocks.set('tool:linked', referencedBlock); blockOrder.push(['tool:linked']); referencedBlock.set('kind', 'tool_call'); referencedBlock.set('tool_call_id', 'linked');
    for (const [id, turnId, startedAt] of [
      ['late', 't1', '2026-08-13T00:00:02Z'],
      ['early', 't1', '2026-08-13T00:00:01Z'],
      ['linked', 't1', '2026-08-13T00:00:00Z'],
      ['ambiguous', '', '2026-08-13T00:00:00Z'],
      ['other-turn', 't2', '2026-08-13T00:00:00Z'],
    ]) {
      const tool = new Y.Map<unknown>(); tool.set('turn_id', turnId); tool.set('name', id); tool.set('started_at', startedAt); calls.set(id, tool);
    }

    expect(renderChat(doc).entries[0].toolCalls.map((tool) => tool.toolCallId)).toEqual(['linked', 'early', 'late']);
  });
});

describe('renderControl permission projection', () => {
  it('exposes only actionable pending records while retaining server CAS history', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const permissions = new Y.Map<unknown>();
    root.set('pending_permissions', permissions);
    for (const [id, status] of [['pending', 'pending'], ['resolved', 'resolved'], ['expired', 'expired']] as const) {
      const permission = new Y.Map<unknown>();
      permission.set('permission_id', id);
      permission.set('status', status);
      permission.set('title', id);
      permissions.set(id, permission);
    }

    expect(renderControl(doc).pendingPermissions.map((item) => [item.queueKey, item.permissionId])).toEqual([['pending', 'pending']]);
    expect(permissions.size).toBe(3);
  });

  it('orders actionable requests by expiry and stable identity', () => {
    const doc = new Y.Doc();
    const permissions = new Y.Map<unknown>();
    doc.getMap<unknown>('root').set('pending_permissions', permissions);
    for (const [id, expiresAt] of [['late', '2026-08-13T12:02:00Z'], ['same-b', '2026-08-13T12:01:00Z'], ['unknown', 'bad'], ['permissive', '123'], ['same-a', '2026-08-13T12:01:00Z']] as const) {
      const permission = new Y.Map<unknown>();
      permission.set('permission_id', id);
      permission.set('status', 'pending');
      permission.set('expires_at', expiresAt);
      permissions.set(id, permission);
    }

    expect(renderControl(doc).pendingPermissions.map((item) => item.permissionId)).toEqual(['same-a', 'same-b', 'late', 'permissive', 'unknown']);
  });

  it('preserves absent, malformed, and textual permission expirations as distinct states', () => {
    const doc = new Y.Doc();
    const permissions = new Y.Map<unknown>();
    doc.getMap<unknown>('root').set('pending_permissions', permissions);
    for (const [id, expiresAt] of [['absent', undefined], ['null', null], ['number', 123], ['text', '2026-08-13T12:01:00Z']] as const) {
      const permission = new Y.Map<unknown>();
      permission.set('permission_id', id);
      permission.set('status', 'pending');
      if (expiresAt !== undefined) permission.set('expires_at', expiresAt);
      permissions.set(id, permission);
    }

    const byId = new Map(renderControl(doc).pendingPermissions.map((item) => [item.permissionId, item.expiresAt]));
    expect(byId.get('absent')).toBeUndefined();
    expect(byId.get('null')).toBeNull();
    expect(byId.get('number')).toBeNull();
    expect(byId.get('text')).toBe('2026-08-13T12:01:00Z');
  });

  it('retains opaque option IDs by their public permission scope', () => {
    const doc = new Y.Doc();
    const permission = new Y.Map<unknown>();
    const optionIds = new Y.Map<unknown>();
    const permissions = new Y.Map<unknown>();
    doc.getMap<unknown>('root').set('pending_permissions', permissions);
    permissions.set('p1', permission);
    permission.set('permission_id', 'p1');
    permission.set('status', 'pending');
    permission.set('option_ids', optionIds);
    optionIds.set('allowOnce', 'opaque-once');
    optionIds.set('allowSession', 'opaque-session');
    optionIds.set('deny', 'opaque-reject');
    optionIds.set('unknown', 'must-not-escape');

    expect(renderControl(doc).pendingPermissions[0].optionIds).toEqual({
      allowOnce: 'opaque-once',
      allowSession: 'opaque-session',
      deny: 'opaque-reject',
    });
  });

  it('accepts tool input evidence only when it is bound to the same tool call', () => {
    const doc = new Y.Doc();
    const permissions = new Y.Map<unknown>();
    const permission = new Y.Map<unknown>();
    doc.getMap<unknown>('root').set('pending_permissions', permissions);
    permissions.set('p1', permission);
    permission.set('permission_id', 'p1');
    permission.set('status', 'pending');
    permission.set('tool_call_id', 'tool-1');
    permission.set('evidence_tool_call_id', 'tool-1');
    permission.set('tool_input_summary', 'Command: cargo (+1 argument)');

    expect(renderControl(doc).pendingPermissions[0].toolInputSummary)
      .toBe('Command: cargo (+1 argument)');
    permission.set('evidence_tool_call_id', 'tool-other');
    expect(renderControl(doc).pendingPermissions[0].toolInputSummary).toBeNull();
  });
});

describe('renderControl elicitation projection', () => {
  it('reads only ordered typed fields and keeps responding forms visible', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const all = new Y.Map<unknown>(); const item = new Y.Map<unknown>();
    const fields = new Y.Map<unknown>(); const order = new Y.Array<string>();
    const field = new Y.Map<unknown>(); const options = new Y.Map<unknown>();
    const optionOrder = new Y.Array<string>(); const option = new Y.Map<unknown>();
    root.set('pending_elicitations', all); all.set('e1', item);
    item.set('elicitation_id', 'e1'); item.set('message', 'Choose carefully');
    item.set('status', 'responding'); item.set('response_action', 'accept');
    item.set('created_at', '2026-08-15T00:00:00Z'); item.set('fields', fields); item.set('field_order', order);
    order.push(['mode']); fields.set('mode', field); field.set('title', 'Mode');
    field.set('kind', 'single_select'); field.set('required', true); field.set('options', options); field.set('option_order', optionOrder);
    optionOrder.push(['safe']); options.set('safe', option); option.set('value', 'safe'); option.set('label', 'Safe');

    expect(renderControl(doc).pendingElicitations).toEqual([expect.objectContaining({
      elicitationId: 'e1', status: 'responding', responseAction: 'accept',
      fields: [expect.objectContaining({ id: 'mode', kind: 'single_select', required: true })],
    })]);
  });
});

describe('renderControl Peri extension projection', () => {
  it('reads the ordered Agent-authoritative session config catalog', () => {
    const doc = new Y.Doc();
    const agent = new Y.Map<unknown>();
    const order = new Y.Array<unknown>(); order.push(['mode']);
    const catalog = new Y.Map<unknown>();
    const mode = new Y.Map<unknown>();
    mode.set('id', 'mode'); mode.set('name', 'Mode'); mode.set('category', 'mode');
    mode.set('current_value', 'default');
    const choices = new Y.Map<unknown>();
    const choiceOrder = new Y.Array<unknown>(); choiceOrder.push(['default', 'bypassPermissions']);
    for (const [value, name] of [['default', 'Default'], ['bypassPermissions', 'Bypass permissions']]) {
      const choice = new Y.Map<unknown>(); choice.set('value', value); choice.set('name', name);
      choices.set(value, choice);
    }
    mode.set('options', choices); mode.set('option_order', choiceOrder); catalog.set('mode', mode);
    agent.set('config_options', catalog); agent.set('config_option_order', order);
    doc.getMap<unknown>('root').set('agent', agent);

    expect(renderControl(doc).agent?.configOptions).toEqual([{
      id: 'mode', name: 'Mode', description: null, category: 'mode', currentValue: 'default',
      options: [
        { value: 'default', name: 'Default', description: null },
        { value: 'bypassPermissions', name: 'Bypass permissions', description: null },
      ],
    }]);
  });

  it('keeps negotiated extensions separate from commands and reads precise usage', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    const agent = new Y.Map<unknown>();
    const commands = new Y.Array<unknown>();
    commands.push(['compact']);
    const extensions = new Y.Array<unknown>();
    extensions.push(['peri.tokenStats', 'peri.skillNames']);
    const catalog = new Y.Map<unknown>();
    const compact = new Y.Map<unknown>();
    compact.set('name', 'compact');
    compact.set('description', 'Compress context');
    compact.set('kind', 'skill');
    catalog.set('compact', compact);
    const usage = new Y.Map<unknown>();
    usage.set('input_tokens', 1200);
    usage.set('output_tokens', 345);
    usage.set('cache_read_tokens', 900);
    usage.set('model', 'claude-opus-4-1');
    agent.set('capabilities', commands);
    agent.set('extensions', extensions);
    agent.set('command_catalog', catalog);
    agent.set('latest_usage', usage);
    root.set('agent', agent);

    expect(renderControl(doc).agent).toMatchObject({
      availableCommands: ['compact'],
      commandCatalog: [{ name: 'compact', description: 'Compress context', kind: 'skill' }],
      extensions: ['peri.tokenStats', 'peri.skillNames'],
      latestUsage: {
        inputTokens: 1200,
        outputTokens: 345,
        cacheReadTokens: 900,
        model: 'claude-opus-4-1',
      },
    });
  });

  it('keeps old control docs readable', () => {
    const doc = new Y.Doc();
    doc.getMap<unknown>('root').set('agent', new Y.Map<unknown>());
    expect(renderControl(doc).agent).toMatchObject({ extensions: [], commandCatalog: [], latestUsage: null });
  });

  it('reads bounded safe activity only after exact extension negotiation', () => {
    const doc = new Y.Doc();
    const agent = new Y.Map<unknown>();
    const extensions = new Y.Array<unknown>(); extensions.push(['peri.agentActivity']);
    const order = new Y.Array<unknown>(); order.push(['subagent:abc123']);
    const activities = new Y.Map<unknown>();
    const item = new Y.Map<unknown>();
    item.set('kind', 'subagent'); item.set('status', 'running'); item.set('label', 'Research agent');
    item.set('is_background', true); item.set('created_at', '2026-08-15T00:00:00Z'); item.set('updated_at', '2026-08-15T00:00:01Z');
    const metrics = new Y.Map<unknown>(); metrics.set('tool_count', 3); item.set('metrics', metrics);
    const attributes = new Y.Map<unknown>(); attributes.set('task_kind', 'agent'); item.set('attributes', attributes);
    activities.set('subagent:abc123', item);
    agent.set('extensions', extensions); agent.set('activity_order', order); agent.set('activities', activities);
    doc.getMap<unknown>('root').set('agent', agent);
    expect(renderControl(doc).agent?.activities).toEqual([{
      id: 'subagent:abc123', kind: 'subagent', status: 'running', label: 'Research agent', isBackground: true,
      metrics: { tool_count: 3 }, attributes: { task_kind: 'agent' }, createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:01Z',
    }]);

    extensions.delete(0, 1);
    expect(renderControl(doc).agent?.activities).toEqual([]);
  });

  it('reads only a bounded prediction behind exact negotiation', () => {
    const doc = new Y.Doc();
    const agent = new Y.Map<unknown>();
    const extensions = new Y.Array<unknown>(); extensions.push(['peri.prediction']);
    const prediction = new Y.Map<unknown>();
    prediction.set('id', 'prediction:2:9');
    prediction.set('text', 'failed check test');
    prediction.set('created_at', '2026-08-15T00:00:00Z');
    agent.set('extensions', extensions);
    agent.set('input_prediction', prediction);
    doc.getMap<unknown>('root').set('agent', agent);

    expect(renderControl(doc).agent?.inputPrediction).toEqual({
      id: 'prediction:2:9', text: 'failed check test', createdAt: '2026-08-15T00:00:00Z',
    });
    extensions.delete(0, 1);
    expect(renderControl(doc).agent?.inputPrediction).toBeNull();

    extensions.push(['peri.prediction']);
    prediction.set('text', 'x'.repeat(201));
    expect(renderControl(doc).agent?.inputPrediction).toBeNull();
  });

  it('always reads the standard plan but gates Peri active wording', () => {
    const doc = new Y.Doc();
    const agent = new Y.Map<unknown>();
    const extensions = new Y.Array<unknown>();
    const order = new Y.Array<unknown>(); order.push(['0']);
    const entries = new Y.Map<unknown>();
    const first = new Y.Map<unknown>();
    first.set('content', 'Run tests'); first.set('status', 'in_progress'); first.set('active_form', 'Running tests');
    entries.set('0', first); agent.set('extensions', extensions); agent.set('plan_order', order); agent.set('plan_entries', entries);
    doc.getMap<unknown>('root').set('agent', agent);

    expect(renderControl(doc).agent?.plan).toEqual([{ id: '0', content: 'Run tests', status: 'in_progress', activeForm: null }]);
    extensions.push(['peri.planEntryActiveForm']);
    expect(renderControl(doc).agent?.plan).toEqual([{ id: '0', content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' }]);
  });

  it('downgrades an unnegotiated local Skill classification to a command', () => {
    const doc = new Y.Doc();
    const agent = new Y.Map<unknown>();
    const commands = new Y.Array<unknown>(); commands.push(['auto-fix']);
    const catalog = new Y.Map<unknown>(); const item = new Y.Map<unknown>();
    item.set('description', 'Fix an issue'); item.set('kind', 'skill'); catalog.set('auto-fix', item);
    agent.set('available_commands', commands); agent.set('command_catalog', catalog);
    doc.getMap<unknown>('root').set('agent', agent);
    expect(renderControl(doc).agent?.commandCatalog).toEqual([
      { name: 'auto-fix', description: 'Fix an issue', kind: 'command' },
    ]);
  });
});
