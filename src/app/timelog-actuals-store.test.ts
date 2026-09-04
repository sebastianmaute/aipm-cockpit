import { describe, it, expect, afterEach } from "vitest";
import { loadActualsCache, saveActualsCache, TIMELOG_ACTUALS_KEY } from "./timelog-actuals-store";
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
});
