import { describe, expect, it } from 'vitest';
import { ComposerDraftStore, type ComposerDraftOwner, type ComposerDraftStorage } from './composer-draft';

class MemoryDraftStorage implements ComposerDraftStorage {
  readonly values = new Map<string, string>();
  async load(key: string) { return this.values.get(key) ?? null; }
  async save(key: string, text: string) { this.values.set(key, text); }
  async remove(key: string) { this.values.delete(key); }
  async clear() { this.values.clear(); }
}

const owner = (principalId: string, projectId = 'project-1', sessionId = 'session-1'): ComposerDraftOwner => ({
  principalId, projectId, sessionId,
});

describe('ComposerDraftStore', () => {
  it('restores a refresh from storage and isolates principal, project and session', async () => {
    const storage = new MemoryDraftStorage();
    const drafts = new ComposerDraftStore(storage);
    drafts.write(owner('principal-a'), 'private work');
    await drafts.settled();
    drafts.unload();

    await drafts.hydrate(owner('principal-b'));
    await drafts.hydrate(owner('principal-a', 'project-2'));
    await drafts.hydrate(owner('principal-a', 'project-1', 'session-2'));
    expect(drafts.read(owner('principal-b'))).toBe('');
    expect(drafts.read(owner('principal-a', 'project-2'))).toBe('');
    expect(drafts.read(owner('principal-a', 'project-1', 'session-2'))).toBe('');
    await drafts.hydrate(owner('principal-a'));
    expect(drafts.read(owner('principal-a'))).toBe('private work');
  });

  it('never lets a late hydration overwrite text entered after hydration started', async () => {
    let resolveLoad!: (value: string | null) => void;
    const storage: ComposerDraftStorage = {
      load: () => new Promise((resolve) => { resolveLoad = resolve; }),
      save: async () => {}, remove: async () => {}, clear: async () => {},
    };
    const drafts = new ComposerDraftStore(storage);
    const hydration = drafts.hydrate(owner('principal-a'));
    drafts.write(owner('principal-a'), 'new input');
    resolveLoad('stale persisted text');
    await hydration;
    expect(drafts.read(owner('principal-a'))).toBe('new input');
  });

  it('does not restore a previous principal after an identity reset', async () => {
    let resolveLoad!: (value: string | null) => void;
    const storage: ComposerDraftStorage = {
      load: () => new Promise((resolve) => { resolveLoad = resolve; }),
      save: async () => {}, remove: async () => {}, clear: async () => {},
    };
    const drafts = new ComposerDraftStore(storage);
    const hydration = drafts.hydrate(owner('principal-a'));
    drafts.reset();
    resolveLoad('previous principal draft');
    await hydration;
    expect(drafts.read(owner('principal-a'))).toBe('');
  });
});
