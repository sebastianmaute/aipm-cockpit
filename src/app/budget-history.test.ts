import { describe, expect, it } from "vitest";
import { mergeBudgetHistories, recordBudgetChange, sanitizeBudgetHistory, splitVariance, summarizeBudgetHistory, type BudgetChange, type BudgetHistoryEntry } from "./budget-history";

let n = 0;
const change = (over: Partial<BudgetChange>): BudgetChange => ({
  kind: "updated", bucketId: 1, bucketName: "Build",
  before: { hours: 100, value: 10000 }, after: { hours: 150, value: 15000 },
  at: "2026-09-16T10:00:00.000Z", date: "2026-09-16", newId: () => `id-${++n}`, ...over,
});

/** A raw entry builder for fixtures that need an array order the real writer
 *  (`recordBudgetChange`) can never produce — it always appends in date order. */
const entry = (over: Partial<BudgetHistoryEntry>): BudgetHistoryEntry => ({
  id: `e-${++n}`, at: "2026-09-16T10:00:00.000Z", date: "2026-09-16", kind: "updated",
  bucketId: 1, bucketName: "Build", projectBacHours: 0, projectBacValue: 0, deltaHours: 0, deltaValue: 0,
  ...over,
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

  it("orders by date before locating the baseline, so a change stored ahead of it is still attributed (§554)", () => {
    const t1 = entry({ id: "baseline-1", at: "2026-09-10T10:00:00.000Z", date: "2026-09-10", kind: "baseline", bucketId: null, bucketName: "", projectBacHours: 100, projectBacValue: 10000 });
    const t2 = entry({ id: "change-2", at: "2026-09-11T10:00:00.000Z", date: "2026-09-11", deltaHours: 10, deltaValue: 1000 });
    const t3 = entry({ id: "change-3", at: "2026-09-12T10:00:00.000Z", date: "2026-09-12", deltaHours: 20, deltaValue: 2000 });
    // Array position deliberately NOT date order — the shape `mergeBudgetHistories` can produce.
    const s = summarizeBudgetHistory([t2, t1, t3])!;
    expect(s.baselineDate).toBe("2026-09-10");
    expect(s.attributed).toEqual({ hours: 30, value: 3000 });
    expect(s.changes.map((e) => e.id)).toEqual(["change-2", "change-3"]);
  });

  it("picks the EARLIEST baseline when two devices each seeded their own (§554)", () => {
    const baselineB = entry({ id: "baseline-B", at: "2026-09-15T10:00:00.000Z", date: "2026-09-15", kind: "baseline", bucketId: null, bucketName: "", projectBacHours: 999, projectBacValue: 99900 });
    const baselineA = entry({ id: "baseline-A", at: "2026-09-01T10:00:00.000Z", date: "2026-09-01", kind: "baseline", bucketId: null, bucketName: "", projectBacHours: 100, projectBacValue: 10000 });
    const laterChange = entry({ id: "change-later", at: "2026-09-16T10:00:00.000Z", date: "2026-09-16", deltaHours: 5, deltaValue: 500 });
    // baselineB sits FIRST in array order but is dated AFTER baselineA.
    const s = summarizeBudgetHistory([baselineB, baselineA, laterChange])!;
    expect(s.baseline).toEqual({ hours: 100, value: 10000 });
    expect(s.baselineDate).toBe("2026-09-01");
  });

  it("excludes a change dated before the only baseline (§554)", () => {
    const baseline = entry({ id: "baseline-only", at: "2026-09-10T10:00:00.000Z", date: "2026-09-10", kind: "baseline", bucketId: null, bucketName: "", projectBacHours: 100, projectBacValue: 10000 });
    const earlyChange = entry({ id: "change-early", at: "2026-09-05T10:00:00.000Z", date: "2026-09-05", deltaHours: 40, deltaValue: 4000 });
    const s = summarizeBudgetHistory([baseline, earlyChange])!;
    expect(s.changes).toEqual([]);
    expect(s.attributed).toEqual({ hours: 0, value: 0 });
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

describe("mergeBudgetHistories", () => {
  const a = recordBudgetChange([], change({}));
  const b = recordBudgetChange(a, change({ before: { hours: 150, value: 15000 }, after: { hours: 170, value: 17000 } }));
  it("unions by id keeping prev order first, then next-only ids in next order", () => {
    const localOnly = recordBudgetChange(a, change({ kind: "created", bucketId: 9, before: { hours: 150, value: 15000 }, after: { hours: 160, value: 16000 } }));
    const merged = mergeBudgetHistories(localOnly, b);
    expect(merged.map((e) => e.id)).toEqual([...localOnly.map((e) => e.id), b[2].id]);
  });
  it("keeps prev's entry on a duplicate id", () => {
    const next = [{ ...a[0], bucketName: "other" }];
    expect(mergeBudgetHistories(a, next)[0]).toBe(a[0]);
  });
  it("treats undefined on either side as empty and ALWAYS returns a new array", () => {
    expect(mergeBudgetHistories(undefined, undefined)).toEqual([]);
    const fromPrev = mergeBudgetHistories(a, undefined);
    expect(fromPrev).toEqual(a);
    expect(fromPrev).not.toBe(a);
    const fromNext = mergeBudgetHistories([], b);
    expect(fromNext).toEqual(b);
    expect(fromNext).not.toBe(b);
  });
  it("never caps", () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ ...a[1], id: `m-${i}` }));
    expect(mergeBudgetHistories(many, [{ ...a[1], id: "last" }])).toHaveLength(5001);
  });
});
