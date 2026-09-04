import { describe, expect, it } from "vitest";
import { insightsMateriallyEqual, reconcileInsights } from "./reconcile";
import type { DetectedInsight, Insight, InsightType } from "./insight";
import { MAX_INSIGHTS } from "./insight";

// Every pre-existing test in this file is about the ALWAYS-EVALUATED behaviour,
// so each of its calls certifies every insight. A DISCRIMINATING predicate
// belongs only in the "evaluated scope" describe at the bottom of this file —
// converting those to this constant too would delete the only coverage the
// freeze path has at this level.
const ALL_EVALUATED = (): boolean => true;

/** Certifies exactly one type — the narrow shape the freeze path is about. */
const onlyType =
  (type: InsightType) =>
  (i: Insight): boolean =>
    i.type === type;

function detected(
  key: string,
  over: Partial<DetectedInsight> = {},
): DetectedInsight {
  return {
    key,
    type: "overdueTrend",
    severity: "medium",
    data: { count: 1 },
    ...over,
  };
}

function stored(key: string, over: Partial<Insight> = {}): Insight {
  return {
    id: 1,
    key,
    type: "overdueTrend",
    severity: "medium",
    data: { count: 1 },
    status: "active",
    firstSeenAt: "2026-01-01",
    lastSeenAt: "2026-01-01",
    occurrences: 1,
    ...over,
  };
}

const REC: NonNullable<Insight["recommendation"]> = {
  summary: "do X",
  proposedCalls: [{ name: "update_task", input: { id: 1 } }],
  generatedAt: "2026-01-19",
  status: "proposed",
};

describe("reconcileInsights", () => {
  it("creates a new active record for an unseen detection (id=max+1, timestamps=today, occurrences=1)", () => {
    const existing = stored("a", { id: 7 });
    const out = reconcileInsights([existing], [detected("a"), detected("b")], "2026-02-01", ALL_EVALUATED);
    const created = out.find((i) => i.key === "b")!;
    expect(created).toBeDefined();
    expect(created.id).toBe(8); // max(7)+1
    expect(created.status).toBe("active");
    expect(created.firstSeenAt).toBe("2026-02-01");
    expect(created.lastSeenAt).toBe("2026-02-01");
    expect(created.occurrences).toBe(1);
  });

  it("mints id=1 when the store is empty", () => {
    const out = reconcileInsights([], [detected("x")], "2026-02-01", ALL_EVALUATED);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  it("re-detects an existing active key: bumps lastSeenAt/occurrences, refreshes severity+data, keeps id+status+firstSeenAt", () => {
    const existing = stored("a", {
      id: 5,
      severity: "low",
      data: { count: 1 },
      occurrences: 3,
      firstSeenAt: "2026-01-01",
      lastSeenAt: "2026-01-10",
    });
    const out = reconcileInsights(
      [existing],
      [detected("a", { severity: "high", data: { count: 9 } })],
      "2026-02-01",
      ALL_EVALUATED,
    );
    const upserted = out.find((i) => i.key === "a")!;
    expect(upserted.id).toBe(5);
    expect(upserted.status).toBe("active");
    expect(upserted.firstSeenAt).toBe("2026-01-01");
    expect(upserted.lastSeenAt).toBe("2026-02-01");
    expect(upserted.occurrences).toBe(4);
    expect(upserted.severity).toBe("high");
    expect(upserted.data).toEqual({ count: 9 });
  });

  it("resolves a cleared record that had a user lifecycle event (actedAt set) and KEEPS it", () => {
    const existing = stored("a", {
      status: "acted",
      actedAt: "2026-01-15",
    });
    const out = reconcileInsights([existing], [], "2026-02-01", ALL_EVALUATED);
    const rec = out.find((i) => i.key === "a")!;
    expect(rec).toBeDefined();
    expect(rec.status).toBe("resolved");
    expect(rec.resolvedAt).toBe("2026-02-01");
  });

  it("PRUNES a cleared auto-surfaced record with no user event", () => {
    const existing = stored("a", { status: "active" });
    const out = reconcileInsights([existing], [], "2026-02-01", ALL_EVALUATED);
    expect(out.find((i) => i.key === "a")).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it("leaves a cleared dismissed record unchanged (still dismissed, still present)", () => {
    const existing = stored("a", {
      status: "dismissed",
      dismissedAt: "2026-01-20",
      dismissReason: "noise",
    });
    const out = reconcileInsights([existing], [], "2026-02-01", ALL_EVALUATED);
    const rec = out.find((i) => i.key === "a")!;
    expect(rec).toBeDefined();
    expect(rec.status).toBe("dismissed");
    expect(rec.dismissedAt).toBe("2026-01-20");
    expect(rec.dismissReason).toBe("noise");
    expect(rec.resolvedAt).toBeUndefined();
  });

  it("re-fires a dismissed record back to active and clears dismissedAt/dismissReason", () => {
    const existing = stored("a", {
      status: "dismissed",
      dismissedAt: "2026-01-20",
      dismissReason: "noise",
      occurrences: 2,
    });
    const out = reconcileInsights([existing], [detected("a")], "2026-02-01", ALL_EVALUATED);
    const rec = out.find((i) => i.key === "a")!;
    expect(rec.status).toBe("active");
    expect(rec.dismissedAt).toBeUndefined();
    expect(rec.dismissReason).toBeUndefined();
    expect(rec.lastSeenAt).toBe("2026-02-01");
    expect(rec.occurrences).toBe(3);
  });

  it("re-fires a resolved record back to active and clears resolvedAt", () => {
    const existing = stored("a", {
      status: "resolved",
      resolvedAt: "2026-01-25",
      occurrences: 4,
    });
    const out = reconcileInsights([existing], [detected("a")], "2026-02-01", ALL_EVALUATED);
    const rec = out.find((i) => i.key === "a")!;
    expect(rec.status).toBe("active");
    expect(rec.resolvedAt).toBeUndefined();
    expect(rec.occurrences).toBe(5);
  });

  it("orders by severity desc, then lastSeenAt desc (stable)", () => {
    const s = [
      stored("low1", { id: 1, severity: "low", lastSeenAt: "2026-01-05" }),
      stored("high-old", { id: 2, severity: "high", lastSeenAt: "2026-01-01" }),
      stored("high-new", { id: 3, severity: "high", lastSeenAt: "2026-01-09" }),
      stored("med1", { id: 4, severity: "medium", lastSeenAt: "2026-01-03" }),
    ];
    // Detect all so nothing prunes; keep their severities/dates.
    const d = s.map((i) =>
      detected(i.key, { severity: i.severity, data: i.data }),
    );
    const out = reconcileInsights(s, d, "2026-01-09", ALL_EVALUATED);
    // Upsert bumps lastSeenAt to today for all — so within a severity tier the
    // order falls back to stable insertion order. Use distinct stored dates by
    // detecting only a subset instead.
    expect(out.map((i) => i.severity)).toEqual(["high", "high", "medium", "low"]);
  });

  it("orders ties by lastSeenAt desc when dates differ", () => {
    const s = [
      stored("high-old", { id: 1, severity: "high", lastSeenAt: "2026-01-01" }),
      stored("high-new", { id: 2, severity: "high", lastSeenAt: "2026-01-09" }),
    ];
    // No detections → both cleared, but they had no user event → pruned.
    // Instead make them dismissed so they persist with their stored dates.
    const dismissed = s.map((i) => stored(i.key, { ...i, status: "dismissed", dismissedAt: "2025-12-01" }));
    const out = reconcileInsights(dismissed, [], "2026-02-01", ALL_EVALUATED);
    expect(out.map((i) => i.key)).toEqual(["high-new", "high-old"]);
  });

  it("caps output at MAX_INSIGHTS", () => {
    const many: DetectedInsight[] = Array.from(
      { length: MAX_INSIGHTS + 25 },
      (_, i) => detected(`k${i}`),
    );
    const out = reconcileInsights([], many, "2026-02-01", ALL_EVALUATED);
    expect(out).toHaveLength(MAX_INSIGHTS);
  });

  // ★★★ THE CAP MUST NOT EVICT THE FROZEN ROW, or "freezing is recoverable" —
  // the justification the whole per-insight predicate rests on — is false. A
  // frozen row is carried through untouched, so its `lastSeenAt` never advances
  // while every detected row's does; under a naive `lastSeenAt` sort it loses
  // ground on every pass and is the FIRST of its severity to be sliced away.
  // Once gone from `stored` it never comes back, so the freeze that protected
  // an acted insight from a fabricated win deletes it by attrition instead.
  it("keeps a frozen insight when the cap evicts, despite its stale lastSeenAt", () => {
    const FROZEN = "frozen-and-stale";
    // Deliberately the OLDEST row in the set: it is what a row frozen across
    // several passes looks like, and it is the one a lastSeenAt sort drops.
    const frozen = stored(FROZEN, { status: "acted", lastSeenAt: "2020-01-01" });
    const many: DetectedInsight[] = Array.from(
      { length: MAX_INSIGHTS + 25 },
      (_, i) => detected(`k${i}`),
    );
    // Same severity throughout, so severity cannot be what saves or sinks it —
    // the tie-break is the entire subject of this test.
    const out = reconcileInsights([frozen], many, "2026-02-01", (i) => i.key !== FROZEN);
    expect(out).toHaveLength(MAX_INSIGHTS);
    expect(out.map((i) => i.key)).toContain(FROZEN);
    // ★★ ORDERING ONLY: the row survives, and its record still says when it was
    // genuinely last seen. Advancing `lastSeenAt` would also make it survive —
    // by writing a lie about observation into exported data, which is the exact
    // class of defect this module exists to prevent. Without this assertion the
    // test passes against that fix too.
    expect(out.find((i) => i.key === FROZEN)?.lastSeenAt).toBe("2020-01-01");
  });

  it("upsert preserves a pending recommendation", () => {
    const existing = stored("a", { recommendation: REC });
    const out = reconcileInsights([existing], [detected("a")], "2026-02-01", ALL_EVALUATED);
    const upserted = out.find((i) => i.key === "a")!;
    expect(upserted.recommendation?.summary).toBe("do X");
    expect(upserted.occurrences).toBe(2);
  });

  it("re-fire drops a stale applied recommendation", () => {
    const applied = { ...REC, status: "applied" as const, appliedAt: "2026-01-19" };
    const existing = stored("a", {
      status: "dismissed",
      dismissedAt: "2026-01-19",
      recommendation: applied,
    });
    const out = reconcileInsights([existing], [detected("a")], "2026-02-01", ALL_EVALUATED);
    const rec = out.find((i) => i.key === "a")!;
    expect(rec.status).toBe("active");
    expect(rec.recommendation).toBeUndefined();
  });

  it("does not mutate the stored input array or its objects", () => {
    const existing = stored("a", {
      id: 5,
      severity: "low",
      occurrences: 3,
      status: "acted",
      actedAt: "2026-01-15",
    });
    const snapshot = structuredClone(existing);
    const arr = [existing];
    reconcileInsights(arr, [detected("a", { severity: "high" })], "2026-02-01", ALL_EVALUATED);
    expect(existing).toEqual(snapshot);
    expect(arr).toHaveLength(1);
  });
});

describe("insightsMateriallyEqual", () => {
  it("is TRUE when two lists differ only in occurrences/lastSeenAt", () => {
    const a = [stored("a", { occurrences: 1, lastSeenAt: "2026-01-01" })];
    const b = [stored("a", { occurrences: 2, lastSeenAt: "2026-02-01" })];
    expect(insightsMateriallyEqual(a, b)).toBe(true);
  });

  it("is TRUE for the identical reference", () => {
    const a = [stored("a")];
    expect(insightsMateriallyEqual(a, a)).toBe(true);
  });

  it("is FALSE when status differs", () => {
    const a = [stored("a", { status: "active" })];
    const b = [stored("a", { status: "acknowledged" })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  it("is FALSE when severity differs", () => {
    const a = [stored("a", { severity: "medium" })];
    const b = [stored("a", { severity: "high" })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  it("is FALSE when a data value differs", () => {
    const a = [stored("a", { data: { count: 1 } })];
    const b = [stored("a", { data: { count: 2 } })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  it("is FALSE when the lengths differ (one pruned/added)", () => {
    const a = [stored("a"), stored("b", { id: 2, key: "b" })];
    const b = [stored("a")];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  it("is FALSE when entityRef differs", () => {
    const a = [stored("a", { entityRef: { view: "open-points", id: 1 } })];
    const b = [stored("a", { entityRef: { view: "open-points", id: 2 } })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
    const c = [stored("a", { entityRef: undefined })];
    expect(insightsMateriallyEqual(a, c)).toBe(false);
  });

  it("is FALSE when a dismissReason / timestamp differs", () => {
    const a = [stored("a", { status: "dismissed", dismissedAt: "2026-01-20", dismissReason: "noise" })];
    const b = [stored("a", { status: "dismissed", dismissedAt: "2026-01-20", dismissReason: "duplicate" })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
    const c = [stored("a", { status: "dismissed", dismissedAt: "2026-01-21", dismissReason: "noise" })];
    expect(insightsMateriallyEqual(a, c)).toBe(false);
  });

  it("is FALSE when a recommendation is added (data-loss guard)", () => {
    const a = [stored("a")];
    const b = [stored("a", { recommendation: REC })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  it("is FALSE when a recommendation STATUS changes", () => {
    const a = [stored("a", { recommendation: REC })];
    const b = [stored("a", { recommendation: { ...REC, status: "applied" as const } })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });
});

const TODAY = "2026-06-10";

/** An ACTED stalledWork record whose captured baseline is count=10. */
function actedStalled(over: Partial<Insight> = {}): Insight {
  return stored("stalledWork", {
    type: "stalledWork",
    data: { count: 10 },
    status: "acted",
    actedAt: "2026-06-01",
    metricAtAction: { count: 10 },
    ...over,
  });
}

function stalledDet(count: number): DetectedInsight {
  return detected("stalledWork", {
    type: "stalledWork",
    severity: "medium",
    data: { count },
  });
}

describe("outcome measurement (SP3)", () => {
  it("measures an improvement while the insight is STILL detected", () => {
    const out = reconcileInsights([actedStalled()], [stalledDet(4)], TODAY, ALL_EVALUATED);
    const rec = out.find((i) => i.key === "stalledWork")!;
    expect(rec.status).toBe("acted");
    expect(rec.outcome).toEqual({
      direction: "improved",
      baseline: 10,
      current: 4,
      delta: 6,
      measuredAt: TODAY,
    });
  });

  it("measures a worsening when the metric grew", () => {
    const out = reconcileInsights([actedStalled()], [stalledDet(14)], TODAY, ALL_EVALUATED);
    const rec = out.find((i) => i.key === "stalledWork")!;
    expect(rec.outcome).toMatchObject({ direction: "worsened", delta: -4 });
  });

  // Direction-only on clear: four of the five detectors are THRESHOLD-gated, so
  // "cleared" means below threshold, not zero (stalledWork stops firing at
  // count < 3, so a baseline of 10 could really be a move to 2, not to 0).
  // Reporting a magnitude here would overstate the win.
  it("records a direction-only win when the condition CLEARS and the record resolves", () => {
    const out = reconcileInsights([actedStalled()], [], TODAY, ALL_EVALUATED);
    const rec = out.find((i) => i.key === "stalledWork")!;
    expect(rec.status).toBe("resolved");
    expect(rec.outcome).toEqual({
      direction: "improved", baseline: 10, measuredAt: TODAY,
    });
    expect(rec.outcome?.current).toBeUndefined();
    expect(rec.outcome?.delta).toBeUndefined();
  });

  it("writes NO outcome without a captured metricAtAction", () => {
    const noBaseline = actedStalled({ metricAtAction: undefined });
    expect(reconcileInsights([noBaseline], [stalledDet(4)], TODAY, ALL_EVALUATED)[0].outcome).toBeUndefined();
    expect(reconcileInsights([noBaseline], [], TODAY, ALL_EVALUATED)[0]?.outcome).toBeUndefined();
  });

  it("writes NO outcome for a record that was never acted on", () => {
    const active = actedStalled({ status: "active", actedAt: undefined });
    const out = reconcileInsights([active], [stalledDet(4)], TODAY, ALL_EVALUATED);
    expect(out[0].outcome).toBeUndefined();
  });

  it("is idempotent: re-reconciling the measured record converges (no measure→persist loop)", () => {
    const once = reconcileInsights([actedStalled()], [stalledDet(4)], TODAY, ALL_EVALUATED);
    const twice = reconcileInsights(once, [stalledDet(4)], TODAY, ALL_EVALUATED);
    // `occurrences` counts detections and legitimately bumps on every pass, so it
    // is normalized out; EVERYTHING else — the outcome above all — must converge.
    const norm = (l: readonly Insight[]) => l.map((i) => ({ ...i, occurrences: 0 }));
    expect(norm(twice)).toEqual(norm(once));
  });

  // A DISMISSED record is typically dismissed while the condition is STILL firing,
  // so the problem instance never ended and its baseline is still the true "before".
  // Dropping it here would re-create the wrong-baseline bug via the other branch.
  it("KEEPS the baseline when a dismissed record is still detected", () => {
    const dismissed = actedStalled({
      status: "dismissed",
      dismissedAt: "2026-06-03",
      outcome: {
        direction: "improved", baseline: 10, current: 6, delta: 4, measuredAt: "2026-06-03",
      },
    });
    const out = reconcileInsights([dismissed], [stalledDet(6)], TODAY, ALL_EVALUATED);
    const rec = out.find((i) => i.key === "stalledWork")!;
    expect(rec.status).toBe("active");
    // The stale measurement still goes — it describes the previous state.
    expect(rec.outcome).toBeUndefined();
    // ...but the baseline survives, so a later act still measures the real "before".
    expect(rec.metricAtAction).toEqual({ count: 10 });
  });

  it("re-fire drops BOTH the stale outcome and the stale baseline", () => {
    const stale = actedStalled({
      status: "resolved",
      resolvedAt: "2026-06-05",
      outcome: {
        direction: "improved",
        baseline: 10,
        current: 0,
        delta: 10,
        measuredAt: "2026-06-05",
      },
    });
    const out = reconcileInsights([stale], [stalledDet(7)], TODAY, ALL_EVALUATED);
    const rec = out.find((i) => i.key === "stalledWork")!;
    expect(rec.status).toBe("active");
    expect(rec.outcome).toBeUndefined();
    // A re-fire is a NEW problem instance and deserves a NEW baseline. Keeping the
    // old one would make the next act a no-op for metricAtActionPatch ("first act
    // wins"), silently measuring the new cycle against the previous cycle's number.
    expect(rec.metricAtAction).toBeUndefined();
  });
});

describe("insightsMateriallyEqual — outcome (data-loss guard)", () => {
  const OUTCOME: NonNullable<Insight["outcome"]> = {
    direction: "improved",
    baseline: 10,
    current: 4,
    delta: 6,
    measuredAt: TODAY,
  };

  it("is FALSE when an outcome is added", () => {
    const a = [stored("a")];
    const b = [stored("a", { outcome: OUTCOME })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  // The optional-field transition: same direction + baseline, but the magnitude
  // disappears (a measured outcome replaced by a direction-only one). A looser
  // comparator — JSON.stringify, which drops undefined keys — would miss this and
  // silently skip the persist write-back.
  it("is FALSE when a measured outcome becomes direction-only", () => {
    const measured = [stored("a", { outcome: OUTCOME })];
    const directionOnly = [stored("a", {
      outcome: { direction: "improved", baseline: 10, measuredAt: TODAY },
    })];
    expect(insightsMateriallyEqual(measured, directionOnly)).toBe(false);
    expect(insightsMateriallyEqual(directionOnly, measured)).toBe(false);
  });

  it("is TRUE when both carry the same outcome", () => {
    const a = [stored("a", { outcome: OUTCOME })];
    const b = [stored("a", { outcome: { ...OUTCOME } })];
    expect(insightsMateriallyEqual(a, b)).toBe(true);
  });
});

describe("evaluated scope", () => {
  // A stored TimeLog guardrail insight. Named distinctly rather than shadowing
  // the file-level `stored(key, over)` above, whose signature differs.
  const guardrail = (over: Partial<Insight> = {}): Insight => ({
    id: 1,
    key: "timelog:timelogCapPerDay:7",
    type: "timelogCapPerDay",
    severity: "medium",
    data: { person: "Ada", count: 2, worstHours: 12, threshold: 8 },
    status: "active",
    firstSeenAt: "2026-09-01",
    lastSeenAt: "2026-09-03",
    occurrences: 2,
    ...over,
  });

  // Asserting only "it was not pruned" PASSES against a version that keeps the
  // row and resolves it to "improved" — the exact fabricated win this argument
  // exists to prevent. So the assertion is UNCHANGED: same object, same status,
  // no outcome, no resolvedAt.
  it("leaves an acted insight completely unchanged when its type was not evaluated", () => {
    const prev = guardrail({ status: "acted", actedAt: "2026-09-02", metricAtAction: { count: 4 } });
    const out = reconcileInsights([prev], [], "2026-09-04", onlyType("milestoneSlip"));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(prev);
    expect(out[0].status).toBe("acted");
    expect(out[0].outcome).toBeUndefined();
    expect(out[0].resolvedAt).toBeUndefined();
  });

  it("does not prune an untouched insight whose type was not evaluated", () => {
    const prev = guardrail();
    const out = reconcileInsights([prev], [], "2026-09-04", onlyType("milestoneSlip"));
    expect(out).toEqual([prev]);
  });

  it("still resolves an acted insight whose type WAS evaluated", () => {
    const prev = guardrail({ status: "acted", actedAt: "2026-09-02", metricAtAction: { count: 4 } });
    const out = reconcileInsights([prev], [], "2026-09-04", ALL_EVALUATED);
    expect(out[0].status).toBe("resolved");
    expect(out[0].outcome?.direction).toBe("improved");
  });

  it("still prunes an untouched insight whose type WAS evaluated", () => {
    const out = reconcileInsights([guardrail()], [], "2026-09-04", ALL_EVALUATED);
    expect(out).toEqual([]);
  });

  // A disabled rule freezes rather than resolves. Distinct from the
  // bookings-unavailable case above: neither implies the other.
  it("freezes a guardrail insight when its rule has been switched off", () => {
    const prev = guardrail({ status: "acknowledged", acknowledgedAt: "2026-09-02" });
    const out = reconcileInsights(
      [prev],
      [],
      "2026-09-04",
      (i) => i.type !== "timelogCapPerDay",
    );
    expect(out).toEqual([prev]);
  });
});

// ★★★ WHAT WIDENING A GUARDRAIL `data` RECORD DOES, AND WHERE. Adding the two
// violating-day keys to a timelog insight's `data` was expected to change when
// an insight counts as CHANGED between passes. It does — but NOT in `upsert`,
// which contains no comparison at all: it assigns `data: det.data` outright and
// advances `lastSeenAt`/`occurrences` on EVERY detection, identical data or
// not. The only `data` comparison in this module is `shallowRecordEqual`, and
// its sole consumer is `insightsMateriallyEqual` — the write-back skip. So the
// whole behaviour delta lives there, and it is narrow: it needs the violating
// DAYS to move while `count`, `worstHours` and `threshold` all stay equal (a
// sliding window that drops one breaching day and gains another at the same
// peak). In that case the workspace is now written where it previously was not.
//
// ★★★ THAT EXTRA WRITE IS REQUIRED, NOT TOLERATED. Skipping it would leave the
// STORED dates describing a roll that has moved on, and the stored dates are
// exactly what a later reconcile reads to ask "does the current roll still
// cover the days this insight was about". A stale bound answers that question
// confidently and wrongly — the fabricated-win shape this field exists to make
// detectable. The two tests below pin both halves.
describe("widening a guardrail data record", () => {
  const withDays = (first: string, last: string) => ({
    count: 2, worstHours: 12, threshold: 8,
    firstViolationDate: first, lastViolationDate: last,
  });

  // The write-back skip MUST see a date-only shift as material. Everything the
  // old record compared on (count/worstHours/threshold) is held equal here, so
  // this is red against a `data` comparison that ignores unknown keys.
  it("treats a violating-day shift as a material change even when the counts match", () => {
    const a = [stored("g", { type: "timelogCapPerDay", data: withDays("2026-02-03", "2026-02-11") })];
    const b = [stored("g", { type: "timelogCapPerDay", data: withDays("2026-02-05", "2026-02-19") })];
    expect(insightsMateriallyEqual(a, b)).toBe(false);
  });

  // `upsert` has no equality gate: identical data still advances the counters,
  // which is why adding keys cannot have changed anything there. Asserting the
  // IDENTICAL-data case is the half that proves the absence of a comparison —
  // a differing-data case would pass either way.
  it("upserts on identical data, so the new keys change nothing in the lifecycle", () => {
    const data = withDays("2026-02-03", "2026-02-11");
    const prev = stored("g", {
      type: "timelogCapPerDay", data, occurrences: 4, lastSeenAt: "2026-06-01",
    });
    const out = reconcileInsights(
      [prev],
      [detected("g", { type: "timelogCapPerDay", data })],
      "2026-06-10",
      ALL_EVALUATED,
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("active");
    expect(out[0].occurrences).toBe(5);
    expect(out[0].lastSeenAt).toBe("2026-06-10");
    expect(out[0].data).toEqual(data);
  });

  // The fresh dates must actually REPLACE the stored ones — a merge that kept
  // the older bound would widen coverage the roll no longer has.
  it("adopts the freshly detected dates rather than merging them", () => {
    const out = reconcileInsights(
      [stored("g", { type: "timelogCapPerDay", data: withDays("2026-02-03", "2026-02-11") })],
      [detected("g", { type: "timelogCapPerDay", data: withDays("2026-05-04", "2026-05-06") })],
      "2026-06-10",
      ALL_EVALUATED,
    );
    expect(out[0].data.firstViolationDate).toBe("2026-05-04");
    expect(out[0].data.lastViolationDate).toBe("2026-05-06");
  });
});

// The compile-error property is the ENTIRE justification for making the argument
// REQUIRED rather than defaulting it to "all types". Prose cannot pin that;
// the directive below can, and `npx tsc --noEmit` is where it is checked —
// vitest never typechecks. If the argument is ever given a default, tsc fails
// here with "Unused '@ts-expect-error' directive".
//
// ★★ Do NOT start a prose line in this block with the bare directive text: a
// comment line beginning `// @ts-` IS a directive to tsc, so an explanatory
// mention becomes a second, unused one and fails the build on the wrong line.
// @ts-expect-error - the evaluated-scope argument is REQUIRED, never defaulted
const _requiredArgumentPin = () => reconcileInsights([], [], "2026-09-04");
void _requiredArgumentPin;
