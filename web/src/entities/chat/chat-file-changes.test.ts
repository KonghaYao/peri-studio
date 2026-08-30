import { describe, expect, it } from 'vitest';
import type { ChatEntry, ToolCallInfo } from './chat-view';
import { selectChatFileChanges } from './chat-file-changes';

function tool(name: string, args: unknown, status = 'completed', kind?: ToolCallInfo['kind'], result: unknown = null, locations?: unknown): ToolCallInfo {
  return {
    toolCallId: `${name}-${JSON.stringify(args)}`,
    name,
    kind,
    status,
    arguments: args,
    result,
    resultOmitted: false,
    resultBytes: null,
    publicError: null,
    startedAt: null,
    completedAt: null,
    locations,
  };
}

function entry(...toolCalls: ToolCallInfo[]): ChatEntry {
  return {
    id: 'assistant-1',
    turnId: 'turn-1',
    kind: 'message',
    role: 'assistant',
    status: 'completed',
    authorUserId: null,
    sourceCommandId: null,
    createdAt: '',
    completedAt: null,
    text: '',
    blocks: [],
    reasoning: [],
    toolCalls,
    resources: [],
    error: null,
  };
}

describe('selectChatFileChanges', () => {
  it('uses only authoritative edit calls and deduplicates projected locations', () => {
    expect(selectChatFileChanges([
      entry(
        tool('Read', { file_path: 'src/read-only.ts' }, 'completed', 'read', null, [{ path: 'src/read-only.ts' }]),
        tool('Anything', {}, 'completed', 'edit', null, [{ path: 'src/app.ts' }]),
        tool('write_file', { path: 'src/name-guess.ts' }, 'completed', 'other', { changed: true }),
        tool('Write', {}, 'completed', 'edit', null, [{ path: 'src/boundary.ts' }]),
        tool('Duplicate', {}, 'completed', 'edit', null, [{ path: 'src/app.ts' }]),
        tool('Bash', { command: 'git status --short' }, 'completed', 'execute', null, [{ path: 'src/git-only.ts' }]),
      ),
    ])).toEqual([
      { path: 'src/app.ts', operation: 'edited' },
      { path: 'src/boundary.ts', operation: 'written' },
    ]);
  });

  it('does not infer changes from tool names or patch-shaped input', () => {
    expect(selectChatFileChanges([
      entry(
        tool('apply_patch', { patch: '*** Update File: web/a.ts' }, 'completed', 'other', { changed: true }),
        tool('Edit', { file_path: 'web/b.ts' }, 'completed', 'other', { changed: true }),
      ),
    ])).toEqual([]);
  });

  it('counts only server-confirmed successful writes', () => {
    expect(selectChatFileChanges([
      entry(
        tool('Edit', { file_path: 'src/pending.ts' }, 'pending', 'edit'),
        tool('Edit', { file_path: 'src/running.ts' }, 'running', 'edit'),
        tool('Edit', { file_path: 'src/permission.ts' }, 'awaitingPermission', 'edit'),
        tool('Edit', { file_path: 'src/failed.ts' }, 'failed', 'edit'),
        tool('Modify workspace file', { file_path: 'src/no-proof.ts' }, 'completed', 'edit'),
        tool('Opaque editor', { file_path: 'src/done.ts' }, 'completed', 'edit', { changed: true }),
      ),
    ])).toEqual([
      { path: 'src/no-proof.ts', operation: 'edited' },
      { path: 'src/done.ts', operation: 'edited' },
    ]);
  });

  it('accepts completed authoritative edits with null, string, or byte-count results', () => {
    expect(selectChatFileChanges([
      entry(
        tool('Edit', { file_path: 'src/null.ts' }, 'completed', 'edit', null),
        tool('Edit', { file_path: 'src/string.ts' }, 'completed', 'edit', 'updated'),
        tool('Write', { file_path: 'src/bytes.ts' }, 'completed', 'edit', { bytes: 12 }),
      ),
    ])).toEqual([
      { path: 'src/null.ts', operation: 'edited' },
      { path: 'src/string.ts', operation: 'edited' },
      { path: 'src/bytes.ts', operation: 'written' },
    ]);
  });
});
