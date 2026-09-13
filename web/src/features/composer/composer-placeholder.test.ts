import { describe, expect, it } from 'vitest';
import { composerInputState, isOpeningSelectedSession, type ComposerPlaceholderInput } from './composer-placeholder';

function base(overrides: Partial<ComposerPlaceholderInput> = {}): ComposerPlaceholderInput {
  return {
    readOnly: false,
    openingSessionId: null,
    selectedSessionId: 'session-1',
    selectedCid: 'chat-1',
    runtimeDocsHydrated: true,
    promptDeliveryReady: true,
    terminal: false,
    turnActive: false,
    submissionForSession: false,
    ...overrides,
  };
}

describe('isOpeningSelectedSession', () => {
  it('treats a launch-time open as current when nothing is selected yet', () => {
    expect(isOpeningSelectedSession('session-1', null)).toBe(true);
    expect(isOpeningSelectedSession(null, null)).toBe(false);
  });

  it('only matches the session that is actually opening', () => {
    expect(isOpeningSelectedSession('session-1', 'session-1')).toBe(true);
    expect(isOpeningSelectedSession('session-2', 'session-1')).toBe(false);
  });
});

describe('composerInputState', () => {
  it('is disabled and explains missing selection before any chat exists', () => {
    const state = composerInputState(base({ selectedCid: null }));
    expect(state.disabled).toBe(true);
    expect(state.placeholder).toBe('Select or create a session from the left first');
  });

  it('keeps the read-only input quiet because the sidebar already exposes that mode', () => {
    const state = composerInputState(base({ readOnly: true, selectedCid: null }));
    expect(state.placeholder).toBe('');
  });

  it('keeps priority order: opening beats missing selection', () => {
    const state = composerInputState(base({ selectedCid: null, selectedSessionId: null, openingSessionId: 'session-1' }));
    expect(state.placeholder).toBe('Opening session…');
  });

  it('does not lock the selected live session while another session is opening', () => {
    const state = composerInputState(base({ openingSessionId: 'other-session' }));
    expect(state.disabled).toBe(false);
    expect(state.placeholder).toBe('Message the agent, or type / for commands');
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

  it('lets the user type while a turn is active and only locks send', () => {
    const state = composerInputState(base({ turnActive: true }));
    expect(state.disabled).toBe(false);
    expect(state.sendLocked).toBe(true);
    expect(state.placeholder).toBe('');
  });

  it('locks edit during current-session confirmation without extra placeholder copy', () => {
    const state = composerInputState(base({ submissionForSession: true }));
    expect(state.disabled).toBe(true);
    expect(state.sendLocked).toBe(true);
    expect(state.placeholder).toBe('');
  });

  it('does not block the selected session for another session confirmation', () => {
    const state = composerInputState(base());
    expect(state.disabled).toBe(false);
    expect(state.sendLocked).toBe(false);
    expect(state.placeholder).toBe('Message the agent, or type / for commands');
  });

  it('is enabled with the default placeholder when everything is ready', () => {
    const state = composerInputState(base());
    expect(state.disabled).toBe(false);
    expect(state.sendLocked).toBe(false);
    expect(state.placeholder).toBe('Message the agent, or type / for commands');
  });
});
