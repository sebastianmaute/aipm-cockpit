// Per-device, per-project Timelog actuals cache. Mirrors landing-state.ts:
// a single localStorage key, defensive parse, SSR guard, bounded size.
// NOT a Workspace field — never exported, never in Turso, cleared by
// app-reset's `lop-app:*` sweep.
import type { ActualsAggregate } from "./timelog-actuals";

export const TIMELOG_ACTUALS_KEY = "lop-app:timelog-actuals";
const MAX_PROJECTS = 50;

export type ActualsCacheEntry = { fetchedAt: string; aggregates: ActualsAggregate };
type CacheMap = Record<string, ActualsCacheEntry>;

function isEntry(v: unknown): v is ActualsCacheEntry {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const e = v as ActualsCacheEntry;
  if (typeof e.fetchedAt !== "string") return false;
  if (!e.aggregates || typeof e.aggregates !== "object" || Array.isArray(e.aggregates)) return false;
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
