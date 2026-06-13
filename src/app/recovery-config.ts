// src/app/recovery-config.ts
//
// Non-destructive recovery of the three config keys that can brick the app.
// "Quarantine" copies each live key to a timestamped backup key and then
// removes the live key (so defaults load next boot) — a reversible MOVE, never
// a delete. Restore reverses it. Export downloads the current config (secrets
// redacted). All localStorage access is guarded; nothing throws to callers.

import { type Lang, migrateLang } from "./i18n";

// Literal copies of the real key names (asserted equal to the source consts in
// recovery-config.test.ts, so they can't drift). Kept literal so this pure
// module doesn't import the React-bearing use-settings/portfolio-mode modules.
const SETTINGS_KEY = "lop-app:settings";
const MODE_KEY = "lop-app:portfolio-mode";
const CURRENT_TURSO_PROJECT_KEY = "lop-app:turso-current-project";

export const CONFIG_KEYS = [SETTINGS_KEY, MODE_KEY, CURRENT_TURSO_PROJECT_KEY] as const;

const BACKUP_PREFIX = "lop-app:recovery-backup:";
const INDEX_KEY = "lop-app:recovery-backups";
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

/** Move each present config key to a timestamped backup key, then remove the
 *  live key. Returns the backup id (null if nothing was backed up or storage
 *  is unavailable). */
export function quarantineConfig(): { ok: boolean; id: string | null } {
  const store = ls();
  if (!store) return { ok: false, id: null };
  try {
    const id = String(Date.now());
    const movedKeys: string[] = [];
    for (const key of CONFIG_KEYS) {
      const value = store.getItem(key);
      if (value === null) continue;
      store.setItem(`${BACKUP_PREFIX}${id}:${key}`, value); // copy first
      store.removeItem(key); // then drop the live key (recoverable move)
      movedKeys.push(key);
    }
    if (movedKeys.length === 0) return { ok: true, id: null };
    const index = readIndex(store);
    index.unshift({ id, at: new Date().toISOString(), keys: movedKeys });
    store.setItem(INDEX_KEY, JSON.stringify(index));
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
    const jira = out.jira as { token?: string } | undefined;
    if (jira?.token) out.jira = { ...jira, token: REDACTED };
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
