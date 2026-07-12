// src/app/recovery-config.ts
//
// Non-destructive recovery of the three config keys that can brick the app.
// "Quarantine" copies each live key to a timestamped backup key and then
// removes the live key (so defaults load next boot) — a reversible MOVE, never
// a delete. Restore reverses it. Export downloads the current config (secrets
// redacted). All localStorage access is guarded; nothing throws to callers.

import { type Lang, migrateLang } from "./i18n";
import { migrateLocalStorage } from "./storage-migration";

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
    migrateLocalStorage(); // normalize any pre-upgrade lop-app: backup keys first
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
  migrateLocalStorage(); // normalize any pre-upgrade lop-app: backup index first
  return readIndex(store);
}

function redactSettings(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...parsed };
    const integrations = out.integrations as { turso?: { authToken?: string } } | undefined;
    if (integrations?.turso?.authToken) {
      out.integrations = {
        ...integrations,
        turso: { ...integrations.turso, authToken: REDACTED },
      };
    }
    const jira = out.jira as { apiToken?: string } | undefined;
    if (jira?.apiToken) out.jira = { ...jira, apiToken: REDACTED };
    // Defense-in-depth: writeSettings already blanks ai.apiKey before persisting,
    // but redact here too so a config export can never leak it if that regresses.
    const ai = out.ai as { apiKey?: string } | undefined;
    if (ai?.apiKey) out.ai = { ...ai, apiKey: REDACTED };
    return out;
  } catch {
    return raw;
  }
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
