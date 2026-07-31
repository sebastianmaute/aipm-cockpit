import { describe, it, expect, afterEach } from "vitest";
import { loadActualsCache, saveActualsCache, clearActualsCache, TIMELOG_ACTUALS_KEY } from "./timelog-actuals-store";

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
  it("evicts the oldest project beyond the 50-project cap", () => {
    for (let i = 0; i <= 50; i++) {
      saveActualsCache(`p-${i}`, { fetchedAt: `2000-01-01T00:00:${String(i).padStart(2, "0")}Z`, aggregates: agg(i) });
    }
    expect(loadActualsCache("p-0")).toBeUndefined();
    expect(loadActualsCache("p-50")?.aggregates?.unattributed.hours).toBe(50);
  });
});

describe("legacy-key fallback", () => {
  const at = (d: string) => ({ fetchedAt: d });

  it("prefers the canonical entry when both keys exist", () => {
    saveActualsCache("legacy-code", at("2026-01-01T00:00:00Z"));
    saveActualsCache("canonical", at("2026-06-06T00:00:00Z"));
    expect(loadActualsCache("canonical", "legacy-code")?.fetchedAt).toBe("2026-06-06T00:00:00Z");
  });

  it("falls back to the legacy entry when the canonical one is absent", () => {
    saveActualsCache("legacy-code", at("2026-01-01T00:00:00Z"));
    expect(loadActualsCache("canonical", "legacy-code")?.fetchedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("returns undefined when neither key has an entry", () => {
    expect(loadActualsCache("canonical", "legacy-code")).toBeUndefined();
  });

  it("is safe when the legacy key equals the canonical one", () => {
    saveActualsCache("same", at("2026-01-01T00:00:00Z"));
    expect(loadActualsCache("same", "same")?.fetchedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("keeps the one-argument call working (no legacy key passed)", () => {
    saveActualsCache("legacy-code", at("2026-01-01T00:00:00Z"));
    expect(loadActualsCache("canonical")).toBeUndefined();
  });

  // ★★ THE BUG THIS MIGRATION CAN MINT. Clear only the canonical entry and
  //    the next mount's read falls back to the legacy one — "Clear all"
  //    appears to work and the cleared data resurrects on remount.
  it("clear removes BOTH keys, so a cleared cache cannot resurrect", () => {
    saveActualsCache("legacy-code", at("2026-01-01T00:00:00Z"));
    saveActualsCache("canonical", at("2026-06-06T00:00:00Z"));
    clearActualsCache("canonical", "legacy-code");
    expect(loadActualsCache("canonical", "legacy-code")).toBeUndefined();
  });

  it("clear still works with one argument", () => {
    saveActualsCache("canonical", at("2026-06-06T00:00:00Z"));
    clearActualsCache("canonical");
    expect(loadActualsCache("canonical")).toBeUndefined();
  });
});
