import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPrincipalRole, principalRole } from './lib/auth-state';
import { promptRecovery, setPromptRecovery } from './lib/prompt-recovery-assembly';
import { busy, connState, connectionProblem, heartbeatCount, setBusy, setConnState, setConnectionProblem, setHeartbeatCount } from './lib/connection';
import {
  chatEntries,
  chatHead,
  chatStatusSignal,
  resetAuthenticatedSession,
  creatingSessionProjectId,
  discoveringSessionsProjectId,
  importableSessions,
  openingSession,
  permissions,
  persistentErrors,
  projects,
  projectSessions,
  restoringSessionId,
  runtimeDocsState,
  selectedCid,
  selectedSessionId,
  setChatEntries,
  setChatHead,
  setChatStatusSignal,
  setCreatingSessionProjectId,
  setDiscoveringSessionsProjectId,
  setImportableSessions,
  setOpeningSession,
  setPermissions,
  setPersistentErrors,
  setProjects,
  setProjectSessions,
  setRestoringSessionId,
  setRuntimeDocsState,
  setSelectedCid,
  setSelectedSessionId,
  toast,
  toasts,
} from './store';

afterEach(() => {
  resetAuthenticatedSession();
  vi.useRealTimers();
});

describe('authenticated UI session reset', () => {
  it('atomically revokes authority and removes every server-derived surface', () => {
    vi.useFakeTimers();
    installPrincipalRole('full');
    setBusy(true);
    setConnState({ text: 'Connected', kind: 'ok' });
    setHeartbeatCount(7);
    setSelectedCid('private-chat');
    setSelectedSessionId('private-session');
    setChatEntries([{ id: 'private-entry' } as never]);
    setChatHead({ activeTurn: { id: 'private-turn' } } as never);
    setPermissions([{ permissionId: 'private-permission' } as never]);
    setRuntimeDocsState({ chat: true, control: true });
    setChatStatusSignal({ 'private-chat': 'running' });
    setProjects([{ id: 'private-project' } as never]);
    setProjectSessions([{ id: 'private-session' } as never]);
    setImportableSessions([{ sessionId: 'private-acp-session' } as never]);
    setPromptRecovery({ sessionId: 'private-session', loading: false, refreshing: false, checkedAt: 'private-time', truncated: true, evidenceIncomplete: true, error: 'private error', prompts: [] });
    setOpeningSession({ commandId: 'private-command', sessionId: 'private-session', previousSessionId: null, previousChatId: null });
    setRestoringSessionId('private-session');
    setCreatingSessionProjectId('private-project');
    setDiscoveringSessionsProjectId('private-project');
    setPersistentErrors([{ id: 1, title: 'private problem', detail: 'secret detail', commandId: null, retryable: false, retrying: false }]);
    setConnectionProblem({ code: 4502, title: 'private connection failure', detail: 'secret detail', action: 'login' });
    toast('private transient feedback');

    resetAuthenticatedSession();

    expect(principalRole()).toBeNull();
    expect(busy()).toBe(false);
    expect(connState()).toEqual({ text: 'Disconnected', kind: 'idle' });
    expect(heartbeatCount()).toBe(0);
    expect(selectedCid()).toBeNull();
    expect(selectedSessionId()).toBeNull();
    expect(chatEntries()).toEqual([]);
    expect(chatHead()).toBeNull();
    expect(permissions()).toEqual([]);
    expect(runtimeDocsState()).toEqual({ chat: false, control: false });
    expect(chatStatusSignal()).toEqual({});
    expect(projects()).toEqual([]);
    expect(projectSessions()).toEqual([]);
    expect(importableSessions()).toEqual([]);
    expect(promptRecovery()).toBeNull();
    expect(openingSession()).toBeNull();
    expect(restoringSessionId()).toBeNull();
    expect(creatingSessionProjectId()).toBeNull();
    expect(discoveringSessionsProjectId()).toBeNull();
    expect(persistentErrors()).toEqual([]);
    expect(connectionProblem()).toBeNull();
    expect(toasts()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is idempotent across producer and AuthGate consumer cleanup', () => {
    vi.useFakeTimers();
    toast('old feedback');

    resetAuthenticatedSession();
    resetAuthenticatedSession();
    toast('new feedback');
    vi.advanceTimersByTime(2499);

    expect(toasts().map((item) => item.msg)).toEqual(['new feedback']);
    vi.advanceTimersByTime(1);
    expect(toasts()).toEqual([]);
  });
});
