import { describe, expect, it } from 'vitest';
import {
  composerBranchLabel,
  composerMachineLabel,
  composerUsageMeterProps,
} from './composer-meta';

describe('composer-meta', () => {
  it('resolves branch labels from the primary repository', () => {
    expect(composerBranchLabel([])).toBeNull();
    expect(composerBranchLabel([{ id: 'repo-1', root: '', name: 'peri', groups: {}, headName: 'main' }])).toBe('main');
    expect(composerBranchLabel([{ id: 'repo-1', root: '', name: 'peri', groups: {}, detached: true }])).toBe('detached HEAD');
  });

  it('resolves machine labels from project instance binding', () => {
    expect(composerMachineLabel(null, [], [])).toBeNull();
    expect(composerMachineLabel(
      { instanceId: 'local' },
      [{ id: 'local', hostname: 'Local instance', status: 'online', tokenId: null, registeredAt: null, lastHeartbeat: null, chatCount: 0 }],
      [{ instanceId: 'local', kind: 'local', displayName: 'This computer', sshDestination: null, sshPort: null, phase: 'online', errorCode: null, hasIdentityFile: false, autoReconnect: false, hostKeySha256: null, updatedAt: null, archivedAt: null }],
    )).toBe('This computer');
  });

  it('prefers token stats usage and falls back to context window totals', () => {
    expect(composerUsageMeterProps(null)).toBeNull();
    expect(composerUsageMeterProps({
      instanceId: 'local',
      sessionId: 'acp-1',
      status: 'ready',
      lastActivityAt: null,
      availableCommands: [],
      commandCatalog: [],
      extensions: ['peri.tokenStats'],
      activities: [],
      inputPrediction: null,
      latestUsage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: null,
        cacheReadTokens: 25,
        requestId: null,
        model: null,
        stopReason: null,
      },
      model: 'nova',
      effort: null,
      contextWindow: 200_000,
      contextUsed: 42_000,
    })).toEqual({
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 25 },
      contextWindow: 200_000,
    });
    expect(composerUsageMeterProps({
      instanceId: 'local',
      sessionId: 'acp-1',
      status: 'ready',
      lastActivityAt: null,
      availableCommands: [],
      commandCatalog: [],
      extensions: [],
      activities: [],
      inputPrediction: null,
      latestUsage: null,
      model: 'nova',
      effort: null,
      contextWindow: 200_000,
      contextUsed: 42_000,
    })).toEqual({
      input: 42_000,
      output: 0,
      cached: 0,
      limit: 200_000,
    });
  });
});
