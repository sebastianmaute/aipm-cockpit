import { describe, it, expect, afterEach } from "vitest";
import { loadActualsCache, saveActualsCache, TIMELOG_ACTUALS_KEY } from "./timelog-actuals-store";

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
