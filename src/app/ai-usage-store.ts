import { LEGACY_PATH } from "./ai-usage-paths";
import type { Usage, UsageBuckets } from "./ai-usage";
import { isoDate, mondayOf, normalizeUsage } from "./ai-usage";

/** The per-path store. The pre-path key is read once for migration and never written again. */
export const AI_USAGE_BY_PATH_KEY = "aipm-cockpit:ai-usage-by-path";
/** The pre-path key (day -> one usage): read once for migration, never written again. */
export const AI_USAGE_KEY = "aipm-cockpit:ai-usage";

/** day `YYYY-MM-DD` -> path id -> usage */
export type PathBuckets = Record<string, Record<string, Usage>>;

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

function write(storage: Storage, b: PathBuckets): void {
  try {
    storage.setItem(AI_USAGE_BY_PATH_KEY, JSON.stringify(b));
  } catch {
    // non-fatal: storage quota or private browsing
  }
}

export function readPathBuckets(storage: Storage): PathBuckets {
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
  const migrated: PathBuckets = {};
  for (const [day, u] of Object.entries(old)) {
    migrated[day] = { [LEGACY_PATH]: normalizeUsage(isRecord(u) ? (u as Partial<Usage>) : undefined) };
  }
  write(storage, migrated); // so migration runs once
  return migrated;
}

/** Reads the stored value, adds, writes, returns the result: a caller's cached copy is never
 *  written, so a second tab's recording is not overwritten. `addToBuckets` applies no day
 *  retention, so none is applied here. */
export function recordPathUsage(storage: Storage, when: Date, path: string, usage: Usage): PathBuckets {
  const current = readPathBuckets(storage);
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
  write(storage, next);
  return next;
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
