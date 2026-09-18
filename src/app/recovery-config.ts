// src/app/recovery-config.ts
//
// Non-destructive recovery of the three config keys that can brick the app.
// "Quarantine" copies each live key to a timestamped backup key and then
// removes the live key (so defaults load next boot) — a reversible MOVE, never
// a delete. Restore reverses it. Export downloads the current config (secrets
// redacted). All localStorage access is guarded; nothing throws to callers.

import { type Lang, migrateLang } from "./i18n";
// secrets.ts is a leaf module (no imports, no React) — safe for this pure
// module to depend on, unlike use-settings/portfolio-mode noted below.
import { SECRET_IDS, SECRET_SETTINGS_PATHS } from "./secrets";

// Literal copies of the real key names (asserted equal to the source consts in
// recovery-config.test.ts, so they can't drift). Kept literal so this pure
// module doesn't import the React-bearing use-settings/portfolio-mode modules.
const SETTINGS_KEY = "aipm-cockpit:settings";
const MODE_KEY = "aipm-cockpit:portfolio-mode";
const CURRENT_TURSO_PROJECT_KEY = "aipm-cockpit:turso-current-project";

export const CONFIG_KEYS = [SETTINGS_KEY, MODE_KEY, CURRENT_TURSO_PROJECT_KEY] as const;

const BACKUP_PREFIX = "aipm-cockpit:recovery-backup:";
const INDEX_KEY = "aipm-cockpit:recovery-backups";
const REDACTED = "***REDACTED***";

export interface BackupMeta {
  id: string;
  at: string;
  keys: string[];
}

function ls(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readIndex(store: Storage): BackupMeta[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BackupMeta[]) : [];
  } catch {
    return [];
  }
}

// Write (or refresh) this run's index entry. Called after each backup copy and
// BEFORE the matching live key is removed, so a key is dropped only once it is
// already indexed — i.e. always reachable by restoreConfig. Replaces any prior
// entry for the same id (the keys list grows as the quarantine progresses).
function upsertIndexEntry(store: Storage, id: string, at: string, keys: string[]): void {
  const index = readIndex(store).filter((b) => b.id !== id);
  index.unshift({ id, at, keys: [...keys] });
  store.setItem(INDEX_KEY, JSON.stringify(index));
}

/** Move each present config key to a timestamped backup key, then remove the
 *  live key. The index entry is refreshed BEFORE each live key is removed, so a
 *  failure mid-quarantine (e.g. quota) never strands an un-indexed,
 *  unrecoverable backup — every already-removed key is restorable. Returns the
 *  backup id (null if nothing was backed up or storage is unavailable). */
export function quarantineConfig(): { ok: boolean; id: string | null } {
  const store = ls();
  if (!store) return { ok: false, id: null };
  try {
    const id = String(Date.now());
    const at = new Date().toISOString();
    const movedKeys: string[] = [];
    for (const key of CONFIG_KEYS) {
      const value = store.getItem(key);
      if (value === null) continue;
      store.setItem(`${BACKUP_PREFIX}${id}:${key}`, value); // 1. copy to backup
      movedKeys.push(key);
      upsertIndexEntry(store, id, at, movedKeys); // 2. index BEFORE removing live
      store.removeItem(key); // 3. drop the live key (now recoverable)
    }
    if (movedKeys.length === 0) return { ok: true, id: null };
    return { ok: true, id };
  } catch {
    return { ok: false, id: null };
  }
}

/** Write a backup's values back to the live config keys. */
export function restoreConfig(id: string): boolean {
  const store = ls();
  if (!store) return false;
  try {
    const entry = readIndex(store).find((b) => b.id === id);
    if (!entry) return false;
    for (const key of entry.keys) {
      const value = store.getItem(`${BACKUP_PREFIX}${id}:${key}`);
      if (value !== null) store.setItem(key, value);
    }
    return true;
  } catch {
    return false;
  }
}

/** All backups, newest first. */
export function listBackups(): BackupMeta[] {
  const store = ls();
  if (!store) return [];
  return readIndex(store);
}

/**
 * Immutably replace the value at `path` with REDACTED. Two deliberate no-ops:
 * a missing branch is left absent (an unconfigured integration must not gain an
 * empty object in its export), and a falsy leaf is left as-is (writeSettings
 * blanks these to "", and rewriting "" as REDACTED would tell a reader a secret
 * was present when none was).
 */
function redactPath(
  node: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> {
  const [head, ...rest] = path;
  const child = node[head];
  if (rest.length === 0) {
    return child ? { ...node, [head]: REDACTED } : node;
  }
  if (!child || typeof child !== "object" || Array.isArray(child)) return node;
  const next = redactPath(child as Record<string, unknown>, rest);
  return next === child ? node : { ...node, [head]: next };
}

/**
 * Defense-in-depth: writeSettings already blanks every sealed secret before
 * persisting, but redact here too so a config export cannot leak one if that
 * regresses — which is the only scenario this function exists for.
 *
 * It walks SECRET_SETTINGS_PATHS rather than naming fields, because naming them
 * is the defect being fixed: the hardcoded version covered three of the five
 * and missed timelog.apiToken and dictation.sttApiKey for as long as they had
 * existed. A sixth secret is now covered by adding it to that one mapping.
 */
function redactSettings(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unparseable blob: hand back the raw string rather than dropping it, so a
    // corrupted settings key is still visible in the export the user downloads.
    return raw;
  }
  // The catch above deliberately wraps JSON.parse ALONE. It used to wrap the
  // redaction too, which turned any fault in the walk into `return raw` — i.e.
  // a broken mapping would have emitted the whole settings blob UNREDACTED,
  // every secret in it, and reported success. Measured, not theorised: deleting
  // one mapping entry did exactly that. A redaction backstop must fail loudly.
  let out = { ...(parsed as Record<string, unknown>) };
  for (const id of SECRET_IDS) {
    out = redactPath(out, SECRET_SETTINGS_PATHS[id]);
  }
  return out;
}

/** JSON of the current live config keys, with secrets redacted. For download. */
export function exportConfig(): string {
  const store = ls();
  const out: Record<string, unknown> = {};
  if (store) {
    for (const key of CONFIG_KEYS) {
      const value = store.getItem(key);
      if (value === null) continue;
      out[key] = key === SETTINGS_KEY ? redactSettings(value) : value;
    }
  }
  return JSON.stringify(out, null, 2);
}

/** Best-effort read of the persisted UI language (for the recovery surfaces,
 *  which render outside the settings provider). Defaults to en-US. */
export function readPersistedLang(): Lang {
  const store = ls();
  if (!store) return "en-US";
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (!raw) return "en-US";
    const parsed = JSON.parse(raw) as { language?: unknown };
    return migrateLang(parsed.language);
  } catch {
    return "en-US";
  }
}
