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

import { ensureStorageMigrated } from "./storage-migration";

const IDB_NAME = "aipm-cockpit";
const IDB_VERSION = 6;
const IDB_KV_STORE = "kv";
export const IDB_TASKS_STORE = "tasks";
export const IDB_RAID_STORE = "raid";
export const IDB_ABSENCES_STORE = "absences";
export const IDB_SHIFTS_STORE = "shifts";
export const IDB_RESOURCES_STORE = "resources";
export const IDB_ROLES_STORE = "roles";
export const IDB_DISCIPLINES_STORE = "disciplines";
export const IDB_GRADES_STORE = "grades";
export const KV_PLAN_KEY = "resource-plan";
export const IDB_BUDGETS_STORE = "budgets";
export const KV_FXRATES_KEY = "fx-rates";
export const KV_STATUS_KEY = "project-status";
export const KV_MILESTONES_KEY = "milestones";
export const KV_CHANGES_KEY = "changes";
export const KV_STAKEHOLDERS_KEY = "stakeholders";
export const KV_PROJECT_KEY = "project";

async function openIdb(): Promise<IDBDatabase> {
  await ensureStorageMigrated(); // rename legacy lop-app* storage before first open
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
