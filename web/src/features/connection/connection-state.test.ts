import { describe, expect, it } from 'vitest';
import { connectionTransition } from './connection-state.ts';

describe('connectionTransition', () => {
  it('keeps actions closed until the authoritative ready event', () => {
    expect(connectionTransition('connecting')).toMatchObject({ ready: false, busy: true });
    expect(connectionTransition('open')).toMatchObject({ ready: false, busy: true });
    expect(connectionTransition('ready')).toEqual({
      ready: true,
      busy: false,
      status: { text: 'Ready', kind: 'ok' },
      problem: null,
    });
  });

  it('closes readiness throughout automatic reconnection', () => {
    expect(connectionTransition('reconnecting', { retryMs: 1499 })).toEqual({
      ready: false,
      busy: true,
      status: { text: 'Reconnecting (in 1s)', kind: 'warn' },
      problem: null,
    });
  });

  it('settles permanent and manual closure into one actionable truth', () => {
    expect(connectionTransition('fatal', { code: 4500 })).toMatchObject({
      ready: false,
      busy: false,
      problem: { action: 'reconnect', title: 'Local Agent instance went offline' },
    });
    expect(connectionTransition('closed', {}, true)).toMatchObject({
      ready: false,
      busy: false,
      problem: { action: 'reconnect' },
    });
    expect(connectionTransition('closed', {}, false)?.problem).toBeNull();
  });

  it('does not overwrite presentation on heartbeat or unknown future events', () => {
    expect(connectionTransition('heartbeat')).toBeNull();
    expect(connectionTransition('future')).toBeNull();
  });
});
