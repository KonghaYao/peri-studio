import { describe, expect, it } from 'vitest';
import { listArchivedEntries, searchArchivedEntries } from './archived-search';
import type { ProjectInfo, ProjectSessionInfo } from '@/entities/registry/registry-view';

const activeProject: ProjectInfo = {
  id: 'p-active',
  name: 'Active',
  cwd: '/active',
  instanceId: 'local',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  archivedAt: null,
};

const archivedProject: ProjectInfo = {
  id: 'p-archived',
  name: 'Old workspace',
  cwd: '/old',
  instanceId: 'local',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-10T00:00:00Z',
  archivedAt: '2026-08-12T00:00:00Z',
};

const archivedSession: ProjectSessionInfo = {
  id: 'acp-archived',
  projectId: 'p-active',
  title: 'Spike notes',
  lifecycle: 'ready',
  updatedAt: '2026-08-11T00:00:00Z',
  lastOpenedAt: null,
  activeChatId: null,
  archivedAt: '2026-08-13T00:00:00Z',
};

describe('archived-search', () => {
  it('lists archived projects and sessions together', () => {
    const entries = listArchivedEntries(
      [activeProject, archivedProject],
      [archivedSession],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(['session', 'project']);
    expect(entries[0]?.title).toBe('Spike notes');
    expect(entries[1]?.title).toBe('Old workspace');
  });

  it('filters archived entries by query', () => {
    const entries = searchArchivedEntries(
      'spike',
      [activeProject, archivedProject],
      [archivedSession],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('session');
  });

  it('filters archived entries by project', () => {
    const entries = searchArchivedEntries(
      '',
      [activeProject, archivedProject],
      [archivedSession],
      { projectId: 'p-active' },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('session');
  });
});
