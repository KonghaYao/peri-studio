import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogActions, type CatalogActionsDependencies, type CatalogSendOptions } from './catalog-actions';

function harness(overrides: Partial<CatalogActionsDependencies> = {}) {
  let ready = true;
  let readOnly = false;
  let uncertain = false;
  let discovering: string | null = null;
  const sent: Array<{ frame: Record<string, unknown>; label: string; options: CatalogSendOptions }> = [];
  const setSessionArchivedPreference = vi.fn();
  const setSessionCustomNamePreference = vi.fn();
  const onSessionPreferencesChanged = vi.fn();
  const deps: CatalogActionsDependencies = {
    isReady: () => ready,
    isReadOnly: () => readOnly,
    hasUncertainMetadata: () => uncertain,
    send: (frame, label, options) => { sent.push({ frame, label, options }); return true; },
    toast: vi.fn(),
    persistProblem: vi.fn(),
    onProjectArchived: vi.fn(),
    onSessionArchived: vi.fn(),
    discoveringProjectId: () => discovering,
    setDiscoveringProjectId: (value) => { discovering = value; },
    principalId: () => 'principal-1',
    resolveSessionKey: (sessionId) => sessionId === 's1'
      ? { principalId: 'principal-1', projectId: 'p1', acpSessionId: 's1' }
      : null,
    setSessionArchivedPreference,
    setSessionCustomNamePreference,
    onSessionPreferencesChanged,
    ...overrides,
  };
  return {
    actions: new CatalogActions(deps), deps, sent,
    setReady: (value: boolean) => { ready = value; },
    setReadOnly: (value: boolean) => { readOnly = value; },
    setUncertain: (value: boolean) => { uncertain = value; },
    discovering: () => discovering,
    setSessionArchivedPreference,
    setSessionCustomNamePreference,
    onSessionPreferencesChanged,
  };
}

describe('CatalogActions', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses one closed mutation gate for role, connection and prior uncertainty', () => {
    const h = harness();
    h.setReadOnly(true);
    expect(h.actions.archiveProject('p1')).toBe(false);
    expect(h.deps.toast).toHaveBeenLastCalledWith('Read-only mode cannot archive projects');

    h.setReadOnly(false); h.setReady(false);
    expect(h.actions.renameProject('p1', 'Name')).toBe(false);
    expect(h.deps.toast).toHaveBeenLastCalledWith('Connection not ready');

    h.setReady(true); h.setUncertain(true);
    expect(h.actions.restoreProject('p1')).toBe(false);
    expect(h.deps.toast).toHaveBeenLastCalledWith('Resolve pending "result not yet confirmed" project or session operations first');
    expect(h.sent).toHaveLength(0);
  });

  it('stores session archive locally without server mutation', () => {
    const h = harness();
    const onCommitted = vi.fn();
    expect(h.actions.setSessionArchived('s1', true, { onCommitted })).toBe(true);
    expect(h.sent).toHaveLength(0);
    expect(h.setSessionArchivedPreference).toHaveBeenCalledWith(
      { principalId: 'principal-1', projectId: 'p1', acpSessionId: 's1' },
      true,
    );
    expect(h.deps.onSessionArchived).toHaveBeenCalledWith('s1');
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(h.deps.toast).toHaveBeenCalledWith('Session archived');
    expect(h.onSessionPreferencesChanged).toHaveBeenCalledOnce();
  });

  it('stores session rename locally without server mutation', () => {
    const h = harness();
    expect(h.actions.renameSession('s1', '  New name  ')).toBe(true);
    expect(h.sent).toHaveLength(0);
    expect(h.setSessionCustomNamePreference).toHaveBeenCalledWith(
      { principalId: 'principal-1', projectId: 'p1', acpSessionId: 's1' },
      'New name',
    );
    expect(h.deps.toast).toHaveBeenCalledWith('Session renamed');
    expect(h.onSessionPreferencesChanged).toHaveBeenCalledOnce();
  });

  it('retains exact command identity and recovery copy on uncertain mutation', () => {
    const h = harness();
    const onFailed = vi.fn();
    h.actions.renameProject('p1', '  New name  ', { onFailed });
    const request = h.sent[0];
    expect(request.frame).toMatchObject({ type: 'project/rename', payload: { projectId: 'p1', name: 'New name' } });
    request.options.onTimeout?.();
    expect(h.deps.persistProblem).toHaveBeenCalledWith(
      'Project rename result not yet confirmed',
      expect.stringContaining('input is preserved'),
      request.frame.commandId,
    );
    expect(onFailed).toHaveBeenCalledOnce();
  });

  it('keeps discovery read-only, single-flight and safely retryable after timeout', () => {
    const h = harness();
    const failed = vi.fn();
    expect(h.actions.discoverSessions('p1', undefined, failed)).toBe(true);
    expect(h.discovering()).toBe('p1');
    expect(h.actions.discoverSessions('p2', undefined, failed)).toBe(false);
    expect(failed).toHaveBeenLastCalledWith('Another project is refreshing ACP sessions.');

    h.sent[0].options.onTimeout?.();
    expect(h.discovering()).toBeNull();
    expect(failed).toHaveBeenLastCalledWith(expect.stringContaining('safe to retry'));
    expect(h.sent[0].options.retryOnUncertain).toBeUndefined();
  });

  it('requires a durable session identity before closing import UI', () => {
    const h = harness();
    const onCommitted = vi.fn();
    const onFailed = vi.fn();
    h.actions.importSession('p1', 'acp-1', onCommitted, onFailed);
    const request = h.sent[0];
    request.options.cb?.({ status: 'committed' });
    expect(onCommitted).not.toHaveBeenCalled();
    request.options.cb?.({ status: 'duplicate', sessionId: 'acp-1' });
    expect(onCommitted).toHaveBeenCalledOnce();

    request.options.onTimeout?.();
    expect(onFailed).toHaveBeenCalledWith('uncertain');
    expect(h.deps.persistProblem).toHaveBeenCalledWith(
      'Import result not yet confirmed',
      expect.stringContaining('original request'),
      request.frame.commandId,
    );
  });
});
