// Per-device, per-project Timelog actuals cache. Mirrors landing-state.ts:
// a single localStorage key, defensive parse, SSR guard, bounded size.
// NOT a Workspace field — never exported, never in Turso, cleared by
// app-reset's `aipm-cockpit:*` sweep.
import { readDeviceJson, writeDeviceJson } from "./device-store";
import type { ActualsAggregate } from "./timelog-actuals";
import type { TimelogProjectRef } from "./timelog-match";
import { isDailyCell, type TimelogDailyRoll, type TimelogUser } from "./timelog-types";

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
  // ★★★ TRUE when the fetch that produced `aggregates` LOST at least one TimeLog
  // project (or, on the per-user path, at least one employee) to an error.
  // Apply OWNS every allocation line of a period it routes and writes the lines
  // it did NOT route to `0`, so applying a short aggregate ERASES the missing
  // project's real booked hours. Every apply path gates on it via
  // `canApplyToBudget` (timelog-guards.ts); a later CLEAN fetch clears it.
  // ★★ ABSENT MEANS COMPLETE, which is what makes the field back-compatible: an
  // entry written before it existed — on a device an older client may still
  // read — keeps exactly its old meaning, and an older client ignores it.
  // ★★ Read it as `=== true`, never truthiness. `isEntry` deliberately does not
  // reject a malformed value: rejecting would drop the whole entry (losing good
  // aggregates over a flag), and treating a hand-edited `"false"` as partial
  // would disable Apply with no way back but Clear all. Failing OPEN on garbage
  // only restores the pre-existing behaviour. See open-followups §172.
  partial?: boolean;
  // Per-(user, date) roll — the guardrail rules' only input. Optional for
  // back-compat with entries written before this field existed.
  // ★★ Like `partial`, this rides along on EVERY save. An entry is rewritten
  // whole, so a save that omits it CLEARS it (register §172, one field over).
  daily?: TimelogDailyRoll;
};
type CacheMap = Record<string, ActualsCacheEntry>;

function isEntry(v: unknown): v is ActualsCacheEntry {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const e = v as ActualsCacheEntry;
  if (typeof e.fetchedAt !== "string") return false;
  if (e.aggregates !== undefined && (typeof e.aggregates !== "object" || e.aggregates === null || Array.isArray(e.aggregates))) return false;
  if (e.users !== undefined && !Array.isArray(e.users)) return false;
  if (e.projectRefs !== undefined && !Array.isArray(e.projectRefs)) return false;
  // ★★★ `daily` is DELIBERATELY NOT CHECKED HERE. The obvious branch —
  // `if (e.daily !== undefined && !isRoll(e.daily)) return false;` — matches
  // the three above but fails CLOSED: it drops the whole entry, losing
  // aggregates that cost a network round trip, over an optional field no
  // aggregate reader touches. `partial` already made that call (§172); the
  // roll gets the same treatment one field over. `withCheckedDaily` below
  // strips the malformed PARTS instead: a `daily` that is not a plain object
  // goes whole, and inside one, every cell that is not cell-SHAPED goes on its
  // own — so no consumer ever reads a cell it cannot read. ★★ SHAPE, not
  // sense: the three fields are checked for being finite numbers, never for
  // being plausible ones, so a negative or absurd `hours` still reaches the
  // rules. Measured, not reasoned: with the rejecting branch in
  // place, "keeps the rest of an entry whose daily field is malformed" is RED.
  return true;
}

/** ★★ The cell-shape rule MOVED to `timelog-types.ts` — a leaf both this store
 *  and the pure `timelog-policy.ts` engine already import — so that the cache
 *  ingress and the engine's own defensive loop apply ONE predicate rather than
 *  two that can drift. Its full docstring lives there. Re-exported here so this
 *  store's public surface is unchanged. ★ It is no longer true that the engine
 *  reads a cell UNGUARDED: it now skips a non-cell value itself. This store
 *  still strips one on load, because fixing bad data at the ingress beats every
 *  reader remembering to. */
export { isDailyCell };

/** Strip what is not a roll, keeping the rest of the entry. The fail-open half
 *  of the rule stated in `isEntry`, applied at CELL granularity: one corrupt
 *  day must cost neither the other days' cells nor the cache entry it rode in
 *  on — §172's principle one level down.
 *  ★ The KEY is deliberately NOT validated here. `parseDailyKey` already skips
 *  a malformed one downstream; a second key rule in a second place is how the
 *  two drift apart.
 *  ★ A clean roll is returned BY IDENTITY — the rebuild runs only when a cell
 *  was actually dropped, so the common path allocates nothing. */
function withCheckedDaily(e: ActualsCacheEntry): ActualsCacheEntry {
  const d: unknown = e.daily;
  if (d === undefined) return e;
  if (typeof d !== "object" || d === null || Array.isArray(d)) {
    const copy = { ...e };
    delete copy.daily;
    return copy;
  }
  const entries = Object.entries(d as Record<string, unknown>);
  if (entries.every(([, cell]) => isDailyCell(cell))) return e;
  const kept: TimelogDailyRoll = {};
  for (const [k, cell] of entries) {
    if (isDailyCell(cell)) kept[k] = cell;
  }
  return { ...e, daily: kept };
}

function readMap(): CacheMap {
  const parsed = readDeviceJson<unknown>(TIMELOG_ACTUALS_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: CacheMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isEntry(v)) out[k] = withCheckedDaily(v);
  }
  return out;
}

export function loadActualsCache(projectId: string): ActualsCacheEntry | undefined {
  return readMap()[projectId];
}

export function clearActualsCache(projectId: string): void {
  const map = readMap();
  if (!(projectId in map)) return;
  delete map[projectId];
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
