import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { RegistryProjection } from './registry-projection';

function registryDoc(): Y.Doc {
  const doc = new Y.Doc();
  const root = doc.getMap<unknown>('root');
  for (const section of ['instances', 'chats', 'sessions', 'workspaces', 'projects', 'project_sessions']) {
    root.set(section, new Y.Map<unknown>());
  }
  const instance = new Y.Map<unknown>();
  instance.set('hostname', 'local');
  instance.set('status', 'online');
  instance.set('last_heartbeat', '2026-08-24T00:00:00Z');
  (root.get('instances') as Y.Map<unknown>).set('local', instance);
  const project = new Y.Map<unknown>();
  project.set('name', 'Peri');
  project.set('cwd', '/workspace/peri');
  project.set('instance_id', 'local');
  project.set('updated_at', '2026-08-24T00:00:00Z');
  (root.get('projects') as Y.Map<unknown>).set('project-1', project);
  const session = new Y.Map<unknown>();
  session.set('project_id', 'project-1');
  session.set('title', 'Stable draft');
  session.set('lifecycle', 'ready');
  session.set('updated_at', '2026-08-24T00:00:00Z');
  (root.get('project_sessions') as Y.Map<unknown>).set('session-1', session);
  return doc;
}

describe('RegistryProjection', () => {
  it('keeps project and session identities stable across heartbeat-only updates', () => {
    const doc = registryDoc();
    const projection = new RegistryProjection();
    const initial = projection.project(doc);

    const root = doc.getMap<unknown>('root');
    const instance = (root.get('instances') as Y.Map<unknown>).get('local') as Y.Map<unknown>;
    instance.set('last_heartbeat', '2026-08-24T00:00:10Z');
    const updated = projection.project(doc);

    expect(updated.instances).not.toBe(initial.instances);
    expect(updated.instances[0]).not.toBe(initial.instances[0]);
    expect(updated.projects).toBe(initial.projects);
    expect(updated.projects[0]).toBe(initial.projects[0]);
    expect(updated.projectSessions).toBe(initial.projectSessions);
    expect(updated.projectSessions[0]).toBe(initial.projectSessions[0]);
    projection.dispose();
  });

  it('replaces only the project whose projected fields changed', () => {
    const doc = registryDoc();
    const projection = new RegistryProjection();
    const initial = projection.project(doc);
    const project = (doc.getMap<unknown>('root').get('projects') as Y.Map<unknown>).get('project-1') as Y.Map<unknown>;

    project.set('name', 'Peri Studio');
    const updated = projection.project(doc);

    expect(updated.projects).not.toBe(initial.projects);
    expect(updated.projects[0]).not.toBe(initial.projects[0]);
    expect(updated.projects[0]?.name).toBe('Peri Studio');
    expect(updated.projectSessions).toBe(initial.projectSessions);
    projection.dispose();
  });

  it('keeps sidebar session order when registry resort only changes updatedAt', () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>('root');
    for (const section of ['instances', 'chats', 'sessions', 'workspaces', 'projects', 'project_sessions']) {
      root.set(section, new Y.Map<unknown>());
    }
    const project = new Y.Map<unknown>();
    project.set('name', 'Peri');
    project.set('cwd', '/workspace/peri');
    project.set('instance_id', 'local');
    project.set('updated_at', '2026-08-24T00:00:00Z');
    (root.get('projects') as Y.Map<unknown>).set('project-1', project);
    const sessions = root.get('project_sessions') as Y.Map<unknown>;
    const first = new Y.Map<unknown>();
    first.set('project_id', 'project-1');
    first.set('title', 'First');
    first.set('lifecycle', 'ready');
    first.set('updated_at', '2026-08-24T00:00:00Z');
    const second = new Y.Map<unknown>();
    second.set('project_id', 'project-1');
    second.set('title', 'Second');
    second.set('lifecycle', 'ready');
    second.set('updated_at', '2026-08-23T00:00:00Z');
    sessions.set('session-a', first);
    sessions.set('session-b', second);

    const projection = new RegistryProjection();
    const initial = projection.project(doc);
    expect(initial.projectSessions.map((session) => session.id)).toEqual(['session-a', 'session-b']);

    second.set('updated_at', '2026-08-25T00:00:00Z');
    const updated = projection.project(doc);

    expect(updated.projectSessions.map((session) => session.id)).toEqual(['session-a', 'session-b']);
    projection.dispose();
  });
});
