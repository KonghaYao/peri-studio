import { createSignal, type Accessor } from 'solid-js';

export interface SessionPreferenceKey {
  principalId: string;
  projectId: string;
  acpSessionId: string;
}

export interface SessionPreferenceRecord {
  archived?: boolean;
  customName?: string;
  archivedAt?: string;
}

export interface SessionPreferenceStorage {
  loadAll(principalId: string): Promise<Record<string, SessionPreferenceRecord>>;
  save(key: string, value: SessionPreferenceRecord | null): Promise<void>;
  clear(): Promise<void>;
}

const recordKey = (key: SessionPreferenceKey) => JSON.stringify([
  key.principalId,
  key.projectId,
  key.acpSessionId,
]);

/**
 * 会话用户偏好（归档/自定义名称）的唯一 owner；IndexedDB 只是 adapter。
 * server 不持久化这些覆盖（ADR-0003）；读侧在 registry 投影后合并。
 */
export class SessionPreferencesStore {
  private readonly values: Accessor<Record<string, SessionPreferenceRecord>>;
  private readonly setValues: (value: Record<string, SessionPreferenceRecord> | ((current: Record<string, SessionPreferenceRecord>) => Record<string, SessionPreferenceRecord>)) => void;
  private loadedPrincipal: string | null = null;
  private persistence: Promise<void> = Promise.resolve();

  constructor(private readonly storage: SessionPreferenceStorage | null) {
    const [values, setValues] = createSignal<Record<string, SessionPreferenceRecord>>({});
    this.values = values;
    this.setValues = setValues;
  }

  get(key: SessionPreferenceKey): SessionPreferenceRecord | undefined {
    return this.values()[recordKey(key)];
  }

  setArchived(key: SessionPreferenceKey, archived: boolean): void {
    const id = recordKey(key);
    this.setValues((current) => {
      const next = { ...current };
      if (!archived) {
        const record = { ...next[id] };
        delete record.archived;
        delete record.archivedAt;
        if (!record.customName) delete next[id];
        else next[id] = record;
        return next;
      }
      next[id] = { ...next[id], archived: true, archivedAt: new Date().toISOString() };
      return next;
    });
    this.enqueue(() => this.persistRecord(id));
  }

  setCustomName(key: SessionPreferenceKey, name: string): void {
    const trimmed = name.trim();
    const id = recordKey(key);
    this.setValues((current) => {
      const next = { ...current };
      if (!trimmed) {
        const record = { ...next[id] };
        delete record.customName;
        if (!record.archived) delete next[id];
        else next[id] = record;
        return next;
      }
      next[id] = { ...next[id], customName: trimmed };
      return next;
    });
    this.enqueue(() => this.persistRecord(id));
  }

  async hydrate(principalId: string): Promise<void> {
    if (!this.storage || this.loadedPrincipal === principalId) return;
    this.loadedPrincipal = principalId;
    const persisted = await this.storage.loadAll(principalId).catch(() => ({}));
    const prefix = JSON.stringify([principalId]);
    const scoped: Record<string, SessionPreferenceRecord> = {};
    for (const [key, value] of Object.entries(persisted)) {
      if (key.startsWith(prefix)) scoped[key] = value;
    }
    this.setValues(scoped);
  }

  reset(clearPersistent = true): void {
    this.loadedPrincipal = null;
    this.setValues({});
    if (clearPersistent) this.enqueue(() => this.storage?.clear());
  }

  async settled(): Promise<void> {
    await this.persistence;
  }

  private async persistRecord(id: string): Promise<void> {
    if (!this.storage) return;
    const record = this.values()[id];
    await this.storage.save(id, record ?? null);
  }

  private enqueue(operation: () => Promise<void> | void): void {
    this.persistence = this.persistence.then(() => operation()).catch(() => undefined);
  }
}

function indexedDbStorage(): SessionPreferenceStorage | null {
  if (typeof indexedDB === 'undefined') return null;
  let database: Promise<IDBDatabase> | null = null;
  const open = () => database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('peri-studio-session-preferences', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('preferences');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const request = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const result = run(db.transaction('preferences', mode).objectStore('preferences'));
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    });
  };
  return {
    loadAll: async (principalId) => {
      const prefix = JSON.stringify([principalId]);
      const db = await open();
      return new Promise<Record<string, SessionPreferenceRecord>>((resolve, reject) => {
        const scoped: Record<string, SessionPreferenceRecord> = {};
        const request = db.transaction('preferences', 'readonly').objectStore('preferences').openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(scoped);
            return;
          }
          const key = String(cursor.key);
          if (key.startsWith(prefix)) scoped[key] = cursor.value as SessionPreferenceRecord;
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    },
    save: (key, value) => request('readwrite', (store) => store.put(value, key)).then(() => undefined),
    clear: () => request('readwrite', (store) => store.clear()).then(() => undefined),
  };
}

const preferences = new SessionPreferencesStore(indexedDbStorage());

export const getSessionPreference = (key: SessionPreferenceKey): SessionPreferenceRecord | undefined =>
  preferences.get(key);

export const setSessionArchivedPreference = (key: SessionPreferenceKey, archived: boolean): void =>
  preferences.setArchived(key, archived);

export const setSessionCustomNamePreference = (key: SessionPreferenceKey, name: string): void =>
  preferences.setCustomName(key, name);

export const hydrateSessionPreferences = (principalId: string): Promise<void> =>
  preferences.hydrate(principalId);

export const resetSessionPreferences = (): void => preferences.reset();

/** 身份边界复位时保留 IndexedDB（同 principal 重连）。 */
export const unloadSessionPreferences = (): void => preferences.reset(false);
