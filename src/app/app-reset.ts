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
/** IndexedDB database holding the non-extractable secrets device key. This is
 *  config, not project data, so a full reset removes it. The browser-backend
 *  WORKSPACE database has a different name and is deliberately NOT touched. */
const SECRETS_DB = "lop-app-secrets";

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
  // Forget the secrets device key (best-effort, fire-and-forget). Once the
  // ciphertext in localStorage is gone the key is useless anyway, so we do not
  // block the reload on this async delete completing.
  try {
    window.indexedDB?.deleteDatabase(SECRETS_DB);
  } catch {
    // ignore — IndexedDB unavailable.
  }
}

/** Reset to a clean slate and reboot. `reload` is injectable for tests. */
export function resetAppToCleanSlate(
  reload: () => void = () => window.location.reload(),
): void {
  clearAppConfig();
  reload();
}
