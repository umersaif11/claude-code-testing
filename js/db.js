// Everything lives in the browser: parsed books, the original PDFs (for "view original"), attempts.
const DB = 'reading-lab';
let dbp;

function open() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('files');
      db.createObjectStore('attempts', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const db = {
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  put: (store, value, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('rl:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem('rl:' + key);
      else localStorage.setItem('rl:' + key, JSON.stringify(value));
    } catch { /* storage unavailable: carry on without persistence */ }
  },
};
