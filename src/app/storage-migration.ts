// One-time idempotent rename of the lop-app storage namespace to aipm-cockpit.
// Holds BOTH legacy and new literals on purpose — EXEMPT from the rename sweep.

const LEGACY_LS_PREFIX = "lop-app:";
const NEW_LS_PREFIX = "aipm-cockpit:";

const NONPREFIXED_LS: Readonly<Record<string, string>> = {
  "lop-style": "aipm-cockpit-style",
  "lop-theme": "aipm-cockpit-theme",
  "lop-active-scheme-colors": "aipm-cockpit-active-scheme-colors",
  "lop-active-scheme-structural": "aipm-cockpit-active-scheme-structural",
  "lop-scheme-supports-dark": "aipm-cockpit-scheme-supports-dark",
};

export const IDB_DB_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["lop-app-secrets", "aipm-cockpit-secrets"],
  ["lop-app", "aipm-cockpit"],
  ["lop-app-project-handles", "aipm-cockpit-project-handles"],
];

function moveKey(oldKey: string, newKey: string): void {
  if (localStorage.getItem(newKey) !== null) {
    localStorage.removeItem(oldKey);
    return;
  }
  const v = localStorage.getItem(oldKey);
  if (v === null) return;
  localStorage.setItem(newKey, v);
  localStorage.removeItem(oldKey);
}

export function migrateLocalStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys) {
      if (k.startsWith(LEGACY_LS_PREFIX)) {
        moveKey(k, NEW_LS_PREFIX + k.slice(LEGACY_LS_PREFIX.length));
      }
    }
    for (const oldKey of Object.keys(NONPREFIXED_LS)) {
      moveKey(oldKey, NONPREFIXED_LS[oldKey]);
    }
  } catch {
    // private-mode / quota / disabled storage — never throw at boot
  }
}

interface StoreDump {
  name: string;
  keyPath: IDBObjectStore["keyPath"];
  autoIncrement: boolean;
  records: Array<{ key: IDBValidKey; value: unknown }>;
}

function idbExists(name: string): Promise<boolean> {
  if (typeof indexedDB.databases !== "function") return Promise.resolve(false);
  return indexedDB.databases().then((l) => l.some((d) => d.name === name)).catch(() => false);
}
function deleteDb(name: string): Promise<void> {
  return new Promise((res) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
}
function dumpDb(name: string): Promise<StoreDump[] | null> {
  return new Promise((res) => {
    const open = indexedDB.open(name);
    open.onerror = () => res(null);
    open.onsuccess = () => {
      const db = open.result;
      const names = Array.from(db.objectStoreNames);
      if (names.length === 0) { db.close(); res([]); return; }
      const dumps: StoreDump[] = [];
      const tx = db.transaction(names, "readonly");
      let pending = names.length;
      for (const sn of names) {
        const store = tx.objectStore(sn);
        const dump: StoreDump = { name: sn, keyPath: store.keyPath, autoIncrement: store.autoIncrement, records: [] };
        const cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) { dump.records.push({ key: c.primaryKey, value: c.value }); c.continue(); }
          else { dumps.push(dump); if (--pending === 0) { db.close(); res(dumps); } }
        };
        cur.onerror = () => { dumps.push(dump); if (--pending === 0) { db.close(); res(dumps); } };
      }
    };
  });
}
function writeDb(name: string, dumps: StoreDump[]): Promise<boolean> {
  return new Promise((res) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const d of dumps) {
        if (!db.objectStoreNames.contains(d.name)) {
          db.createObjectStore(d.name, d.keyPath != null ? { keyPath: d.keyPath, autoIncrement: d.autoIncrement } : { autoIncrement: d.autoIncrement });
        }
      }
    };
    open.onerror = () => res(false);
    open.onsuccess = () => {
      const db = open.result;
      if (dumps.length === 0) { db.close(); res(true); return; }
      const tx = db.transaction(dumps.map((d) => d.name), "readwrite");
      for (const d of dumps) {
        const store = tx.objectStore(d.name);
        const inline = d.keyPath != null;
        for (const rec of d.records) {
          if (inline) store.put(rec.value); else store.put(rec.value, rec.key);
        }
      }
      tx.oncomplete = () => { db.close(); res(true); };
      tx.onerror = () => { db.close(); res(false); };
    };
  });
}

async function migrateOneDb(oldName: string, newName: string): Promise<void> {
  if (await idbExists(newName)) return;
  if (!(await idbExists(oldName))) return;
  const dumps = await dumpDb(oldName);
  if (dumps === null) return;
  const ok = await writeDb(newName, dumps);
  if (!ok) return;
  const verify = await dumpDb(newName);
  if (verify === null) return;
  const oldCount = dumps.reduce((n, d) => n + d.records.length, 0);
  const newCount = verify.reduce((n, d) => n + d.records.length, 0);
  if (newCount < oldCount) return;
  await deleteDb(oldName);
}

export async function migrateIndexedDb(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  for (const [oldName, newName] of IDB_DB_RENAMES) {
    try { await migrateOneDb(oldName, newName); } catch { /* degrade: keep old */ }
  }
}
