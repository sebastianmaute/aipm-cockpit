import { describe, it, expect, afterEach } from "vitest";
import { isDailyCell, loadActualsCache, MAX_DAILY_ROLL_CHARS, saveActualsCache, TIMELOG_ACTUALS_KEY } from "./timelog-actuals-store";
import { writeDeviceJson } from "./device-store";

afterEach(() => window.localStorage.clear());

const agg = (h: number) => ({ byBucket: {}, byResource: {}, unattributed: { hours: h, billableHours: 0 } });

describe("timelog actuals cache", () => {
  it("round-trips per project", () => {
    saveActualsCache("proj-1", { fetchedAt: "2026-06-23T10:00:00Z", aggregates: { byBucket: { 7: { "2026-06": { hours: 4, billableHours: 4 } } }, byResource: {}, unattributed: { hours: 0, billableHours: 0 } } });
    expect(loadActualsCache("proj-1")?.aggregates?.byBucket[7]["2026-06"].hours).toBe(4);
  });
  it("returns undefined for an unknown project and for corrupt JSON", () => {
    expect(loadActualsCache("missing")).toBeUndefined();
    window.localStorage.setItem(TIMELOG_ACTUALS_KEY, "{not json");
    expect(loadActualsCache("x")).toBeUndefined();
  });
  it("keeps entries isolated per project", () => {
    saveActualsCache("a", { fetchedAt: "t", aggregates: agg(1) });
    saveActualsCache("b", { fetchedAt: "t", aggregates: agg(2) });
    expect(loadActualsCache("a")?.aggregates?.unattributed.hours).toBe(1);
    expect(loadActualsCache("b")?.aggregates?.unattributed.hours).toBe(2);
  });
  it("returns undefined for an entry missing required fields", () => {
    window.localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify({ p: { fetchedAt: 5 } }));
    expect(loadActualsCache("p")).toBeUndefined();
  });
  it("accepts a directory-only entry (valid fetchedAt, no aggregates)", () => {
    // "Load people" persists users without aggregates — aggregates is optional.
    window.localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify({ p: { fetchedAt: "2026-01-01T00:00:00Z" } }));
    expect(loadActualsCache("p")).toEqual({ fetchedAt: "2026-01-01T00:00:00Z" });
  });
  it("rejects an entry whose aggregates is the wrong type", () => {
    window.localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify({ p: { fetchedAt: "2026-01-01T00:00:00Z", aggregates: 5 } }));
    expect(loadActualsCache("p")).toBeUndefined();
  });
  it("round-trips the partial flag, and reads ABSENT as complete", () => {
    // Absent must keep meaning "complete" — that is what lets an entry written
    // before the field existed stay readable, and an older client ignore it.
    saveActualsCache("short", { fetchedAt: "t", aggregates: agg(1), partial: true });
    saveActualsCache("full", { fetchedAt: "t", aggregates: agg(1), partial: false });
    saveActualsCache("old", { fetchedAt: "t", aggregates: agg(1) });
    expect(loadActualsCache("short")?.partial).toBe(true);
    expect(loadActualsCache("full")?.partial).toBe(false);
    expect(loadActualsCache("old")?.partial).toBeUndefined();
  });
  it("keeps an entry whose partial flag is malformed rather than dropping it", () => {
    // Failing OPEN on garbage: rejecting the entry would lose good aggregates
    // over a flag, and treating it as partial would disable Apply with no way
    // back but Clear all. Consumers read `=== true`, so a string is not partial.
    window.localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify({ p: { fetchedAt: "t", aggregates: agg(3), partial: "false" } }));
    expect(loadActualsCache("p")?.aggregates?.unattributed.hours).toBe(3);
    expect(loadActualsCache("p")?.partial === true).toBe(false);
  });
  it("evicts the oldest project beyond the 50-project cap", () => {
    for (let i = 0; i <= 50; i++) {
      saveActualsCache(`p-${i}`, { fetchedAt: `2000-01-01T00:00:${String(i).padStart(2, "0")}Z`, aggregates: agg(i) });
    }
    expect(loadActualsCache("p-0")).toBeUndefined();
    expect(loadActualsCache("p-50")?.aggregates?.unattributed.hours).toBe(50);
  });
});

describe("ActualsCacheEntry.daily", () => {
  it("round-trips a daily roll", () => {
    saveActualsCache("p1", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      daily: { "7|2026-09-01": { hours: 8, maxEntryHours: 8, entryCount: 1 } },
    });
    expect(loadActualsCache("p1")?.daily).toEqual({
      "7|2026-09-01": { hours: 8, maxEntryHours: 8, entryCount: 1 },
    });
  });

  // Back-compat: an entry written before `daily` existed must still load.
  it("loads an entry that has no daily field", () => {
    saveActualsCache("p2", { fetchedAt: "2026-09-04T00:00:00.000Z" });
    const e = loadActualsCache("p2");
    expect(e?.fetchedAt).toBe("2026-09-04T00:00:00.000Z");
    expect(e?.daily).toBeUndefined();
  });

  // ★★ FAILS OPEN, matching `partial` (register §172): rejecting the whole
  // entry over a malformed optional field would drop good aggregates.
  it("keeps the rest of an entry whose daily field is malformed", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      p3: { fetchedAt: "2026-09-04T00:00:00.000Z", daily: "nonsense" },
    });
    expect(loadActualsCache("p3")?.fetchedAt).toBe("2026-09-04T00:00:00.000Z");
    // ★ The second half of failing open, and the half the reader depends on:
    // the entry survives AND the bad value is DROPPED, so no consumer of the
    // roll ever iterates a string. Without this line the test passes against a
    // `withCheckedDaily` that returns its argument unchanged.
    expect(loadActualsCache("p3")?.daily).toBeUndefined();
  });

  // ★★ The string case above exercises only the `typeof` arm, so on its own it
  // leaves the other two container guards unpinned — both of these were GREEN
  // against the mutant that deletes the guard each one names.
  it("strips a null daily, keeping the rest of the entry", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      p4: { fetchedAt: "2026-09-04T00:00:00.000Z", aggregates: agg(3), daily: null },
    });
    // `typeof null === "object"`, so only the `d === null` arm can catch this.
    expect(loadActualsCache("p4")?.daily).toBeUndefined();
    expect(loadActualsCache("p4")?.aggregates?.unattributed.hours).toBe(3);
  });

  it("strips an array daily, keeping the rest of the entry", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      p5: { fetchedAt: "2026-09-04T00:00:00.000Z", aggregates: agg(4), daily: [] },
    });
    // An array is a non-null object, so only the `Array.isArray` arm catches it.
    expect(loadActualsCache("p5")?.daily).toBeUndefined();
    expect(loadActualsCache("p5")?.aggregates?.unattributed.hours).toBe(4);
  });

  // ★★★ The container passing says NOTHING about what is inside it. The policy
  // engine reads `cell.maxEntryHours` off every entry with no shape guard, in a
  // debounced effect with no try/catch — so a `null` cell here is an uncaught
  // throw that kills the insights reconcile on every tick, not a bad number.
  it("drops a malformed cell ALONE, keeping the valid cells beside it", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      p6: {
        fetchedAt: "2026-09-04T00:00:00.000Z",
        aggregates: agg(5),
        daily: {
          "5|2026-01-01": null,
          "7|2026-01-02": { hours: 8, maxEntryHours: 8, entryCount: 1 },
        },
      },
    });
    const daily = loadActualsCache("p6")?.daily;
    expect(daily?.["5|2026-01-01"]).toBeUndefined();
    // ★ THE ANTI-VACUITY CONTROL. "the bad cell is absent" is equally true of a
    // roll discarded wholesale, which is the §172 failure one level down — so
    // the surviving cell is what separates a cell-granular strip from an
    // entry-granular one. The entry itself must survive too.
    expect(daily?.["7|2026-01-02"]).toEqual({ hours: 8, maxEntryHours: 8, entryCount: 1 });
    expect(loadActualsCache("p6")?.aggregates?.unattributed.hours).toBe(5);
  });

  it("drops a cell whose field is a string, keeping the valid cell beside it", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      p7: {
        fetchedAt: "2026-09-04T00:00:00.000Z",
        daily: {
          // A string does NOT throw downstream — `"8" > 6` is a real
          // comparison — it propagates into the rendered violation text. So
          // this is a silent-corruption case, not a crash case.
          "1|2026-01-01": { hours: "8", maxEntryHours: 8, entryCount: 1 },
          "3|2026-01-03": { hours: 8, maxEntryHours: 8, entryCount: 1 },
        },
      },
    });
    const daily = loadActualsCache("p7")?.daily;
    expect(daily?.["1|2026-01-01"]).toBeUndefined();
    // The valid cell survives — same anti-vacuity control as above.
    expect(daily?.["3|2026-01-03"]).toEqual({ hours: 8, maxEntryHours: 8, entryCount: 1 });
  });

  it("returns a fully valid roll unchanged", () => {
    const roll = {
      "7|2026-09-01": { hours: 8, maxEntryHours: 8, entryCount: 1 },
      "9|2026-09-02": { hours: 4, maxEntryHours: 2, entryCount: 2 },
    };
    saveActualsCache("p8", { fetchedAt: "2026-09-04T00:00:00.000Z", daily: roll });
    expect(loadActualsCache("p8")?.daily).toEqual(roll);
  });

  // ★★ NO TEST PINS THE CLEAN-PATH IDENTITY, deliberately. (Kept here at the
  // end of the `daily` block; the `dailyWindow` block follows.) `readMap` re-parses
  // localStorage on EVERY call, so both the return-`e` path and a rebuild hand
  // back a fresh object per call and are indistinguishable from outside. An
  // `expect(...).toBe(...)` here would be red against correct code, and an
  // equality assertion dressed up as an identity one would read as coverage
  // while pinning nothing. The identity/allocation property is an internal
  // optimization; what is CONTRACTUAL is the equality asserted above.
});

// ★★★ SEPARATE describe BECAUSE IT CANNOT GO THROUGH THE STORE. `JSON.parse` is
// the store's only ingress and JSON has no `NaN`/`Infinity` literal, so no test
// driving `loadActualsCache` can reach a non-finite field — which means none can
// distinguish `Number.isFinite(x)` from `typeof x === "number"` either. Pinning
// the guard at all requires calling the predicate directly; routing this through
// the store instead would report the guard as vacuous and invite its removal.
describe("isDailyCell", () => {
  it("accepts a well-formed cell", () => {
    expect(isDailyCell({ hours: 8, maxEntryHours: 8, entryCount: 1 })).toBe(true);
    // Zero and negative are SHAPE-valid: the guarantee is that the rules can
    // read the cell, never that the number is plausible.
    expect(isDailyCell({ hours: 0, maxEntryHours: -1, entryCount: 0 })).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isDailyCell(null)).toBe(false);
    expect(isDailyCell([])).toBe(false);
    expect(isDailyCell("nonsense")).toBe(false);
    expect(isDailyCell(undefined)).toBe(false);
  });

  it("rejects a missing or non-numeric field", () => {
    expect(isDailyCell({ hours: 8, maxEntryHours: 8 })).toBe(false);
    expect(isDailyCell({ hours: "8", maxEntryHours: 8, entryCount: 1 })).toBe(false);
    expect(isDailyCell({ hours: 8, maxEntryHours: null, entryCount: 1 })).toBe(false);
  });

  // ★★★ THE ONLY THING SEPARATING `Number.isFinite(x)` FROM `typeof x ===
  // "number"`. Both NaN and Infinity are `typeof "number"`, so without these
  // three assertions the weakened check passes every other case in this file.
  it("rejects NaN and Infinity, which are both typeof number", () => {
    expect(isDailyCell({ hours: NaN, maxEntryHours: 8, entryCount: 1 })).toBe(false);
    expect(isDailyCell({ hours: 8, maxEntryHours: Infinity, entryCount: 1 })).toBe(false);
    expect(isDailyCell({ hours: 8, maxEntryHours: 8, entryCount: -Infinity })).toBe(false);
  });

  // ★ `Number.isFinite` does not coerce; the GLOBAL `isFinite` does, and would
  // read this cell as valid — the mutant this assertion exists to kill.
  it("does not coerce a numeric string", () => {
    expect(isDailyCell({ hours: "8", maxEntryHours: "8", entryCount: "1" })).toBe(false);
  });
});

describe("ActualsCacheEntry.dailyWindow", () => {
  const ROLL = { "7|2026-02-03": { hours: 12, maxEntryHours: 12, entryCount: 1 } };

  it("round-trips a valid window", () => {
    saveActualsCache("w1", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      daily: ROLL,
      dailyWindow: { from: "2026-01-01", to: "2026-03-31" },
    });
    expect(loadActualsCache("w1")?.dailyWindow).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  // A one-day fetch is a real window: `from === to` must NOT be rejected by the
  // `from <= to` guard. Pinned separately because the obvious `<` spelling of
  // that guard passes every other case in this block.
  it("accepts a single-day window", () => {
    saveActualsCache("w2", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      dailyWindow: { from: "2026-02-03", to: "2026-02-03" },
    });
    expect(loadActualsCache("w2")?.dailyWindow).toEqual({ from: "2026-02-03", to: "2026-02-03" });
  });

  // Back-compat, and a state the next reader must be able to NAME: an entry
  // written before this field existed carries a roll whose coverage is unknown.
  // That is different from a window that demonstrably covers the days asked
  // about, and the difference is the whole point of the field.
  it("loads a roll that has no window, leaving the window undefined", () => {
    saveActualsCache("w3", { fetchedAt: "2026-09-04T00:00:00.000Z", daily: ROLL });
    const e = loadActualsCache("w3");
    expect(e?.daily).toEqual(ROLL);
    expect(e?.dailyWindow).toBeUndefined();
  });

  // ★★★ FAILS OPEN, matching `daily` and `partial` (register §172): a malformed
  // optional field must not cost the entry. The `daily` assertion is the
  // anti-vacuity control — "the window is gone" is equally true of an entry
  // dropped wholesale, which is the failure this rule exists to prevent.
  it("strips a malformed window while the rest of the entry, roll included, survives", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      w4: {
        fetchedAt: "2026-09-04T00:00:00.000Z",
        aggregates: agg(6),
        daily: ROLL,
        dailyWindow: "nonsense",
      },
    });
    const e = loadActualsCache("w4");
    expect(e?.dailyWindow).toBeUndefined();
    expect(e?.daily).toEqual(ROLL);
    expect(e?.aggregates?.unattributed.hours).toBe(6);
    expect(e?.fetchedAt).toBe("2026-09-04T00:00:00.000Z");
  });

  // ★★★ AN INVERTED WINDOW IS REJECTED, NOT REPAIRED. Swapping the ends would
  // invent a range no fetch ever requested, and a reader asking "did the roll
  // cover February?" would get a confident yes from a bound that was never
  // real. Fabricating coverage is the one direction that cannot be walked back.
  it("rejects a window whose from is after its to", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      w5: {
        fetchedAt: "2026-09-04T00:00:00.000Z",
        daily: ROLL,
        dailyWindow: { from: "2026-03-31", to: "2026-01-01" },
      },
    });
    const e = loadActualsCache("w5");
    expect(e?.dailyWindow).toBeUndefined();
    // Not repaired into the swapped range either — absent, not corrected.
    expect(e?.daily).toEqual(ROLL);
  });

  // ★★ ALL-OR-NOTHING, unlike the roll, whose cells are stripped individually.
  // One real end plus one garbage end is worse than no window: it answers a
  // coverage question from a bound that does not exist. Both `it` bodies below
  // were GREEN against a guard that checked only the OTHER end.
  it("strips a window whose from is not a string", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      w6: { fetchedAt: "t", dailyWindow: { from: 20260101, to: "2026-03-31" } },
    });
    expect(loadActualsCache("w6")?.dailyWindow).toBeUndefined();
  });

  it("strips a window whose to is not a string", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      w7: { fetchedAt: "t", dailyWindow: { from: "2026-01-01", to: null } },
    });
    expect(loadActualsCache("w7")?.dailyWindow).toBeUndefined();
  });

  // ★★ SHAPE, not sense. The ISO check exists so the `<`/`>` comparisons a
  // reader runs against these bounds are lexicographically meaningful — a
  // `"Jan 2026"` would compare as a string and silently answer wrongly. It does
  // NOT certify the date exists, which is why `9999-99-99` is deliberately not
  // a case here.
  it("strips a window whose ends are strings but not ISO dates", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      w8: { fetchedAt: "t", dailyWindow: { from: "Jan 2026", to: "Mar 2026" } },
    });
    expect(loadActualsCache("w8")?.dailyWindow).toBeUndefined();
  });

  // `typeof null === "object"` and an array is a non-null object, so each of
  // these reaches a different arm of the container guard.
  it("strips a null window", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      w9: { fetchedAt: "t", aggregates: agg(7), dailyWindow: null },
    });
    expect(loadActualsCache("w9")?.dailyWindow).toBeUndefined();
    expect(loadActualsCache("w9")?.aggregates?.unattributed.hours).toBe(7);
  });

  it("strips an array window", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      w10: { fetchedAt: "t", aggregates: agg(8), dailyWindow: ["2026-01-01", "2026-03-31"] },
    });
    expect(loadActualsCache("w10")?.dailyWindow).toBeUndefined();
    expect(loadActualsCache("w10")?.aggregates?.unattributed.hours).toBe(8);
  });

  // ★★ The two strippers are composed, not alternatives: a single entry can be
  // malformed in BOTH fields, and neither pass may swallow the other's repair
  // or the entry itself.
  it("strips a malformed roll and a malformed window from the same entry", () => {
    writeDeviceJson(TIMELOG_ACTUALS_KEY, {
      w11: {
        fetchedAt: "2026-09-04T00:00:00.000Z",
        aggregates: agg(9),
        daily: "nonsense",
        dailyWindow: { from: "2026-03-31", to: "2026-01-01" },
      },
    });
    const e = loadActualsCache("w11");
    expect(e?.daily).toBeUndefined();
    expect(e?.dailyWindow).toBeUndefined();
    expect(e?.aggregates?.unattributed.hours).toBe(9);
  });
});

// ★★★ The roll BOUND, and the window narrowing that has to ride with it.
// `writeDeviceJson` swallows a quota error whole, so an over-budget roll used
// to cost the ENTIRE save — `aggregates` included. Trimming fixes that, and
// then immediately creates a worse hazard if the window is left alone:
// `dailyWindow` is the coverage CLAIM `task-manager.tsx`'s insights reconcile
// tests an insight's violating dates against, so a roll trimmed behind an
// intact window resolves guardrail insights as a fabricated "improved".
describe("ActualsCacheEntry.daily size bound", () => {
  const DAY_MS = 86_400_000;
  const isoDay = (i: number) => new Date(Date.UTC(2020, 0, 1) + i * DAY_MS).toISOString().slice(0, 10);
  const CELL = { hours: 8, maxEntryHours: 8, entryCount: 1 };
  /**
   * `days` consecutive dated cells for ONE booker, oldest at index 0.
   *
   * ★★★ A ONE-BOOKER-PER-DATE FIXTURE CANNOT EXPRESS THE BOUNDARY DEFECT, and
   * for a release every test in this block used one. The trim's survivor run is
   * a contiguous tail of (user, date) entries, so the boundary can only land
   * INSIDE a date group when a date carries more than one booker — with one
   * booker per date every retained date is retained whole and a window narrowed
   * to the boundary date is indistinguishable from a correct one. The test
   * below commented as stopping the fabricated-clean regression passed against
   * fully defective code for exactly that reason. Use `multiRollOf` for
   * anything asserting WHICH date `from` may name.
   */
  const rollOf = (days: number): Record<string, typeof CELL> => {
    const out: Record<string, typeof CELL> = {};
    for (let i = 0; i < days; i += 1) out[`7|${isoDay(i)}`] = { ...CELL };
    return out;
  };
  const datesOf = (roll: Record<string, unknown> | undefined) =>
    Object.keys(roll ?? {}).map((k) => k.slice(k.indexOf("|") + 1)).sort();

  // ★ 20k cells is ~1.2 MB against a 512 KiB budget — comfortably over on both
  // the narrow-id and wide-id cell measurements, so the trim cannot fail to
  // fire for a reason unrelated to what each test asserts.
  const OVER_DAYS = 20_000;

  // ★★ THE CONTROL, and it is load-bearing: without it a trim that fires
  // unconditionally — or one that narrows a window it never needed to touch —
  // passes every other test in this block.
  it("leaves a roll within budget completely untouched, window included", () => {
    const small = rollOf(100);
    expect(JSON.stringify(small).length).toBeLessThanOrEqual(MAX_DAILY_ROLL_CHARS);
    saveActualsCache("b1", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      aggregates: agg(3),
      daily: small,
      dailyWindow: { from: "2019-12-01", to: "2020-12-31" },
    });
    const e = loadActualsCache("b1");
    expect(e?.daily).toEqual(small);
    expect(e?.dailyWindow).toEqual({ from: "2019-12-01", to: "2020-12-31" });
  });

  it("trims an oversized roll to the budget, keeping the NEWEST cells", () => {
    saveActualsCache("b2", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      daily: rollOf(OVER_DAYS),
      dailyWindow: { from: isoDay(0), to: isoDay(OVER_DAYS - 1) },
    });
    const kept = loadActualsCache("b2")?.daily;
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(MAX_DAILY_ROLL_CHARS);
    const dates = datesOf(kept);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.length).toBeLessThan(OVER_DAYS);
    // The newest day survives and the oldest does not — the direction of the
    // trim, which is the whole difference between this and dropping recent data
    // the guardrail rules are actually about.
    expect(dates).toContain(isoDay(OVER_DAYS - 1));
    expect(dates).not.toContain(isoDay(0));
    // Survivors are a contiguous run at the NEW end, not an arbitrary subset.
    expect(dates[dates.length - 1]).toBe(isoDay(OVER_DAYS - 1));
    expect(dates).toEqual(datesOf(rollOf(OVER_DAYS)).slice(OVER_DAYS - dates.length));
  });

  // ★★★ THE ONE THAT STOPS THE FABRICATED-CLEAN REGRESSION. A trim that leaves
  // `from` alone leaves the entry claiming coverage of days the roll no longer
  // holds; the reconcile then reads "covered, no violation found" and resolves
  // a real guardrail insight as `"improved"` into exported workspace data.
  it("narrows dailyWindow.from to the earliest RETAINED date after a trim", () => {
    const ORIGINAL_FROM = isoDay(0);
    saveActualsCache("b3", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      daily: rollOf(OVER_DAYS),
      dailyWindow: { from: ORIGINAL_FROM, to: isoDay(OVER_DAYS - 1) },
    });
    const e = loadActualsCache("b3");
    const dates = datesOf(e?.daily);
    expect(e?.dailyWindow?.from).toBe(dates[0]);
    // Anti-vacuity: the assertion above is equally true of a window nobody
    // narrowed if the trim happened to retain the oldest day.
    expect(e?.dailyWindow?.from).not.toBe(ORIGINAL_FROM);
  });

  /** `days` × `bookers` cells, every booker present on every date. */
  const multiRollOf = (days: number, bookers: number): Record<string, typeof CELL> => {
    const out: Record<string, typeof CELL> = {};
    for (let i = 0; i < days; i += 1) {
      // Fixed-width ids so every cell costs the same and the boundary position
      // is a function of the budget alone, not of how a number happens to print.
      for (let b = 0; b < bookers; b += 1) out[`${100 + b}|${isoDay(i)}`] = { ...CELL };
    }
    return out;
  };
  const bookersOn = (roll: Record<string, unknown> | undefined, date: string) =>
    Object.keys(roll ?? {}).filter((k) => k.slice(k.indexOf("|") + 1) === date).length;

  // ★★★ THE MULTI-BOOKER HALF OF THE SAME REGRESSION, and the one the
  // single-booker fixtures above are structurally blind to. When the budget
  // boundary falls inside a date's group of bookers, that date is retained for
  // SOME people and dropped for others. Naming it as `from` claims coverage for
  // the dropped ones, whose insights then pass the window check, find no
  // violation because their cell is gone, and resolve as "improved".
  it("never names a half-retained date as dailyWindow.from", () => {
    const BOOKERS = 200;
    saveActualsCache("b3m", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      daily: multiRollOf(200, BOOKERS),
      dailyWindow: { from: isoDay(0), to: isoDay(199) },
    });
    const e = loadActualsCache("b3m");
    const kept = e?.daily as Record<string, unknown> | undefined;
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(MAX_DAILY_ROLL_CHARS);

    const earliestPresent = [...new Set(datesOf(kept))].sort()[0];
    // ★★ ANTI-VACUITY, and without it this test proves nothing: it asserts the
    // trim actually landed mid-group. If the budget happened to divide evenly
    // by the booker count the boundary would be clean, every retained date
    // whole, and the assertion below would hold against the defect too.
    expect(bookersOn(kept, earliestPresent)).toBeGreaterThan(0);
    expect(bookersOn(kept, earliestPresent)).toBeLessThan(BOOKERS);

    // The claim must skip the half-retained date entirely...
    expect(e?.dailyWindow?.from).not.toBe(earliestPresent);
    // ...and the date it DOES name must be retained for every booker.
    expect(bookersOn(kept, e?.dailyWindow?.from as string)).toBe(BOOKERS);
  });

  // The trim drops the OLD end, so the far end of the claim is still true and
  // narrowing it would throw away coverage that was actually fetched.
  it("leaves dailyWindow.to unchanged by a trim", () => {
    saveActualsCache("b4", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      daily: rollOf(OVER_DAYS),
      dailyWindow: { from: isoDay(0), to: "2099-12-31" },
    });
    expect(loadActualsCache("b4")?.dailyWindow?.to).toBe("2099-12-31");
  });

  // ★★ Reachable shape for "nothing survives": every key unusable. A cell is a
  // fixed ~60 chars and `parseDailyKey` rejects a userId large enough to pad
  // one past the budget, so a single oversized cell cannot be constructed.
  // ★★ Losing the roll must never cost the rest of the entry — the aggregates
  // are what the network round trip bought.
  it("drops daily AND dailyWindow together when nothing survives, keeping the rest", () => {
    const unusable: Record<string, typeof CELL> = {};
    for (let i = 0; i < OVER_DAYS; i += 1) unusable[`no-pipe-${i}`] = { ...CELL };
    expect(JSON.stringify(unusable).length).toBeGreaterThan(MAX_DAILY_ROLL_CHARS);
    saveActualsCache("b5", {
      fetchedAt: "2026-09-04T00:00:00.000Z",
      aggregates: agg(11),
      users: [{ userId: 7, firstName: "Ada", lastName: "Lovelace", initials: "AL", email: "ada@example.com", isActive: true }],
      partial: true,
      daily: unusable,
      dailyWindow: { from: isoDay(0), to: isoDay(OVER_DAYS - 1) },
    });
    const e = loadActualsCache("b5");
    expect(e?.daily).toBeUndefined();
    expect(e?.dailyWindow).toBeUndefined();
    expect(e?.aggregates?.unattributed.hours).toBe(11);
    expect(e?.users?.[0].userId).toBe(7);
    expect(e?.fetchedAt).toBe("2026-09-04T00:00:00.000Z");
    expect(e?.partial).toBe(true);
  });

  // Back-compat: an entry written before `dailyWindow` existed still has to be
  // bounded, and the narrowing branch must not assume a window is there.
  it("trims an oversized roll on an entry with no dailyWindow without throwing", () => {
    expect(() =>
      saveActualsCache("b6", { fetchedAt: "2026-09-04T00:00:00.000Z", daily: rollOf(OVER_DAYS) }),
    ).not.toThrow();
    const e = loadActualsCache("b6");
    expect(JSON.stringify(e?.daily).length).toBeLessThanOrEqual(MAX_DAILY_ROLL_CHARS);
    expect(datesOf(e?.daily).length).toBeGreaterThan(0);
    expect(e?.dailyWindow).toBeUndefined();
  });

  // ★★ A key with no `|` and a key whose date is not ISO-shaped are both
  // unorderable, so neither can honestly be called old or new — and neither may
  // become the new `from`. `"zzz"` is chosen because it sorts ABOVE every ISO
  // date lexicographically and `"0000-00-00"` below every real one, so a trim
  // that failed to exclude them would visibly move `from` to a non-date.
  it("drops unparseable and non-ISO keys during a trim without letting them set from", () => {
    const mixed: Record<string, typeof CELL> = { ...rollOf(OVER_DAYS), "no-pipe": { ...CELL }, "7|zzz": { ...CELL }, "7|0000-00-00x": { ...CELL } };
    expect(() =>
      saveActualsCache("b7", {
        fetchedAt: "2026-09-04T00:00:00.000Z",
        daily: mixed,
        dailyWindow: { from: isoDay(0), to: isoDay(OVER_DAYS - 1) },
      }),
    ).not.toThrow();
    const e = loadActualsCache("b7");
    const keys = Object.keys(e?.daily ?? {});
    expect(keys).not.toContain("no-pipe");
    expect(keys).not.toContain("7|zzz");
    expect(keys).not.toContain("7|0000-00-00x");
    expect(e?.dailyWindow?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e?.dailyWindow?.from).toBe(datesOf(e?.daily)[0]);
  });
});
