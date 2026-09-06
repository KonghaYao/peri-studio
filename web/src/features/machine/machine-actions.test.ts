import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineActions, type MachineActionsDependencies, type MachineSendOptions } from './machine-actions';

function harness(overrides: Partial<MachineActionsDependencies> = {}) {
  let ready = true;
  let readOnly = false;
  let uncertain = false;
  const sent: Array<{ frame: Record<string, unknown>; label: string; options: MachineSendOptions }> = [];
  const deps: MachineActionsDependencies = {
    isReady: () => ready,
    isReadOnly: () => readOnly,
    hasUncertainMetadata: () => uncertain,
    send: (frame, label, options) => { sent.push({ frame, label, options }); return true; },
    toast: vi.fn(),
    persistProblem: vi.fn(),
    ...overrides,
  };
  return {
    actions: new MachineActions(deps),
    deps,
    sent,
    setReady: (value: boolean) => { ready = value; },
    setReadOnly: (value: boolean) => { readOnly = value; },
    setUncertain: (value: boolean) => { uncertain = value; },
  };
}

describe('MachineActions', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses one closed mutation gate for role, connection and prior uncertainty', () => {
    const h = harness();
    h.setReadOnly(true);
    expect(h.actions.connect('ssh_1')).toBe(false);
    expect(h.deps.toast).toHaveBeenLastCalledWith('Read-only mode cannot connect computers');

    h.setReadOnly(false); h.setReady(false);
    expect(h.actions.disconnect('ssh_1')).toBe(false);
    expect(h.deps.toast).toHaveBeenLastCalledWith('Connection not ready');

    h.setReady(true); h.setUncertain(true);
    expect(h.actions.retry('ssh_1')).toBe(false);
    expect(h.deps.toast).toHaveBeenLastCalledWith('Resolve pending "result not yet confirmed" project or session operations first');
    expect(h.sent).toHaveLength(0);
  });

  it('sends connect through the machine/connect action', () => {
    const h = harness();
    const onCommitted = vi.fn();
    expect(h.actions.connect('ssh_1', { onCommitted })).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.frame).toMatchObject({ type: 'machine/connect', payload: { instanceId: 'ssh_1' } });
    h.sent[0]?.options.cb?.({ status: 'committed', instanceId: 'ssh_1' });
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(h.deps.toast).not.toHaveBeenCalled();
  });

  it('renames computers through server metadata mutation', () => {
    const h = harness();
    const onCommitted = vi.fn();
    expect(h.actions.rename('ssh_1', '  Remote box  ', { onCommitted })).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.frame).toMatchObject({ type: 'machine/rename', payload: { instanceId: 'ssh_1', name: 'Remote box' } });
    h.sent[0]?.options.cb?.({ status: 'committed', instanceId: 'ssh_1' });
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(h.deps.toast).toHaveBeenCalledWith('Computer renamed');
  });

  it('retains exact command identity and recovery copy on uncertain mutation', () => {
    const h = harness();
    const onFailed = vi.fn();
    h.actions.trustHost('ssh_1', 'SHA256:abc', { onFailed });
    const request = h.sent[0];
    expect(request.frame).toMatchObject({
      type: 'machine/trust-host',
      payload: { instanceId: 'ssh_1', fingerprint: 'SHA256:abc' },
    });
    request.options.onTimeout?.();
    expect(h.deps.persistProblem).toHaveBeenCalledWith(
      'Trust host result not yet confirmed',
      expect.stringContaining('machines list'),
      request.frame.commandId,
    );
    expect(onFailed).toHaveBeenCalledOnce();
  });

  it('rejects empty rename and trust fingerprints before sending', () => {
    const h = harness();
    expect(h.actions.rename('ssh_1', '   ')).toBe(false);
    expect(h.actions.trustHost('ssh_1', '   ')).toBe(false);
    expect(h.sent).toHaveLength(0);
  });
});
