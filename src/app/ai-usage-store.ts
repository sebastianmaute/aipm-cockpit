import { LEGACY_PATH } from "./ai-usage-paths";
import type { Usage, UsageBuckets } from "./ai-usage";
import { isoDate, mondayOf, normalizeUsage } from "./ai-usage";

/** The per-path store. The pre-path key is read once for migration and never written again. */
export const AI_USAGE_BY_PATH_KEY = "aipm-cockpit:ai-usage-by-path";
/** The pre-path key (day -> one usage): read once for migration, never written again. */
export const AI_USAGE_KEY = "aipm-cockpit:ai-usage";

/** day `YYYY-MM-DD` -> path id -> usage */
export type PathBuckets = Record<string, Record<string, Usage>>;

/** Days the store keeps: today and the days before it, back to this many days in all. Every reader reads the
 *  current week only (`weekToDate`, `weekByPath`: Monday through today, at most seven days), so a day before
 *  this window is never read again. Pruned on every write and on the one-time migration, since the store holds
 *  a row per path per day. */
export const USAGE_RETENTION_DAYS = 7;

/** `b` without the days before the retention window that ends on `now`'s day, and without keys that are not a
 *  day (no reader can place them in a week). */
function pruneOldDays(b: PathBuckets, now: Date): PathBuckets {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (USAGE_RETENTION_DAYS - 1));
  const out: PathBuckets = {};
  for (const [day, paths] of Object.entries(b)) {
    const d = new Date(`${day}T00:00:00`);
    if (!Number.isNaN(d.getTime()) && d >= first) out[day] = paths;
  }
  return out;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function sanitizePathBuckets(v: unknown): PathBuckets {
  const out: PathBuckets = {};
  if (!isRecord(v)) return out;
  for (const [day, paths] of Object.entries(v)) {
    if (!isRecord(paths)) continue;
    const row: Record<string, Usage> = {};
    for (const [path, u] of Object.entries(paths)) {
      row[path] = normalizeUsage(isRecord(u) ? (u as Partial<Usage>) : undefined);
    }
    out[day] = row;
  }
  return out;
}

/** False when storage refused the write (quota, private browsing). */
function write(storage: Storage, b: PathBuckets): boolean {
  try {
    storage.setItem(AI_USAGE_BY_PATH_KEY, JSON.stringify(b));
    return true;
  } catch {
    return false;
  }
}

/** `now` dates the retention window the one-time migration prunes to. */
export function readPathBuckets(storage: Storage, now: Date = new Date()): PathBuckets {
  let raw: string | null = null;
  try {
    raw = storage.getItem(AI_USAGE_BY_PATH_KEY);
  } catch {
    return {};
  }
  if (raw !== null) return sanitizePathBuckets(parseJson(raw));
  const old = parseJson(
    (() => {
      try {
        return storage.getItem(AI_USAGE_KEY);
      } catch {
        return null;
      }
    })(),
  );
  if (!isRecord(old)) return {};
  const all: PathBuckets = {};
  for (const [day, u] of Object.entries(old)) {
    all[day] = { [LEGACY_PATH]: normalizeUsage(isRecord(u) ? (u as Partial<Usage>) : undefined) };
  }
  const migrated = pruneOldDays(all, now);
  write(storage, migrated); // so migration runs once
  return migrated;
}

/** Reads the stored value, adds, writes, returns the result: a caller's cached copy is never
 *  written, so a second tab's recording is not overwritten. Days before the retention window
 *  (`USAGE_RETENTION_DAYS`) are dropped. `persisted` is false when storage refused the write: the
 *  next read would return the old value, so the caller must keep `buckets` somewhere else. */
export function recordPathUsage(
  storage: Storage, when: Date, path: string, usage: Usage,
): { readonly buckets: PathBuckets; readonly persisted: boolean } {
  const current = pruneOldDays(readPathBuckets(storage, when), when);
  const day = isoDate(when);
  const prev = normalizeUsage(current[day]?.[path]);
  const add = normalizeUsage(usage);
  const next: PathBuckets = {
    ...current,
    [day]: {
      ...current[day],
      [path]: {
        input: prev.input + add.input,
        output: prev.output + add.output,
        cacheWrite: prev.cacheWrite + add.cacheWrite,
        cacheRead: prev.cacheRead + add.cacheRead,
      },
    },
  };
  return { buckets: next, persisted: write(storage, next) };
}

function sum(list: Usage[]): Usage {
  return list.reduce(
    (a, u) => ({
      input: a.input + u.input,
      output: a.output + u.output,
      cacheWrite: a.cacheWrite + u.cacheWrite,
      cacheRead: a.cacheRead + u.cacheRead,
    }),
    { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  );
}

export function totalsByDay(b: PathBuckets): UsageBuckets {
  const out: UsageBuckets = {};
  for (const [day, paths] of Object.entries(b)) out[day] = sum(Object.values(paths).map(normalizeUsage));
  return out;
}

/** This week only, with `weekToDate`'s boundary (Monday through `now`). */
export function weekByPath(b: PathBuckets, now: Date): Record<string, Usage> {
  const start = mondayOf(now);
  const out: Record<string, Usage> = {};
  for (const [day, paths] of Object.entries(b)) {
    const d = new Date(`${day}T00:00:00`);
    if (!(d >= start && d <= now)) continue;
    for (const [path, u] of Object.entries(paths)) out[path] = sum([out[path] ?? normalizeUsage(undefined), normalizeUsage(u)]);
  }
  return out;
}
