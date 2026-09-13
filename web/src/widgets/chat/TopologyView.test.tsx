import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatInfo, InstanceInfo } from '@/entities/registry/registry-view';
import {
  setChatCatalog,
  setGlobalStatus,
  setInstances,
  setSchemaVersion,
} from '@/store';
import { TopologyView } from './TopologyView';

function resetStore() {
  setInstances([]);
  setChatCatalog([]);
  setGlobalStatus('unknown');
  setSchemaVersion(null);
}

afterEach(resetStore);

const instance = (overrides: Partial<InstanceInfo> = {}): InstanceInfo => ({
  id: 'local',
  hostname: 'macbook.local',
  status: 'online',
  tokenId: 'token-instance-1',
  registeredAt: '2026-08-16T08:00:00Z',
  lastHeartbeat: '2026-08-16T08:10:00Z',
  chatCount: 2,
  ...overrides,
});

const chat = (overrides: Partial<ChatInfo> = {}): ChatInfo => ({
  id: 'chat-1',
  instanceId: 'local',
  title: 'Topology panel dev',
  status: 'active',
  gap: null,
  updatedAt: '2026-08-16T08:05:00Z',
  cwd: null,
  workspaceId: null,
  ...overrides,
});

describe('TopologyView', () => {
  it('renders the three-level topology: server → instance → chats', () => {
    setInstances([instance()]);
    setChatCatalog([chat(), chat({ id: 'chat-2', title: 'Old conversation', status: 'ended' })]);
    setGlobalStatus('healthy');
    setSchemaVersion(3);
    render(() => <TopologyView />);

    expect(screen.getByText('Peri Studio server')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('macbook.local')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Topology panel dev')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Old conversation')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
    // 不展示 token 本体，只展示脱敏标识
    expect(screen.queryByText('token-instance-1')).not.toBeInTheDocument();
    expect(screen.getByText(/token token-instance-1/)).toBeInTheDocument();
  });

  it('shows an offline badge for offline instances', () => {
    setInstances([instance({ status: 'offline' })]);
    render(() => <TopologyView />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('shows the server card and empty state when no instance is connected', () => {
    setGlobalStatus('healthy');
    setSchemaVersion(3);
    render(() => <TopologyView />);
    expect(screen.getByText('Peri Studio server')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('No instances')).toBeInTheDocument();
  });

  it('drops chats whose owning instance is not present', () => {
    setInstances([instance()]);
    setChatCatalog([chat({ instanceId: 'gone' })]);
    render(() => <TopologyView />);
    expect(screen.queryByText('Topology panel dev')).not.toBeInTheDocument();
  });
});
