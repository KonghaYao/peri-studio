import { describe, expect, it } from 'vitest';
import { formatElapsedBadge, narrateToolCall, resolveToolCardKind } from './tool-narration';
import type { ToolCallInfo } from '@/entities/chat/chat-view';

const base: ToolCallInfo = {
  toolCallId: 't1',
  name: 'Bash',
  kind: 'execute',
  status: 'completed',
  arguments: { command: 'pwd' },
  result: null,
  publicError: null,
  resultOmitted: false,
  resultBytes: 0,
  startedAt: null,
  completedAt: null,
};

describe('tool-narration', () => {
  it('resolves bash from command arguments', () => {
    expect(resolveToolCardKind(base)).toBe('bash');
  });

  it('narrates completed shell commands like Fenix', () => {
    const result = narrateToolCall(base, { tone: 'done', statusLabel: 'Done', running: false, terminal: true });
    expect(result.title).toBe('Ran $ pwd');
  });

  it('resolves known tool names before overlapping argument shapes', () => {
    expect(resolveToolCardKind({ ...base, name: 'WebSearch', kind: 'other', arguments: { query: 'SolidJS' } })).toBe('web-search');
    expect(resolveToolCardKind({ ...base, name: 'Grep', kind: 'other', arguments: { pattern: 'ToolCall', path: 'web/src' } })).toBe('grep');
    expect(resolveToolCardKind({ ...base, name: 'Write', kind: 'edit', arguments: { file_path: 'a.ts', content: 'x' } })).toBe('write');
    expect(resolveToolCardKind({ ...base, name: 'Edit', kind: 'edit', arguments: { file_path: 'a.ts', old_string: 'x', new_string: 'y' } })).toBe('edit');
  });

  it('narrates files, searches and questions with user-facing verbs', () => {
    expect(narrateToolCall({ ...base, name: 'Read', kind: 'read', arguments: { file_path: '/workspace/src/main.ts', offset: 10, limit: 5 } }, { tone: 'done', statusLabel: 'Done', running: false, terminal: true, projectCwd: '/workspace' })).toMatchObject({
      kind: 'read-file',
      subtitle: 'Lines 10-14',
      filePreview: { prefix: 'Opened ', pathLabel: 'main.ts', path: '/workspace/src/main.ts' },
    });
    expect(narrateToolCall({ ...base, name: 'WebSearch', kind: 'other', arguments: { query: 'SolidJS signals' } }, { tone: 'running', statusLabel: 'Running', running: true, terminal: false }).title).toBe('Searching SolidJS signals');
    expect(narrateToolCall({ ...base, name: 'AskUserQuestion', kind: 'other', arguments: { questions: [] } }, { tone: 'done', statusLabel: 'Done', running: false, terminal: true }).title).toBe('Asked question');
  });

  it('uses basename for file preview labels while keeping the original path', () => {
    const options = { tone: 'done', statusLabel: 'Done', running: false, terminal: true, projectCwd: '/workspace/project' };
    expect(narrateToolCall({ ...base, name: 'Read', kind: 'read', arguments: { file_path: '/workspace/other/main.ts' } }, options).filePreview).toMatchObject({
      pathLabel: 'main.ts',
      path: '/workspace/other/main.ts',
    });
    expect(narrateToolCall({ ...base, name: 'Read', kind: 'read', arguments: { file_path: 'src/main.ts' } }, options).filePreview).toMatchObject({
      pathLabel: 'main.ts',
      path: 'src/main.ts',
    });
  });

  it('formats elapsed badges without spaces', () => {
    expect(formatElapsedBadge(12)).toBe('12ms');
    expect(formatElapsedBadge(1250)).toBe('1.3s');
  });
});
