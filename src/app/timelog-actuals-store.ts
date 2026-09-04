// Per-device, per-project Timelog actuals cache. Mirrors landing-state.ts:
// a single localStorage key, defensive parse, SSR guard, bounded size.
// NOT a Workspace field — never exported, never in Turso, cleared by
// app-reset's `aipm-cockpit:*` sweep.
import { readDeviceJson, writeDeviceJson } from "./device-store";
import type { ActualsAggregate } from "./timelog-actuals";
import type { TimelogProjectRef } from "./timelog-match";
import { isDailyCell, parseDailyKey, type TimelogDailyRoll, type TimelogUser } from "./timelog-types";

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
  // ★★★ THE SCOPE HALF OF THE SAME CLAIM, and `dailyWindow` alone was NOT
  // enough — shipping the window without this was a Critical. The roll is a
  // window-AND-SCOPE snapshot: `fetchBookings(start, end, userIds)` iterates
  // only the ticked people, and a successful narrow fetch sets `partial: false`
  // because nothing failed. So the days check passes, the rule reports itself
  // evaluated, and every UNFETCHED person's stored insight finds no violation
  // and resolves as "improved" — from one ordinary "re-check just Bob" action,
  // with no size threshold, no corruption and no second device involved.
  // ★★ The userIds the roll COVERS, not the ones that violated anything: a
  // person fetched and found clean must be clearable, which is the whole point
  // of the feature. Absent means "scope unknown" and FREEZES, exactly like an
  // absent window — the recoverable direction, and the back-compat rule for
  // entries written before this field existed.
  // ★★ Rides on EVERY save via `rollPair`, for the §172 reason: an entry is
  // rewritten whole, so a saver that omits it CLEARS it.
  dailyUsers?: readonly number[];
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

/** ALL-OR-NOTHING, like the window and for the same reason: a scope claim that
 *  is partly garbage is not a narrower claim, it is an unknown one, and keeping
 *  the readable half would certify coverage for whoever happened to parse. A
 *  non-array, or any member that is not a positive integer, drops the field —
 *  which reads as "scope unknown" and FREEZES.
 *  ★ Positive, mirroring `buildDailyRoll`'s `userId <= 0` skip: `mapV2TimeItem`
 *  falls back to `0` for an unidentified booker, so 0 is a sentinel here too and
 *  must never be admitted as a covered person. */
function withCheckedDailyUsers(e: ActualsCacheEntry): ActualsCacheEntry {
  const u: unknown = e.dailyUsers;
  if (u === undefined) return e;
  if (Array.isArray(u) && u.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)) {
    return e;
  }
  const copy = { ...e };
  delete copy.dailyUsers;
  return copy;
}

function readMap(): CacheMap {
  const parsed = readDeviceJson<unknown>(TIMELOG_ACTUALS_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: CacheMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isEntry(v)) out[k] = withCheckedDailyUsers(withCheckedDailyWindow(withCheckedDaily(v)));
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

/** ★★★ The largest `daily` roll ONE cache entry may persist, measured as the
 *  length of that roll's own `JSON.stringify`.
 *  DERIVATION. A cell serialises as
 *  `"7|2026-09-01":{"hours":8,"maxEntryHours":8,"entryCount":1}` — measured at
 *  61.5 chars/cell for a narrow-id whole-hour roll and 71.0 for six-digit ids
 *  with fractional hours, so ~70 is the conservative planning figure. 512 KiB
 *  therefore holds roughly 7,400 cells: a 30-booker team across a full 250-day
 *  year, or a 200-booker org-scope fetch across its most recent ~37 days.
 *  UNBOUNDED, that same org-scope fetch across 250 days is 50,000 cells and
 *  measured 3,073,001 chars — against a localStorage origin quota of roughly
 *  5 MB shared with every other `aipm-cockpit:*` key. `writeDeviceJson`
 *  swallows the resulting quota error, so the ENTIRE save is lost silently,
 *  `aggregates` included: a network round trip discarded in order to persist a
 *  field no aggregate reader touches. This cap keeps one roll near a tenth of
 *  that quota.
 *  ★★ `.length` counts UTF-16 code units, not bytes. For a real roll — ASCII
 *  keys, numeric values — the two are equal, and browsers bill localStorage in
 *  UTF-16 units anyway, so this is if anything the more honest measure.
 *  ★★★ WHAT IT DOES NOT PROTECT AGAINST, stated plainly: this is a PER-ENTRY
 *  bound, so 50 entries (`MAX_PROJECTS`) each sitting just under it is ~25 MB
 *  and blows the origin quota exactly as before. Only projects actually
 *  fetched carry a roll at all, so that is a theoretical rather than an
 *  observed shape — but it is a real hole, and the map-level bound remains
 *  `MAX_PROJECTS` eviction ALONE, which counts entries and never measures them.
 *  ★ Per-entry was chosen over a whole-map budget because a whole-map trim
 *  would have to shrink some OTHER project's roll during a save for THIS one,
 *  and every trim rewrites a `dailyWindow` — a coverage CLAIM the insights
 *  reconcile trusts. A save for project A silently narrowing project B's claim
 *  is a worse failure than the quota headroom it would buy. `MAX_PROJECTS`
 *  eviction is the safe map-level lever precisely because it drops entries
 *  WHOLE: an absent entry reads as "unknown", which FREEZES insights. */
export const MAX_DAILY_ROLL_CHARS = 512 * 1024;

/** Bound one entry's `daily` roll to `MAX_DAILY_ROLL_CHARS` by dropping the
 *  OLDEST dates first, and narrow `dailyWindow.from` to whatever survived.
 *  ★★★ THE NARROWING IS THE POINT, NOT A TIDY-UP. `dailyWindow` is a CLAIM —
 *  "the roll holds data for these dates" — and `task-manager.tsx`'s insights
 *  reconcile clears a guardrail insight only when that window COVERS the
 *  insight's `[firstViolationDate, lastViolationDate]`. Trim days out of the
 *  roll while leaving the window intact and the claim goes false in the one
 *  direction that cannot be walked back: the insight reads as covered, the
 *  trimmed roll yields no violation, and it resolves as a fabricated
 *  `"improved"` written into `Workspace.insights` — shared, exported, and read
 *  on every AI turn. So the trim and the narrowing live in ONE function on the
 *  write path all four savers funnel through, and cannot be written out of
 *  step.
 *  ★★ Nothing surviving drops `daily` AND `dailyWindow` TOGETHER. A missing
 *  window makes the reconcile FREEZE (`rollWindow === undefined` returns
 *  false), which is the recoverable direction and already the back-compat rule.
 *  Everything else in the entry is written regardless: losing the roll must
 *  never cost the `aggregates` beside it.
 *  ★★ `from` is RAISED, never lowered. A roll carrying a day outside its own
 *  declared window would otherwise WIDEN the claim — fabricating coverage, the
 *  same harm one level down — so the write is gated on `earliest > from`.
 *  ★ A roll within budget is returned BY IDENTITY: the common path allocates
 *  nothing, and an unparseable key survives untouched because validating keys
 *  is deliberately not this store's job (`withCheckedDaily` says why). During a
 *  TRIM such a key is dropped instead — it cannot be ordered against the
 *  others, so there is no honest way to call it old or new, and it must not
 *  become the new `from`. The same goes for a key `parseDailyKey` accepts whose
 *  date is not ISO-shaped: `ISO_DATE_RE` is this file's own WINDOW rule, not a
 *  second key rule, and gating retention and `from` on one set keeps them from
 *  drifting apart. */
function withBoundedDaily(e: ActualsCacheEntry): ActualsCacheEntry {
  const d: unknown = e.daily;
  // Anything that is not a plain object is left for the read path to strip.
  if (typeof d !== "object" || d === null || Array.isArray(d)) return e;
  const roll = d as TimelogDailyRoll;
  if (JSON.stringify(roll).length <= MAX_DAILY_ROLL_CHARS) return e;

  // ★ Cost of one `"key":cell` pair PLUS the comma joining it to the next, so
  // the running total over-counts by exactly one comma — conservative, which
  // is the side to err on when the penalty is a silently swallowed write.
  const dated: { key: string; date: string; cost: number }[] = [];
  for (const [key, cell] of Object.entries(roll)) {
    const parsed = parseDailyKey(key);
    if (!parsed || !ISO_DATE_RE.test(parsed.date)) continue;
    dated.push({
      key,
      date: parsed.date,
      cost: JSON.stringify(key).length + 1 + JSON.stringify(cell).length + 1,
    });
  }
  // Oldest first. The key breaks a tie so two users on one date order stably.
  dated.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)));

  // Walk NEWEST-first, keeping while the total fits, and stop at the first that
  // does not — everything before it is older still, so the survivors are a
  // contiguous newest-end run.
  let used = 2; // the enclosing `{}`
  let firstKept = dated.length;
  for (let i = dated.length - 1; i >= 0; i -= 1) {
    const next = used + dated[i].cost;
    if (next > MAX_DAILY_ROLL_CHARS) break;
    used = next;
    firstKept = i;
  }

  const copy = { ...e };
  if (firstKept >= dated.length) {
    delete copy.daily;
    delete copy.dailyWindow;
    // The scope claim describes the roll; with no roll left it claims nothing.
    delete copy.dailyUsers;
    return copy;
  }
  const kept: TimelogDailyRoll = {};
  for (let i = firstKept; i < dated.length; i += 1) kept[dated[i].key] = roll[dated[i].key];
  copy.daily = kept;
  const window = copy.dailyWindow;
  if (window !== undefined) {
    // ★★★ THE BOUNDARY DATE IS ONLY HALF-RETAINED, AND `from` MUST NEVER NAME IT.
    // The roll is keyed `userId|date`, so `dated` carries one entry per (user,
    // date) and the sort groups a date's bookers together. The survivor run
    // starts at `firstKept`, which lands INSIDE a date group whenever that date
    // has more bookers than the remaining budget — the normal case for any
    // multi-booker roll, not an edge. Naming that date as `from` claims coverage
    // for the bookers whose cells were just dropped: their stored insights pass
    // `isEvaluated`'s window check, find no violation because the cell is gone,
    // and clear as "improved" into the shared, exported workspace. Advance to
    // the first FULLY retained date instead.
    // ★ The half-retained cells STAY in `daily` — they are real measurements and
    // the rules should still read them. Only the coverage CLAIM narrows.
    let firstFull = firstKept;
    if (firstKept > 0 && dated[firstKept - 1].date === dated[firstKept].date) {
      const partialDate = dated[firstKept].date;
      while (firstFull < dated.length && dated[firstFull].date === partialDate) firstFull += 1;
    }
    if (firstFull >= dated.length) {
      // The only retained date is a partial one — no honest window survives.
      delete copy.dailyWindow;
    } else {
      const earliest = dated[firstFull].date;
      // Past the far end there is no honest window left to state — freeze.
      if (earliest > window.to) delete copy.dailyWindow;
      else if (earliest > window.from) copy.dailyWindow = { from: earliest, to: window.to };
    }
  }
  return copy;
}

export function saveActualsCache(projectId: string, entry: ActualsCacheEntry): void {
  const map = readMap();
  map[projectId] = withBoundedDaily(entry);
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
