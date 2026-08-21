# Insights → Action Loop SP3 — Outcome Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an insight is acted on, snapshot the one number it is about; on a later reconcile, measure the live number against that baseline and label the outcome (improved / unchanged / worsened + delta), surfaced as a badge — plus fold in the five deferred SP2 items.

**Architecture:** A new pure i18n-free `insights/outcome.ts` owns the per-type metric field map, extraction, and `computeOutcome`. Capture happens in `task-manager` at BOTH acted sites (manual `onActInsight` + AI `confirmInsightRecommendation`) via one shared patch helper so they cannot drift. Measurement happens inside the existing pure `reconcile.ts` (upsert for acted-and-still-detected, clear for acted→resolved). `outcome` + `metricAtAction` ride the existing insights blob — no new backend write path, byte-stable when absent.

**Tech Stack:** TypeScript, React 19, Vitest 4, forked Next.js 16, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-20-insights-action-loop-sp3-design.md`

---

## File Structure

**Create:**
- `src/app/insights/outcome.ts` — pure engine: `METRIC_FIELD`, `insightMetricValue`, `insightMetricSnapshot`, `metricAtActionPatch`, `baselineOf`, `computeOutcome`.
- `src/app/insights/outcome.test.ts`
- `src/app/insights/insight-outcome-badge.tsx` — presentational badge (props-only; used by BOTH surfaces).
- `src/app/insights/insight-outcome-badge.test.tsx`

**Modify:**
- `src/app/insights/insight.ts` — `InsightOutcome` type + `Insight.outcome?`.
- `src/app/insights/sanitize-insights.ts` — `sanitizeOutcome`.
- `src/app/insights/sanitize-insights.test.ts`
- `src/app/insights/reconcile.ts` — measure in upsert/clear, drop on re-fire, `outcomeEqual` in `insightsMateriallyEqual`.
- `src/app/insights/reconcile.test.ts`
- `src/app/task-manager.tsx` — capture at both acted sites; populate the recommendation context's linked `entity`.
- `src/app/dashboard-sections/insights-card.tsx` + `src/app/insights-panel.tsx` — render the badge.
- `src/app/insight-recommendation-controls.tsx` — regenerate-after-reject.
- `src/app/insights/recommend-call.ts` — drop the dead `| null`.
- `src/app/use-insight-recommend-runner.ts` — drop the unused `now` arg.
- `src/app/i18n.ts` + `src/app/i18n.de.ts` — 4 outcome keys + release highlight.
- `src/app/version.ts`, `CHANGELOG.md`, `AGENTS.md`, `package.json`, `docs/baselines/file-sizes.json`.

---

### Task 1: Outcome engine (pure)

**Files:**
- Modify: `src/app/insights/insight.ts`
- Create: `src/app/insights/outcome.ts`
- Test: `src/app/insights/outcome.test.ts`

- [ ] **Step 1: Add the type to `insight.ts`**

Insert after the `InsightRecommendation` block (~line 71), and add the field to `Insight`:

```ts
export const INSIGHT_OUTCOME_DIRECTIONS = ["improved", "unchanged", "worsened"] as const;
export type InsightOutcomeDirection = (typeof INSIGHT_OUTCOME_DIRECTIONS)[number];

/** SP3 outcome measurement: the acted-on baseline vs the live metric. */
export interface InsightOutcome {
  readonly direction: InsightOutcomeDirection;
  readonly baseline: number;
  readonly current: number;
  /** baseline − current. Positive ⇒ better (ALL insight metrics are lower-is-better). */
  readonly delta: number;
  readonly measuredAt: string;
}
```

In `interface Insight`, replace the reserved comment line and add the field:

```ts
  /** Baseline metric captured at the FIRST transition to `acted` (SP3). */
  readonly metricAtAction?: Readonly<Record<string, number>>;
  readonly recommendation?: InsightRecommendation;
  /** Measured outcome vs `metricAtAction` (SP3). Derived — reconcile owns it. */
  readonly outcome?: InsightOutcome;
```

- [ ] **Step 2: Write the failing test**

Create `src/app/insights/outcome.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  METRIC_FIELD, insightMetricValue, insightMetricSnapshot, metricAtActionPatch,
  baselineOf, computeOutcome,
} from "./outcome";
import type { Insight } from "./insight";

function ins(over: Partial<Insight> = {}): Insight {
  return {
    id: 1, key: "k", type: "milestoneSlip", severity: "high",
    data: { name: "M1", daysOverdue: 5 }, status: "active",
    firstSeenAt: "2026-06-01", lastSeenAt: "2026-06-01", occurrences: 1,
    ...over,
  };
}

describe("insightMetricValue", () => {
  it("reads the per-type field", () => {
    expect(insightMetricValue("milestoneSlip", { daysOverdue: 5 })).toBe(5);
    expect(insightMetricValue("overdueTrend", { current: 12, prior: 9, delta: 3 })).toBe(12);
    expect(insightMetricValue("stalledWork", { count: 3 })).toBe(3);
    expect(insightMetricValue("budgetVariance", { variancePct: 22 })).toBe(22);
    expect(insightMetricValue("raidAging", { daysSinceUpdate: 9 })).toBe(9);
  });

  it("returns null when the field is missing or not finite", () => {
    expect(insightMetricValue("stalledWork", {})).toBeNull();
    expect(insightMetricValue("stalledWork", { count: "abc" })).toBeNull();
  });

  it("coerces a numeric string", () => {
    expect(insightMetricValue("stalledWork", { count: "4" })).toBe(4);
  });
});

describe("insightMetricSnapshot / metricAtActionPatch", () => {
  it("snapshots under the per-type field name", () => {
    expect(insightMetricSnapshot(ins())).toEqual({ daysOverdue: 5 });
  });

  it("returns undefined when no metric is extractable", () => {
    expect(insightMetricSnapshot(ins({ data: { name: "M1" } }))).toBeUndefined();
  });

  it("patches on first act only — a re-act never overwrites the baseline", () => {
    expect(metricAtActionPatch(ins())).toEqual({ metricAtAction: { daysOverdue: 5 } });
    const already = ins({ metricAtAction: { daysOverdue: 9 }, data: { daysOverdue: 2 } });
    expect(metricAtActionPatch(already)).toEqual({});
  });

  it("patches empty when the metric is absent", () => {
    expect(metricAtActionPatch(ins({ data: { name: "M1" } }))).toEqual({});
  });
});

describe("baselineOf", () => {
  it("reads the captured baseline by the type's field", () => {
    expect(baselineOf(ins({ metricAtAction: { daysOverdue: 7 } }))).toBe(7);
  });
  it("returns null with no capture", () => {
    expect(baselineOf(ins())).toBeNull();
  });
});

describe("computeOutcome", () => {
  it("improved when the metric fell (lower is better)", () => {
    expect(computeOutcome(10, 4, "2026-06-10")).toEqual({
      direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-10",
    });
  });
  it("worsened when the metric rose", () => {
    expect(computeOutcome(4, 10, "2026-06-10")).toMatchObject({ direction: "worsened", delta: -6 });
  });
  it("unchanged when equal", () => {
    expect(computeOutcome(4, 4, "2026-06-10")).toMatchObject({ direction: "unchanged", delta: 0 });
  });
});

describe("METRIC_FIELD guard", () => {
  it("covers every insight type exactly once", () => {
    expect(Object.keys(METRIC_FIELD).sort()).toEqual(
      ["budgetVariance", "milestoneSlip", "overdueTrend", "raidAging", "stalledWork"],
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/app/insights/outcome.test.ts`
Expected: FAIL — "Failed to resolve import ./outcome".

- [ ] **Step 4: Implement `outcome.ts`**

```ts
// Pure, i18n-free SP3 outcome engine. Every insight metric is LOWER-IS-BETTER,
// so `improved` is simply current < baseline — there is no per-type direction
// table. `today` is always passed in; this module reads no clock.
import { INSIGHT_TYPES, type Insight, type InsightOutcome, type InsightType } from "./insight";

/** The ONE comparable number per insight type, keyed by the `data` field each
 *  detector in detect.ts emits. Pinned by a guard test — renaming a detector's
 *  data key without updating this map silently strands extraction at null. */
export const METRIC_FIELD: Record<InsightType, string> = {
  milestoneSlip: "daysOverdue",
  overdueTrend: "current",
  stalledWork: "count",
  budgetVariance: "variancePct",
  raidAging: "daysSinceUpdate",
};

function finite(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The comparable number for an insight's data, or null when absent/unparseable. */
export function insightMetricValue(
  type: InsightType,
  data: Readonly<Record<string, string | number>>,
): number | null {
  return finite(data[METRIC_FIELD[type]]);
}

/** `{ [field]: value }` for metricAtAction, or undefined when no metric exists. */
export function insightMetricSnapshot(
  insight: Insight,
): Readonly<Record<string, number>> | undefined {
  const v = insightMetricValue(insight.type, insight.data);
  return v === null ? undefined : { [METRIC_FIELD[insight.type]]: v };
}

/** Spreadable patch for an acted transition. The FIRST act wins — a re-act must
 *  never overwrite the true "before" value the outcome is measured against. */
export function metricAtActionPatch(
  insight: Insight,
): { metricAtAction?: Readonly<Record<string, number>> } {
  if (insight.metricAtAction !== undefined) return {};
  const snap = insightMetricSnapshot(insight);
  return snap ? { metricAtAction: snap } : {};
}

/** The captured baseline for this insight, or null when never captured. */
export function baselineOf(insight: Insight): number | null {
  const m = insight.metricAtAction;
  if (!m) return null;
  return finite(m[METRIC_FIELD[insight.type]]);
}

export function computeOutcome(baseline: number, current: number, today: string): InsightOutcome {
  const delta = baseline - current;
  const direction = delta > 0 ? "improved" : delta < 0 ? "worsened" : "unchanged";
  return { direction, baseline, current, delta, measuredAt: today };
}

// Referenced so a new InsightType is a compile error here, not a silent gap.
void INSIGHT_TYPES;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/insights/outcome.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Guard test — METRIC_FIELD matches what detect.ts emits**

Append to `outcome.test.ts`:

```ts
import { detectInsights } from "./detect";

it("every METRIC_FIELD key is a field the matching detector actually emits", () => {
  const today = "2026-06-10";
  const detected = detectInsights(
    {
      tasks: [
        { id: 1, title: "t", assignee: "", status: "To Do", dueDate: "2026-05-01",
          lastUpdateDate: "2026-01-01", blockers: "", dependencies: [] },
      ] as never,
      milestones: [{ id: 1, name: "M", date: "2026-05-01" }] as never,
      raid: [], budgets: [], roles: [], resources: [], plan: null,
      priorOverdueCount: 0, holidaySet: new Set<string>(),
    },
    today,
  );
  for (const d of detected) {
    expect(Object.prototype.hasOwnProperty.call(d.data, METRIC_FIELD[d.type])).toBe(true);
  }
  // The fixture must actually exercise more than one detector.
  expect(detected.length).toBeGreaterThan(1);
});
```

If the minimal fixture does not satisfy a detector's shape, widen it until at least `milestoneSlip`, `overdueTrend` and `stalledWork` fire (add 3 stale tasks for `stalledWork`). Do NOT weaken the assertion.

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0, no warnings.

- [ ] **Step 8: Commit**

```bash
git add src/app/insights/insight.ts src/app/insights/outcome.ts src/app/insights/outcome.test.ts
git commit -m "feat(insights): SP3 outcome engine + InsightOutcome type"
```

---

### Task 2: `sanitizeInsights` validates `outcome`

**Files:**
- Modify: `src/app/insights/sanitize-insights.ts`
- Test: `src/app/insights/sanitize-insights.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `sanitize-insights.test.ts` (reuse the file's existing valid-insight factory; if it builds records inline, mirror that style):

```ts
describe("outcome (SP3)", () => {
  const base = {
    id: 1, key: "k", type: "stalledWork", severity: "medium", status: "acted",
    data: { count: 3 }, firstSeenAt: "2026-06-01", lastSeenAt: "2026-06-02", occurrences: 1,
  };

  it("keeps a well-formed outcome", () => {
    const [out] = sanitizeInsights([
      { ...base, outcome: { direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-05" } },
    ]);
    expect(out.outcome).toEqual({
      direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-05",
    });
  });

  it("drops an outcome with an unknown direction", () => {
    const [out] = sanitizeInsights([
      { ...base, outcome: { direction: "sideways", baseline: 1, current: 1, delta: 0, measuredAt: "2026-06-05" } },
    ]);
    expect(out.outcome).toBeUndefined();
  });

  it("drops an outcome with a non-finite number", () => {
    const [out] = sanitizeInsights([
      { ...base, outcome: { direction: "improved", baseline: "x", current: 4, delta: 6, measuredAt: "2026-06-05" } },
    ]);
    expect(out.outcome).toBeUndefined();
  });

  it("omits outcome entirely when absent (byte-stable for SP1/SP2 records)", () => {
    const [out] = sanitizeInsights([base]);
    expect("outcome" in out).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/insights/sanitize-insights.test.ts`
Expected: FAIL — `out.outcome` is `undefined` on the well-formed case (field not carried through).

- [ ] **Step 3: Implement**

In `sanitize-insights.ts`, extend the import from `./insight` with `INSIGHT_OUTCOME_DIRECTIONS`, `type InsightOutcome`, `type InsightOutcomeDirection`. Add below `sanitizeRecommendation`:

```ts
function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function sanitizeOutcome(v: unknown): InsightOutcome | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const direction = o.direction as InsightOutcomeDirection;
  if (!INSIGHT_OUTCOME_DIRECTIONS.includes(direction)) return undefined;
  const baseline = num(o.baseline);
  const current = num(o.current);
  const delta = num(o.delta);
  if (baseline === undefined || current === undefined || delta === undefined) return undefined;
  return { direction, baseline, current, delta, measuredAt: isoOr(o.measuredAt, "") };
}
```

In `sanitizeInsights`, after `const rec = sanitizeRecommendation(o.recommendation);`:

```ts
    const outcome = sanitizeOutcome(o.outcome);
```

and in the `insight` literal, after the `...(rec ? …)` line:

```ts
      ...(outcome ? { outcome } : {}),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/insights/sanitize-insights.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/insights/sanitize-insights.ts src/app/insights/sanitize-insights.test.ts
git commit -m "feat(insights): sanitize the SP3 outcome field"
```

---

### Task 3: Reconcile measures the outcome

**Files:**
- Modify: `src/app/insights/reconcile.ts`
- Test: `src/app/insights/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `reconcile.test.ts` (mirror the file's existing insight/detection factories):

```ts
describe("outcome measurement (SP3)", () => {
  const acted = {
    id: 1, key: "stalledWork", type: "stalledWork", severity: "medium",
    status: "acted", data: { count: 10 }, firstSeenAt: "2026-06-01",
    lastSeenAt: "2026-06-01", occurrences: 1, actedAt: "2026-06-02",
    metricAtAction: { count: 10 },
  } as const;

  const det = (count: number) => ({
    key: "stalledWork", type: "stalledWork", severity: "medium", data: { count },
  }) as never;

  it("measures an improvement while the insight is still detected", () => {
    const [out] = reconcileInsights([acted as never], [det(4)], "2026-06-10");
    expect(out.status).toBe("acted");
    expect(out.outcome).toEqual({
      direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-10",
    });
  });

  it("measures a worsening", () => {
    const [out] = reconcileInsights([acted as never], [det(14)], "2026-06-10");
    expect(out.outcome).toMatchObject({ direction: "worsened", delta: -4 });
  });

  it("labels the auto-resolve as improved when the condition clears", () => {
    const [out] = reconcileInsights([acted as never], [], "2026-06-10");
    expect(out.status).toBe("resolved");
    expect(out.outcome).toMatchObject({ direction: "improved", current: 0, delta: 10 });
  });

  it("does not measure when there is no captured baseline", () => {
    const noBaseline = { ...acted, metricAtAction: undefined };
    const [out] = reconcileInsights([noBaseline as never], [det(4)], "2026-06-10");
    expect(out.outcome).toBeUndefined();
  });

  it("does not measure a non-acted insight", () => {
    const active = { ...acted, status: "active", actedAt: undefined };
    const [out] = reconcileInsights([active as never], [det(4)], "2026-06-10");
    expect(out.outcome).toBeUndefined();
  });

  it("is idempotent — reconciling the same detection twice yields the same outcome", () => {
    const once = reconcileInsights([acted as never], [det(4)], "2026-06-10");
    const twice = reconcileInsights(once, [det(4)], "2026-06-10");
    expect(twice).toEqual(once);
  });

  it("drops a stale outcome on re-fire but keeps metricAtAction", () => {
    const resolved = {
      ...acted, status: "resolved", resolvedAt: "2026-06-05",
      outcome: { direction: "improved", baseline: 10, current: 0, delta: 10, measuredAt: "2026-06-05" },
    };
    const [out] = reconcileInsights([resolved as never], [det(8)], "2026-06-10");
    expect(out.status).toBe("active");
    expect(out.outcome).toBeUndefined();
    expect(out.metricAtAction).toEqual({ count: 10 });
  });
});

describe("insightsMateriallyEqual — outcome (data-loss guard)", () => {
  const a = {
    id: 1, key: "k", type: "stalledWork", severity: "medium", status: "acted",
    data: { count: 4 }, firstSeenAt: "2026-06-01", lastSeenAt: "2026-06-02", occurrences: 1,
  } as const;

  it("reports a change when only the outcome differs", () => {
    const withOutcome = {
      ...a,
      outcome: { direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-10" },
    };
    expect(insightsMateriallyEqual([a as never], [withOutcome as never])).toBe(false);
  });

  it("still reports equal when outcomes match", () => {
    const o = { direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-10" };
    expect(
      insightsMateriallyEqual([{ ...a, outcome: o } as never], [{ ...a, outcome: o } as never]),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/insights/reconcile.test.ts`
Expected: FAIL — outcome is `undefined` on the measure cases; the materially-equal outcome case returns `true`.

- [ ] **Step 3: Implement in `reconcile.ts`**

Add the import at the top:

```ts
import { baselineOf, computeOutcome, insightMetricValue } from "./outcome";
```

Add the measure helper above `upsert`:

```ts
/** Attach a freshly measured outcome to an ACTED insight. No captured baseline
 *  or no extractable current metric ⇒ leave the record untouched. Idempotent:
 *  same data + same today ⇒ same outcome, so repeated reconciles converge. */
function withMeasuredOutcome(i: Insight, today: string): Insight {
  const baseline = baselineOf(i);
  const current = insightMetricValue(i.type, i.data);
  if (baseline === null || current === null) return i;
  return { ...i, outcome: computeOutcome(baseline, current, today) };
}
```

In `upsert`, replace the still-live early return:

```ts
  if (prev.status !== "dismissed" && prev.status !== "resolved") {
    // SP3: an acted insight that is STILL detected gets its outcome re-measured
    // against the captured baseline using the fresh detection data.
    return prev.status === "acted" ? withMeasuredOutcome(next, today) : next;
  }
```

The re-fire rebuild already omits `outcome` by construction (it lists fields explicitly and keeps only `metricAtAction`) — add a comment above the `metricAtAction` spread:

```ts
    // metricAtAction kept as history; `outcome` intentionally DROPPED — the old
    // measurement no longer describes the now-recurring problem (SP3).
```

In `clear`, replace the `hadUserAction` branch:

```ts
  if (hadUserAction(prev)) {
    const resolved: Insight = { ...prev, status: "resolved", resolvedAt: today };
    // SP3: an ACTED insight whose condition cleared is a win — measure against
    // the baseline with current = 0 (the condition no longer fires at all).
    if (prev.status !== "acted") return resolved;
    const baseline = baselineOf(prev);
    return baseline === null
      ? resolved
      : { ...resolved, outcome: computeOutcome(baseline, 0, today) };
  }
```

Add the outcome comparator beside `recommendationEqual`:

```ts
function outcomeEqual(a: Insight["outcome"], b: Insight["outcome"]): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.direction === b.direction &&
    a.baseline === b.baseline &&
    a.current === b.current &&
    a.delta === b.delta &&
    a.measuredAt === b.measuredAt
  );
}
```

and add to the `insightsMateriallyEqual` condition, after the `recommendationEqual` line:

```ts
      || !outcomeEqual(x.outcome, y.outcome)
```

(match the file's existing `||`-prefix formatting: it uses trailing `||`, so insert `!outcomeEqual(x.outcome, y.outcome)` as the final clause with the preceding line gaining a trailing `||`.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/insights/reconcile.test.ts`
Expected: PASS (all, including the pre-existing SP1/SP2 cases).

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/insights/reconcile.ts src/app/insights/reconcile.test.ts
git commit -m "feat(insights): measure the SP3 outcome in reconcile"
```

---

### Task 4: Capture the baseline at BOTH acted sites

**Files:**
- Modify: `src/app/task-manager.tsx` (~line 811 `onActInsight`; ~line 1698 `confirmInsightRecommendation`)
- Test: `src/app/insights/outcome.test.ts` (helper already covered) + a new capture test if the repo has a task-manager insight test; otherwise assert via the helper (see Step 4).

- [ ] **Step 1: Import the helper in `task-manager.tsx`**

Add to the insights imports:

```ts
import { metricAtActionPatch } from "./insights/outcome";
```

- [ ] **Step 2: Capture in `onActInsight`**

Replace the mapper (line ~815-819):

```ts
      setInsights((prev) =>
        (prev ?? []).map((i) =>
          i.id === id
            ? {
                ...i,
                status: "acted" as const,
                actedAt: today,
                // SP3: baseline for outcome measurement. metricAtActionPatch is a
                // no-op when a baseline already exists (first act wins) or when the
                // insight has no extractable metric.
                ...metricAtActionPatch(i),
              }
            : i,
        ),
      );
```

- [ ] **Step 3: Capture in `confirmInsightRecommendation`**

In the `setInsights` mapper that advances the insight to `acted` (the `i.id === insight.id ? { ...i, status: "acted", actedAt: today, recommendation: {...} } : i` object), add the same spread — read from `i` (the fresh previous state), NOT the closure's `insight`:

```ts
                status: "acted" as const,
                actedAt: today,
                ...metricAtActionPatch(i),
                recommendation: { ...rec, status: "applied" as const, appliedAt: today, appliedSummary: rec.summary },
```

- [ ] **Step 4: Verify by test**

The patch semantics are already pinned by Task 1's `metricAtActionPatch` tests (first-act-wins, absent-metric). Add ONE integration-level assertion in `outcome.test.ts` documenting the shared-helper contract both call sites rely on:

```ts
it("both acted sites can share one spreadable patch (no drift)", () => {
  const i = ins({ data: { daysOverdue: 5 } });
  const manual = { ...i, status: "acted" as const, actedAt: "2026-06-02", ...metricAtActionPatch(i) };
  const viaAi = { ...i, status: "acted" as const, actedAt: "2026-06-02", ...metricAtActionPatch(i) };
  expect(manual.metricAtAction).toEqual(viaAi.metricAtAction);
  expect(manual.metricAtAction).toEqual({ daysOverdue: 5 });
});
```

Run: `npx vitest run src/app/insights/outcome.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/app/task-manager.tsx src/app/insights/outcome.test.ts
git commit -m "feat(insights): capture metricAtAction on every acted transition"
```

---

### Task 5: Outcome badge component

**Files:**
- Create: `src/app/insights/insight-outcome-badge.tsx`
- Test: `src/app/insights/insight-outcome-badge.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN keys to `i18n.ts`**

Add near the other `insight*` keys:

```ts
  insightOutcomeImproved: "Improved by {0} since you acted",
  insightOutcomeUnchanged: "No change since you acted",
  insightOutcomeWorsened: "Worse by {0} since you acted",
  insightOutcomeLabel: "Outcome",
```

- [ ] **Step 2: Add the DE keys via a node utf8 write (NEVER the Edit tool)**

`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts. Anchor on `\r\n`:

```bash
node -e "
const fs=require('fs');const p='src/app/i18n.de.ts';
let s=fs.readFileSync(p,'utf8');
const anchor='  insightRecommendationError:';
const add='  insightOutcomeImproved: \"Um {0} verbessert seit deiner Aktion\",\r\n'
  +'  insightOutcomeUnchanged: \"Keine Änderung seit deiner Aktion\",\r\n'
  +'  insightOutcomeWorsened: \"Um {0} verschlechtert seit deiner Aktion\",\r\n'
  +'  insightOutcomeLabel: \"Ergebnis\",\r\n';
if(!s.includes(anchor))throw new Error('anchor not found');
s=s.replace(anchor, add+anchor);
fs.writeFileSync(p,s,'utf8');
console.log('ok');
"
```

If the anchor key does not exist, pick any existing `insight*` DE key line as the anchor. Then verify real umlauts and no NUL bytes:

```bash
node -e "
const b=require('fs').readFileSync('src/app/i18n.de.ts');
console.log('NUL:',b.filter(x=>x===0).length);
const s=b.toString('utf8');
console.log('umlaut ok:', s.includes('Änderung'), '| ascii-sub:', /Aenderung|ue |oe /.test(s));
"
```
Expected: `NUL: 0`, `umlaut ok: true`, `ascii-sub: false`.

- [ ] **Step 3: Write the failing test**

Create `src/app/insights/insight-outcome-badge.test.tsx`:

```tsx
import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightOutcomeBadge } from "./insight-outcome-badge";

it("renders the improved wording with the absolute delta", () => {
  render(
    <InsightOutcomeBadge
      lang="en-US"
      outcome={{ direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-10" }}
    />,
  );
  expect(screen.getByText("Improved by 6 since you acted")).toBeInTheDocument();
});

it("renders the worsened wording with a POSITIVE displayed magnitude", () => {
  render(
    <InsightOutcomeBadge
      lang="en-US"
      outcome={{ direction: "worsened", baseline: 4, current: 10, delta: -6, measuredAt: "2026-06-10" }}
    />,
  );
  expect(screen.getByText("Worse by 6 since you acted")).toBeInTheDocument();
});

it("renders the unchanged wording without a delta", () => {
  render(
    <InsightOutcomeBadge
      lang="en-US"
      outcome={{ direction: "unchanged", baseline: 4, current: 4, delta: 0, measuredAt: "2026-06-10" }}
    />,
  );
  expect(screen.getByText("No change since you acted")).toBeInTheDocument();
});

it("keeps the direction dot out of the accessible name (aria-hidden)", () => {
  const { container } = render(
    <InsightOutcomeBadge
      lang="en-US"
      outcome={{ direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-10" }}
    />,
  );
  expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/app/insights/insight-outcome-badge.test.tsx`
Expected: FAIL — cannot resolve `./insight-outcome-badge`.

- [ ] **Step 5: Implement the badge**

Create `src/app/insights/insight-outcome-badge.tsx`:

```tsx
"use client";
// Presentational SP3 outcome badge. Props-only (no context) so BOTH the
// dashboard card and the Insights view can render it. The direction rides the
// DOT (non-text, AA-exempt); the wording is muted text and carries the meaning
// on its own, so the badge is never colour-only.
import { t, type Lang } from "../i18n";
import type { InsightOutcome } from "./insight";

const DIRECTION_DOT: Record<InsightOutcome["direction"], string> = {
  improved: "bg-[var(--rag-green)]",
  unchanged: "bg-ui-medium-grey",
  worsened: "bg-[var(--rag-red)]",
};

export interface InsightOutcomeBadgeProps {
  readonly outcome: InsightOutcome;
  readonly lang: Lang;
}

export function InsightOutcomeBadge({ outcome, lang }: InsightOutcomeBadgeProps) {
  const magnitude = String(Math.abs(outcome.delta));
  const text =
    outcome.direction === "improved"
      ? t(lang, "insightOutcomeImproved", magnitude)
      : outcome.direction === "worsened"
        ? t(lang, "insightOutcomeWorsened", magnitude)
        : t(lang, "insightOutcomeUnchanged");
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DIRECTION_DOT[outcome.direction]}`} />
      {text}
    </span>
  );
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/app/insights/insight-outcome-badge.test.tsx && npx tsc --noEmit`
Expected: PASS, exit 0. (tsc also enforces EN/DE key parity — a missing DE key fails here.)

- [ ] **Step 7: Commit**

```bash
git add src/app/insights/insight-outcome-badge.tsx src/app/insights/insight-outcome-badge.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(insights): SP3 outcome badge + EN/DE strings"
```

---

### Task 6: Render the badge on both surfaces

**Files:**
- Modify: `src/app/dashboard-sections/insights-card.tsx`
- Modify: `src/app/insights-panel.tsx`
- Test: `src/app/dashboard-sections/insights-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `insights-card.test.tsx` (the file's `makeInsight` factory already exists):

```tsx
describe("outcome badge (#6B SP3)", () => {
  it("renders the outcome badge on an acted insight", () => {
    render(
      <InsightsCard
        insights={[makeInsight({
          id: 8, status: "acted",
          outcome: { direction: "improved", baseline: 10, current: 4, delta: 6, measuredAt: "2026-06-10" },
        })]}
        lang="en-US"
        dc={dc}
      />,
    );
    expect(screen.getByText("Improved by 6 since you acted")).toBeInTheDocument();
  });

  it("renders no badge when the insight has no outcome", () => {
    render(<InsightsCard insights={[makeInsight({ id: 9, status: "acted" })]} lang="en-US" dc={dc} />);
    expect(screen.queryByText(/since you acted/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/dashboard-sections/insights-card.test.tsx`
Expected: FAIL — text not found.

- [ ] **Step 3: Implement in both surfaces**

In each file, import the badge and render it in the insight's meta/status line (below the title, beside the existing severity/status text):

```tsx
import { InsightOutcomeBadge } from "../insights/insight-outcome-badge"; // insights-card.tsx
// import { InsightOutcomeBadge } from "./insights/insight-outcome-badge"; // insights-panel.tsx
```

```tsx
{insight.outcome && <InsightOutcomeBadge outcome={insight.outcome} lang={lang} />}
```

Place it where the row already renders muted meta text. Do NOT add a new interactive control — resolve is automatic.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/dashboard-sections/insights-card.test.tsx src/app/insights-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Live axe (markup changed on two axe-scanned surfaces)**

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"
PORT=3100 npm run stop
```
Expected: PASS on both (all theme combos).

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-sections/insights-card.tsx src/app/insights-panel.tsx src/app/dashboard-sections/insights-card.test.tsx
git commit -m "feat(insights): surface the SP3 outcome badge on both insight surfaces"
```

---

### Task 7: Fold-in — linked-entity digest in the recommendation context

**Files:**
- Modify: `src/app/task-manager.tsx` (`buildInsightRecommendContext`, ~line 1607)

**Context:** `RecommendContextInput` ALREADY has an optional `entity: { view, id, title, fields }` and `buildRecommendContext` already renders it — task-manager just never populates it, so every recommendation reads "(no linked entity)".

- [ ] **Step 1: Populate `entity` from the insight's `entityRef`**

Add a pure local resolver above `buildInsightRecommendContext`:

```ts
  /** Resolve an insight's entityRef to a compact title + field digest for the
   *  recommendation context (SP3 fold-in — previously always "(no linked
   *  entity)"). Bounded: a short, fixed field list per view, never the whole row. */
  const resolveInsightEntity = useCallback(
    (insight: Insight) => {
      const ref = insight.entityRef;
      if (!ref) return undefined;
      if (ref.view === "milestones") {
        const m = milestones.find((x) => x.id === ref.id);
        return m && {
          view: ref.view, id: m.id, title: m.name,
          fields: `date: ${m.date}\nowner: ${m.owner ?? ""}\nstatus: ${m.achieved ? "achieved" : "open"}`,
        };
      }
      if (ref.view === "raid") {
        const r = raid.find((x) => x.id === ref.id);
        return r && {
          view: ref.view, id: r.id, title: r.title,
          fields: `category: ${r.category}\nstatus: ${r.status}\nowner: ${r.owner ?? ""}\ntargetDate: ${r.targetDate ?? ""}`,
        };
      }
      return undefined;
    },
    [milestones, raid],
  );
```

Then in `buildInsightRecommendContext`, pass it:

```ts
        ...(resolveInsightEntity(insight) ? { entity: resolveInsightEntity(insight)! } : {}),
```

Prefer hoisting to a local first to avoid the double call:

```ts
      const entity = resolveInsightEntity(insight);
      return buildRecommendContext({
        // …existing fields…
        ...(entity ? { entity } : {}),
      });
```

Add `resolveInsightEntity` to the `buildInsightRecommendContext` `useCallback` dep array.

> **Field-name check:** verify each property against `types.ts` (`Milestone`, `RaidItem`) before writing — use only fields that exist; drop any that don't rather than inventing one. Only `milestoneSlip` and `raidAging` carry an `entityRef` today, so those two views are the complete set.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0 (the `exhaustive-deps` rule will flag a missing dep — fix by adding it, never by disabling the rule).

- [ ] **Step 3: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat(insights): include the linked entity digest in the recommendation context"
```

---

### Task 8: Fold-in — regenerate after reject

**Files:**
- Modify: `src/app/insight-recommendation-controls.tsx`
- Test: `src/app/dashboard-sections/insights-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to the `recommendation UI (#6B SP2)` describe in `insights-card.test.tsx`:

```tsx
it("offers regenerate on a rejected recommendation (SP3 fold-in)", async () => {
  const user = userEvent.setup();
  const onGenerateRecommendation = vi.fn();
  const insight = makeInsight({
    id: 11,
    recommendation: {
      summary: "Reassign the overdue task", proposedCalls: [],
      generatedAt: "2026-06-10T00:00:00.000Z", status: "rejected",
    },
  });
  const title = insightTitle(insight, "en-US");
  render(
    <InsightsCard
      insights={[insight]} lang="en-US" dc={dc}
      actions={{
        onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
        onGenerateRecommendation, onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
      }}
    />,
  );
  expect(screen.getByText("Recommendation dismissed.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: `Generate recommendation – ${title}` }));
  expect(onGenerateRecommendation).toHaveBeenCalledWith(11);
});

it("still hides regenerate when AI is disabled", () => {
  const insight = makeInsight({
    id: 12,
    recommendation: {
      summary: "s", proposedCalls: [], generatedAt: "2026-06-10T00:00:00.000Z", status: "rejected",
    },
  });
  render(
    <InsightsCard
      insights={[insight]} lang="en-US" dc={dc} aiEnabled={false}
      actions={{
        onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn(),
        onGenerateRecommendation: vi.fn(), onApplyRecommendation: vi.fn(), onRejectRecommendation: vi.fn(),
      }}
    />,
  );
  expect(screen.queryByRole("button", { name: /Generate recommendation/ })).not.toBeInTheDocument();
});
```

**Note:** the existing SP2 test `"shows a muted rejected note and no action buttons once rejected"` asserts the ABSENCE of Apply/Reject only — it does not assert the absence of the Generate CTA, so it stays green. If it also asserts no Generate button, update that assertion (the behaviour change is intentional and specced).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/dashboard-sections/insights-card.test.tsx`
Expected: FAIL — no "Generate recommendation" button on a rejected recommendation.

- [ ] **Step 3: Implement**

In `insight-recommendation-controls.tsx`, the `rejected` branch currently renders only the muted note. Render the note AND the same Generate CTA the no-recommendation branch uses (identical gating: `aiEnabled !== false`, not popout, `onGenerateRecommendation` present, busy state when `generatingId === insight.id`). Extract the CTA into a small local component/const inside the file if it would otherwise be duplicated verbatim — do NOT copy-paste the JSX (the duplication gate is blocking).

- [ ] **Step 4: Run tests + live axe**

```bash
npx vitest run src/app/dashboard-sections/insights-card.test.tsx src/app/insights-panel.test.tsx
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights"
PORT=3100 npm run stop
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/insight-recommendation-controls.tsx src/app/dashboard-sections/insights-card.test.tsx
git commit -m "feat(insights): allow regenerating a rejected recommendation"
```

---

### Task 9: Fold-in — dead `| null` + unused runner arg

**Files:**
- Modify: `src/app/insights/recommend-call.ts`
- Modify: `src/app/use-insight-recommend-runner.ts`
- Modify: `src/app/use-insight-recommend.ts` (only if it branches on a null result)
- Test: `src/app/insights/recommend-call.test.ts`, `src/app/use-insight-recommend-runner.test.ts`

- [ ] **Step 1: Narrow the return type**

In `recommend-call.ts`, change the signature and the doc line:

```ts
export async function runInsightRecommendation(
  args: RecommendCallArgs,
): Promise<InsightRecommendation> {
```

The body already throws on every failure path (`runForcedToolCall` throws; `if (!parsed) throw new Error("parse")`), so no body change is needed.

- [ ] **Step 2: Drop the now-redundant null checks at the call sites**

In `use-insight-recommend-runner.ts` the tick has `if (rec) applyRecommendationRef.current(insight.id, rec);` — simplify to:

```ts
            applyRecommendationRef.current(insight.id, rec);
```

Check `use-insight-recommend.ts` for the same pattern and simplify it identically if present.

- [ ] **Step 3: Remove the unused `now` arg from the runner**

`now` is mirrored into `nowRef` but never read. Delete, in `use-insight-recommend-runner.ts`:
- the `now?: () => Date;` field (and its doc comment) from `InsightRecommendRunnerArgs`,
- `const nowRef = useRef(args.now);`,
- `useEffect(() => { nowRef.current = args.now; }, [args.now]);`.

If `use-insight-recommend-runner.test.ts` passes `now`, remove it from those call sites too.

- [ ] **Step 4: Run tests + typecheck + lint**

```bash
npx vitest run src/app/insights/recommend-call.test.ts src/app/use-insight-recommend-runner.test.ts
npx tsc --noEmit && npm run lint
```
Expected: PASS, exit 0. (lint runs `--max-warnings=0` — an orphaned import or unused local is fatal.)

- [ ] **Step 5: Commit**

```bash
git add src/app/insights/recommend-call.ts src/app/use-insight-recommend-runner.ts src/app/use-insight-recommend.ts src/app/use-insight-recommend-runner.test.ts
git commit -m "refactor(insights): drop the dead null return and the unused runner clock arg"
```

---

### Task 10: Release 0.192.0

**Files:**
- Modify: `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`, `AGENTS.md`, `package.json`, `docs/baselines/file-sizes.json`

- [ ] **Step 1: Pick an UNUSED milestone codename**

```bash
grep -oE '"[A-Z][A-Za-z ]+"' CHANGELOG.md | sort -u | head -80
```
Pick a sci-fi/fantasy author name that does NOT appear (candidates to check: Sturgeon, Vinge, Willis, Chiang, Okorafor, Kress, Brunner). Codenames are unique per minor block.

- [ ] **Step 2: Bump the version**

In `src/app/version.ts`: `APP_VERSION = "0.192.0"`, `APP_MILESTONE = "<codename>"`, and append `"versionHighlightInsightsOutcome"` to `APP_HIGHLIGHT_KEYS`.

In `package.json`: `"version": "0.192.0"`.

- [ ] **Step 3: Add the highlight strings**

`i18n.ts`:
```ts
  versionHighlightInsightsOutcome: "Insights now measure whether acting actually moved the number, and close themselves when the problem clears.",
```
`i18n.de.ts` via the node utf8 write pattern from Task 5 Step 2 (real umlauts, `\r\n` anchors, re-verify NUL count 0).

- [ ] **Step 4: CHANGELOG + AGENTS.md**

Add a `## 0.192.0 "<codename>"` CHANGELOG entry covering: outcome measurement (capture at any acted transition, per-type metric, badge, auto-resolve labelling) and the five SP2 fold-ins.

In `AGENTS.md`, extend `### Insights → action loop` with an SP3 bullet: the `outcome`/`metricAtAction` model, `METRIC_FIELD` (all lower-is-better), capture-at-first-act-only, measurement in reconcile (upsert acted+detected; clear acted→resolved; re-fire drops outcome), the `insightsMateriallyEqual` outcome-compare data-loss landmine, and the documented preview/apply WYSIWYG note (a background proposal is previewed against LIVE state at apply time by design; the allow-set is enforced at load + apply).

- [ ] **Step 5: Full gate run**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
npm run dup:check
npm run size:check
```
Expected: all green. If `size:check` fails because a touched file grew past its baseline, update `docs/baselines/file-sizes.json` for that file ONLY (never raise the global ratchet).

- [ ] **Step 6: Live axe, fresh isolated server**

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"
PORT=3100 npm run stop
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "0.192.0 \"<codename>\" — Insights SP3: outcome measurement"
```

---

### Task 11: Code review before release

- [ ] **Step 1: Run the superpowers code review over the whole branch**

Use `superpowers:requesting-code-review` with BASE_SHA = the merge-base with `main` and HEAD_SHA = `HEAD`. Dispatch a security-focused reviewer AND a correctness-focused reviewer in parallel.

Focus areas to hand the reviewers:
- Does any path let an outcome/baseline be written from untrusted input without `sanitizeInsights`?
- Does `insightsMateriallyEqual` cover `outcome` (the SP1/SP2 data-loss class)?
- Is measurement idempotent — can the reconcile→setInsights→re-run cycle loop?
- Can `metricAtAction` be overwritten after the first act (which would corrupt the baseline)?
- Fold-in #7: does the entity digest leak anything beyond bounded entity fields into the prompt?

- [ ] **Step 2: Fix every CRITICAL and HIGH finding, then re-review the fixed HEAD**

- [ ] **Step 3: Re-run the full gate set (Task 10 Steps 5-6) after any fix, then commit**

- [ ] **Step 4: STOP**

Do NOT push, open an MR, or merge. Report the result and wait for the user's explicit "release".

---

## Self-Review

- **Spec coverage:** data model → T1; sanitize → T2; reconcile measurement + materiallyEqual + re-fire → T3; capture at both acted sites → T4; badge + i18n → T5; both surfaces + axe → T6; fold-in 1 (entity digest) → T7; fold-in 2 (regenerate) → T8; fold-ins 3+4 (`| null`, `now`) → T9; fold-in 5 (WYSIWYG doc note) → T10 Step 4; release → T10; review gate → T11. No spec section is unmapped.
- **Type consistency:** `InsightOutcome` fields (`direction`/`baseline`/`current`/`delta`/`measuredAt`) are identical across T1 (type), T2 (sanitize), T3 (reconcile + comparator), T5 (badge). `metricAtActionPatch` returns a spreadable partial in T1 and is spread unchanged in T4. `METRIC_FIELD` keys match the `InsightType` union exactly.
- **No placeholders:** every code step carries real code; the only deliberate lookups are the CHANGELOG codename grep (T10 S1) and the `types.ts` field verification in T7 S1, both with explicit commands/instructions.
