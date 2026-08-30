import { describe, expect, it } from 'vitest';
import { isConversationEmpty } from './conversation-empty';

describe('isConversationEmpty', () => {
  const ready = {
    runtimeDocsHydrated: true,
    entryCount: 0,
    turnActive: false,
    hasSubmission: false,
    restoring: false,
    chatLoading: false,
  };

  it('is true only when the session is hydrated and idle with no transcript', () => {
    expect(isConversationEmpty(ready)).toBe(true);
    expect(isConversationEmpty({ ...ready, entryCount: 1 })).toBe(false);
    expect(isConversationEmpty({ ...ready, turnActive: true })).toBe(false);
    expect(isConversationEmpty({ ...ready, hasSubmission: true })).toBe(false);
    expect(isConversationEmpty({ ...ready, restoring: true })).toBe(false);
    expect(isConversationEmpty({ ...ready, chatLoading: true })).toBe(false);
    expect(isConversationEmpty({ ...ready, runtimeDocsHydrated: false })).toBe(false);
  });
});
