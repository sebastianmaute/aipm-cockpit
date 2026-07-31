// Per-device, per-project Timelog actuals cache. Mirrors landing-state.ts:
// a single localStorage key, defensive parse, SSR guard, bounded size.
// NOT a Workspace field — never exported, never in Turso, cleared by
// app-reset's `aipm-cockpit:*` sweep.
import { readDeviceJson, writeDeviceJson } from "./device-store";
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
  const parsed = readDeviceJson<unknown>(TIMELOG_ACTUALS_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: CacheMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isEntry(v)) out[k] = v;
  }
  return out;
}

/** Reads the entry for `projectId`, falling back ONCE to `legacyProjectId`.
 *
 *  ★ Read-only on purpose. The call sites are lazy `useState` initializers, so
 *  writing here would be a side effect during render (double-invoked under
 *  StrictMode). The entry migrates to the canonical key on the next
 *  `saveActualsCache`, which already writes whatever key it is given. The
 *  orphaned legacy entry is bounded by MAX_PROJECTS. See open-followups §14. */
export function loadActualsCache(projectId: string, legacyProjectId?: string): ActualsCacheEntry | undefined {
  const map = readMap();
  const hit = map[projectId];
  if (hit) return hit;
  if (legacyProjectId && legacyProjectId !== projectId) return map[legacyProjectId];
  return undefined;
}

/** ★★ Deletes BOTH keys. Clearing only the canonical one would let the
 *  legacy fallback above resurrect the cleared cache on the next mount. */
export function clearActualsCache(projectId: string, legacyProjectId?: string): void {
  const map = readMap();
  const ids = legacyProjectId && legacyProjectId !== projectId ? [projectId, legacyProjectId] : [projectId];
  const present = ids.filter((id) => id in map);
  if (present.length === 0) return;
  for (const id of present) delete map[id];
  writeDeviceJson(TIMELOG_ACTUALS_KEY, map);
}

export function saveActualsCache(projectId: string, entry: ActualsCacheEntry): void {
  const map = readMap();
  map[projectId] = entry;
  const entries = Object.entries(map);
  if (entries.length > MAX_PROJECTS) {
    entries.sort((a, b) => b[1].fetchedAt.localeCompare(a[1].fetchedAt));
    const kept: CacheMap = {};
    for (const [k, v] of entries.slice(0, MAX_PROJECTS)) kept[k] = v;
    writeDeviceJson(TIMELOG_ACTUALS_KEY, kept);
    return;
  }
  writeDeviceJson(TIMELOG_ACTUALS_KEY, map);
}
