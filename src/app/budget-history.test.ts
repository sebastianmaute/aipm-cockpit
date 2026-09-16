import { describe, expect, it } from "vitest";
import { recordBudgetChange, sanitizeBudgetHistory, splitVariance, summarizeBudgetHistory, type BudgetChange } from "./budget-history";

let n = 0;
const change = (over: Partial<BudgetChange>): BudgetChange => ({
  kind: "updated", bucketId: 1, bucketName: "Build",
  before: { hours: 100, value: 10000 }, after: { hours: 150, value: 15000 },
  at: "2026-09-16T10:00:00.000Z", date: "2026-09-16", newId: () => `id-${++n}`, ...over,
});

describe("recordBudgetChange", () => {
  it("seeds a baseline from the BAC before the first change, then records the change", () => {
    const h = recordBudgetChange([], change({}));
    expect(h.map((e) => e.kind)).toEqual(["baseline", "updated"]);
    expect(h[0]).toMatchObject({ bucketId: null, projectBacHours: 100, projectBacValue: 10000, deltaHours: 0, deltaValue: 0 });
    expect(h[1]).toMatchObject({ bucketId: 1, bucketName: "Build", projectBacHours: 150, deltaHours: 50, deltaValue: 5000 });
  });
  it("writes nothing when BAC did not move (rename, non-budget edit)", () => {
    const prev = recordBudgetChange([], change({}));
    const same = recordBudgetChange(prev, change({ before: { hours: 150, value: 15000 }, after: { hours: 150, value: 15000 } }));
    expect(same).toBe(prev);
  });
  it("writes nothing and seeds nothing on an empty history when BAC did not move", () => {
    const none = recordBudgetChange([], change({ after: { hours: 100, value: 10000 } }));
    expect(none).toEqual([]);
  });
  it("records a deletion as a negative delta keeping the name", () => {
    const h = recordBudgetChange([], change({ kind: "deleted", bucketName: "Vendor", after: { hours: 60, value: 6000 } }));
    expect(h[1]).toMatchObject({ kind: "deleted", bucketName: "Vendor", deltaHours: -40, deltaValue: -4000 });
  });
  it("never mutates its input", () => {
    const prev = Object.freeze(recordBudgetChange([], change({})));
    expect(() => recordBudgetChange(prev, change({ before: { hours: 150, value: 15000 }, after: { hours: 170, value: 17000 } }))).not.toThrow();
  });
  it("records a change that moves the BAC by a single unit", () => {
    const h = recordBudgetChange([], change({ before: { hours: 100, value: 10000 }, after: { hours: 100, value: 12000 } }));
    expect(h.map((e) => e.kind)).toEqual(["baseline", "updated"]);
    expect(h[1]).toMatchObject({ deltaHours: 0, deltaValue: 2000 });
  });
});

describe("summarizeBudgetHistory", () => {
  it("is null without a baseline", () => { expect(summarizeBudgetHistory([])).toBeNull(); });
  it("sums attributed deltas after the baseline", () => {
    let h = recordBudgetChange([], change({}));
    h = recordBudgetChange(h, change({ before: { hours: 150, value: 15000 }, after: { hours: 130, value: 13000 } }));
    const s = summarizeBudgetHistory(h)!;
    expect(s.baselineDate).toBe("2026-09-16");
    expect(s.baseline).toEqual({ hours: 100, value: 10000 });
    expect(s.attributed).toEqual({ hours: 30, value: 3000 });
    expect(s.changes).toHaveLength(2);
  });
});

describe("splitVariance", () => {
  it("matches the approved mockup: baseline 1200, +500 scope, BAC 1700, EAC 1440", () => {
    expect(splitVariance(1200, 500, 1700, 1440)).toEqual({ vac: 260, performance: -240, attributed: 500, unattributed: 0 });
  });
  it("puts BAC movement nobody recorded into unattributed", () => {
    expect(splitVariance(1200, 500, 1760, 1440)).toEqual({ vac: 320, performance: -240, attributed: 500, unattributed: 60 });
  });
});

describe("sanitizeBudgetHistory", () => {
  it("drops malformed entries and non-arrays", () => {
    expect(sanitizeBudgetHistory("x")).toEqual([]);
    const good = recordBudgetChange([], change({}));
    expect(sanitizeBudgetHistory([
      ...good, { id: 5 }, null, "y",
      { ...good[1], kind: "bogus" },
      { ...good[1], date: "2026-13-01" },
      { ...good[1], date: undefined },
      { ...good[1], bucketId: "not-a-number" },
    ])).toEqual(good);
  });
  it("normalizes a non-string bucketName to empty rather than dropping the entry", () => {
    const good = recordBudgetChange([], change({}));
    const [sanitized] = sanitizeBudgetHistory([{ ...good[1], bucketName: 42 }]);
    expect(sanitized).toMatchObject({ ...good[1], bucketName: "" });
  });
});
