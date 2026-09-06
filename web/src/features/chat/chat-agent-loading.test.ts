import { describe, expect, it } from 'vitest';
import { chatAgentLoading } from './chat-agent-loading';

describe('chatAgentLoading', () => {
  it('returns false when session loading is false', () => {
    expect(chatAgentLoading(false, { turnStatus: 'running' })).toBe(false);
  });

  it('returns false when turn is terminal even if loading flag is stale', () => {
    expect(chatAgentLoading(true, { turnStatus: 'cancelled' })).toBe(false);
    expect(chatAgentLoading(true, { turnStatus: 'cancelling' })).toBe(true);
  });

  it('returns true only for active turn with loading', () => {
    expect(chatAgentLoading(true, { turnStatus: 'running' })).toBe(true);
  });
});
