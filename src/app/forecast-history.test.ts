import { describe, expect, it } from "vitest";
import { entryOnOrBefore, sanitizeForecastHistory, upsertForecastHistory, type ForecastHistoryEntry } from "./forecast-history";

const e = (date: string, over: Partial<ForecastHistoryEntry> = {}): ForecastHistoryEntry => ({
  date, p50: "2026-11-02", p80: "2026-11-09", p95: "2026-11-20", chanceOnTime: 0.62, ...over,
});

describe("upsertForecastHistory", () => {
  it("adds to an empty history", () => {
    expect(upsertForecastHistory([], e("2026-10-01"))).toEqual([e("2026-10-01")]);
  });

  it("replaces the entry for the same date with the second value", () => {
    const first = e("2026-10-01");
    const second = e("2026-10-01", { p50: "2026-11-05", chanceOnTime: 0.4 });
    expect(upsertForecastHistory(upsertForecastHistory([], first), second)).toEqual([second]);
  });

  it("keeps the result sorted by date ascending", () => {
    const out = upsertForecastHistory([e("2026-10-05"), e("2026-10-01")], e("2026-10-03"));
    expect(out.map((x) => x.date)).toEqual(["2026-10-01", "2026-10-03", "2026-10-05"]);
  });

  it("does not mutate its input", () => {
    const input = [e("2026-10-01")];
    const snapshot = JSON.stringify(input);
    const out = upsertForecastHistory(input, e("2026-10-02"));
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).not.toBe(input);
  });
});

describe("sanitizeForecastHistory", () => {
  it("keeps a valid entry, including null finish dates and a null chance", () => {
    const n = e("2026-10-01", { p50: null, p80: null, p95: null, chanceOnTime: null });
    expect(sanitizeForecastHistory([e("2026-10-02"), n])).toEqual([n, e("2026-10-02")]);
  });

  it("drops an invalid date", () => {
    expect(sanitizeForecastHistory([e("2026-02-30"), e("nope"), { ...e("2026-10-01"), date: 5 }])).toEqual([]);
  });

  it("drops a non-date, non-null finish date", () => {
    expect(sanitizeForecastHistory([
      e("2026-10-01", { p50: "soon" }), e("2026-10-02", { p80: 3 as never }), e("2026-10-03", { p95: undefined as never }),
    ])).toEqual([]);
  });

  it("drops a chance outside 0..1 or not a number, keeps the bounds", () => {
    expect(sanitizeForecastHistory([
      e("2026-10-01", { chanceOnTime: 1.01 }), e("2026-10-02", { chanceOnTime: -0.1 }),
      e("2026-10-03", { chanceOnTime: Number.NaN }), e("2026-10-04", { chanceOnTime: "0.5" as never }),
    ])).toEqual([]);
    expect(sanitizeForecastHistory([e("2026-10-05", { chanceOnTime: 0 }), e("2026-10-06", { chanceOnTime: 1 })])).toHaveLength(2);
  });

  it("keeps the last entry per date", () => {
    const out = sanitizeForecastHistory([e("2026-10-01", { chanceOnTime: 0.1 }), e("2026-10-01", { chanceOnTime: 0.9 })]);
    expect(out).toEqual([e("2026-10-01", { chanceOnTime: 0.9 })]);
  });

  it("returns [] for a non-array and drops non-objects", () => {
    expect(sanitizeForecastHistory(undefined)).toEqual([]);
    expect(sanitizeForecastHistory({})).toEqual([]);
    expect(sanitizeForecastHistory([null, 3, "x"])).toEqual([]);
  });

  it("sorts by date ascending", () => {
    expect(sanitizeForecastHistory([e("2026-10-05"), e("2026-10-01")]).map((x) => x.date)).toEqual(["2026-10-01", "2026-10-05"]);
  });

  it("strips unknown keys", () => {
    expect(sanitizeForecastHistory([{ ...e("2026-10-01"), extra: 1 }])).toEqual([e("2026-10-01")]);
  });
});

describe("entryOnOrBefore", () => {
  const h = [e("2026-10-01"), e("2026-10-05"), e("2026-10-10")];

  it("returns the latest entry with date <= the given date", () => {
    expect(entryOnOrBefore(h, "2026-10-08")).toEqual(e("2026-10-05"));
    expect(entryOnOrBefore(h, "2026-10-10")).toEqual(e("2026-10-10"));
    expect(entryOnOrBefore(h, "2027-01-01")).toEqual(e("2026-10-10"));
  });

  it("returns null when every entry is later, or the history is empty", () => {
    expect(entryOnOrBefore(h, "2026-09-30")).toBeNull();
    expect(entryOnOrBefore([], "2026-10-08")).toBeNull();
  });
});
