// Tiny IndexedDB key-value store for the in-progress puzzle.

import type { SavedGame } from './game';

const DB = 'puzzles';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= open());

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const saveState = (s: SavedGame) => run<void>('readwrite', (st) => st.put(s, 'state'));
export const saveImage = (b: Blob) => run<void>('readwrite', (st) => st.put(b, 'image'));

export async function loadSaved(): Promise<{ state: SavedGame; image: Blob } | null> {
  try {
    const [state, image] = await Promise.all([
      run<SavedGame | undefined>('readonly', (st) => st.get('state')),
      run<Blob | undefined>('readonly', (st) => st.get('image')),
    ]);
    return state?.version === 1 && image ? { state, image } : null;
  } catch {
    return null;
  }
}

export async function clearSaved() {
  await run<void>('readwrite', (st) => st.delete('state'));
  await run<void>('readwrite', (st) => st.delete('image'));
}
