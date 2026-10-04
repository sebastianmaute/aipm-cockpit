// --- IndexedDB key/value wrapper ------------------------------------------
//
// Schema:
//   - "kv"   — generic key/value store (legacy). Used by LocalFileBackend to
//              persist picked FsHandles. Created at version 1.
//   - "tasks" / "raid" — record-level storage for the BrowserBackend.
//              Created at version 2. keyPath:"id" pulls the key directly
//              from the stored record, so puts don't need an explicit key.
//   - "absences" — third workspace entity (Resource Planner v1). Created
//              at version 3. Same keyPath:"id" pattern as tasks/raid.
//   - "shifts"  — fourth workspace entity (Resource Planner Phase 4).
//              Created at version 4. Per-assignee weekly hours pattern.
//
// Bumping the version triggers `onupgradeneeded`, which adds missing stores
// idempotently — users coming from earlier versions keep their data and gain
// the new record stores additively.

// ★ Every name, store and key below comes from idb-layout.ts, the one list the
// e2e seed also reads (§99). Add a store or kv key THERE, never as a literal here.
import { IDB_CORE_KV_KEYS, IDB_DB_NAME, IDB_DB_VERSION, IDB_ENTITY_STORES, IDB_KV_STORE } from "./idb-layout";

const IDB_NAME = IDB_DB_NAME;
const IDB_VERSION = IDB_DB_VERSION;
export const IDB_TASKS_STORE = IDB_ENTITY_STORES.tasks;
export const IDB_RAID_STORE = IDB_ENTITY_STORES.raid;
export const IDB_ABSENCES_STORE = IDB_ENTITY_STORES.absences;
export const IDB_SHIFTS_STORE = IDB_ENTITY_STORES.shifts;
export const IDB_RESOURCES_STORE = IDB_ENTITY_STORES.resources;
export const IDB_ROLES_STORE = IDB_ENTITY_STORES.roles;
export const IDB_DISCIPLINES_STORE = IDB_ENTITY_STORES.disciplines;
export const IDB_GRADES_STORE = IDB_ENTITY_STORES.grades;
export const KV_PLAN_KEY = IDB_CORE_KV_KEYS.plan;
export const IDB_BUDGETS_STORE = IDB_ENTITY_STORES.budgets;
export const KV_FXRATES_KEY = IDB_CORE_KV_KEYS.fxRates;
export const KV_STATUS_KEY = IDB_CORE_KV_KEYS.status;
export const KV_MILESTONES_KEY = IDB_CORE_KV_KEYS.milestones;
export const KV_CHANGES_KEY = IDB_CORE_KV_KEYS.changes;
export const KV_STAKEHOLDERS_KEY = IDB_CORE_KV_KEYS.stakeholders;
export const KV_PROJECT_KEY = IDB_CORE_KV_KEYS.project;

async function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    // `blocked` fires when an older tab (running an earlier IDB_VERSION)
    // still holds a connection open with no onversionchange handler of its
    // own — the upgrade transaction then waits with no further event until
    // that tab closes. Reject rather than hang so the caller's load fails
    // instead of holding the app forever. `settled` guards the one race
    // this creates: a blocked request can still fire onsuccess later, once
    // the other tab closes on its own — that late connection must be
    // closed immediately rather than leaked or resolved a second time.
    let settled = false;
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onblocked = () => {
      settled = true;
      reject(
        new Error(
          "IndexedDB upgrade is blocked by another open tab of this app. Close the other tabs and reload.",
        ),
      );
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_KV_STORE)) {
        db.createObjectStore(IDB_KV_STORE);
      }
      if (!db.objectStoreNames.contains(IDB_TASKS_STORE)) {
        db.createObjectStore(IDB_TASKS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_RAID_STORE)) {
        db.createObjectStore(IDB_RAID_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_ABSENCES_STORE)) {
        db.createObjectStore(IDB_ABSENCES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_SHIFTS_STORE)) {
        db.createObjectStore(IDB_SHIFTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_RESOURCES_STORE)) {
        db.createObjectStore(IDB_RESOURCES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_ROLES_STORE)) {
        db.createObjectStore(IDB_ROLES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_DISCIPLINES_STORE)) {
        db.createObjectStore(IDB_DISCIPLINES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_GRADES_STORE)) {
        db.createObjectStore(IDB_GRADES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_BUDGETS_STORE)) {
        db.createObjectStore(IDB_BUDGETS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        // A blocked request that already rejected can still succeed once
        // the blocking tab closes. Nobody is waiting on this connection
        // any more — close it rather than leak it or resolve twice.
        db.close();
        return;
      }
      settled = true;
      // Every connection this resolves yields to a NEWER tab's upgrade:
      // this tab may itself be the one blocking someone else later. Older
      // builds (pre-dating this handler) don't have it, which is why
      // onblocked above is still needed on the other side of that race.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      settled = true;
      reject(req.error);
    };
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_KV_STORE, "readonly");
    const store = tx.objectStore(IDB_KV_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_KV_STORE, "readwrite");
    const store = tx.objectStore(IDB_KV_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_KV_STORE, "readwrite");
    const store = tx.objectStore(IDB_KV_STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** The kv store's name, for a caller that runs its own transaction over it (`idbTransaction`). */
export const IDB_KV_STORE_NAME = IDB_KV_STORE;

/**
 * §4 round 7 — ONE readwrite transaction over `storeNames`, on a connection requested in the CALLER'S
 * OWN TURN: nothing is awaited before `indexedDB.open`, and every request the save needs is issued inside
 * this one transaction (`body` may issue more from a request's `onsuccess`, while it is still active).
 * ★★ Why: measured in Chromium, a page that is closing lets the IndexedDB work it requested in its
 *   pagehide flush finish, but work requested in a LATER task — after a Web Lock grant, or a second
 *   connection opened from an earlier read's callback — never lands. One connection, one transaction.
 * ★ Readwrite transactions over overlapping stores run one at a time across tabs, so a compare-and-set
 *   done here is atomic without a lock. `fail(err)` aborts the transaction (nothing it did is kept) and
 *   rejects with `err`; a throw inside `body` does the same. Resolves on `complete`.
 */
export function idbTransaction(
  storeNames: readonly string[],
  body: (tx: IDBTransaction, fail: (err: unknown) => void) => void,
): Promise<void> {
  return openIdb().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...storeNames], "readwrite");
    let failure: { err: unknown } | null = null;
    const fail = (err: unknown): void => {
      if (failure) return;
      failure = { err };
      try { tx.abort(); } catch { /* already finishing: `onabort` or `oncomplete` settles it */ }
    };
    tx.oncomplete = () => (failure ? reject(failure.err) : resolve());
    tx.onabort = () => reject(failure ? failure.err : (tx.error ?? new Error("IndexedDB transaction aborted")));
    try {
      body(tx, fail);
    } catch (err) {
      fail(err);
    }
  }));
}

/** Reads every record from a record store. Used by BrowserBackend to load
 *  tasks/raid as arrays. Empty store → empty array. */
export async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * One-transaction bulk update against a keyPath-keyed store:
 *   - `puts`  — records to insert/replace (key derived from each item's `id`)
 *   - `deleteIds` — keys to remove
 *
 * Both arrays may be empty; the function short-circuits when there's no work
 * so unchanged saves don't even open a transaction.
 */
export async function idbBulkUpdate<T extends { id: number }>(
  storeName: string,
  puts: readonly T[],
  deleteIds: readonly number[],
): Promise<void> {
  if (puts.length === 0 && deleteIds.length === 0) return;
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const item of puts) store.put(item);
    for (const id of deleteIds) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
