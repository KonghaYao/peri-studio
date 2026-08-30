import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { renderResourceView } from '@/entities/resource/resource-view';

describe('resource Yjs projection reader', () => {
  it('reads ordered file entries without trusting map iteration order', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('root');
    const meta = new Y.Map();
    meta.set('view_id', 'view-1');
    meta.set('project_id', 'project-1');
    meta.set('view_type', 'fs_directory_page');
    meta.set('path', 'src');
    root.set('meta', meta);
    const order = new Y.Array<string>();
    order.push(['b', 'a']);
    root.set('entry_order', order);
    const entries = new Y.Map<Y.Map<unknown>>();
    for (const [id, name] of [['a', 'a.ts'], ['b', 'b.ts']] as const) {
      const entry = new Y.Map<unknown>();
      entry.set('name', name);
      entry.set('path', `src/${name}`);
      entry.set('kind', 'file');
      entries.set(id, entry);
    }
    root.set('entries', entries);

    const view = renderResourceView('resource:view-1', doc)!;
    expect(view.path).toBe('src');
    expect(view.entries.map((entry) => entry.name)).toEqual(['b.ts', 'a.ts']);
  });

  it('fails closed when structural maps are missing', () => {
    expect(renderResourceView('resource:bad', new Y.Doc())).toBeNull();
  });

  it('rejects unknown view and Git group discriminants at the Yjs boundary', () => {
    for (const [viewType, groupId] of [['future_view', 'index'], ['git_group_page', 'future_group']]) {
      const doc = new Y.Doc();
      const root = doc.getMap('root');
      const meta = new Y.Map();
      meta.set('view_id', 'view-1');
      meta.set('project_id', 'project-1');
      meta.set('view_type', viewType);
      meta.set('group_id', groupId);
      root.set('meta', meta);
      root.set('entry_order', new Y.Array());
      root.set('entries', new Y.Map());
      expect(renderResourceView('resource:bad', doc)).toBeNull();
    }
  });

  it('reads git log page entries and parses JSON parents and refs', () => {
    const doc = new Y.Doc();
    const root = doc.getMap('root');
    const meta = new Y.Map();
    meta.set('view_id', 'view-log');
    meta.set('project_id', 'project-1');
    meta.set('view_type', 'git_log_page');
    meta.set('repo_id', 'repo-1');
    meta.set('head_oid', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    root.set('meta', meta);
    const order = new Y.Array<string>();
    order.push(['c1']);
    root.set('entry_order', order);
    const entries = new Y.Map<Y.Map<unknown>>();
    const entry = new Y.Map<unknown>();
    entry.set('oid', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    entry.set('short_oid', 'aaaaaaaa');
    entry.set('message', 'feat: graph');
    entry.set('author_name', 'Peri');
    entry.set('author_date', '2026-08-30T10:00:00.000Z');
    entry.set('parents', '["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]');
    entry.set('refs', '[{"name":"main","kind":"branch"}]');
    entries.set('c1', entry);
    root.set('entries', entries);

    const view = renderResourceView('resource:view-log', doc)!;
    expect(view.viewType).toBe('git_log_page');
    expect(view.entries[0].parents).toEqual(['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
    expect(view.entries[0].refs).toEqual([{ name: 'main', kind: 'branch' }]);
  });
});
