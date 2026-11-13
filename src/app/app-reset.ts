"use client";

// Full factory reset ("clean slate"). Wipes all browser-local CONFIG so the app
// reboots as if freshly installed: every `aipm-cockpit:*` localStorage key (settings,
// encrypted secrets, project registry, portfolio mode, UI/layout state) plus the
// non-extractable secrets device key in IndexedDB.
//
// NON-DESTRUCTIVE to project DATA: underlying JSON files, Turso databases, and
// the browser-backend workspace IndexedDB store are intentionally left intact.
// Projects are *detached* (the registry pointer is cleared) — not deleted — so
// the user can re-open them later via Load / Create.

import { invalidateAllSealedWrites } from "./secrets-store";
import { sealSettingsUntilReload } from "./settings-reload-seal";
import { getMsalConfig } from "./msal-config";

const LOP_APP_PREFIX = "aipm-cockpit:";
/** Same key as `use-settings.ts` `SETTINGS_KEY`; a literal, as in `recovery-config.ts`, so the
 *  reset does not pull in the settings hook module. */
const SETTINGS_KEY = `${LOP_APP_PREFIX}settings`;
/** IndexedDB databases a full reset removes. These hold CONFIG, not project
 *  data: the non-extractable secrets device key, and saved File-System-Access
 *  handles (mere pointers/permissions to detached project files — clearing them
 *  "detaches completely" without deleting any file). The browser-backend
 *  WORKSPACE database (project data) has a different name and is NOT touched. */
const CONFIG_DBS = ["aipm-cockpit-secrets", "aipm-cockpit-project-handles"] as const;

/** The Microsoft sign-in library (MSAL, `cacheLocation: "localStorage"` in `use-ms-auth.ts`)
 *  keeps accounts, id/access/refresh tokens and its own bookkeeping under keys it names itself.
 *  In the installed @azure/msal-browser 5.x every such key begins `msal.` (`PREFIX` in
 *  `dist/cache/CacheKeys.mjs`; account and credential keys `msal.3|…`), and its temporary
 *  interaction keys live in sessionStorage with the same prefix. A few entries carry no prefix
 *  but contain the client id (`appmetadata-<env>-<clientId>`, the throttling entries, and
 *  credential keys written by older MSAL versions) — the library's own `clear` matches those by
 *  client id, and so does this.
 *
 *  The library's `clearCache` is NOT used: the Settings reset runs whether or not M365 was ever
 *  initialised in this tab, `clearCache` needs an initialised `PublicClientApplication`, and it
 *  is async while the reset reloads synchronously straight after. Removing the keys signs
 *  nothing out at Microsoft and opens no window. */
const MSAL_KEY_PREFIX = "msal.";
/** Entra application (client) ids are GUIDs. Anything else is not used to match keys, so a
 *  malformed setting cannot widen the sweep to unrelated keys. */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The client id MSAL was configured with: the build-time env var, else the one in Settings.
 *  Read BEFORE the `aipm-cockpit:*` sweep removes the settings. */
function configuredMsalClientId(store: Storage): string | null {
  let settingsClientId: string | undefined;
  try {
    const raw = store.getItem(SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const m365 = (parsed as { integrations?: { m365?: { clientId?: unknown } } } | null)?.integrations?.m365;
    if (typeof m365?.clientId === "string") settingsClientId = m365.clientId;
  } catch {
    // unreadable settings — fall back to the prefix match alone.
  }
  const clientId = getMsalConfig(settingsClientId)?.clientId.trim().toLowerCase() ?? "";
  return GUID_RE.test(clientId) ? clientId : null;
}

function isMsalCacheKey(key: string, clientId: string | null): boolean {
  if (key.startsWith(MSAL_KEY_PREFIX)) return true;
  return clientId !== null && key.toLowerCase().includes(clientId);
}

/** Snapshot-then-remove every MSAL key in one storage area. Best-effort. */
function removeMsalKeys(store: Storage | undefined, clientId: string | null): void {
  if (!store) return;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (k && isMsalCacheKey(k, clientId)) keys.push(k);
  }
  for (const k of keys) {
    try {
      store.removeItem(k);
    } catch {
      // ignore quota/disabled errors — best-effort.
    }
  }
}

function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined; // access can throw when storage is blocked.
  }
}

/** Clear every `aipm-cockpit:*` localStorage key, the Microsoft sign-in cache (local only — the
 *  account stays signed in at Microsoft) and forget the secrets device key.
 *  Leaves all workspace data stores (files / Turso / browser-backend IndexedDB)
 *  intact — those hold project data and are only detached, never deleted. */
export function clearAppConfig(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const store = window.localStorage;
  // ★ §609 — the sweep below removes the secrets key directly, not via `removeSealed`, and the
  //   reload that follows is a navigation, not a stop: a seal whose WebCrypto continuation is
  //   already queued would still commit and write the key back (a passphrase-sealed one would
  //   even survive the device-key delete). Cancel every seal in flight first.
  invalidateAllSealedWrites();
  // The Microsoft sign-in cache. Its client id lives in the settings the sweep below removes.
  const msalClientId = configuredMsalClientId(store);
  removeMsalKeys(store, msalClientId);
  removeMsalKeys(sessionStorageOrUndefined(), msalClientId);
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
  sealSettingsUntilReload(); // §740 — a stale persist-effect write would put the settings back
  reload();
}
