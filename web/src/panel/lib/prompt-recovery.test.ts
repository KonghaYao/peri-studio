import { describe, expect, it } from 'vitest';
import {
  beginPromptRecovery,
  completePromptRecovery,
  failPromptRecovery,
  PromptRecoveryQueryGate,
  promptRecoveryDiagnostic,
  type PromptRecoveryView,
} from './prompt-recovery';

const evidence = (overrides: Partial<PromptRecoveryView> = {}): PromptRecoveryView => ({
  sessionId: 'session-a', loading: false, refreshing: false, checkedAt: '2026-08-14T00:00:00.000Z', truncated: true,
  evidenceIncomplete: false, error: null,
  prompts: [{ commandId: 'command-a', turnId: 'turn-a', status: 'delivery_unknown', createdAt: 'created', updatedAt: 'updated', errorCode: 'DELIVERY_UNKNOWN' }],
  ...overrides,
});

describe('PromptRecoveryQueryGate', () => {
  it('accepts only the current exact command and session while classifying old reads as stale', () => {
    const gate = new PromptRecoveryQueryGate(60_000);
    gate.begin('query-a', 'session-a', 0);
    gate.begin('query-b', 'session-a', 1);
    expect(gate.classify('query-a', 'session-a', 2)).toBe('stale');
    expect(gate.classify('query-b', 'session-a', 2)).toBe('current');
    expect(gate.classify('query-b', 'session-b', 2)).toBeNull();
    expect(gate.classify('mutation-command', undefined, 2)).toBeNull();
  });

  it('retains a timed-out read identity until tracker expiry without keeping it current', () => {
    const gate = new PromptRecoveryQueryGate(60_000);
    gate.begin('query-a', 'session-a', 0);
    gate.timeout('query-a');
    expect(gate.classify('query-a', undefined, 59_999)).toBe('stale');
    expect(gate.classify('query-a', undefined, 60_000)).toBeNull();
  });
});

describe('prompt recovery view model', () => {
  it('preserves successful evidence while a refresh fails', () => {
    const refreshing = beginPromptRecovery(evidence(), 'session-a');
    expect(refreshing).toMatchObject({ refreshing: true, loading: false, checkedAt: '2026-08-14T00:00:00.000Z', truncated: true });
    expect(failPromptRecovery(refreshing, 'session-a', 'Query failed')).toMatchObject({ refreshing: false, checkedAt: '2026-08-14T00:00:00.000Z', error: 'Query failed', prompts: evidence().prompts });
  });

  it('never carries evidence or checked time into another session', () => {
    expect(beginPromptRecovery(evidence(), 'session-b')).toEqual({
      sessionId: 'session-b', loading: true, refreshing: false, checkedAt: null, truncated: false, evidenceIncomplete: false, error: null, prompts: [],
    });
  });

  it('advances checkedAt only for a successful response', () => {
    expect(completePromptRecovery({ sessionId: 'session-a', truncated: false, evidenceIncomplete: false, prompts: [] }, 'checked-now').checkedAt).toBe('checked-now');
  });

  it('maps every status conservatively and emits body-free diagnostics', () => {
    const diagnostic = promptRecoveryDiagnostic(evidence());
    expect(diagnostic).toContain('command-a');
    expect(diagnostic).not.toMatch(/message|prompt body|token|cookie/i);
  });
});
