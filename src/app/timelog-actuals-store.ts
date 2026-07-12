// Per-device, per-project Timelog actuals cache. Mirrors landing-state.ts:
// a single localStorage key, defensive parse, SSR guard, bounded size.
// NOT a Workspace field — never exported, never in Turso, cleared by
// app-reset's `aipm-cockpit:*` sweep.
import type { ActualsAggregate } from "./timelog-actuals";
import type { TimelogProjectRef } from "./timelog-match";
import type { TimelogUser } from "./timelog-types";

export const TIMELOG_ACTUALS_KEY = "aipm-cockpit:timelog-actuals";
const MAX_PROJECTS = 50;

// The matching-UI inputs (`users`/`projectRefs`) are cached ALONGSIDE the
// aggregates so the People/Projects tables survive a view remount instead of
// going empty while the KPIs (read from `aggregates`) still show. Optional for
// back-compat with entries written before this field existed.
export type ActualsCacheEntry = {
  fetchedAt: string;
  // Optional: a directory-only "Load people" persists users without aggregates
  // (bookings not fetched yet). Present once "Fetch bookings" has run.
  aggregates?: ActualsAggregate;
  users?: TimelogUser[];
  projectRefs?: TimelogProjectRef[];
};
type CacheMap = Record<string, ActualsCacheEntry>;

function isEntry(v: unknown): v is ActualsCacheEntry {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const e = v as ActualsCacheEntry;
  if (typeof e.fetchedAt !== "string") return false;
  if (e.aggregates !== undefined && (typeof e.aggregates !== "object" || e.aggregates === null || Array.isArray(e.aggregates))) return false;
  if (e.users !== undefined && !Array.isArray(e.users)) return false;
  if (e.projectRefs !== undefined && !Array.isArray(e.projectRefs)) return false;
  return true;
}

function readMap(): CacheMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TIMELOG_ACTUALS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: CacheMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEntry(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadActualsCache(projectId: string): ActualsCacheEntry | undefined {
  return readMap()[projectId];
}

export function clearActualsCache(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    const map = readMap();
    if (!(projectId in map)) return;
    delete map[projectId];
    window.localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify(map));
  } catch {
    // quota / disabled — non-fatal
  }
}

export function saveActualsCache(projectId: string, entry: ActualsCacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    const map = readMap();
    map[projectId] = entry;
    const entries = Object.entries(map);
    if (entries.length > MAX_PROJECTS) {
      entries.sort((a, b) => b[1].fetchedAt.localeCompare(a[1].fetchedAt));
      const kept: CacheMap = {};
      for (const [k, v] of entries.slice(0, MAX_PROJECTS)) kept[k] = v;
      window.localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify(kept));
      return;
    }
    window.localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify(map));
  } catch {
    // quota / disabled — non-fatal
  }
}
