import { describe, expect, it } from 'vitest';
import { instanceGroupName, reconcileInstanceGroups } from './instance-groups';

describe('instance-groups', () => {
  it('joins machine display names for sidebar groups', () => {
    const groups = reconcileInstanceGroups(
      [{ id: 'ssh_1', hostname: 'linux-box', status: 'online', tokenId: null, registeredAt: null, lastHeartbeat: null, chatCount: 0 }],
      [],
      [{
        instanceId: 'ssh_1',
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
      }],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe('GPU box');
  });

  it('seeds ssh-only groups before projects exist', () => {
    const groups = reconcileInstanceGroups(
      [],
      [],
      [{
        instanceId: 'ssh_new',
        kind: 'ssh',
        displayName: 'Build host',
        sshDestination: 'user@build',
        sshPort: 22,
        phase: 'offline',
        errorCode: null,
        hasIdentityFile: false,
        autoReconnect: true,
        hostKeySha256: null,
        updatedAt: null,
        archivedAt: null,
      }],
      [],
    );
    expect(groups.map((group) => group.id)).toEqual(['ssh_new']);
    expect(groups[0]?.offline).toBe(true);
    expect(groups[0]?.projects).toEqual([]);
  });

  it('falls back to hostname when machine row is missing', () => {
    expect(instanceGroupName('ssh_2', {
      id: 'ssh_2',
      hostname: 'remote-host',
      status: 'online',
      tokenId: null,
      registeredAt: null,
      lastHeartbeat: null,
      chatCount: 0,
    }, [])).toBe('remote-host');
  });
});
