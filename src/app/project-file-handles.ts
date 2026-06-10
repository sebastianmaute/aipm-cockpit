/**
 * Per-project FileSystemFileHandle persistence via a dedicated IndexedDB
 * database. Storing handles in a separate DB (not the main "lop-app" IDB)
 * avoids touching storage.ts's schema version / onupgradeneeded.
 *
 * FileSystemFileHandle is structured-cloneable and can be stored directly as
 * an IDB value. The store uses out-of-line keys (no keyPath) so the projectId
 * string doubles as the record key via `put(handle, projectId)`.
 *
 * All functions are no-ops / return null when IndexedDB is unavailable (SSR or
 * non-browser environments) so they are safe to call unconditionally.
 */

import type { FsHandle } from "./storage";

const HANDLES_DB_NAME = "lop-app-project-handles";
const HANDLES_DB_VERSION = 1;
const HANDLES_STORE = "handles";

/** Returns false in SSR or environments without IndexedDB. */
function idbAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openHandlesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLES_DB_NAME, HANDLES_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLES_STORE)) {
        // Out-of-line keys: `put(value, key)` uses projectId as key.
        db.createObjectStore(HANDLES_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Persists a FileSystemFileHandle for the given project.
 * Resolves silently if IndexedDB is unavailable.
 */
export async function saveHandle(
  projectId: string,
  handle: FsHandle,
): Promise<void> {
  if (!idbAvailable()) return;
  const db = await openHandlesDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE, "readwrite");
    const store = tx.objectStore(HANDLES_STORE);
    const req = store.put(handle, projectId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves the stored FileSystemFileHandle for the given project.
 * Returns null when IndexedDB is unavailable, the project is unknown, or an
 * error occurs.
 */
export async function getHandle(
  projectId: string,
): Promise<FsHandle | null> {
  if (!idbAvailable()) return null;
  try {
    const db = await openHandlesDb();
    return await new Promise<FsHandle | null>((resolve, reject) => {
      const tx = db.transaction(HANDLES_STORE, "readonly");
      const store = tx.objectStore(HANDLES_STORE);
      const req = store.get(projectId);
      req.onsuccess = () => resolve((req.result as FsHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Removes the stored FileSystemFileHandle for the given project.
 * Resolves silently if IndexedDB is unavailable or the key does not exist.
 */
export async function deleteHandle(projectId: string): Promise<void> {
  if (!idbAvailable()) return;
  const db = await openHandlesDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE, "readwrite");
    const store = tx.objectStore(HANDLES_STORE);
    const req = store.delete(projectId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
