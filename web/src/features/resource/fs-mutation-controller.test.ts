import { describe, expect, it, vi } from 'vitest';
import { FsMutationController, joinPath, parentPath, validateMutationName } from './fs-mutation-controller';
import type { DeleteConfirmResultFrame, FsMutationAction } from '@/shared/protocol/resource-fs-mutation';

function harness() {
  let generation = 4;
  let sequence = 0;
  const sent: Array<{ frame: FsMutationAction; callbacks: Record<string, (value?: unknown) => void> }> = [];
  const refreshDirectories = vi.fn();
  const refreshProject = vi.fn();
  const sendQuery = vi.fn(() => true);
  const controller = new FsMutationController({
    ready: () => true,
    canMutate: () => true,
    supportsStructuralMutations: () => true,
    generation: () => generation,
    newId: () => `id-${++sequence}`,
    sendAction: (frame, callbacks) => { sent.push({ frame, callbacks: callbacks as never }); return true; },
    sendQuery,
    refreshDirectories,
    refreshProject,
  });
  return { controller, sent, sendQuery, refreshDirectories, refreshProject, setGeneration: (value: number) => { generation = value; } };
}

describe('FsMutationController', () => {
  it('builds CAS actions and enforces one in-flight command per project', () => {
    const { controller, sent } = harness();
    expect(controller.move('p1', 'src/a.ts', 'lib/a.ts', 'rev-1')).toBe(true);
    expect(controller.delete('p1', 'src/b.ts', 'rev-2', false)).toBe(false);
    expect(sent[0].frame).toEqual({
      t: 'action', type: 'fs/move', commandId: 'id-1',
      payload: { projectId: 'p1', source: 'src/a.ts', target: 'lib/a.ts', sourceIfMatch: 'rev-1', targetIfNoneMatch: '*' },
    });
  });

  it('keeps DeliveryUnknown and retries the exact frame and commandId', () => {
    const { controller, sent } = harness();
    controller.delete('p1', 'src/a.ts', 'rev-1', false);
    sent[0].callbacks.onUncertain();
    expect(controller.state('p1').phase).toBe('uncertain');
    expect(controller.retry('p1')).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1].frame).toBe(sent[0].frame);
    expect(sent[1].frame.commandId).toBe('id-1');
  });

  it('refreshes affected parents on terminal ack and fences stale generations', () => {
    const { controller, sent, refreshDirectories, setGeneration } = harness();
    controller.move('p1', 'src/a.ts', 'lib/a.ts', 'rev-1');
    sent[0].callbacks.onTerminal({
      commandId: 'id-1', status: 'committed',
      resourceResult: { kind: 'fs_mutation', data: { primaryPath: 'lib/a.ts', affectedPaths: ['src', 'lib'] } },
    });
    expect(refreshDirectories).toHaveBeenCalledWith('p1', ['src', 'lib'], 4);
    expect(controller.state('p1').focusPath).toBe('lib/a.ts');

    controller.clear('p1');
    controller.createDirectory('p1', 'next');
    setGeneration(5);
    sent[1].callbacks.onTerminal({ commandId: 'id-2', status: 'committed' });
    expect(refreshDirectories).toHaveBeenCalledTimes(1);
  });

  it('drops stale-generation terminal callbacks and releases project single-flight', () => {
    const { controller, sent, setGeneration } = harness();
    controller.move('p1', 'src/a.ts', 'lib/a.ts', 'rev-1');
    setGeneration(5);
    sent[0].callbacks.onTerminal({ commandId: 'id-1', status: 'committed' });

    expect(controller.state('p1').phase).toBe('idle');
    expect(controller.createDirectory('p1', 'next')).toBe(true);
  });

  it('does not reconcile an uncertain command in a different generation', () => {
    const { controller, sent, setGeneration } = harness();
    controller.delete('p1', 'src/a.ts', 'rev-1', false);
    sent[0].callbacks.onUncertain();
    setGeneration(5);

    expect(controller.retry('p1')).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('keeps conflicts for manual refresh and full-refreshes ordinary failures', () => {
    const { controller, sent, refreshProject } = harness();
    controller.delete('p1', 'a', 'rev', false);
    sent[0].callbacks.onError({ commandId: 'id-1', code: 'VERSION_CONFLICT' });
    expect(controller.state('p1').phase).toBe('conflict');
    expect(refreshProject).not.toHaveBeenCalled();
    controller.clear('p1');
    controller.delete('p1', 'a', 'rev', false);
    sent[1].callbacks.onError({ commandId: 'id-2', code: 'UNAVAILABLE' });
    expect(refreshProject).toHaveBeenCalledWith('p1', 4);
  });

  it('requests a bound recursive-delete token then dispatches delete', () => {
    const { controller, sent, sendQuery } = harness();
    expect(controller.requestRecursiveDelete('p1', 'src', 'rev-1')).toBe(true);
    expect(sendQuery).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resource/open-delete-confirm', requestId: 'id-1', projectId: 'p1',
      payload: { path: 'src', ifMatch: 'rev-1', recursive: true, useTrash: false },
    }));
    const frame: DeleteConfirmResultFrame = {
      t: 'resource_result', requestId: 'id-1',
      result: { kind: 'delete_confirm', data: { confirmToken: 'token', expiresAt: '2026-09-06T00:00:00Z', summary: { path: 'src', kind: 'directory' } } },
    };
    expect(controller.handleResourceResult(frame)).toBe(true);
    expect(sent[0].frame).toMatchObject({
      type: 'fs/delete', commandId: 'id-2', payload: { confirmToken: 'token', recursive: true },
    });
  });
});

describe('filesystem mutation paths', () => {
  it('accepts only one basename segment', () => {
    expect(validateMutationName('notes.txt')).toBeNull();
    for (const value of ['', '.', '..', 'a/b', 'a\\b', ' padded ']) expect(validateMutationName(value)).not.toBeNull();
    expect(parentPath('src/web/a.ts')).toBe('src/web');
    expect(joinPath('src', 'a.ts')).toBe('src/a.ts');
  });
});
