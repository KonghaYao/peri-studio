import { describe, expect, it } from 'vitest';
import { collectNonTerminalSshRuntimes, shouldPromptBeforeQuit } from './shutdown-prompt';

describe('shutdown-prompt', () => {
  const machines = [{
    instanceId: 'ssh_gpu',
    kind: 'ssh',
    displayName: 'GPU box',
    sshDestination: 'user@gpu',
    sshPort: null,
    phase: 'online',
    errorCode: null,
    hasIdentityFile: false,
    autoReconnect: true,
    hostKeySha256: null,
    updatedAt: null,
    archivedAt: null,
  }];

  it('detects non-terminal ssh runtimes from chat catalog and session projections', () => {
    const summary = collectNonTerminalSshRuntimes({
      machines,
      instances: [{ id: 'ssh_gpu', hostname: 'gpu', status: 'online', tokenId: null, registeredAt: null, lastHeartbeat: null, chatCount: 1 }],
      chatCatalog: [{ id: 'chat-1', instanceId: 'ssh_gpu', title: 'Run', status: 'running', updatedAt: null, cwd: null, workspaceId: null, gap: null }],
      chatStatuses: { 'chat-1': 'running' },
      projects: [{ id: 'p1', name: 'Remote', cwd: '/repo', instanceId: 'ssh_gpu', createdAt: null, updatedAt: null, archivedAt: null }],
      projectSessions: [],
    });
    expect(summary.instanceIds).toEqual(['ssh_gpu']);
    expect(summary.displayNames).toEqual(['GPU box']);
    expect(shouldPromptBeforeQuit({
      machines,
      instances: [],
      chatCatalog: [{ id: 'chat-1', instanceId: 'ssh_gpu', title: 'Run', status: 'running', updatedAt: null, cwd: null, workspaceId: null, gap: null }],
      chatStatuses: { 'chat-1': 'running' },
      projects: [],
      projectSessions: [],
    })).toBe(true);
  });

  it('does not prompt when ssh chats are terminal', () => {
    expect(shouldPromptBeforeQuit({
      machines,
      instances: [],
      chatCatalog: [{ id: 'chat-1', instanceId: 'ssh_gpu', title: 'Run', status: 'ended', updatedAt: null, cwd: null, workspaceId: null, gap: null }],
      chatStatuses: { 'chat-1': 'ended' },
      projects: [],
      projectSessions: [],
    })).toBe(false);
  });
});
