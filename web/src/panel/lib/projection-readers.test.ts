import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { renderRegistry } from '@/entities/registry/registry-view';

describe('renderRegistry project session catalog', () => {
  it('normalizes ACP session id and preserves archive metadata from projection', () => {
    const doc = new Y.Doc();
    const sessions = new Y.Map<unknown>();
    const session = new Y.Map<unknown>();
    doc.getMap<unknown>('root').set('project_sessions', sessions);
    sessions.set('logical-1', session);
    session.set('project_id', 'project-1');
    session.set('acp_session_id', 'acp-1');
    session.set('title', 'Saved work');
    session.set('lifecycle', 'ready');
    session.set('archived_at', '2026-08-14T00:00:00Z');

    const [projectSession] = renderRegistry(doc).projectSessions;
    expect(projectSession.id).toBe('acp-1');
    expect(projectSession.archivedAt).toBe('2026-08-14T00:00:00Z');
    expect(projectSession.lifecycle).toBe('ready');
  });
});
