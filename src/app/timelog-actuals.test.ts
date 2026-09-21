import { describe, it, expect } from "vitest";
import { aggregateActuals, bucketOverlay, buildDailyRoll } from "./timelog-actuals";
import { periodKeyForDate } from "./resource-capacity";
import { parseDailyKey } from "./timelog-types";
import type { TimelogTimeItem, TimelogLinks } from "./timelog-types";

// timeRegistrationId/taskId are ignored scaffolding — the engine keys only on userId/projectId/date/hours.
const item = (userId: number, projectId: number, date: string, hours: number, billable = hours): TimelogTimeItem =>
  ({ timeRegistrationId: 0, userId, projectId, projectName: "", projectNo: "", taskId: 0, date, hours, billableHours: billable, isBillable: billable > 0 });

const links: TimelogLinks = {
  userLinks: [{ timelogUserId: 5, resourceId: 2, manual: false }],
  projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }],
};

describe("aggregateActuals", () => {
  it("sums mapped hours into byBucket[bucketId][period]", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-06-20", 2)], links);
    // toMatchObject, not toEqual: the cell also carries the per-resource
    // breakdown apply needs. This assertion is about the TOTALS.
    expect(bucketOverlay(out, "month")[7]["2026-06"]).toMatchObject({ hours: 6, billableHours: 6 });
  });
  it("splits hours across distinct period keys", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-07-01", 3)], links);
    expect(bucketOverlay(out, "month")[7]["2026-06"].hours).toBe(4);
    expect(bucketOverlay(out, "month")[7]["2026-07"].hours).toBe(3);
  });
  // The bucket·period TOTAL alone cannot be attributed to a role downstream:
  // apply had to guess, and guessed allocations[0], costing everyone at the
  // first role's rate. The breakdown that makes attribution possible must
  // survive aggregation — it is available here and was being discarded.
  it("keeps the per-resource breakdown inside each bucket·period cell", () => {
    const twoPeople: TimelogLinks = {
      userLinks: [
        { timelogUserId: 5, resourceId: 2, manual: false },
        { timelogUserId: 6, resourceId: 3, manual: false },
      ],
      projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }],
    };
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(6, 9, "2026-06-11", 2), item(5, 9, "2026-06-12", 1)],
      twoPeople,
    );
    const cell = bucketOverlay(out, "month")[7]["2026-06"];
    expect(cell.hours).toBe(7); // total unchanged
    // The field is optional on the TYPE (a pre-breakdown persisted cache has no
    // such key), so assert aggregation actually produced it.
    expect(cell.byResource).toBeDefined();
    // toMatchObject: an overlay cell also carries the resource's `byDay`.
    expect(cell.byResource?.[2]).toMatchObject({ hours: 5, billableHours: 5 });
    expect(cell.byResource?.[3]).toMatchObject({ hours: 2, billableHours: 2 });
  });

  // The breakdown must always reconcile to the total it sits on, or apply and
  // the overlay display would disagree about the same bucket.
  it("breakdown sums to the cell total", () => {
    const twoPeople: TimelogLinks = {
      userLinks: [
        { timelogUserId: 5, resourceId: 2, manual: false },
        { timelogUserId: 6, resourceId: 3, manual: false },
      ],
      projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }],
    };
    // Person 5 books TWICE in the period on purpose: with one booking each, an
    // implementation that OVERWRITES per resource instead of accumulating still
    // sums correctly, so the invariant this test is named for would go unguarded.
    const out = aggregateActuals(
      [
        item(5, 9, "2026-06-10", 4, 4),
        item(6, 9, "2026-06-11", 2, 0),
        item(5, 9, "2026-06-12", 3, 3),
      ],
      twoPeople,
    );
    const cell = bucketOverlay(out, "month")[7]["2026-06"];
    expect(cell.byResource).toBeDefined();
    const summed = Object.values(cell.byResource ?? {}).reduce(
      (acc, c) => ({ hours: acc.hours + c.hours, billableHours: acc.billableHours + c.billableHours }),
      { hours: 0, billableHours: 0 },
    );
    expect(summed).toEqual({ hours: cell.hours, billableHours: cell.billableHours });
  });

  it("aggregates per resource", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4)], links);
    expect(out.byResource[2]).toEqual({ hours: 4, billableHours: 4 });
  });
  it("routes unmapped user OR unmapped project hours to unattributed (never dropped)", () => {
    const out = aggregateActuals([item(5, 999, "2026-06-10", 3), item(404, 9, "2026-06-10", 5)], links);
    expect(out.unattributed.hours).toBe(8);
    expect(bucketOverlay(out, "month")[7]).toBeUndefined();
    expect(Object.keys(out.byResource).length).toBe(0);
  });
  it("maps a bucketId:null project link to unattributed", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4)],
      { userLinks: links.userLinks, projectLinks: [{ timelogProjectId: 9, bucketId: null, manual: true }] });
    expect(out.unattributed.hours).toBe(4);
    expect(Object.keys(out.byResource).length).toBe(0);
  });

  // `timelog-api.ts` coerces `Date` through `dateOnly = s(v).slice(0, 10)`, and
  // `s` returns "" for anything non-string — so an absent, null or numeric Date
  // arrives as `date: ""`, and a regionally formatted "05/01/2026" is exactly
  // ten characters and survives the slice intact. Kept as a day key, such a date
  // would be rolled by `bucketOverlay`'s `periodKeyForDate` into a key no
  // rendered column matches (measured: month "" and "05/01/2", week "NaN-WNaN"
  // for both), so real hours would vanish from the Budget view with no
  // diagnostic. Unattributable to a day ⇒ `unattributed`, like an unlinked row.
  it("routes a malformed-date row to unattributed instead of a phantom month key", () => {
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(5, 9, "", 3), item(5, 9, "05/01/2026", 2)],
      links,
    );
    expect(out.unattributed).toEqual({ hours: 5, billableHours: 5 });
    // The junk period keys a malformed day key would roll up to must not exist at all.
    expect(Object.keys(bucketOverlay(out, "month")[7])).toEqual(["2026-06"]);
    expect(bucketOverlay(out, "month")[7][""]).toBeUndefined();
    expect(bucketOverlay(out, "month")[7]["05/01/2"]).toBeUndefined();
  });

  // ★★ THE DOUBLE-COUNT GUARD. `byResource[resourceId] = add(...)` is written
  // BEFORE the day-key write is reached, so a date guard placed after that
  // write counts the same hours in `byResource` AND in `unattributed` — a
  // silent inflation of every per-resource total. The good row alongside is
  // what makes the assertion say "only the good hours", not merely "non-zero".
  it("does not double-count a malformed-date row into byResource", () => {
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(5, 9, "", 3)],
      links,
    );
    expect(out.unattributed).toEqual({ hours: 3, billableHours: 3 });
    expect(out.byResource[2]).toEqual({ hours: 4, billableHours: 4 });
  });

  // ★★★ THE SUBSET INVARIANT, and it is the whole safety of the `undated` split.
  // `undated` is a SUBSET of `unattributed`, never a sibling — every existing
  // reader of `unattributed` stays correct precisely because the set of rows
  // reaching it did not change. A fixture carrying BOTH kinds of unattributable
  // row is what makes that a claim: a link-broken row (healthy date, no user
  // link) must land in `unattributed` ALONE, while the malformed-date row lands
  // in BOTH. Written as a test rather than a comment because a comment cannot
  // fail: widen `undated` to take the link-broken rows too and this dies.
  it("reports undated hours as a strict subset of unattributed", () => {
    const out = aggregateActuals(
      [
        item(5, 9, "2026-06-10", 4), // fully attributable
        item(5, 9, "", 3), // malformed date, links healthy → BOTH
        item(99, 9, "2026-06-11", 8), // unlinked user, date healthy → unattributed ONLY
      ],
      links,
    );
    expect(out.unattributed).toEqual({ hours: 11, billableHours: 11 });
    expect(out.undated).toEqual({ hours: 3, billableHours: 3 });
    // ★ A FIXTURE PROPERTY, NOT THE INVARIANT — this line claimed to state the
    // subset "as arithmetic" and cannot. Subset-by-ROW does not imply the
    // inequality once hours can be negative, and this very commit relies on
    // negatives being real: undated +10 against a link-broken -20 gives
    // undated.hours > unattributed.hours with the subset perfectly intact. It
    // earns its place by killing the realistic mutant (widening the inner
    // predicate breaks this AND the two toEqual assertions above), not by
    // expressing the invariant. The invariant is structural: `!dated` is a
    // disjunct of the outer condition, so nothing can reach `undated` without
    // having been added to `unattributed` first.
    expect(out.undated!.hours).toBeLessThan(out.unattributed.hours);
  });

  // §544: shape-valid but not a real day. Before the fix this row counted as DATED, so the month
  // key filed it under February and the ISO-week key under March.
  it("routes a calendar-invalid day to undated instead of any period", () => {
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(5, 9, "2026-02-30", 3)],
      links,
    );
    expect(out.undated).toEqual({ hours: 3, billableHours: 3 });
    expect(out.unattributed).toEqual({ hours: 3, billableHours: 3 });
    // Presence half: the VALID row still reached a period. A predicate that refused every row
    // would also produce undated = 3 if the valid row were dropped from the fixture.
    const attributed = Object.values(out.byResource).reduce((s, c) => s + c.hours, 0);
    expect(attributed).toBe(4);
    expect(Object.keys(out.byBucketDay ?? {}).join(",")).not.toContain("2026-02-30");
  });

  // Anti-vacuity control for the split: a guard that fired unconditionally, or
  // an `undated` fed from the same predicate as `unattributed`, would satisfy
  // the assertions above. Nothing malformed ⇒ nothing undated AND nothing
  // unattributed. Absent is as good as zero — the field is optional so a
  // pre-split cache entry still deserializes.
  it("leaves undated at zero when every row carries a usable date", () => {
    const out = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(99, 9, "2026-06-11", 8)],
      links,
    );
    expect(out.undated?.hours ?? 0).toBe(0);
    expect(out.undated?.billableHours ?? 0).toBe(0);
    // The link-broken row still reaches `unattributed` — proving the zero above
    // is not merely an empty fixture.
    expect(out.unattributed).toEqual({ hours: 8, billableHours: 8 });
  });

  // Anti-vacuity control: a guard that fired unconditionally would satisfy every
  // assertion above. A wholly well-formed fixture must still attribute in full,
  // with nothing diverted.
  it("leaves a wholly well-formed fixture fully attributed", () => {
    const out = aggregateActuals([item(5, 9, "2026-06-10", 4), item(5, 9, "2026-07-01", 3)], links);
    expect(out.unattributed).toEqual({ hours: 0, billableHours: 0 });
    expect(bucketOverlay(out, "month")[7]["2026-06"].hours).toBe(4);
    expect(bucketOverlay(out, "month")[7]["2026-07"].hours).toBe(3);
    expect(out.byResource[2]).toEqual({ hours: 7, billableHours: 7 });
  });
});

describe("byBucketDay and bucketOverlay", () => {
  // The file's `links` maps ONE user (5 → resource 2); the second booker needs
  // a second link, mirroring the `twoPeople` fixture above (6 → resource 3).
  const twoPeople: TimelogLinks = {
    userLinks: [...links.userLinks, { timelogUserId: 6, resourceId: 3, manual: false }],
    projectLinks: links.projectLinks,
  };

  it("keeps each booking's day and resource in byBucketDay", () => {
    const agg = aggregateActuals([item(5, 9, "2026-06-10", 2), item(5, 9, "2026-06-10", 1), item(6, 9, "2026-06-11", 4)], twoPeople);
    expect(agg.byBucket).toBeUndefined();
    const days = agg.byBucketDay?.[7];
    expect(days?.["2026-06-10"]?.hours).toBe(3);
    expect(days?.["2026-06-11"]?.byResource?.[3]?.hours).toBe(4);
  });

  it("rolls days up into month periods with per-resource byDay", () => {
    const agg = aggregateActuals([item(5, 9, "2026-06-10", 2), item(5, 9, "2026-06-30", 1), item(5, 9, "2026-07-01", 5)], links);
    const overlay = bucketOverlay(agg, "month");
    expect(overlay[7]["2026-06"].hours).toBe(3);
    expect(overlay[7]["2026-06"].byResource?.[2]?.byDay).toEqual({ "2026-06-10": 2, "2026-06-30": 1 });
    expect(overlay[7]["2026-07"].hours).toBe(5);
  });

  it("rolls the same aggregate into ISO weeks when the plan is weekly (§169)", () => {
    const agg = aggregateActuals([item(5, 9, "2026-06-10", 4)], links);
    expect(bucketOverlay(agg, "week")[7]["2026-W24"].hours).toBe(4);
    expect(bucketOverlay(agg, "month")[7]["2026-06"].hours).toBe(4);
  });

  it("a malformed-date row never mints a week key in the overlay", () => {
    const good = periodKeyForDate("2026-06-10", "week");
    const agg = aggregateActuals(
      [item(5, 9, "2026-06-10", 4), item(5, 9, "", 3), item(5, 9, "05/01/2026", 2)],
      links,
    );
    expect(agg.unattributed.hours).toBe(5);
    expect(Object.keys(bucketOverlay(agg, "week")[7] ?? {})).toEqual([good]);
  });

  // Replaces the deleted "items in different weeks get distinct keys": a Sunday
  // and the following Monday sit in adjacent ISO weeks but the same month, so a
  // roll-up that ignored the live granularity would merge them into one key.
  it("rolls bookings in adjacent ISO weeks into two distinct week keys", () => {
    const agg = aggregateActuals([item(5, 9, "2026-06-14", 4), item(5, 9, "2026-06-15", 3)], links);
    const weeks = bucketOverlay(agg, "week")[7];
    expect(Object.keys(weeks).sort()).toEqual(["2026-W24", "2026-W25"]);
    expect(weeks["2026-W24"].hours).toBe(4);
    expect(weeks["2026-W25"].hours).toBe(3);
  });

  it("keeps a legacy period-keyed entry only where its keys match the live granularity", () => {
    const legacy = {
      byBucket: { 7: { "2026-06": { hours: 6, billableHours: 6 }, "2026-W24": { hours: 4, billableHours: 4 } } },
      byResource: {}, unattributed: { hours: 0, billableHours: 0 },
    };
    expect(Object.keys(bucketOverlay(legacy, "month")[7])).toEqual(["2026-06"]);
    expect(Object.keys(bucketOverlay(legacy, "week")[7])).toEqual(["2026-W24"]);
  });

  it("returns an empty overlay for an absent aggregate", () => {
    expect(bucketOverlay(undefined, "month")).toEqual({});
  });
});

describe("buildDailyRoll", () => {
  const item = (userId: number, date: string, hours: number): TimelogTimeItem => ({
    timeRegistrationId: Math.round(Math.random() * 1e9),
    userId, projectId: 1, projectName: "P", projectNo: "1", taskId: 1,
    date, hours, billableHours: hours, isBillable: true,
  });

  it("sums hours per user and date and records the largest single entry", () => {
    const roll = buildDailyRoll([
      item(7, "2026-09-01", 3),
      item(7, "2026-09-01", 4.5),
      item(7, "2026-09-02", 8),
      item(9, "2026-09-01", 2),
    ]);
    expect(roll).toEqual({
      "7|2026-09-01": { hours: 7.5, maxEntryHours: 4.5, entryCount: 2 },
      "7|2026-09-02": { hours: 8, maxEntryHours: 8, entryCount: 1 },
      "9|2026-09-01": { hours: 2, maxEntryHours: 2, entryCount: 1 },
    });
  });

  // ★★ The roll must NOT reproduce aggregateActuals' attribution: it is the
  // input to rules about a PERSON's day, and an unlinked project is still that
  // person's time. Dropping ProjectID 0 (absence / non-project time) here would
  // make the daily total under-report against the very cap it is checked by.
  it("keeps non-project time, which aggregation folds into unattributed", () => {
    const zero = { ...item(7, "2026-09-01", 5), projectId: 0, projectName: "", projectNo: "" };
    expect(buildDailyRoll([zero])["7|2026-09-01"]).toEqual({
      hours: 5, maxEntryHours: 5, entryCount: 1,
    });
  });

  // ★★ `mapV2TimeItem` (timelog-api.ts) maps an employee whose EmployeeInitials
  // do not resolve against the directory to `userId: 0`. Unfiltered, every one
  // of them merges into a single `0|<date>` cell holding summed hours no
  // individual booked, and the guardrail rules then report a cap violation for
  // a person who does not exist — persisted into the shared insights slice.
  // TWO sentinel items share a date ON PURPOSE: with only one, "dropped" and
  // "kept but not summed" are indistinguishable. The real booker alongside them
  // is the anti-vacuity control — "no 0 key" is also true of an empty roll.
  it("drops the unidentified-booker sentinel instead of summing it into a phantom day", () => {
    const roll = buildDailyRoll([
      item(0, "2026-09-01", 8),
      item(0, "2026-09-01", 8),
      item(7, "2026-09-01", 6),
    ]);
    expect(roll["0|2026-09-01"]).toBeUndefined();
    // The identified booker is untouched — the filter must not widen past the sentinel.
    expect(roll["7|2026-09-01"]).toEqual({ hours: 6, maxEntryHours: 6, entryCount: 1 });
    expect(Object.keys(roll)).toEqual(["7|2026-09-01"]);
  });

  // ★★★ THESE TWO PIN A KEY THAT LOOKS LIKE A BUG AND IS THE SAFETY PROPERTY.
  // A malformed date must reach the roll as an UNPARSEABLE KEY, because that key
  // is the only production signal that the roll is not fully readable:
  // `parseDailyKey` rejects it → `evaluateTimelogPolicy` sets its per-roll
  // `skipped` flag → the guardrail rules are withheld from `evaluated` →
  // `reconcileInsights` freezes instead of resolving. Filtering these rows out
  // makes the rules certify a clean day for hours nobody could place, and the
  // reconcile then writes a fabricated "improved" into exported data. That
  // filter was written, shipped and reverted on 2026-09-07 (open-followups
  // §431); these tests exist so it cannot come back quietly.
  // ★ `parseDailyKey` is asserted directly rather than trusting the key's shape:
  // the claim is "the policy engine cannot read this", and that predicate IS the
  // policy engine's reader. Asserting only `roll["7|"]` would still pass if the
  // parser were later loosened to accept it.
  it("keeps a blank-date row as an unparseable key, so the roll reads as incomplete", () => {
    const roll = buildDailyRoll([
      item(7, "", 8),
      item(7, "2026-09-01", 6),
    ]);
    expect(roll["7|"]).toEqual({ hours: 8, maxEntryHours: 8, entryCount: 1 });
    expect(parseDailyKey("7|")).toBeNull();
    // The good row still rolls up normally — the bad key must not cost it.
    expect(roll["7|2026-09-01"]).toEqual({ hours: 6, maxEntryHours: 6, entryCount: 1 });
  });

  // The ten-character regional case: `dateOnly`'s `.slice(0, 10)` is a no-op on
  // it, so it reaches the roll looking like a date and is not one.
  it("keeps a regionally formatted date as an unparseable key", () => {
    const roll = buildDailyRoll([
      item(7, "05/01/2026", 8),
      item(7, "2026-09-01", 6),
    ]);
    expect(roll["7|05/01/2026"]).toEqual({ hours: 8, maxEntryHours: 8, entryCount: 1 });
    expect(parseDailyKey("7|05/01/2026")).toBeNull();
    expect(roll["7|2026-09-01"]).toEqual({ hours: 6, maxEntryHours: 6, entryCount: 1 });
  });

  it("returns an empty roll for no items", () => {
    expect(buildDailyRoll([])).toEqual({});
  });
});
