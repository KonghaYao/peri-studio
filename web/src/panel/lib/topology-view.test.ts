import { describe, expect, it } from 'vitest';
import { buildTopologyTree, chatStatusLabel, instanceStatusLabel, serverStatusLabel } from './topology-view';

const instance = (id: string, status = 'online') => ({
  id,
  hostname: `host-${id}`,
  status,
  tokenId: `token-${id}`,
  registeredAt: '2026-08-16T00:00:00Z',
  lastHeartbeat: '2026-08-16T00:00:10Z',
  chatCount: 0,
});

const chat = (id: string, instanceId: string, status = 'active') => ({
  id,
  instanceId,
  title: `chat-${id}`,
  status,
  gap: null,
  updatedAt: '2026-08-16T00:00:00Z',
  cwd: null,
  workspaceId: null,
});

describe('buildTopologyTree', () => {
  it('groups chats under their owning instance and drops orphans', () => {
    const tree = buildTopologyTree(
      [instance('i1'), instance('i2')],
      [chat('c1', 'i1'), chat('c2', 'i2'), chat('c3', 'i1'), chat('orphan', 'gone')],
    );
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe('i1');
    expect(tree[0].chats.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(tree[1].id).toBe('i2');
    expect(tree[1].chats.map((c) => c.id)).toEqual(['c2']);
  });

  it('sorts instances and chats by id', () => {
    const tree = buildTopologyTree(
      [instance('z'), instance('a')],
      [chat('z1', 'a'), chat('a1', 'a')],
    );
    expect(tree.map((n) => n.id)).toEqual(['a', 'z']);
    expect(tree[0].chats.map((c) => c.id)).toEqual(['a1', 'z1']);
  });

  it('keeps instance nodes without chats', () => {
    const tree = buildTopologyTree([instance('lonely')], [chat('c1', 'other')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].chats).toEqual([]);
  });

  it('omits projection gaps from the operator topology', () => {
    const tree = buildTopologyTree(
      [instance('local')],
      [chat('live', 'local', 'accepting'), chat('stale', 'local', 'gap')],
    );
    expect(tree[0].chats.map((item) => item.id)).toEqual(['live']);
  });
});

describe('status labels', () => {
  it('maps instance statuses to labels', () => {
    expect(instanceStatusLabel('online')).toBe('Online');
    expect(instanceStatusLabel('offline')).toBe('Offline');
    expect(instanceStatusLabel('unknown')).toBe('Unknown');
    expect(instanceStatusLabel(null)).toBe('Unknown');
  });

  it('maps chat statuses to labels', () => {
    expect(chatStatusLabel('accepting')).toBe('Accepting');
    expect(chatStatusLabel('active')).toBe('Running');
    expect(chatStatusLabel('ended')).toBe('Ended');
    expect(chatStatusLabel('closed')).toBe('Closed');
    expect(chatStatusLabel('crashed')).toBe('Crashed');
    expect(chatStatusLabel(null)).toBe('Unknown');
  });

  it('maps server statuses to labels', () => {
    expect(serverStatusLabel('healthy')).toBe('Healthy');
    expect(serverStatusLabel('degraded')).toBe('Degraded');
    expect(serverStatusLabel('restarting')).toBe('Restarting');
    expect(serverStatusLabel(null)).toBe('Unknown');
  });
});
