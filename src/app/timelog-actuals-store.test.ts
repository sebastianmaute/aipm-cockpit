import { describe, it, expect, afterEach } from "vitest";
import { isDailyCell, loadActualsCache, saveActualsCache, TIMELOG_ACTUALS_KEY } from "./timelog-actuals-store";
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

  // ★★ NO TEST PINS THE CLEAN-PATH IDENTITY, deliberately. `readMap` re-parses
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
