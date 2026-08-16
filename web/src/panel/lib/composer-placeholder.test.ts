import { describe, expect, it } from 'vitest';
import { composerInputState, type ComposerPlaceholderInput } from './composer-placeholder';

function base(overrides: Partial<ComposerPlaceholderInput> = {}): ComposerPlaceholderInput {
  return {
    readOnly: false,
    openingSessionId: null,
    selectedCid: 'chat-1',
    runtimeDocsHydrated: true,
    promptDeliveryReady: true,
    terminal: false,
    turnActive: false,
    hasSubmission: false,
    submissionForSession: false,
    submissionInAnotherSession: false,
    ...overrides,
  };
}

describe('composerInputState', () => {
  it('is disabled and explains missing selection before any chat exists', () => {
    const state = composerInputState(base({ selectedCid: null }));
    expect(state.disabled).toBe(true);
    expect(state.placeholder).toBe('Select or create a session from the left first');
  });

  it('defers to the read-only mode over every other state', () => {
    const state = composerInputState(base({ readOnly: true, selectedCid: null }));
    expect(state.placeholder).toBe('Read-only mode');
  });

  it('keeps priority order: opening beats missing selection', () => {
    const state = composerInputState(base({ selectedCid: null, openingSessionId: 'session-1' }));
    expect(state.placeholder).toBe('Opening session…');
  });

  it('waits for both runtime documents before accepting input', () => {
    const state = composerInputState(base({ runtimeDocsHydrated: false }));
    expect(state.disabled).toBe(true);
    expect(state.placeholder).toBe('Loading session…');
  });

  it('requires the negotiated upgrade gate before sending', () => {
    const state = composerInputState(base({ promptDeliveryReady: false }));
    expect(state.disabled).toBe(true);
    expect(state.placeholder).toBe('Server upgrade required to send messages safely');
  });

  it('marks a terminal conversation as read-only history', () => {
    const state = composerInputState(base({ terminal: true }));
    expect(state.disabled).toBe(true);
    expect(state.placeholder).toBe('Conversation ended (history is read-only)');
  });

  it('keeps the input open for a running turn while offering stop', () => {
    const state = composerInputState(base({ turnActive: true }));
    expect(state.disabled).toBe(true);
    expect(state.placeholder).toBe('Agent is working; stop it anytime');
  });

  it('explains the current-session confirmation lock', () => {
    const state = composerInputState(base({ hasSubmission: true, submissionForSession: true }));
    expect(state.disabled).toBe(true);
    expect(state.placeholder).toBe('Confirming the current message…');
  });

  it('distinguishes another session confirmation without leaking its draft', () => {
    const state = composerInputState(base({ hasSubmission: true, submissionInAnotherSession: true }));
    expect(state.disabled).toBe(true);
    expect(state.placeholder).toBe('Still confirming a message in another session…');
  });

  it('is enabled with the default placeholder when everything is ready', () => {
    const state = composerInputState(base());
    expect(state.disabled).toBe(false);
    expect(state.placeholder).toBe('Message Agent');
  });
});
