// IndexedDB for takes, sessions and media blobs. Falls back to in-memory maps when
// IndexedDB is unavailable, so practice still works for the current page session.
import { Session, Take } from './types';

const DB_NAME = 'interview-practice';
const DB_VERSION = 1;

type StoreName = 'takes' | 'sessions' | 'media';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const mem: Record<StoreName, Map<string, unknown>> = { takes: new Map(), sessions: new Map(), media: new Map() };

export function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

export async function dbAvailable(): Promise<boolean> {
  return (await openDB()) !== null;
}

function tx<T>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(store, mode);
    } catch (e) {
      return reject(e);
    }
    let result: T | undefined;
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error ?? new Error('Transaction failed'));
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
  });
}

async function put(store: StoreName, value: { id: string }): Promise<void> {
  const db = await openDB();
  if (!db) {
    mem[store].set(value.id, value);
    return;
  }
  await tx(db, store, 'readwrite', (s) => s.put(value));
}

async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB();
  if (!db) return [...mem[store].values()] as T[];
  try {
    return ((await tx<T[]>(db, store, 'readonly', (s) => s.getAll())) ?? []) as T[];
  } catch {
    return [];
  }
}

async function del(store: StoreName, id: string): Promise<void> {
  const db = await openDB();
  if (!db) {
    mem[store].delete(id);
    return;
  }
  await tx(db, store, 'readwrite', (s) => s.delete(id));
}

function isTake(x: unknown): x is Take {
  const t = x as Take;
  return !!t && typeof t.id === 'string' && typeof t.createdAt === 'number' && typeof t.questionText === 'string';
}

function isSession(x: unknown): x is Session {
  const s = x as Session;
  return !!s && typeof s.id === 'string' && typeof s.startedAt === 'number';
}

export async function listTakes(): Promise<Take[]> {
  const all = await getAll<unknown>('takes');
  // Skip unreadable records instead of failing the whole list.
  return all
    .filter(isTake)
    .map((t) => ({ ...t, notes: t.notes ?? '', transcript: t.transcript ?? '', checklist: t.checklist ?? {} }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const saveTake = (t: Take) => put('takes', t);

export async function listSessions(): Promise<Session[]> {
  const all = await getAll<unknown>('sessions');
  return all.filter(isSession).sort((a, b) => b.startedAt - a.startedAt);
}

export const saveSession = (s: Session) => put('sessions', s);

/** Throws on failure (quota, private mode, eviction) so callers can keep the blob in memory. */
export async function saveMedia(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  if (!db) throw new Error('IndexedDB is not available in this browser.');
  await tx(db, 'media', 'readwrite', (s) => s.put({ id, blob }));
}

export async function getMedia(id: string): Promise<Blob | null> {
  const db = await openDB();
  if (!db) return null;
  try {
    const rec = await tx<{ id: string; blob: Blob }>(db, 'media', 'readonly', (s) => s.get(id));
    return rec?.blob instanceof Blob ? rec.blob : null;
  } catch {
    return null;
  }
}

export async function deleteTake(id: string): Promise<void> {
  await del('media', id).catch(() => undefined);
  await del('takes', id);
}

export async function clearAll(): Promise<void> {
  (Object.keys(mem) as StoreName[]).forEach((k) => mem[k].clear());
  const db = await openDB();
  if (!db) return;
  for (const store of ['takes', 'sessions', 'media'] as StoreName[]) {
    await tx(db, store, 'readwrite', (s) => s.clear());
  }
}

export function isQuotaError(e: unknown): boolean {
  const name = (e as DOMException)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}
