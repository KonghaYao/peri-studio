import { describe, expect, it } from 'vitest';
import {
  fsCreateDirAction,
  fsDeleteAction,
  fsMoveAction,
  isActionResourceResult,
  isDeleteConfirmResultFrame,
  openDeleteConfirm,
} from './resource-fs-mutation';

describe('resource filesystem mutation protocol', () => {
  it('builds create, move, delete, and recursive-confirm envelopes', () => {
    expect(fsCreateDirAction('c1', 'p1', 'src/new')).toEqual({
      t: 'action', type: 'fs/create-dir', commandId: 'c1',
      payload: { projectId: 'p1', path: 'src/new', ifNoneMatch: '*' },
    });
    expect(fsMoveAction('c2', 'p1', 'src/a', 'src/b', 'rev-a').payload).toEqual({
      projectId: 'p1', source: 'src/a', target: 'src/b', sourceIfMatch: 'rev-a', targetIfNoneMatch: '*',
    });
    expect(fsDeleteAction('c3', 'p1', 'src', 'rev-src', true, 'token').payload).toMatchObject({
      ifMatch: 'rev-src', recursive: true, useTrash: false, confirmToken: 'token',
    });
    expect(openDeleteConfirm('q1', 'p1', 'src', 'rev-src')).toMatchObject({
      t: 'resource_query', type: 'resource/open-delete-confirm', requestId: 'q1', projectId: 'p1',
      payload: { path: 'src', ifMatch: 'rev-src', recursive: true, useTrash: false },
    });
  });

  it('strictly validates delete-confirm and action result envelopes', () => {
    expect(isDeleteConfirmResultFrame({
      t: 'resource_result', requestId: 'q1',
      result: { kind: 'delete_confirm', data: { confirmToken: 'token', expiresAt: '2026-09-06T12:00:00Z', summary: { path: 'src', kind: 'directory', entryCount: 2 } } },
    })).toBe(true);
    expect(isDeleteConfirmResultFrame({
      t: 'resource_result', requestId: 'q1',
      result: { kind: 'delete_confirm', data: { confirmToken: 'token', expiresAt: 'x', summary: { path: 'src', kind: 'symlink' } } },
    })).toBe(false);
    expect(isActionResourceResult({ kind: 'fs_mutation', data: { primaryPath: 'src/new', affectedPaths: ['src'] } })).toBe(true);
    expect(isActionResourceResult({ kind: 'fs_mutation', data: { primaryPath: 'src/new', affectedPaths: 'src' } })).toBe(false);
  });
});
