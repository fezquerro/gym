// Thin promise wrapper over IndexedDB. Every store holds whole documents keyed by `id`.

const DB_NAME = 'gym-log';
const DB_VERSION = 3;
export const STORES = ['exercises', 'routines', 'sessions', 'records', 'weighins'];

let opening;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) {
          req.result.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => {
      // Let a newer version of the app, open in another tab, upgrade the database.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run(stores, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = work(tx);
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const getAll = store =>
  run(store, 'readonly', tx => tx.objectStore(store).getAll()).then(req => req.result);

export const putMany = (store, values) =>
  run(store, 'readwrite', tx => values.forEach(v => tx.objectStore(store).put(v)));

export const put = (store, value) => putMany(store, [value]);

export const del = (store, id) =>
  run(store, 'readwrite', tx => tx.objectStore(store).delete(id));

// Empties one store and fills it with `values`.
export const replaceStore = (store, values) =>
  run(store, 'readwrite', tx => {
    tx.objectStore(store).clear();
    values.forEach(v => tx.objectStore(store).put(v));
  });

// Swaps the whole database for `data` in one transaction (used by backup import).
export const replaceAll = data =>
  run(STORES, 'readwrite', tx => {
    for (const name of STORES) {
      const store = tx.objectStore(name);
      store.clear();
      data[name].forEach(v => store.put(v));
    }
  });
