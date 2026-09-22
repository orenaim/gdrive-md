/**
 * A local checkpoint of unsaved work.
 *
 * This exists for one scenario: the browser, the network or the tab dies
 * between an edit and the save that would have persisted it. Drive is the
 * source of truth and this is not a second copy of the document — it is a
 * few seconds of insurance, cleared as soon as Drive confirms the same bytes.
 *
 * IndexedDB rather than localStorage because writes are asynchronous (so a
 * frequent checkpoint never blocks typing) and because documents can be
 * larger than localStorage's practical limits.
 */
export interface Draft {
  /** `${googleUserId}:${fileId}` — keeps accounts and files apart. */
  key: string;
  fileId: string;
  userId: string;
  localText: string;
  /** The Drive revision this draft was edited on top of. */
  baseRevisionId: string;
  savedAt: number;
}

const DB_NAME = 'gdrive-md';
const DB_VERSION = 1;
const STORE = 'drafts';

export function draftKey(userId: string, fileId: string): string {
  return `${userId}:${fileId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

/**
 * The draft store, as the session sees it.
 *
 * Every method swallows its own failures. Draft storage is a convenience: a
 * browser in private mode, with storage disabled, or simply out of quota must
 * degrade to "no draft recovery", never to "cannot edit".
 */
export interface DraftStore {
  save(draft: Draft): Promise<void>;
  load(key: string): Promise<Draft | null>;
  clear(key: string): Promise<void>;
}

export class IndexedDbDraftStore implements DraftStore {
  private db: Promise<IDBDatabase> | null = null;

  private connect(): Promise<IDBDatabase> {
    if (!this.db) this.db = openDb();
    return this.db;
  }

  async save(draft: Draft): Promise<void> {
    try {
      const db = await this.connect();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(draft);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      // See the note on DraftStore: never let this break editing.
    }
  }

  async load(key: string): Promise<Draft | null> {
    try {
      const db = await this.connect();
      return await new Promise<Draft | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).get(key);
        request.onsuccess = () => resolve((request.result as Draft | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  async clear(key: string): Promise<void> {
    try {
      const db = await this.connect();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignored.
    }
  }
}

/** Used where IndexedDB is unavailable, and in tests. */
export class MemoryDraftStore implements DraftStore {
  private readonly drafts = new Map<string, Draft>();

  async save(draft: Draft): Promise<void> {
    this.drafts.set(draft.key, draft);
  }
  async load(key: string): Promise<Draft | null> {
    return this.drafts.get(key) ?? null;
  }
  async clear(key: string): Promise<void> {
    this.drafts.delete(key);
  }
}

/**
 * Whether a stored draft represents work worth offering to recover.
 *
 * A draft matching what Drive already holds is not unsaved work — it is a
 * checkpoint that simply outlived its usefulness, and offering it would train
 * people to dismiss a dialog that sometimes matters.
 */
export function draftIsWorthRecovering(draft: Draft | null, driveText: string): draft is Draft {
  return draft !== null && draft.localText !== driveText;
}
