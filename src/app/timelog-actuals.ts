// src/app/timelog-actuals.ts — pure, i18n-free aggregation of Timelog bookings.
import type { PlanGranularity } from "./types";
import { periodKeyForDate } from "./resource-capacity";
import { granularityOfPeriodKey } from "./actual-hours";
import { isRealCalendarDate } from "./sanitize-core";
import { dailyKey, type TimelogDailyRoll } from "./timelog-types";
import type { TimelogTimeItem, TimelogLinks } from "./timelog-types";

export type HourCell = { hours: number; billableHours: number };
/** One resource's hours inside a cell. `byDay` is present on cells derived from
 *  a dated aggregate (`bucketOverlay` over `byBucketDay`) and lets Apply write
 *  day keys; a legacy cached cell has no `byDay`. */
export type ResourceDayCell = HourCell & { byDay?: Record<string, number> };
/** A bucket·period total PLUS the per-resource breakdown that produced it.
 *  The breakdown is what lets apply attribute hours to the right role line —
 *  without it apply can only guess, and it guessed allocations[0], costing
 *  every person at the first role's rate. Structural SUPERSET of HourCell, so
 *  readers of `.hours`/`.billableHours` (the overlay display) are unchanged.
 *  Invariant: the breakdown sums to the total (pinned by a test).
 *
 *  OPTIONAL on purpose: the actuals cache (`aipm-cockpit:timelog-actuals`) is
 *  persisted per-device and its guard only shallow-checks `aggregates`, so an
 *  entry written before this field existed deserializes without it. Aggregation
 *  always writes it; readers must tolerate its absence (apply treats those hours
 *  as unattributable and surfaces them rather than guessing). Since dated
 *  actuals, the fetch stores day cells (`byBucketDay`) and periods are derived
 *  at read time by `bucketOverlay`. */
export type BucketPeriodCell = HourCell & { byResource?: Record<number, ResourceDayCell> };
/** bucketId → PERIOD key ("YYYY-MM" / "YYYY-Www") → cell. Derived at read time
 *  by `bucketOverlay`; the legacy `byBucket` field of a pre-dated-actuals cache
 *  entry has this shape. */
export type ActualsByBucket = Record<number, Record<string, BucketPeriodCell>>;
/** bucketId → DAY key ("YYYY-MM-DD") → cell. What the fetch stores. */
export type ActualsByBucketDay = Record<number, Record<string, BucketPeriodCell>>;
export type ActualsByResource = Record<number, HourCell>;
export type ActualsAggregate = {
  /** LEGACY: period-keyed cells written before dated actuals, frozen at the
   *  granularity of that fetch. New fetches never write it. Read it only through
   *  `bucketOverlay`, which drops keys that do not match the live granularity. */
  byBucket?: ActualsByBucket;
  /** Day-keyed cells. Read through `bucketOverlay`. */
  byBucketDay?: ActualsByBucketDay;
  byResource: ActualsByResource;
  unattributed: HourCell;
  /** The hours inside `unattributed` that failed the DATE check specifically.
   *
   *  ★★★ A SUBSET OF `unattributed`, NEVER A SIBLING. Every row counted here is
   *  ALSO counted there, so no existing reader of `unattributed` changes meaning
   *  and none had to be touched. Pinned by a test ("reports undated hours as a
   *  strict subset of unattributed") rather than left to this comment, because a
   *  comment cannot fail when someone widens the predicate.
   *
   *  It exists because the two causes carry OPPOSITE remedies and the surfaces
   *  were offering only one. A link-broken row is repaired by fixing the link
   *  and re-fetching; a row whose `date` is not a calendar day (see ISO_DAY_RE)
   *  has healthy links and a re-fetch returns the same junk — the defect is in
   *  the source data, so telling that user to re-fetch sends them in a circle.
   *
   *  OPTIONAL on purpose, exactly like `BucketPeriodCell.byResource` and for the
   *  same reason: the actuals cache (`aipm-cockpit:timelog-actuals`) is persisted
   *  per-device and its guard only shallow-checks `aggregates`, so an entry
   *  written before this field existed deserializes without it. Aggregation
   *  always writes it; readers must tolerate its absence. */
  undated?: HourCell;
};

/** Can this row be attributed to a PERIOD? Used by `aggregateActuals` ALONE.
 *
 *  ★★★ ONE CONSUMER, DELIBERATELY, AND `buildDailyRoll` MUST NOT ADOPT IT — the
 *  guard at its keying site says why at length. An earlier cut of this file
 *  applied the constant at both consumers on the reasoning that one rule for one
 *  file cannot drift; that reasoning was right about drift and wrong about what
 *  the two consumers OWE, and it silently converted a freeze into a fabricated
 *  clean. Symmetry between them is not a property worth having here.
 *
 *  ★★ DELIBERATELY LOCAL, and deliberately NOT `timelog-types.ts`'s
 *  `KEY_DATE_RE`. That one is a KEY rule — "is this daily-roll key usable?" —
 *  and its docstring argues at length why the identical `^\d{4}-\d{2}-\d{2}$`
 *  shape declared in several modules must stay several constants: each answers
 *  a different question and the answers are free to move apart. This one is a
 *  ROW rule, applied before the row's date becomes a day key at all.
 *
 *  ★ SHAPE, never existence — `9999-99-99` is admitted, matching the sibling
 *  rule. The point is to reject a date that is not a calendar day at all, not
 *  to certify that the day happened.
 *
 *  Why rows arrive malformed: `timelog-api.ts` coerces every API field through
 *  `dateOnly = (v) => s(v).slice(0, 10)` where `s` yields "" for a non-string.
 *  So an absent, null or numeric `Date` becomes `""`, and a regionally
 *  formatted `"05/01/2026"` is exactly ten characters and survives the slice
 *  untouched. Neither is a day. */
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const add = (cell: HourCell | undefined, it: TimelogTimeItem): HourCell => ({
  hours: (cell?.hours ?? 0) + it.hours,
  billableHours: (cell?.billableHours ?? 0) + it.billableHours,
});

export function aggregateActuals(
  items: readonly TimelogTimeItem[],
  links: TimelogLinks,
): ActualsAggregate {
  const userToRes = new Map(links.userLinks.map((l) => [l.timelogUserId, l.resourceId]));
  const projToBucket = new Map(links.projectLinks.map((l) => [l.timelogProjectId, l.bucketId]));
  const byBucketDay: ActualsByBucketDay = {};
  const byResource: ActualsByResource = {};
  let unattributed: HourCell = { hours: 0, billableHours: 0 };
  // The DATE-failure subset of `unattributed` — see the field's docstring for
  // why it is a subset and not a fourth bucket.
  let undated: HourCell = { hours: 0, billableHours: 0 };

  for (const it of items) {
    const resourceId = userToRes.get(it.userId);
    const bucketId = projToBucket.get(it.projectId);
    // ★★★ PLACEMENT IS LOAD-BEARING: this MUST stay above the `byResource`
    // write. The day-key write is only reached further down, so the intuitive
    // spot — beside the write whose key would be junk — is AFTER the
    // `byResource` write, and a guard there counts the same hours in
    // `byResource` AND in `unattributed`. A row is unattributable to a DAY (and
    // so to any period) exactly as an unlinked row is unattributable to a
    // BUCKET, so it takes the same exit, for the same reason, at the same point.
    // Unguarded, a malformed date would become a day key that `bucketOverlay`'s
    // `periodKeyForDate` then turns into a phantom period — measured on the
    // dates this file's ISO_DAY_RE docstring lists: month keys "" and "05/01/2",
    // week key "NaN-WNaN" for both — matching no rendered column, so the hours
    // silently disappear from the Budget view rather than being surfaced.
    // §544: shape AND a real calendar day. Shape alone let "2026-02-30" count as dated, so the
    // month key filed it under February while the ISO-week key's Date rolled it into March.
    const dated = ISO_DAY_RE.test(it.date) && isRealCalendarDate(it.date);
    if (resourceId === undefined || bucketId === undefined || bucketId === null || !dated) {
      unattributed = add(unattributed, it);
      // Deliberately NOT an `else` on the link checks: a row can fail both, and
      // it is still undated. The subset invariant is "everything undated is also
      // unattributed", not "the two partition the unattributable rows".
      if (!dated) undated = add(undated, it);
      continue;
    }
    byResource[resourceId] = add(byResource[resourceId], it);
    // The DAY is the key. Periods are derived at read time (`bucketOverlay`) with
    // the live plan granularity, so a granularity change after the fetch can no
    // longer file hours under keys the report never reads (§169).
    const day = it.date;
    byBucketDay[bucketId] ??= {};
    const cur = byBucketDay[bucketId][day];
    // Keep the resource dimension ON the cell. It was computed above and then
    // discarded here, which is where per-role attribution became impossible.
    byBucketDay[bucketId][day] = {
      ...add(cur, it),
      byResource: { ...cur?.byResource, [resourceId]: add(cur?.byResource?.[resourceId], it) },
    };
  }
  return { byBucketDay, byResource, unattributed, undated };
}

/**
 * The period-keyed overlay every consumer reads, derived with the LIVE plan
 * granularity. A dated aggregate rolls its day cells up and records each
 * resource's `byDay`, so Apply can write day keys. A legacy aggregate keeps
 * only the cells whose key shape matches `granularity`; a cell frozen at the
 * other granularity would land under a key the report never reads.
 */
export function bucketOverlay(agg: ActualsAggregate | undefined, granularity: PlanGranularity): ActualsByBucket {
  if (!agg) return {};
  if (agg.byBucketDay) return rollUpDays(agg.byBucketDay, granularity);
  return legacyOverlay(agg.byBucket ?? {}, granularity);
}

function rollUpDays(days: ActualsByBucketDay, granularity: PlanGranularity): ActualsByBucket {
  const out: ActualsByBucket = {};
  for (const [bucketId, byDay] of Object.entries(days)) {
    const periods: Record<string, BucketPeriodCell> = {};
    for (const [day, cell] of Object.entries(byDay)) {
      const pk = periodKeyForDate(day, granularity);
      const cur = periods[pk];
      const byResource: Record<number, ResourceDayCell> = { ...cur?.byResource };
      for (const [rid, rc] of Object.entries(cell.byResource ?? {})) {
        const id = Number(rid);
        const prev = byResource[id];
        byResource[id] = {
          hours: (prev?.hours ?? 0) + rc.hours,
          billableHours: (prev?.billableHours ?? 0) + rc.billableHours,
          byDay: { ...prev?.byDay, [day]: (prev?.byDay?.[day] ?? 0) + rc.hours },
        };
      }
      periods[pk] = {
        hours: (cur?.hours ?? 0) + cell.hours,
        billableHours: (cur?.billableHours ?? 0) + cell.billableHours,
        byResource,
      };
    }
    out[Number(bucketId)] = periods;
  }
  return out;
}

function legacyOverlay(byBucket: ActualsByBucket, granularity: PlanGranularity): ActualsByBucket {
  const out: ActualsByBucket = {};
  for (const [bucketId, periods] of Object.entries(byBucket)) {
    const kept: Record<string, BucketPeriodCell> = {};
    for (const [pk, cell] of Object.entries(periods)) {
      if (granularityOfPeriodKey(pk) === granularity) kept[pk] = cell;
    }
    if (Object.keys(kept).length > 0) out[Number(bucketId)] = kept;
  }
  return out;
}

/**
 * Per-(user, date) roll — the input to the guardrail rules.
 *
 * ★★★ SEPARATE FROM `aggregateActuals` ON PURPOSE, and the difference is the
 * point. Aggregation answers "how do these hours attribute to budget buckets",
 * so it keys by bucket and day (periods are derived later by `bucketOverlay`),
 * sums per-entry hours away, and
 * folds every unlinked item into `unattributed`. The rules ask "what did this
 * PERSON book that day", so the roll keeps the calendar date, keeps the largest
 * single entry, and keeps non-project time — it is still their time.
 *
 * Sparse: only (user, date) pairs that carry bookings get a key.
 */
export function buildDailyRoll(items: readonly TimelogTimeItem[]): TimelogDailyRoll {
  const out: TimelogDailyRoll = {};
  for (const it of items) {
    // Drop the unidentified-booker SENTINEL. `mapV2TimeItem` (timelog-api.ts)
    // resolves `EmployeeInitials` against the directory and falls back to
    // `userId: 0` via its `|| 0`, so without this every employee the directory
    // could not identify sums into ONE `0|<date>` cell — three unresolved
    // people booking 8h each become a 24h day, and the guardrail rules report
    // a cap violation for a person who does not exist. `use-timelog-sync.ts`
    // already filters `id > 0` when it builds the People table; the roll
    // honours the same convention.
    // ★ NARROW ON PURPOSE: an UNLINKED booker (a real positive userId with no
    // TimelogUserLink) must still be measured — see the "deliberately
    // links-independent" comment at the buildDailyRoll call site. Only the
    // non-positive sentinel is excluded.
    if (it.userId <= 0) continue;
    // ★★★ DO NOT ADD AN `ISO_DAY_RE` GUARD HERE. It is right there at the top of
    // this file, it reads like an oversight that it is not applied to both
    // consumers, and applying it converts a deliberate FREEZE into a fabricated
    // CLEAN. This was written, reviewed, shipped and reverted on 2026-09-07;
    // open-followups §431 carries the measurement.
    //
    // A malformed date mints the unparseable key `"7|"` ON PURPOSE. That key is
    // the ONLY production signal that the roll is not fully readable:
    // `parseDailyKey` rejects it → `evaluateTimelogPolicy` sets its per-roll
    // `skipped` flag → all four guardrail rules are withheld from `evaluated` →
    // `reconcileInsights` FREEZES the stored insights instead of resolving them.
    // Drop the row and that chain never starts: the rules certify a clean day
    // for hours nobody could place, and `computeClearedOutcome` writes a
    // fabricated `"improved"` into shared, exported `Workspace.insights`.
    //
    // ★★ IT IS NOT SYMMETRICAL WITH `aggregateActuals`, and that asymmetry is the
    // point. There, an unplaceable row has a truthful home (`unattributed`) that
    // a surface already renders. Here it has none — a roll cell is a claim about
    // a DAY — so the honest move is to keep the row unreadable and let the
    // readiness floor see it. Over-withholding freezes rows and is recoverable;
    // under-withholding fabricates a win and is not.
    //
    // ★ Scope, measured: on the PROJECT path this is moot either way, because
    // `use-timelog-sync.ts` clamps to `inWindow` (a malformed date fails the
    // lexical range) and hands `finish` an EMPTY `covered`, which freezes
    // everyone regardless. It is the SELF and ORG paths that depend on this key,
    // because there `covered` is derived date-blind from the fetched items.
    const k = dailyKey(it.userId, it.date);
    const cur = out[k];
    if (cur === undefined) {
      out[k] = { hours: it.hours, maxEntryHours: it.hours, entryCount: 1 };
      continue;
    }
    cur.hours += it.hours;
    if (it.hours > cur.maxEntryHours) cur.maxEntryHours = it.hours;
    cur.entryCount += 1;
  }
  return out;
}
