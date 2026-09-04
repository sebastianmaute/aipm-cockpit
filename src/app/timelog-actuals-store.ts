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
  // ★★★ The date window the roll above was FETCHED over, inclusive. The roll is
  // a window-and-scope SNAPSHOT — `finish` replaces it wholesale from the
  // current fetch's items — so a day absent from it is ambiguous on its own:
  // either nobody booked that day, or that day was never fetched. This field is
  // what separates the two, and without it a stored insight about February
  // resolves as a clean win the moment somebody fetches April.
  // ★★ ONE field holding BOTH ends rather than two loose ones: it cannot
  // half-arrive, it is one thing to carry through a saver and one thing to
  // validate. `from` and `to` are ISO `YYYY-MM-DD` with `from <= to`.
  // ★★ Optional, exactly like `daily` and `partial`, for entries written before
  // it existed. A roll WITHOUT a window is a real, readable state — "covered
  // days unknown" — and a reader must be able to tell it apart from a window
  // that demonstrably covers the days it is asking about. It rides along on
  // EVERY save for the same reason `daily` does: an entry is rewritten whole,
  // so a saver that omits it CLEARS it (register §172).
  dailyWindow?: TimelogRollWindow;
};

/** The inclusive ISO `YYYY-MM-DD` date range a `daily` roll was fetched over. */
export type TimelogRollWindow = { from: string; to: string };

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
  // ★★ `dailyWindow` is unchecked here for the SAME reason and by the same
  // rule — `withCheckedDailyWindow` below strips it instead. Rejecting the
  // entry would fail CLOSED, dropping a network-round-trip's worth of
  // aggregates AND the roll itself over an optional field.
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strip a malformed roll window, keeping the rest of the entry — the fail-open
 *  rule `withCheckedDaily` applies to the roll, one field over.
 *  ★★★ ALL-OR-NOTHING, and that is the point: unlike the roll, whose cells are
 *  stripped INDIVIDUALLY, a half-valid window is worse than no window at all. A
 *  reader asking "did the roll cover these days?" gets `false`/unknown from an
 *  absent window and goes on being careful; from a window with one real end and
 *  one garbage end it gets a confident answer computed from a bound that was
 *  never real. So a window survives only if BOTH ends are ISO-shaped strings.
 *  ★★ `from > to` is rejected rather than swapped. An inverted window covers
 *  nothing, and quietly reordering the ends would invent a range no fetch ever
 *  requested — fabricating coverage is the one direction that cannot be walked
 *  back. `from === to` is legal: a single-day fetch is a real window.
 *  ★ SHAPE, not sense — the regex admits `9999-99-99`. It exists to keep the
 *  `<`/`>` comparisons downstream lexicographically meaningful, not to certify
 *  that a date exists. */
function withCheckedDailyWindow(e: ActualsCacheEntry): ActualsCacheEntry {
  const w: unknown = e.dailyWindow;
  if (w === undefined) return e;
  if (typeof w === "object" && w !== null && !Array.isArray(w)) {
    const { from, to } = w as Record<string, unknown>;
    if (
      typeof from === "string" &&
      typeof to === "string" &&
      ISO_DATE_RE.test(from) &&
      ISO_DATE_RE.test(to) &&
      from <= to
    ) {
      return e;
    }
  }
  const copy = { ...e };
  delete copy.dailyWindow;
  return copy;
}

function readMap(): CacheMap {
  const parsed = readDeviceJson<unknown>(TIMELOG_ACTUALS_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: CacheMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isEntry(v)) out[k] = withCheckedDailyWindow(withCheckedDaily(v));
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
