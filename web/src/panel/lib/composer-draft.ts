import { createSignal, type Accessor } from 'solid-js';

export interface ComposerDraftOwner {
  principalId: string;
  projectId: string;
  sessionId: string;
}

export interface ComposerDraftStorage {
  load(key: string): Promise<string | null>;
  save(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

type DraftIdentity = ComposerDraftOwner | string | null;

const ownerKey = (owner: ComposerDraftOwner) => JSON.stringify([
  owner.principalId,
  owner.projectId,
  owner.sessionId,
]);

const normalizeOwner = (identity: DraftIdentity): ComposerDraftOwner | null => {
  if (!identity) return null;
  if (typeof identity === 'string') {
    return { principalId: 'test-principal', projectId: 'test-project', sessionId: identity };
  }
  return identity.principalId && identity.projectId && identity.sessionId ? identity : null;
};

/**
 * 草稿状态的唯一 owner：同步 Solid 读写 + 异步持久化及 hydration 竞态门禁。
 * IndexedDB 只是 adapter；业务身份和“不覆盖用户新输入”语义由本类拥有。
 */
export class ComposerDraftStore {
  private readonly values: Accessor<Record<string, string>>;
  private readonly setValues: (value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void;
  private readonly revisions = new Map<string, number>();
  private persistence: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(private readonly storage: ComposerDraftStorage | null) {
    const [values, setValues] = createSignal<Record<string, string>>({});
    this.values = values;
    this.setValues = setValues;
  }

  read(identity: DraftIdentity): string {
    const owner = normalizeOwner(identity);
    return owner ? this.values()[ownerKey(owner)] ?? '' : '';
  }

  write(identity: DraftIdentity, text: string): void {
    const owner = normalizeOwner(identity);
    if (!owner) return;
    const key = ownerKey(owner);
    this.bump(key);
    this.setValues((current) => ({ ...current, [key]: text }));
    this.enqueue(() => text ? this.storage?.save(key, text) : this.storage?.remove(key));
  }

  clear(identity: DraftIdentity): void {
    const owner = normalizeOwner(identity);
    if (!owner) return;
    const key = ownerKey(owner);
    this.bump(key);
    this.setValues((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    this.enqueue(() => this.storage?.remove(key));
  }

  restore(identity: DraftIdentity, text: string): void {
    if (!this.read(identity)) this.write(identity, text);
  }

  async hydrate(identity: DraftIdentity): Promise<void> {
    const owner = normalizeOwner(identity);
    if (!owner || !this.storage) return;
    const key = ownerKey(owner);
    const generation = this.generation;
    const revision = this.revisions.get(key) ?? 0;
    const persisted = await this.storage.load(key).catch(() => null);
    if (!persisted
      || this.generation !== generation
      || (this.revisions.get(key) ?? 0) !== revision
      || this.values()[key]) return;
    this.setValues((current) => ({ ...current, [key]: persisted }));
  }

  /** 身份注销时同步清内存，并排队清除浏览器持久副本。 */
  reset(clearPersistent = true): void {
    this.generation += 1;
    this.setValues({});
    this.revisions.clear();
    if (clearPersistent) this.enqueue(() => this.storage?.clear());
  }

  /** 测试/页面重建 seam：模拟 JS realm 重载但保留 IndexedDB。 */
  unload(): void {
    this.reset(false);
  }

  async settled(): Promise<void> {
    await this.persistence;
  }

  private bump(key: string): void {
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
  }

  private enqueue(operation: () => Promise<void> | void): void {
    this.persistence = this.persistence.then(() => operation()).catch(() => undefined);
  }
}

function indexedDbStorage(): ComposerDraftStorage | null {
  if (typeof indexedDB === 'undefined') return null;
  let database: Promise<IDBDatabase> | null = null;
  const open = () => database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('peri-studio-composer', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const request = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const result = run(db.transaction('drafts', mode).objectStore('drafts'));
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    });
  };
  return {
    load: (key) => request('readonly', (store) => store.get(key)).then((value) => typeof value === 'string' ? value : null),
    save: (key, text) => request('readwrite', (store) => store.put(text, key)).then(() => undefined),
    remove: (key) => request('readwrite', (store) => store.delete(key)).then(() => undefined),
    clear: () => request('readwrite', (store) => store.clear()).then(() => undefined),
  };
}

const drafts = new ComposerDraftStore(indexedDbStorage());

export const composerDraft = (owner: DraftIdentity): string => drafts.read(owner);
export const setComposerDraft = (owner: DraftIdentity, text: string): void => drafts.write(owner, text);
export const clearComposerDraft = (owner: DraftIdentity): void => drafts.clear(owner);
export const restoreComposerDraft = (owner: DraftIdentity, text: string): void => drafts.restore(owner, text);
export const hydrateComposerDraft = (owner: DraftIdentity): Promise<void> => drafts.hydrate(owner);
export const resetComposerDrafts = (): void => drafts.reset();
