"use client";

// Full factory reset ("clean slate"). Wipes all browser-local CONFIG so the app
// reboots as if freshly installed: every `lop-app:*` localStorage key (settings,
// encrypted secrets, project registry, portfolio mode, UI/layout state) plus the
// non-extractable secrets device key in IndexedDB.
//
// NON-DESTRUCTIVE to project DATA: underlying JSON files, Turso databases, and
// the browser-backend workspace IndexedDB store are intentionally left intact.
// Projects are *detached* (the registry pointer is cleared) — not deleted — so
// the user can re-open them later via Load / Create.

const LOP_APP_PREFIX = "lop-app:";
/** IndexedDB databases a full reset removes. These hold CONFIG, not project
 *  data: the non-extractable secrets device key, and saved File-System-Access
 *  handles (mere pointers/permissions to detached project files — clearing them
 *  "detaches completely" without deleting any file). The browser-backend
 *  WORKSPACE database (project data) has a different name and is NOT touched. */
const CONFIG_DBS = ["lop-app-secrets", "lop-app-project-handles"] as const;

/** Clear every `lop-app:*` localStorage key and forget the secrets device key.
 *  Leaves all workspace data stores (files / Turso / browser-backend IndexedDB)
 *  intact — those hold project data and are only detached, never deleted. */
export function clearAppConfig(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const store = window.localStorage;
  // Snapshot the keys first — removing during iteration shifts indices.
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (k && k.startsWith(LOP_APP_PREFIX)) keys.push(k);
  }
  for (const k of keys) {
    try {
      store.removeItem(k);
    } catch {
      // ignore quota/disabled errors — best-effort.
    }
  }
  // Drop the config IndexedDB databases (secrets device key + file handles),
  // best-effort and fire-and-forget. We deliberately do NOT await these: the
  // ciphertext is already gone from localStorage, and awaiting deleteDatabase
  // can hang on `onblocked` when another tab holds the DB open. The reload
  // closes this tab's connections so the delete proceeds.
  for (const db of CONFIG_DBS) {
    try {
      window.indexedDB?.deleteDatabase(db);
    } catch {
      // ignore — IndexedDB unavailable.
    }
  }
}

/** Reset to a clean slate and reboot. `reload` is injectable for tests. */
export function resetAppToCleanSlate(
  reload: () => void = () => window.location.reload(),
): void {
  clearAppConfig();
  reload();
}
