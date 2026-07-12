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

// One-time completion marker so post-migration boots do zero IDB work on EVERY
// browser (avoids the shell-probe churn below). Swept by clearAppConfig's
// aipm-cockpit:* sweep — harmless to re-run after a reset (old DBs are gone).
const IDB_MIGRATED_FLAG = "aipm-cockpit:idb-migrated";

interface StoreDump {
  name: string;
  keyPath: IDBObjectStore["keyPath"];
  autoIncrement: boolean;
  records: Array<{ key: IDBValidKey; value: unknown }>;
}

function countRecords(dumps: StoreDump[]): number {
  return dumps.reduce((n, d) => n + d.records.length, 0);
}

// Resolves true only on a definitive delete; false on blocked/error so the
// caller can treat the DB as "not settled" and retry on the next boot.
function deleteDb(name: string): Promise<boolean> {
  return new Promise((res) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => res(true);
    r.onerror = () => res(false);
    r.onblocked = () => res(false);
  });
}
// Opens `name` (IndexedDB auto-creates an empty v1 DB when absent, so a null
// return means a READ error, and a 0-store result means the DB did not really
// exist). NEVER used as the migration gate on its own — see migrateOneDb.
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
// Creates `name` at v1 with the dumped stores and writes every record. On ANY
// failure it deletes the partial shell it created, so a failed attempt never
// leaves an empty DB that would shadow the old one on the next boot.
function writeDb(name: string, dumps: StoreDump[]): Promise<boolean> {
  return new Promise((res) => {
    const fail = (db?: IDBDatabase) => { if (db) db.close(); deleteDb(name).finally(() => res(false)); };
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const d of dumps) {
        if (!db.objectStoreNames.contains(d.name)) {
          db.createObjectStore(d.name, d.keyPath != null ? { keyPath: d.keyPath, autoIncrement: d.autoIncrement } : { autoIncrement: d.autoIncrement });
        }
      }
    };
    open.onerror = () => fail();
    open.onsuccess = () => {
      const db = open.result;
      try {
        if (dumps.length === 0) { db.close(); res(true); return; }
        // A pre-existing same-version shell (e.g. a blocked deleteDb left it)
        // skips onupgradeneeded, so a store may be missing — transaction() then
        // throws NotFoundError synchronously. Catch it → clean up, don't hang.
        const tx = db.transaction(dumps.map((d) => d.name), "readwrite");
        for (const d of dumps) {
          const store = tx.objectStore(d.name);
          const inline = d.keyPath != null;
          for (const rec of d.records) {
            if (inline) store.put(rec.value); else store.put(rec.value, rec.key);
          }
        }
        tx.oncomplete = () => { db.close(); res(true); };
        tx.onerror = () => fail(db);
      } catch {
        fail(db);
      }
    };
  });
}

// Migrates one DB by CONTENT (never by indexedDB.databases(), which Firefox and
// Safari<14 don't implement — a databases()-based gate would silently skip the
// whole migration there and strand the user's data). Returns true when the DB
// is fully settled (migrated, or old never existed), false when work remains.
async function migrateOneDb(oldName: string, newName: string): Promise<boolean> {
  const oldDump = await dumpDb(oldName);
  if (oldDump === null) return false;              // read error — retry next boot
  if (oldDump.length === 0) {                      // old never really existed (fresh shell)
    return await deleteDb(oldName);                // drop the probe shell; nothing to migrate
  }
  const oldCount = countRecords(oldDump);

  const newDump = await dumpDb(newName);
  if (newDump === null) return false;
  const newCount = countRecords(newDump);
  if (newCount > 0) {
    // new holds REAL records — only the app writes those (writeDb's tx is
    // atomic, so a non-empty new never comes from a partial copy). NEVER clobber
    // it: retire old only when new is at least as complete; otherwise (new is
    // newer-but-smaller — user deleted rows while old lingered) leave BOTH and
    // retry, so record-count is never used to overwrite live user data.
    return newCount >= oldCount ? await deleteDb(oldName) : false;
  }

  // new is absent / empty (0 records) → drop the shell so writeDb's
  // onupgradeneeded fires, then copy. Fixes the "empty new DB shadows old" defect.
  await deleteDb(newName);
  const ok = await writeDb(newName, oldDump);
  if (!ok) return false;                           // writeDb cleaned its own shell
  const verify = await dumpDb(newName);
  if (verify === null || countRecords(verify) < oldCount) return false;
  return await deleteDb(oldName);
}

export async function migrateIndexedDb(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try { if (localStorage.getItem(IDB_MIGRATED_FLAG) === "1") return; } catch { /* storage off */ }
  let allDone = true;
  for (const [oldName, newName] of IDB_DB_RENAMES) {
    let done = false;
    try { done = await migrateOneDb(oldName, newName); } catch { done = false; }
    if (!done) allDone = false;
  }
  if (allDone) {
    try { localStorage.setItem(IDB_MIGRATED_FLAG, "1"); } catch { /* storage off */ }
  }
}
