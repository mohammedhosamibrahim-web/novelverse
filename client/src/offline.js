/**
 * Offline chapter storage (IndexedDB).
 * Stores chapter manifests (manga: page routes) and novel text so the
 * readers can render content without a network connection. Images are
 * served by the service worker's runtime cache once pre-fetched.
 */
const DB_NAME = 'novelverse-offline';
const STORE = 'chapters';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function saveChapter(key, data) {
  return withStore('readwrite', (store) => store.put({ key, ...data }));
}

export function getChapter(key) {
  return withStore('readonly', (store) => store.get(key));
}

export function removeChapter(key) {
  return withStore('readwrite', (store) => store.delete(key));
}

export function listChapters() {
  return withStore('readonly', (store) => store.getAll());
}

export function clearChapters() {
  return withStore('readwrite', (store) => store.clear());
}
