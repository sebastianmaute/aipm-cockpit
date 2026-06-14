# Next-Actions Confidence Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank Action-Center items by how actionable a signal is (clarity bonus / static penalty + trend), not severity color alone, with configurable weights, root-cause why-text, and a collapsible monitor group.

**Architecture:** Extend the existing pure `next-actions/` engine. `score.ts` gains a hybrid term (`final = base + clarity − staticPenalty`, clamped ≥0). A new pure `trends.ts` derives budget/schedule direction from Turso snapshot history; the surface threads it (and three new configurable weights) through the optional `ActionInput` fields — engine stays pure/i18n-free. Providers tag clarity classes and enrich why-text. `actions-panel.tsx` collapses the `monitor` tier.

**Tech Stack:** TypeScript, React (Next.js fork), Vitest, i18n EN+DE (real umlauts, parity enforced by tsc).

**Spec:** `docs/superpowers/specs/2026-06-14-next-actions-confidence-ranking-design.md`

---

## Conventions for every task

- Run a single test file: `npx vitest run src/app/<file>.test.ts`
- Typecheck (also enforces EN/DE i18n key parity): `npx tsc --noEmit`
- **DE strings:** the Edit tool corrupts umlauts in `i18n.de.ts`. After editing it, verify with
  `npx vitest run src/app/i18n-encoding.test.ts`; if corrupted, rewrite the line via a node utf8
  write. Never use ASCII subs (ue/ae/oe/ss).
- New `ActionInput` fields MUST stay **optional** — a required field breaks every provider test's
  `input()` helper.
- Commit after each task with the message shown.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `next-actions/score.ts` | scoring math + weights | add `clarity`/`staticPenalty` factors, 3 weights, clamp ≥0 |
| `next-actions/trends.ts` | **new** pure trend derivation | `TrendDir`, `ActionTrends`, `computeActionTrends` |
| `next-actions/types.ts` | engine input contract | 4 optional `ActionInput` fields |
| `next-actions/providers/*.ts` | signal→action mapping | clarity class per provider; budget/schedule trend + why |
| `next-actions-input.ts` | pure ActionInput assembler | passthrough of new fields |
| `settings-types.ts` | settings model | `NextActionsConfig` += 3 weights + resolver |
| `settings-sections/next-actions-section.tsx` | settings UI | "Ranking weights" inputs |
| `task-manager.tsx` | surface wiring | compute trends, pass weights |
| `actions-panel.tsx` | inbox UI | collapsible monitor group |
| `i18n.ts`, `i18n.de.ts` | strings | new why/settings/monitor keys |
| `version.ts`, `CHANGELOG.md` | release | bump + highlight |

---

### Task 1: Hybrid scoring math (`score.ts`)

**Files:**
- Modify: `src/app/next-actions/score.ts`
- Test: `src/app/next-actions/score.test.ts`

- [ ] **Step 1: Write failing tests** — append to `src/app/next-actions/score.test.ts`:

```ts
import { scoreAction, ACTION_WEIGHTS } from "./score";

describe("hybrid confidence factors", () => {
  it("adds clarity as a positive term", () => {
    expect(scoreAction({ risk: 30, clarity: 15 })).toBe(45);
  });
  it("subtracts staticPenalty", () => {
    expect(scoreAction({ risk: 30, staticPenalty: 25 })).toBe(5);
  });
  it("never returns below zero", () => {
    expect(scoreAction({ staticPenalty: 25 })).toBe(0);
  });
  it("keeps the base sum unchanged when neither is set", () => {
    expect(scoreAction({ risk: 30, urgency: 15 })).toBe(45);
  });
  it("exposes the three new weights with the spec defaults", () => {
    expect(ACTION_WEIGHTS.clarityBonus).toBe(15);
    expect(ACTION_WEIGHTS.semiClarityBonus).toBe(7);
    expect(ACTION_WEIGHTS.staticPenalty).toBe(25);
  });
  it("worked example: clear medium (60) outranks vague red (45)", () => {
    const clearMedium = scoreAction({ risk: 30, urgency: 15, clarity: 15 }); // 60
    const vagueRed = scoreAction({ risk: 30, urgency: 40, staticPenalty: 25 }); // 45
    expect(clearMedium).toBeGreaterThan(vagueRed);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/next-actions/score.test.ts`
Expected: FAIL — `clarity`/`staticPenalty` not in `ScoreFactors`, weights undefined.

- [ ] **Step 3: Implement** — edit `src/app/next-actions/score.ts`:

Add to `ACTION_WEIGHTS` (before the closing `} as const;`):

```ts
  clarityBonus: 15,     // signal has one obvious assignable fix
  semiClarityBonus: 7,  // several levers, still actionable
  staticPenalty: 25,    // aggregate/derived red with no single lever
```

Extend `ScoreFactors`:

```ts
export interface ScoreFactors {
  urgency?: number;
  risk?: number;
  impact?: number;
  quickWin?: number;
  staleness?: number;
  clarity?: number;        // confidence bonus (clear-fix item)
  staticPenalty?: number;  // confidence penalty (vague/static signal)
}
```

Replace `scoreAction`:

```ts
export function scoreAction(f: ScoreFactors): number {
  const sum =
    (f.urgency ?? 0) + (f.risk ?? 0) + (f.impact ?? 0) +
    (f.quickWin ?? 0) + (f.staleness ?? 0) +
    (f.clarity ?? 0) - (f.staticPenalty ?? 0);
  return Math.max(0, sum); // never negative — keeps sort deterministic
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/next-actions/score.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/next-actions/score.ts src/app/next-actions/score.test.ts
git commit -m "feat: hybrid clarity/static-penalty scoring factors"
```

---

### Task 2: Pure trend derivation (`trends.ts`)

**Files:**
- Create: `src/app/next-actions/trends.ts`
- Test: `src/app/next-actions/trends.test.ts`

- [ ] **Step 1: Write failing test** — create `src/app/next-actions/trends.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeActionTrends } from "./trends";
import type { SnapshotRecord } from "../snapshot";

function snap(over: Partial<SnapshotRecord>): SnapshotRecord {
  return {
    id: "x", capturedAt: "2026-01-01T00:00:00.000Z", bucket: "2026-W01",
    cadence: "weekly", trigger: "auto", isBaseline: false,
    remainingHours: null, remainingCost: null, pctComplete: 0,
    forecastEndDate: "2026-12-31", planEndDate: "2026-12-31",
    spi: null, cpi: null, overallRag: "", scheduleRag: "", budgetRag: "",
    scopeRag: "", currency: "EUR", milestones: [], series: [],
    ...over,
  };
}

describe("computeActionTrends", () => {
  it("returns undefined with fewer than two snapshots", () => {
    expect(computeActionTrends([])).toBeUndefined();
    expect(computeActionTrends([snap({})])).toBeUndefined();
  });
  it("flags rising remaining cost as worsening budget", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", remainingCost: 100 }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", remainingCost: 200 }),
    ]);
    expect(t?.budget).toBe("worsening");
  });
  it("flags falling remaining cost as improving budget", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", remainingCost: 200 }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", remainingCost: 100 }),
    ]);
    expect(t?.budget).toBe("improving");
  });
  it("treats equal cost (within epsilon) as flat", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", remainingCost: 100 }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", remainingCost: 100 }),
    ]);
    expect(t?.budget).toBe("flat");
  });
  it("falls back to budgetRag movement when cost is null", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", budgetRag: "A" }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", budgetRag: "R" }),
    ]);
    expect(t?.budget).toBe("worsening");
  });
  it("flags dropping SPI as worsening schedule, omits when null", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", spi: 1.0 }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", spi: 0.8 }),
    ]);
    expect(t?.schedule).toBe("worsening");
    const none = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", spi: null }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", spi: 0.8 }),
    ]);
    expect(none?.schedule).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/next-actions/trends.test.ts`
Expected: FAIL — `./trends` does not exist.

- [ ] **Step 3: Implement** — create `src/app/next-actions/trends.ts`:

```ts
// src/app/next-actions/trends.ts
//
// Pure trend derivation for the confidence ranking. Compares the latest snapshot
// to an earlier one and reports a direction per aggregate metric. No React, no
// Turso import — the surface passes the result in via ActionInput.trends.
import type { SnapshotRecord } from "../snapshot";

export type TrendDir = "worsening" | "flat" | "improving";

export interface ActionTrends {
  budget?: TrendDir;
  schedule?: TrendDir;
}

export const TREND_LOOKBACK = 1;       // buckets back to compare against
const COST_EPSILON = 1;                 // currency units treated as "no change"
const SPI_EPSILON = 0.01;
const RAG_ORDER: Record<string, number> = { G: 0, A: 1, R: 2 };

export function computeActionTrends(
  snapshots: readonly SnapshotRecord[],
  lookback: number = TREND_LOOKBACK,
): ActionTrends | undefined {
  if (snapshots.length < 2) return undefined;
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const latest = sorted[sorted.length - 1];
  const prev = sorted[Math.max(0, sorted.length - 1 - lookback)];

  const out: ActionTrends = {};
  const budget = costTrend(prev, latest);
  if (budget) out.budget = budget;
  const schedule = spiTrend(prev, latest);
  if (schedule) out.schedule = schedule;
  return out;
}

// Higher remaining cost = worsening; null cost on either side → RAG movement.
function costTrend(prev: SnapshotRecord, latest: SnapshotRecord): TrendDir | undefined {
  if (prev.remainingCost != null && latest.remainingCost != null) {
    const d = latest.remainingCost - prev.remainingCost;
    return Math.abs(d) <= COST_EPSILON ? "flat" : d > 0 ? "worsening" : "improving";
  }
  const a = RAG_ORDER[prev.budgetRag];
  const b = RAG_ORDER[latest.budgetRag];
  if (a == null || b == null) return undefined; // "" RAG → no signal
  return a === b ? "flat" : b > a ? "worsening" : "improving";
}

// Lower SPI = worsening.
function spiTrend(prev: SnapshotRecord, latest: SnapshotRecord): TrendDir | undefined {
  if (prev.spi == null || latest.spi == null) return undefined;
  const d = latest.spi - prev.spi;
  return Math.abs(d) <= SPI_EPSILON ? "flat" : d < 0 ? "worsening" : "improving";
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/next-actions/trends.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/next-actions/trends.ts src/app/next-actions/trends.test.ts
git commit -m "feat: pure computeActionTrends from snapshot history"
```

---

### Task 3: ActionInput optional fields + input passthrough

**Files:**
- Modify: `src/app/next-actions/types.ts`
- Modify: `src/app/next-actions-input.ts`
- Test: `src/app/next-actions-input.test.ts`

- [ ] **Step 1: Write failing test** — append to `src/app/next-actions-input.test.ts`:

```ts
import { buildActionInput } from "./next-actions-input";

describe("confidence field passthrough", () => {
  const base = {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
    dashboard: { budget: { effective: "G" }, evm: {} } as never,
    commsReminders: [], features: [], projectName: "P",
    today: "2026-01-01", now: new Date("2026-01-01T00:00:00Z"),
    reminderLeadDays: 7, dueSoonWorkdays: 5, raidReviewIntervalDays: 14,
  };
  it("passes trends and weight overrides straight through", () => {
    const input = buildActionInput({
      ...base,
      trends: { budget: "worsening" },
      clarityBonus: 20, semiClarityBonus: 9, staticPenalty: 30,
    });
    expect(input.trends).toEqual({ budget: "worsening" });
    expect(input.clarityBonus).toBe(20);
    expect(input.semiClarityBonus).toBe(9);
    expect(input.staticPenalty).toBe(30);
  });
  it("leaves them undefined when omitted", () => {
    const input = buildActionInput(base);
    expect(input.trends).toBeUndefined();
    expect(input.clarityBonus).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/next-actions-input.test.ts`
Expected: FAIL — fields not on `BuildActionInputArgs`/`ActionInput`.

- [ ] **Step 3: Implement**

In `src/app/next-actions/types.ts`, add the import near the other type imports:

```ts
import type { ActionTrends } from "./trends";
```

Add these fields to the `ActionInput` interface (after `workloadOverdueUrgent?`):

```ts
  /** Aggregate-metric trend directions (Turso snapshots). Undefined off-Turso. */
  trends?: ActionTrends;
  /** Confidence weights (Settings → Next actions). Provider falls back to const. */
  clarityBonus?: number;
  semiClarityBonus?: number;
  staticPenalty?: number;
```

In `src/app/next-actions-input.ts`, add to `BuildActionInputArgs` (after `workloadOverdueUrgent?`):

```ts
  trends?: import("./next-actions/trends").ActionTrends;
  clarityBonus?: number;
  semiClarityBonus?: number;
  staticPenalty?: number;
```

And add to the returned object in `buildActionInput` (after `workloadOverdueUrgent: a.workloadOverdueUrgent,`):

```ts
    trends: a.trends,
    clarityBonus: a.clarityBonus,
    semiClarityBonus: a.semiClarityBonus,
    staticPenalty: a.staticPenalty,
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/next-actions-input.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/next-actions/types.ts src/app/next-actions-input.ts src/app/next-actions-input.test.ts
git commit -m "feat: thread trends + confidence weights through ActionInput"
```

---

### Task 4: Budget provider — static penalty + trend + why

**Files:**
- Modify: `src/app/next-actions/providers/budget.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/next-actions/providers/budget.test.ts`

- [ ] **Step 1: Write failing test** — append to `src/app/next-actions/providers/budget.test.ts`
  (reuse the file's existing `input()` helper; if none, build an `ActionInput` with a Red
  `dashboard.budget.effective`):

```ts
import { budgetProvider } from "./budget";

describe("budget confidence", () => {
  function redInput(over: Partial<Parameters<typeof budgetProvider.provide>[0]> = {}) {
    return {
      tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
      commsReminders: [], features: ["budget"], projectName: "P",
      today: "2026-01-01", now: new Date("2026-01-01T00:00:00Z"),
      reminderLeadDays: 7, dueSoonWorkdays: 5, raidReviewIntervalDays: 14,
      dismissed: new Set<string>(),
      dashboard: { budget: { effective: "R" }, evm: { cpi: 0.8 } },
      ...over,
    } as unknown as Parameters<typeof budgetProvider.provide>[0];
  }
  it("applies the static penalty so a red budget is not top-tier by default", () => {
    const [a] = budgetProvider.provide(redInput());
    // base risk 30 - penalty 25 = 5
    expect(a.score).toBe(5);
  });
  it("halves the penalty when the trend is worsening", () => {
    const [a] = budgetProvider.provide(redInput({ trends: { budget: "worsening" } }));
    // 30 - round(25/2)=13 -> 17
    expect(a.score).toBe(17);
    expect(a.why.key).toBe("actionBudgetWhyWorsening");
  });
  it("uses the improving why-key when improving", () => {
    const [a] = budgetProvider.provide(redInput({ trends: { budget: "improving" } }));
    expect(a.why.key).toBe("actionBudgetWhyImproving");
  });
  it("honors a configured staticPenalty override", () => {
    const [a] = budgetProvider.provide(redInput({ staticPenalty: 10 }));
    expect(a.score).toBe(20); // 30 - 10
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/next-actions/providers/budget.test.ts`
Expected: FAIL — score still 30; why-keys missing.

- [ ] **Step 3: Implement** — replace the body of `provide` in `src/app/next-actions/providers/budget.ts`:

```ts
  provide(input: ActionInput): SuggestedAction[] {
    const eff = input.dashboard.budget.effective;
    if (eff !== "R" && eff !== "A") return [];

    const cpi = input.dashboard.evm.cpi;
    const cpiText = cpi != null && Number.isFinite(cpi) ? cpi.toFixed(2) : "n/a";

    const trend = input.trends?.budget;
    const penaltyBase = input.staticPenalty ?? W.staticPenalty;
    // A worsening aggregate IS moving — pull it back up by halving the penalty.
    const staticPenalty = trend === "worsening" ? Math.round(penaltyBase / 2) : penaltyBase;

    const score = scoreAction({
      risk: eff === "R" ? W.riskCritical : W.riskHigh,
      staticPenalty,
    });

    const why =
      trend === "worsening"
        ? { key: "actionBudgetWhyWorsening" as const, params: [cpiText] }
        : trend === "improving"
          ? { key: "actionBudgetWhyImproving" as const, params: [cpiText] }
          : { key: "actionBudgetWhyCpi" as const, params: [cpiText] };

    return [
      {
        id: "budget:overall:over",
        source: "budget",
        moduleId: "budget",
        title: { key: "actionBudgetTitle", params: [input.projectName] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "budget", id: 0 },
      },
    ];
  },
```

Add the two EN keys to `src/app/i18n.ts` (next to `actionBudgetWhyCpi`):

```ts
  actionBudgetWhyWorsening: "CPI {0} — over budget and worsening",
  actionBudgetWhyImproving: "CPI {0} — over budget but improving",
```

Add the matching DE keys to `src/app/i18n.de.ts` (real umlauts; verify after — see Conventions):

```ts
  actionBudgetWhyWorsening: "CPI {0} — über Budget und verschlechtert sich",
  actionBudgetWhyImproving: "CPI {0} — über Budget, aber verbessert sich",
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/next-actions/providers/budget.test.ts src/app/i18n-encoding.test.ts && npx tsc --noEmit`
Expected: PASS; tsc green (EN/DE parity); umlauts intact.

- [ ] **Step 5: Commit**

```bash
git add src/app/next-actions/providers/budget.ts src/app/next-actions/providers/budget.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: budget provider static penalty + trend-aware why"
```

---

### Task 5: Schedule provider — static penalty + trend + why

**Files:**
- Modify: `src/app/next-actions/providers/schedule.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/next-actions/providers/schedule.test.ts`

- [ ] **Step 1: Write failing test** — append to `src/app/next-actions/providers/schedule.test.ts`:

```ts
import { scheduleProvider } from "./schedule";

describe("schedule confidence", () => {
  function input(over = {}) {
    return {
      tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
      commsReminders: [], features: [], projectName: "P",
      today: "2026-01-01", now: new Date("2026-01-01T00:00:00Z"),
      reminderLeadDays: 7, dueSoonWorkdays: 5, raidReviewIntervalDays: 14,
      dismissed: new Set<string>(),
      dashboard: { budget: { effective: "G" }, evm: { spi: 0.7 } },
      ...over,
    } as unknown as Parameters<typeof scheduleProvider.provide>[0];
  }
  it("applies a static penalty to the aggregate SPI signal", () => {
    const [a] = scheduleProvider.provide(input());
    // spi 0.7 < critical 0.8: urgency 40 + risk 30 - penalty 25 = 45
    expect(a.score).toBe(45);
    expect(a.why.key).toBe("actionScheduleWhyBehind");
  });
  it("halves the penalty and uses the slipping why when worsening", () => {
    const [a] = scheduleProvider.provide(input({ trends: { schedule: "worsening" } }));
    // 40 + 30 - round(25/2)=13 = 57
    expect(a.score).toBe(57);
    expect(a.why.key).toBe("actionScheduleWhySlipping");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/next-actions/providers/schedule.test.ts`
Expected: FAIL — penalty not applied; `actionScheduleWhySlipping` missing.

- [ ] **Step 3: Implement** — replace the body of `provide` in `src/app/next-actions/providers/schedule.ts`:

```ts
  provide(input: ActionInput): SuggestedAction[] {
    const warn = input.scheduleSpiWarn ?? 0.9;
    const critical = input.scheduleSpiCritical ?? 0.8;
    const spi = input.dashboard.evm?.spi ?? null;
    if (spi == null || spi >= warn) return [];

    const trend = input.trends?.schedule;
    const penaltyBase = input.staticPenalty ?? W.staticPenalty;
    const staticPenalty = trend === "worsening" ? Math.round(penaltyBase / 2) : penaltyBase;

    const score =
      spi < critical
        ? scoreAction({ urgency: W.urgencyOverdue, risk: W.riskCritical, staticPenalty })
        : scoreAction({ urgency: W.urgencySoon, risk: W.riskHigh, staticPenalty });

    const why =
      trend === "worsening"
        ? { key: "actionScheduleWhySlipping" as const, params: [spi.toFixed(2)] }
        : { key: "actionScheduleWhyBehind" as const, params: [spi.toFixed(2)] };

    return [
      {
        id: "schedule:project:spi",
        source: "schedule",
        title: { key: "actionScheduleTitle", params: [input.projectName] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "dashboard", id: 0 },
      },
    ];
  },
```

EN key in `src/app/i18n.ts` (next to `actionScheduleWhyBehind`):

```ts
  actionScheduleWhySlipping: "SPI {0} — schedule slipping",
```

DE key in `src/app/i18n.de.ts` (real umlauts):

```ts
  actionScheduleWhySlipping: "SPI {0} — Zeitplan verzögert sich",
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/next-actions/providers/schedule.test.ts src/app/i18n-encoding.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/next-actions/providers/schedule.ts src/app/next-actions/providers/schedule.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: schedule provider static penalty + trend-aware why"
```

---

### Task 6: RAID provider — clarity class + no-owner why

**Files:**
- Modify: `src/app/next-actions/providers/raid.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/next-actions/providers/raid.test.ts`

A High/Red severity RAID item with **no owner** is a clear fix (assign the owner) → full
`clarityBonus` + the no-owner why. With an owner it's `semiClarityBonus` (several levers) and
keeps the existing severity why. Review-due actions (section B) are unchanged.

- [ ] **Step 1: Write failing test** — append to `src/app/next-actions/providers/raid.test.ts`:

```ts
import { raidProvider } from "./raid";

describe("raid severity confidence", () => {
  function input(raid: unknown[], over = {}) {
    return {
      tasks: [], raid, changes: [], milestones: [], stakeholders: [],
      commsReminders: [], features: ["raid"], projectName: "P",
      today: "2026-01-01", now: new Date("2026-01-01T00:00:00Z"),
      reminderLeadDays: 7, dueSoonWorkdays: 5, raidReviewIntervalDays: 14,
      raidReviewEnabled: false, dismissed: new Set<string>(),
      dashboard: { budget: { effective: "G" }, evm: {} },
      ...over,
    } as unknown as Parameters<typeof raidProvider.provide>[0];
  }
  const highRisk = {
    id: 1, category: "R", title: "DB outage", severity: "High",
    status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01",
  };
  it("gives a clarity bonus + no-owner why when unassigned", () => {
    const [a] = raidProvider.provide(input([{ ...highRisk }]));
    // risk High 15 + clarity 15 = 30
    expect(a.score).toBe(30);
    expect(a.why.key).toBe("actionRaidWhyNoOwner");
  });
  it("gives only the semi bonus + severity why when an owner is set", () => {
    const [a] = raidProvider.provide(input([{ ...highRisk, owner: "Mara" }]));
    // risk 15 + semi 7 = 22
    expect(a.score).toBe(22);
    expect(a.why.key).toBe("actionRaidWhySeverity");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/next-actions/providers/raid.test.ts`
Expected: FAIL — scores 15; `actionRaidWhyNoOwner` missing.

- [ ] **Step 3: Implement** — in `src/app/next-actions/providers/raid.ts`, replace the severity
  loop body (section A) with:

```ts
    // (A) Severity actions — non-terminal items with RAG "R" or "A"
    for (const item of input.raid) {
      if (isTerminalStatus(item.status, item.category)) continue;
      const rag = severityRag(item.severity);
      if (rag !== "R" && rag !== "A") continue;
      const hasOwner = !!(item.owner || item.ownerEmail || item.ownerResourceId != null);
      const clarity = hasOwner
        ? (input.semiClarityBonus ?? W.semiClarityBonus)
        : (input.clarityBonus ?? W.clarityBonus);
      const score = scoreAction({ risk: rag === "R" ? W.riskCritical : W.riskHigh, clarity });
      const why = hasOwner
        ? { key: "actionRaidWhySeverity" as const, params: [item.severity ?? ""] }
        : { key: "actionRaidWhyNoOwner" as const, params: [item.severity ?? ""] };
      out.push({
        id: `raid:${item.id}:severity`,
        source: "raid",
        moduleId: "raid",
        title: { key: "actionRaidTitle" as const, params: [item.id, item.title] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "raid", id: item.id },
      });
    }
```

EN key in `src/app/i18n.ts` (next to `actionRaidWhySeverity`):

```ts
  actionRaidWhyNoOwner: "Severity {0} — no owner assigned",
```

DE key in `src/app/i18n.de.ts` (real umlauts):

```ts
  actionRaidWhyNoOwner: "Schweregrad {0} — kein Verantwortlicher zugewiesen",
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/next-actions/providers/raid.test.ts src/app/i18n-encoding.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/next-actions/providers/raid.ts src/app/next-actions/providers/raid.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: raid severity clarity bonus + no-owner why"
```

---

### Task 7: Clear & semi clarity on the remaining providers

**Files:**
- Modify: `task-due.ts`, `change-pending.ts`, `stakeholder-comms.ts` (CLEAR → `clarityBonus`)
- Modify: `milestone.ts`, `workload.ts` (SEMI → `semiClarityBonus`)
- Test: each provider's existing `*.test.ts`

No new i18n keys here — clarity only changes scores.

- [ ] **Step 1: Write failing tests** — add one assertion to each provider test. Examples:

`task-due.test.ts`:
```ts
it("adds a clarity bonus to a due action", () => {
  // a single overdue task: urgency 40 + clarity 15 = 55
  const actions = taskDueProvider.provide(/* existing overdue-task input */ overdueInput);
  expect(actions[0].score).toBe(55);
});
```

`stakeholder-comms.test.ts`:
```ts
it("adds a clarity bonus", () => {
  const [a] = stakeholderCommsProvider.provide(commsInput);
  // urgency 15 + risk 15 + clarity 15 = 45
  expect(a.score).toBe(45);
});
```

`workload.test.ts`:
```ts
it("adds the semi-clarity bonus to an over-allocated alert", () => {
  const [a] = workloadProvider.provide(overAllocInput);
  // risk 15 + urgency 15 + semi 7 = 37  (non-critical allocation)
  expect(a.score).toBe(37);
});
```

`change-pending.test.ts` (per-item Red):
```ts
it("adds a clarity bonus to a per-item pending change", () => {
  const items = changePendingProvider.provide(redItemInput);
  const item = items.find((a) => a.id.endsWith(":item"))!;
  expect(item.score).toBe(45); // risk 30 + clarity 15
});
```

`milestone.test.ts` (overdue):
```ts
it("adds the semi-clarity bonus to an overdue milestone", () => {
  const [a] = milestoneProvider.provide(overdueMilestoneInput);
  expect(a.score).toBe(67); // urgency 40 + impact 20 + semi 7
});
```

(Reuse each file's existing input fixtures; the numbers above assume the standard weights.)

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/next-actions/providers/task-due.test.ts src/app/next-actions/providers/change-pending.test.ts src/app/next-actions/providers/stakeholder-comms.test.ts src/app/next-actions/providers/milestone.test.ts src/app/next-actions/providers/workload.test.ts`
Expected: FAIL — scores lack the bonus.

- [ ] **Step 3: Implement** — add `clarity` to each `scoreAction(...)` call:

`task-due.ts` — change `const score = scoreAction({ urgency });` to:
```ts
      const score = scoreAction({ urgency, clarity: input.clarityBonus ?? W.clarityBonus });
```

`stakeholder-comms.ts` — change the `scoreAction` line to:
```ts
      const score = scoreAction({
        urgency: W.urgencySoon, risk: W.riskHigh,
        clarity: input.clarityBonus ?? W.clarityBonus,
      });
```

`change-pending.ts` — add `clarity: input.clarityBonus ?? W.clarityBonus,` to **both**
`scoreAction` calls (the aggregate and the per-item):
```ts
      const score = scoreAction({ risk: W.riskCritical, impact: W.impactScopePending, clarity: input.clarityBonus ?? W.clarityBonus });
```
```ts
      const score = scoreAction({ risk: W.riskCritical, clarity: input.clarityBonus ?? W.clarityBonus });
```

`workload.ts` — add `clarity: input.semiClarityBonus ?? W.semiClarityBonus,` to **both**
branches:
```ts
      const score =
        al.reason === "over-allocated"
          ? scoreAction({ risk: al.value >= allocCritical ? W.riskCritical : W.riskHigh, urgency: W.urgencySoon, clarity: input.semiClarityBonus ?? W.semiClarityBonus })
          : scoreAction({ urgency: al.value >= overdueUrgent ? W.urgencyOverdue : W.urgencyToday, risk: W.riskHigh, clarity: input.semiClarityBonus ?? W.semiClarityBonus });
```

`milestone.ts` — add `clarity: input.semiClarityBonus ?? W.semiClarityBonus,` to **both**
`scoreAction` calls (overdue and at-risk):
```ts
      const score = scoreAction({ urgency: W.urgencyOverdue, impact: W.impactBlocksMilestone, clarity: input.semiClarityBonus ?? W.semiClarityBonus });
```
```ts
      const score = scoreAction({ risk: W.riskHigh, impact: W.impactBlocksMilestone, clarity: input.semiClarityBonus ?? W.semiClarityBonus });
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/next-actions/providers/` then `npx tsc --noEmit`
Expected: PASS (adjust any pre-existing score assertions in these files that didn't account for
the bonus — update them to the new expected totals).

- [ ] **Step 5: Commit**

```bash
git add src/app/next-actions/providers/task-due.ts src/app/next-actions/providers/change-pending.ts src/app/next-actions/providers/stakeholder-comms.ts src/app/next-actions/providers/milestone.ts src/app/next-actions/providers/workload.ts src/app/next-actions/providers/*.test.ts
git commit -m "feat: clarity/semi bonuses on remaining action providers"
```

---

### Task 8: Configurable weights in `NextActionsConfig`

**Files:**
- Modify: `src/app/settings-types.ts`
- Test: `src/app/settings-next-actions.test.ts`

- [ ] **Step 1: Write failing test** — append to `src/app/settings-next-actions.test.ts`:

```ts
import { defaultNextActionsConfig, resolveNextActionsConfig } from "./settings-types";

describe("ranking weights", () => {
  it("defaults to 15 / 7 / 25", () => {
    expect(defaultNextActionsConfig.clarityBonus).toBe(15);
    expect(defaultNextActionsConfig.semiClarityBonus).toBe(7);
    expect(defaultNextActionsConfig.staticPenalty).toBe(25);
  });
  it("coerces overrides and allows zero", () => {
    const c = resolveNextActionsConfig({ clarityBonus: 0, semiClarityBonus: 3, staticPenalty: 40 });
    expect(c.clarityBonus).toBe(0);
    expect(c.semiClarityBonus).toBe(3);
    expect(c.staticPenalty).toBe(40);
  });
  it("falls back to defaults on invalid input", () => {
    const c = resolveNextActionsConfig({ clarityBonus: -5, staticPenalty: "x" });
    expect(c.clarityBonus).toBe(15);
    expect(c.staticPenalty).toBe(25);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/settings-next-actions.test.ts`
Expected: FAIL — fields undefined.

- [ ] **Step 3: Implement** — in `src/app/settings-types.ts`:

Add to the `NextActionsConfig` type (before the closing `};`):

```ts
  /** Confidence bonus for a clear-fix action. */
  clarityBonus: number;
  /** Confidence bonus for a semi-clear (several-lever) action. */
  semiClarityBonus: number;
  /** Confidence penalty for a vague/aggregate static signal. */
  staticPenalty: number;
```

Add to `defaultNextActionsConfig`:

```ts
  clarityBonus: 15,
  semiClarityBonus: 7,
  staticPenalty: 25,
```

In `resolveNextActionsConfig`, add an `intMin0` coercer next to `intMin1`:

```ts
  const intMin0 = (v: unknown, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : def;
  };
```

And add to the returned object:

```ts
    clarityBonus: intMin0(obj.clarityBonus, d.clarityBonus),
    semiClarityBonus: intMin0(obj.semiClarityBonus, d.semiClarityBonus),
    staticPenalty: intMin0(obj.staticPenalty, d.staticPenalty),
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/settings-next-actions.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-types.ts src/app/settings-next-actions.test.ts
git commit -m "feat: configurable ranking weights in NextActionsConfig"
```

---

### Task 9: Ranking-weights UI (`next-actions-section.tsx`)

**Files:**
- Modify: `src/app/settings-sections/next-actions-section.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/settings-sections/next-actions-section.test.tsx`

- [ ] **Step 1: Write failing test** — append to the section test:

```ts
it("renders the three ranking-weight inputs and edits them", () => {
  const onChange = vi.fn();
  render(<NextActionsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
  const clarity = screen.getByLabelText("Clarity bonus");
  fireEvent.change(clarity, { target: { value: "20" } });
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ nextActions: expect.objectContaining({ clarityBonus: 20 }) }),
  );
});
```

(Match the label text to the EN strings added below; import `defaultSettings` from
`../settings-types`.)

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/settings-sections/next-actions-section.test.tsx`
Expected: FAIL — no "Clarity bonus" input.

- [ ] **Step 3: Implement** — in `next-actions-section.tsx`, extend the `FIELDS` array with three
  entries (they render exactly like the existing int fields and are covered by the existing
  reset-to-defaults button, which already maps over `FIELDS`):

```ts
  { key: "clarityBonus", labelKey: "naClarityBonus", hintKey: "naClarityBonusHint", kind: "int" },
  { key: "semiClarityBonus", labelKey: "naSemiClarityBonus", hintKey: "naSemiClarityBonusHint", kind: "int" },
  { key: "staticPenalty", labelKey: "naStaticPenalty", hintKey: "naStaticPenaltyHint", kind: "int" },
```

Note: the existing int input uses `min={1}`. These weights allow `0`. Lower the int minimum to
`0` (drop the `f.kind === "ratio" ? 0.1 : 1` to `f.kind === "ratio" ? 0.1 : 0`) — `0` is a valid
"disable this knob" value and the threshold fields are unaffected by a `0` floor since the user
won't set them to 0 in practice; if you prefer to keep the threshold floor at 1, add a
`min?: number` to `NumField` and set `min: 0` on the three weight fields only.

Add EN keys to `src/app/i18n.ts`:

```ts
  naClarityBonus: "Clarity bonus",
  naClarityBonusHint: "Score added to a clear-fix action (one obvious next step).",
  naSemiClarityBonus: "Semi-clarity bonus",
  naSemiClarityBonusHint: "Score added to an action with several reasonable levers.",
  naStaticPenalty: "Static penalty",
  naStaticPenaltyHint: "Score subtracted from a vague, aggregate signal with no single lever.",
```

Add DE keys to `src/app/i18n.de.ts` (real umlauts):

```ts
  naClarityBonus: "Klarheits-Bonus",
  naClarityBonusHint: "Punkte für eine Aktion mit eindeutigem nächsten Schritt.",
  naSemiClarityBonus: "Teil-Klarheits-Bonus",
  naSemiClarityBonusHint: "Punkte für eine Aktion mit mehreren sinnvollen Hebeln.",
  naStaticPenalty: "Statik-Abzug",
  naStaticPenaltyHint: "Abzug für ein vages, aggregiertes Signal ohne einzelnen Hebel.",
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/settings-sections/next-actions-section.test.tsx src/app/i18n-encoding.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/next-actions-section.tsx src/app/settings-sections/next-actions-section.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: ranking-weights inputs in Settings -> Next actions"
```

---

### Task 10: Surface wiring (`task-manager.tsx`)

**Files:**
- Modify: `src/app/task-manager.tsx`
- Test: covered by the engine acceptance test (Task 12) + existing task-manager render tests

- [ ] **Step 1: Implement** — add the import near the other next-actions imports (~line 107):

```ts
import { computeActionTrends } from "./next-actions/trends";
```

Compute the trends just before the `nextActions` `useMemo` (after `snapshots` is defined,
~line 420). `snapshots.snapshots` is the sorted `SnapshotRecord[]`; gate on `trendsActive` so
non-Turso passes `undefined`:

```ts
  const actionTrends = useMemo(
    () => (trendsActive ? computeActionTrends(snapshots.snapshots) : undefined),
    [trendsActive, snapshots.snapshots],
  );
```

In the `buildActionInput({ ... })` call, add these props (next to the other
`settings.nextActions?.*` lines):

```ts
          trends: actionTrends,
          clarityBonus: settings.nextActions?.clarityBonus,
          semiClarityBonus: settings.nextActions?.semiClarityBonus,
          staticPenalty: settings.nextActions?.staticPenalty,
```

Add `actionTrends` to the `useMemo` dependency array (after `actionSnooze.dismissed`):

```ts
    [tasks, raid, changes, milestones, stakeholders, dashboardModel, comms.items, settings.features, settings.notifications, settings.nextActions, project, today, workloadAlerts, actionSnooze.dismissed, actionTrends],
```

- [ ] **Step 2: Typecheck + run the existing task-manager/integration tests**

Run: `npx tsc --noEmit && npx vitest run src/app/task-manager`
Expected: PASS — no type errors, existing tests green.

- [ ] **Step 3: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat: wire snapshot trends + weights into the action input"
```

---

### Task 11: Collapsible monitor group (`actions-panel.tsx`)

**Files:**
- Modify: `src/app/actions-panel.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/actions-panel.test.tsx`

- [ ] **Step 1: Write failing test** — append to `src/app/actions-panel.test.tsx`:

```ts
it("collapses the monitor group by default and toggles it", () => {
  const actions = [
    { id: "m1", source: "budget", title: { key: "actionBudgetTitle", params: ["P"] },
      why: { key: "actionBudgetWhyCpi", params: ["0.8"] }, score: 10, tier: "monitor",
      cta: { kind: "open", view: "budget", id: 0 } },
  ] as never;
  render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
  const toggle = screen.getByRole("button", { name: /monitored/i });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  // row hidden while collapsed
  expect(screen.queryByText(/budget/i)).toBeNull();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/app/actions-panel.test.tsx`
Expected: FAIL — monitor rows render expanded; no toggle button.

- [ ] **Step 3: Implement** — in `src/app/actions-panel.tsx`:

Add `useState` import and a collapsed-state hook; special-case the `monitor` tier so its section
header is a disclosure button and its rows render only when expanded. Replace the `TIERS.map`
section body with:

```tsx
import { useState } from "react";
// ...
export function ActionsPanel({ lang, actions, onOpen, onSnooze }: ActionsPanelProps) {
  const [monitorOpen, setMonitorOpen] = useState(false);
  return (
    <div className={VIEW_PANE_FILL_CLASS}>
      <div className="mb-4 shrink-0">
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "actionCenterTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t(lang, "actionCenterSubtitle")}</p>
      </div>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "actionsEmptyState")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto">
          {TIERS.map(({ tier, labelKey }) => {
            const rows = actions.filter((a) => a.tier === tier);
            if (rows.length === 0) return null;
            if (tier === "monitor") {
              return (
                <section key={tier}>
                  <button
                    type="button"
                    aria-expanded={monitorOpen}
                    aria-controls="action-monitor-list"
                    onClick={() => setMonitorOpen((o) => !o)}
                    className="mb-2 flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <span aria-hidden>{monitorOpen ? "▾" : "▸"}</span>
                    {t(lang, "actionMonitoredCount", rows.length)}
                  </button>
                  {monitorOpen && (
                    <div id="action-monitor-list" className="flex flex-col gap-2">
                      {rows.map((a) => (
                        <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpen} onSnooze={onSnooze} />
                      ))}
                    </div>
                  )}
                </section>
              );
            }
            return (
              <section key={tier}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(lang, labelKey)} ({rows.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {rows.map((a) => (
                    <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpen} onSnooze={onSnooze} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

EN key in `src/app/i18n.ts`:

```ts
  actionMonitoredCount: "{0} monitored",
```

DE key in `src/app/i18n.de.ts`:

```ts
  actionMonitoredCount: "{0} überwacht",
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/app/actions-panel.test.tsx src/app/i18n-encoding.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions-panel.tsx src/app/actions-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: collapsible monitor group in the action inbox"
```

---

### Task 12: End-to-end ranking acceptance test (`engine.test.ts`)

**Files:**
- Test: `src/app/next-actions/engine.test.ts`

- [ ] **Step 1: Write the acceptance test** — append:

```ts
import { computeNextActions } from "./engine";
import { budgetProvider } from "./providers/budget";
import { raidProvider } from "./providers/raid";

it("ranks a clear RAID-no-owner action above a static red budget", () => {
  const input = {
    tasks: [], changes: [], milestones: [], stakeholders: [], commsReminders: [],
    features: ["budget", "raid"], projectName: "P",
    today: "2026-01-01", now: new Date("2026-01-01T00:00:00Z"),
    reminderLeadDays: 7, dueSoonWorkdays: 5, raidReviewIntervalDays: 14,
    raidReviewEnabled: false, dismissed: new Set<string>(),
    dashboard: { budget: { effective: "R" }, evm: { cpi: 0.8 } },
    raid: [{ id: 1, category: "R", title: "DB outage", severity: "High",
             status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01" }],
    // no trends → budget stays fully penalised
  } as never;
  const actions = computeNextActions(input, [budgetProvider, raidProvider]);
  const raidIdx = actions.findIndex((a) => a.source === "raid");
  const budgetIdx = actions.findIndex((a) => a.source === "budget");
  expect(raidIdx).toBeLessThan(budgetIdx); // raid (30) ranks above budget (5)
});
```

- [ ] **Step 2: Run, verify it passes** (the implementation already exists from Tasks 1/4/6)

Run: `npx vitest run src/app/next-actions/engine.test.ts`
Expected: PASS — confirms the cross-provider ordering goal.

- [ ] **Step 3: Commit**

```bash
git add src/app/next-actions/engine.test.ts
git commit -m "test: clear action outranks static red budget end-to-end"
```

---

### Task 13: Release — version, changelog, highlight

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Full suite green first**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all PASS (lint with `--max-warnings=0`).

- [ ] **Step 2: Bump `src/app/version.ts`** — same minor line continues codename "Jemisin"; if
  this ships as a new minor, set `APP_VERSION = "0.83.0"` and pick the next author codename.
  Update `APP_BUILD_DATE = "2026-06-14"`. Append one highlight key to `APP_HIGHLIGHT_KEYS`:

```ts
  "versionHighlightConfidenceRanking",
```

- [ ] **Step 3: Add EN/DE highlight strings** — `i18n.ts`:

```ts
  versionHighlightConfidenceRanking: "Action Center now ranks by how actionable a signal is, with configurable weights and a collapsible monitor group.",
```

`i18n.de.ts` (real umlauts):

```ts
  versionHighlightConfidenceRanking: "Das Action Center sortiert jetzt nach Handlungsklarheit — mit konfigurierbaren Gewichten und einer einklappbaren Überwachungsgruppe.",
```

- [ ] **Step 4: Add a `CHANGELOG.md` entry** at the top, dated 2026-06-14, summarizing: hybrid
  confidence scoring (clarity bonus / static penalty), snapshot-trend awareness for budget &
  schedule, root-cause why-text, configurable ranking weights, collapsible monitor group.

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts`
Expected: PASS.

```bash
git add src/app/version.ts CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts
git commit -m "chore: release confidence ranking (version, changelog, highlight)"
```

---

## Final verification (before finishing the branch)

```bash
npx vitest run         # full unit/integration suite
npx tsc --noEmit       # types + i18n EN/DE parity
npm run lint           # eslint, 0 warnings
npm run build          # next build (prebuild script-docs check)
```

Then use **superpowers:finishing-a-development-branch**. e2e (`npm run e2e`, incl. the 12-view
axe gate) runs in CI — the collapsible monitor button must keep `aria-expanded`/`aria-controls`
wired for the a11y gate.

---

## Self-Review

**Spec coverage:**
- Hybrid math (base + clarity − penalty, clamp ≥0) → Task 1. ✓
- Actionability + trend basis → Tasks 2 (trend), 4–7 (clarity classes + trend consumption). ✓
- Trend plumbing via optional ActionInput, engine pure → Tasks 3, 10. ✓
- Root-cause why-text (budget/schedule/raid) → Tasks 4, 5, 6. ✓
- Configurable weights (clarity/semi/static) → Tasks 8 (model), 9 (UI), 10 (wiring). ✓
- Collapse static reds → Task 11. ✓
- Acceptance (clear medium outranks vague red) → Tasks 1 (unit), 12 (e2e engine). ✓
- Release checklist → Task 13. ✓

**Type consistency:** `clarity` / `staticPenalty` (ScoreFactors), `clarityBonus` /
`semiClarityBonus` / `staticPenalty` (weights + config + ActionInput), `ActionTrends` /
`TrendDir` / `computeActionTrends`, `actionBudgetWhyWorsening` / `actionBudgetWhyImproving` /
`actionScheduleWhySlipping` / `actionRaidWhyNoOwner` / `actionMonitoredCount` —
names used consistently across all tasks.

**No placeholders:** every code/test step carries concrete code and exact commands. Provider
fixtures in Task 7 reuse each test file's existing inputs (the only "match the existing fixture"
note); adjust pre-existing score assertions to the new totals as called out in Task 7 Step 4.
