# Resource Capacity Engine & Planning Grid (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute per-period capacity from utilization (net of weekends, holidays, and absences) and surface it in an editable per-period Planning grid in the Resources tab, with a planning-window control and a week/month canonical-vs-rollup toggle.

**Architecture:** A new **pure** `resource-capacity.ts` module owns period generation, workday/absence counting, the capacity formula, and the read-only rollup — all unit-tested (including golden figures from `docs/patterns/Book1.xlsx`). The Planning grid is a new view in `resources-panel.tsx` fed by prop-drilled callbacks; per-period utilization/mode edits and plan-window/granularity changes go through new handlers in `use-resource-planner.ts` (writing `Resource.utilization`/`utilizationMode`/`absenceOverride` and `ResourcePlan`), persisted by the Phase-1 storage layer. No storage changes.

**Tech Stack:** TypeScript, React 19, Next.js 16, Vitest (jsdom) + Testing Library. Spec: `docs/superpowers/specs/2026-05-23-resource-utilization-design.md`. Branch: `feat/resource-utilization`.

**Baseline:** 2 pre-existing `tsc` errors in test files (`settings-menu.test.tsx:18`, `use-due-alerts.test.ts:28`) — ignore; add none. `use-holiday-set.test.ts` is an occasional full-run flake — re-run alone if it's the sole failure.

**Internal unit = hours.** Days are `hours ÷ workdayHours`. Percent values are 0–100. Period keys: month `YYYY-MM`, ISO week `GGGG-Www`.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/app/resource-capacity.ts` | Pure: period generation, workday/absence counting, capacity formula, rollup | **New** |
| `src/app/resource-capacity.test.ts` | Engine unit tests incl. Excel golden fixtures | **New** |
| `src/app/use-resource-planner.ts` | Handlers: set utilization / mode / absence override / plan window / granularity | Modify |
| `src/app/use-resource-planner.test.tsx` | Tests for the new handlers | Modify |
| `src/app/resources-panel.tsx` | "planning" view: per-period grid + window control + week/month toggle | Modify |
| `src/app/resources-panel.test.tsx` | Grid tests | Modify |
| `src/app/workspace-section.tsx` | Pass `plan` + new callbacks to `ResourcesPanel` | Modify |
| `src/app/task-manager.tsx` | Wire the new handlers + `plan` into `WorkspaceSection` | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New keys | Modify |

**Commands:** single file `npx vitest run src/app/<file>.test.ts`; full `npm run test:run`; types `npx tsc --noEmit`.

---

## Task 1: Period generation (`resource-capacity.ts`)

**Files:** Create `src/app/resource-capacity.ts`, `src/app/resource-capacity.test.ts`.

- [ ] **Step 1: Write failing tests** `src/app/resource-capacity.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { generatePeriods } from "./resource-capacity";

describe("generatePeriods - month", () => {
  test("inclusive month range with correct keys and bounds", () => {
    const p = generatePeriods("2026-01-15", "2026-03-02", "month");
    expect(p.map((x) => x.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(p[0]).toEqual({ key: "2026-01", start: "2026-01-01", end: "2026-01-31" });
    expect(p[1].end).toBe("2026-02-28");
  });
});

describe("generatePeriods - week", () => {
  test("ISO weeks covering the range, Monday..Sunday", () => {
    // 2026-01-01 is a Thursday; ISO week 2026-W01 is Mon 2025-12-29 .. Sun 2026-01-04
    const p = generatePeriods("2026-01-01", "2026-01-10", "week");
    expect(p[0].key).toBe("2026-W01");
    expect(p[0].start).toBe("2025-12-29");
    expect(p[0].end).toBe("2026-01-04");
    expect(p[1].key).toBe("2026-W02");
    expect(p[1].start).toBe("2026-01-05");
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/app/resource-capacity.test.ts`.

- [ ] **Step 3: Implement** `src/app/resource-capacity.ts`:

```ts
import type { Absence, PlanGranularity, Resource } from "./types";

/** A planning period. Dates are inclusive "YYYY-MM-DD". */
export type Period = { key: string; start: string; end: string };

const pad = (n: number) => String(n).padStart(2, "0");

function monthPeriods(startDate: string, endDate: string): Period[] {
  const out: Period[] = [];
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7)); // 1-based
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ key: `${y}-${pad(m)}`, start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** ISO-8601 week-numbering year + week for a UTC date. */
function isoWeekParts(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  t.setUTCDate(t.getUTCDate() - day + 3); // nearest Thursday
  const isoYear = t.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstThuDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstThuDay + 3);
  const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86400000));
  return { year: isoYear, week };
}

function mondayOf(d: Date): Date {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day);
  return t;
}

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function weekPeriods(startDate: string, endDate: string): Period[] {
  const out: Period[] = [];
  let cur = mondayOf(new Date(`${startDate}T00:00:00Z`));
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cur <= end) {
    const sun = new Date(cur);
    sun.setUTCDate(sun.getUTCDate() + 6);
    const { year, week } = isoWeekParts(cur);
    out.push({ key: `${year}-W${pad(week)}`, start: iso(cur), end: iso(sun) });
    cur = new Date(cur);
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
}

export function generatePeriods(
  startDate: string,
  endDate: string,
  granularity: PlanGranularity,
): Period[] {
  if (startDate > endDate) return [];
  return granularity === "week" ? weekPeriods(startDate, endDate) : monthPeriods(startDate, endDate);
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/resource-capacity.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add src/app/resource-capacity.ts src/app/resource-capacity.test.ts
git commit -m "feat(capacity): period generation (month + ISO week)"
```

---

## Task 2: Workday + absence counting

**Files:** Modify `src/app/resource-capacity.ts`, `src/app/resource-capacity.test.ts`.

- [ ] **Step 1: Append failing tests:**

```ts
import { workdaysInRange, absencesForResource, absenceWorkdays } from "./resource-capacity";
import type { Absence, Resource } from "./types";

describe("workdaysInRange", () => {
  test("counts Mon–Fri inclusive, excluding weekends and holidays", () => {
    // Feb 2026: Feb 1 is a Sunday; Mon–Fri across the month = 20 workdays.
    expect(workdaysInRange("2026-02-01", "2026-02-28", new Set())).toBe(20);
    // remove one workday via a holiday:
    expect(workdaysInRange("2026-02-01", "2026-02-28", new Set(["2026-02-03"]))).toBe(19);
    // single weekend day:
    expect(workdaysInRange("2026-02-07", "2026-02-08", new Set())).toBe(0);
  });
});

describe("absencesForResource", () => {
  test("matches by resourceId, falls back to case-folded name", () => {
    const r: Resource = { id: 7, name: "Alex Example", roleId: null, utilizationMode: "percent", utilization: {} };
    const abs: Absence[] = [
      { id: 1, assignee: "Alex Example", startDate: "2026-02-02", endDate: "2026-02-02", type: "vacation", resourceId: 7 },
      { id: 2, assignee: "Alex Example", startDate: "2026-02-03", endDate: "2026-02-03", type: "sick" },
      { id: 3, assignee: "Bob", startDate: "2026-02-04", endDate: "2026-02-04", type: "vacation", resourceId: 9 },
    ];
    expect(absencesForResource(abs, r).map((a) => a.id).sort()).toEqual([1, 2]);
  });
});

describe("absenceWorkdays", () => {
  test("counts workdays inside absence ranges intersected with the period", () => {
    const abs: Absence[] = [{ id: 1, assignee: "x", startDate: "2026-02-02", endDate: "2026-02-06", type: "vacation" }];
    // Mon–Fri Feb 2–6 = 5 workdays, all within the period:
    expect(absenceWorkdays(abs, "2026-02-01", "2026-02-28", new Set())).toBe(5);
    // a holiday inside the absence range is not counted as a workday:
    expect(absenceWorkdays(abs, "2026-02-01", "2026-02-28", new Set(["2026-02-04"]))).toBe(4);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement (append to `resource-capacity.ts`):**

```ts
function isWorkday(d: Date, holidaySet: ReadonlySet<string>): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidaySet.has(iso(d));
}

/** Count Mon–Fri dates in [start,end] inclusive that are not holidays. */
export function workdaysInRange(start: string, end: string, holidaySet: ReadonlySet<string>): number {
  if (start > end) return 0;
  let count = 0;
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    if (isWorkday(cur, holidaySet)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** A resource's absences: by resourceId when set, else case-folded name match. */
export function absencesForResource(absences: readonly Absence[], resource: Resource): Absence[] {
  const nameKey = resource.name.trim().toLowerCase();
  return absences.filter((a) =>
    a.resourceId != null ? a.resourceId === resource.id : a.assignee.trim().toLowerCase() === nameKey,
  );
}

/** Workdays within [periodStart,periodEnd] that fall inside any absence range. */
export function absenceWorkdays(
  resourceAbsences: readonly Absence[],
  periodStart: string,
  periodEnd: string,
  holidaySet: ReadonlySet<string>,
): number {
  if (resourceAbsences.length === 0 || periodStart > periodEnd) return 0;
  let count = 0;
  const cur = new Date(`${periodStart}T00:00:00Z`);
  const last = new Date(`${periodEnd}T00:00:00Z`);
  while (cur <= last) {
    if (isWorkday(cur, holidaySet)) {
      const d = iso(cur);
      if (resourceAbsences.some((a) => a.startDate <= d && d <= a.endDate)) count++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/resource-capacity.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add src/app/resource-capacity.ts src/app/resource-capacity.test.ts
git commit -m "feat(capacity): workday + absence counting"
```

---

## Task 3: Capacity formula (golden fixtures)

**Files:** Modify `src/app/resource-capacity.ts`, `src/app/resource-capacity.test.ts`.

- [ ] **Step 1: Append failing tests** (the Andre Weiß golden fixture from Book1.xlsx Forecast row 4):

```ts
import { periodCapacityHours, type Period } from "./resource-capacity";

const FEB: Period = { key: "2026-02", start: "2026-02-01", end: "2026-02-28" };

describe("periodCapacityHours - percent mode (Excel golden: Andre month 1)", () => {
  test("0.95 × (20 workdays − 5.5 absence) days = 13.775 days = 110.2h", () => {
    const r: Resource = {
      id: 1, name: "Andre", roleId: null, utilizationMode: "percent",
      utilization: { "2026-02": 95 }, absenceOverride: { "2026-02": 44 }, // 5.5 days × 8h
    };
    const cap = periodCapacityHours(r, FEB, [], 8, new Set());
    expect(cap).toBeCloseTo(110.2, 6);   // hours
    expect(cap / 8).toBeCloseTo(13.775, 6); // days
  });
});

describe("periodCapacityHours - auto absence + holidays", () => {
  test("percent 100, one 2-day absence, no override → (20−2)×8 = 144h", () => {
    const r: Resource = { id: 1, name: "x", roleId: null, utilizationMode: "percent", utilization: { "2026-02": 100 } };
    const abs: Absence[] = [{ id: 1, assignee: "x", startDate: "2026-02-02", endDate: "2026-02-03", type: "vacation" }];
    expect(periodCapacityHours(r, FEB, abs, 8, new Set())).toBeCloseTo(144, 6);
  });
});

describe("periodCapacityHours - hours mode", () => {
  test("flat 40h minus 8h auto absence (1 day) = 32h", () => {
    const r: Resource = { id: 1, name: "x", roleId: null, utilizationMode: "hours", utilization: { "2026-02": 40 } };
    const abs: Absence[] = [{ id: 1, assignee: "x", startDate: "2026-02-02", endDate: "2026-02-02", type: "vacation" }];
    expect(periodCapacityHours(r, FEB, abs, 8, new Set())).toBe(32);
  });
  test("flat hours never goes negative", () => {
    const r: Resource = { id: 1, name: "x", roleId: null, utilizationMode: "hours", utilization: { "2026-02": 4 }, absenceOverride: { "2026-02": 40 } };
    expect(periodCapacityHours(r, FEB, [], 8, new Set())).toBe(0);
  });
  test("missing utilization value → 0 capacity", () => {
    const r: Resource = { id: 1, name: "x", roleId: null, utilizationMode: "percent", utilization: {} };
    expect(periodCapacityHours(r, FEB, [], 8, new Set())).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement (append):**

```ts
/**
 * Capacity (hours) for a (resource, period):
 *   workdays      = Mon–Fri in period, minus holidays
 *   possibleHours = workdays × workdayHours
 *   absenceHours  = absenceOverride[key] if set, else (absence workdays × workdayHours)
 *   percent mode: (util/100) × max(0, possibleHours − absenceHours)
 *   hours   mode: max(0, util − absenceHours)
 * `resourceAbsences` must already be filtered to this resource (use absencesForResource).
 */
export function periodCapacityHours(
  resource: Resource,
  period: Period,
  resourceAbsences: readonly Absence[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): number {
  const workdays = workdaysInRange(period.start, period.end, holidaySet);
  const possibleHours = workdays * workdayHours;
  const override = resource.absenceOverride?.[period.key];
  const absenceHours = override != null
    ? override
    : absenceWorkdays(resourceAbsences, period.start, period.end, holidaySet) * workdayHours;
  const util = resource.utilization[period.key] ?? 0;
  if (resource.utilizationMode === "percent") {
    return (util / 100) * Math.max(0, possibleHours - absenceHours);
  }
  return Math.max(0, util - absenceHours);
}
```

- [ ] **Step 4: Run → PASS.** Confirms the Excel cell `D4 = 13.775` is reproduced.

- [ ] **Step 5: Commit.**
```bash
git add src/app/resource-capacity.ts src/app/resource-capacity.test.ts
git commit -m "feat(capacity): capacity formula + Excel golden fixtures"
```

---

## Task 4: Read-only week/month rollup

The canonical granularity is editable; the other is a derived, read-only view. Boundary rule: a fine period is attributed to the canonical period containing its **start** date.

**Files:** Modify `src/app/resource-capacity.ts`, `src/app/resource-capacity.test.ts`.

- [ ] **Step 1: Append failing tests:**

```ts
import { displayCapacityHours } from "./resource-capacity";

describe("displayCapacityHours rollup", () => {
  const wh = 8;
  const r: Resource = { id: 1, name: "x", roleId: null, utilizationMode: "percent", utilization: { "2026-02": 100 } };

  test("display === canonical: uses the period's own stored utilization", () => {
    const feb: Period = { key: "2026-02", start: "2026-02-01", end: "2026-02-28" };
    expect(displayCapacityHours(feb, [feb], r, [], wh, new Set(), "month", "month")).toBeCloseTo(160, 6);
  });

  test("coarse→fine (month canonical, week display): week borrows its month's util", () => {
    const feb: Period = { key: "2026-02", start: "2026-02-01", end: "2026-02-28" };
    const week: Period = { key: "2026-W07", start: "2026-02-09", end: "2026-02-15" }; // Mon–Sun, 5 workdays
    // 100% × 5 workdays × 8h = 40h
    expect(displayCapacityHours(week, [feb], r, [], wh, new Set(), "month", "week")).toBeCloseTo(40, 6);
  });

  test("fine→coarse (week canonical, month display): sum of weeks starting in the month", () => {
    const rw: Resource = { id: 1, name: "x", roleId: null, utilizationMode: "hours", utilization: { "2026-W07": 10, "2026-W08": 10 } };
    const w7: Period = { key: "2026-W07", start: "2026-02-09", end: "2026-02-15" };
    const w8: Period = { key: "2026-W08", start: "2026-02-16", end: "2026-02-22" };
    const feb: Period = { key: "2026-02", start: "2026-02-01", end: "2026-02-28" };
    // hours mode, no absence: 10 + 10 = 20
    expect(displayCapacityHours(feb, [w7, w8], rw, [], wh, new Set(), "week", "month")).toBe(20);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement (append):**

```ts
/**
 * Capacity (hours) for a DISPLAY period, given the resource's CANONICAL periods.
 *   - display === canonical granularity → the period's own stored utilization.
 *   - coarse→fine (canonical month, display week): the fine period borrows the
 *     utilization VALUE of the canonical period containing its start date, and
 *     computes capacity over the fine period's own workdays/absence.
 *   - fine→coarse (canonical week, display month): sum capacity of canonical
 *     periods whose start date falls within the display period.
 */
export function displayCapacityHours(
  displayPeriod: Period,
  canonicalPeriods: readonly Period[],
  resource: Resource,
  resourceAbsences: readonly Absence[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  canonicalGranularity: PlanGranularity,
  displayGranularity: PlanGranularity,
): number {
  if (canonicalGranularity === displayGranularity) {
    return periodCapacityHours(resource, displayPeriod, resourceAbsences, workdayHours, holidaySet);
  }
  // fine→coarse: sum canonical periods that start within the display period.
  if (canonicalGranularity === "week" && displayGranularity === "month") {
    let sum = 0;
    for (const c of canonicalPeriods) {
      if (c.start >= displayPeriod.start && c.start <= displayPeriod.end) {
        sum += periodCapacityHours(resource, c, resourceAbsences, workdayHours, holidaySet);
      }
    }
    return sum;
  }
  // coarse→fine: borrow the containing canonical period's utilization VALUE.
  const owner = canonicalPeriods.find((c) => c.start <= displayPeriod.start && displayPeriod.start <= c.end);
  const borrowedUtil = owner ? (resource.utilization[owner.key] ?? 0) : 0;
  const borrowed: Resource = { ...resource, utilization: { [displayPeriod.key]: borrowedUtil } };
  return periodCapacityHours(borrowed, displayPeriod, resourceAbsences, workdayHours, holidaySet);
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.**
```bash
git add src/app/resource-capacity.ts src/app/resource-capacity.test.ts
git commit -m "feat(capacity): read-only week/month rollup"
```

---

## Task 5: Planner handlers (utilization / mode / override / plan window)

**Files:** Modify `src/app/use-resource-planner.ts`, `src/app/use-resource-planner.test.tsx`.

- [ ] **Step 1: Append failing tests** (mirror the file's existing renderHook harness):

```ts
test("handleSetUtilization writes resource.utilization[periodKey]", () => {
  const { result } = renderPlanner({ resources: [{ id: 1, name: "S", roleId: null, utilizationMode: "percent", utilization: {} }] });
  act(() => { result.current.handleSetUtilization(1, "2026-02", 80); });
  expect(currentResources()[0].utilization["2026-02"]).toBe(80);
});

test("handleSetUtilizationMode switches a resource's mode", () => {
  const { result } = renderPlanner({ resources: [{ id: 1, name: "S", roleId: null, utilizationMode: "percent", utilization: {} }] });
  act(() => { result.current.handleSetUtilizationMode(1, "hours"); });
  expect(currentResources()[0].utilizationMode).toBe("hours");
});

test("handleSetAbsenceOverride sets and clears (null removes the key)", () => {
  const { result } = renderPlanner({ resources: [{ id: 1, name: "S", roleId: null, utilizationMode: "percent", utilization: {} }] });
  act(() => { result.current.handleSetAbsenceOverride(1, "2026-02", 16); });
  expect(currentResources()[0].absenceOverride?.["2026-02"]).toBe(16);
  act(() => { result.current.handleSetAbsenceOverride(1, "2026-02", null); });
  expect(currentResources()[0].absenceOverride?.["2026-02"]).toBeUndefined();
});

test("handleSetPlanWindow and handleSetPlanGranularity update the plan", () => {
  const { result } = renderPlanner();
  act(() => { result.current.handleSetPlanWindow("2026-01-01", "2026-06-30"); });
  act(() => { result.current.handleSetPlanGranularity("week"); });
  expect(currentPlan().startDate).toBe("2026-01-01");
  expect(currentPlan().endDate).toBe("2026-06-30");
  expect(currentPlan().granularity).toBe("week");
});
```

> If the harness lacks a `currentPlan()` probe, add one the same way `currentResources()` is exposed (read the workspace `plan` from the rendered provider).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** in `use-resource-planner.ts`. Ensure `plan, setPlan` are destructured from `useWorkspace()` (add if missing). Add handlers:

```ts
const handleSetUtilization = useCallback((resourceId: number, periodKey: string, value: number) => {
  const stamp = new Date().toISOString();
  setResources((prev) => prev.map((r) =>
    r.id === resourceId ? { ...r, utilization: { ...r.utilization, [periodKey]: value }, localModifiedAt: stamp } : r,
  ));
}, [setResources]);

const handleSetUtilizationMode = useCallback((resourceId: number, mode: "percent" | "hours") => {
  const stamp = new Date().toISOString();
  setResources((prev) => prev.map((r) => (r.id === resourceId ? { ...r, utilizationMode: mode, localModifiedAt: stamp } : r)));
}, [setResources]);

const handleSetAbsenceOverride = useCallback((resourceId: number, periodKey: string, hours: number | null) => {
  const stamp = new Date().toISOString();
  setResources((prev) => prev.map((r) => {
    if (r.id !== resourceId) return r;
    const next = { ...(r.absenceOverride ?? {}) };
    if (hours == null) delete next[periodKey];
    else next[periodKey] = hours;
    const out = { ...r, localModifiedAt: stamp } as typeof r;
    if (Object.keys(next).length > 0) out.absenceOverride = next;
    else delete out.absenceOverride;
    return out;
  }));
}, [setResources]);

const handleSetPlanWindow = useCallback((startDate: string, endDate: string) => {
  setPlan((prev) => ({ ...prev, startDate, endDate }));
}, [setPlan]);

const handleSetPlanGranularity = useCallback((granularity: "week" | "month") => {
  setPlan((prev) => ({ ...prev, granularity }));
}, [setPlan]);
```

Add to the returned object: `handleSetUtilization, handleSetUtilizationMode, handleSetAbsenceOverride, handleSetPlanWindow, handleSetPlanGranularity`.

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/use-resource-planner.test.tsx` + `npx tsc --noEmit` (2 known errors only).

- [ ] **Step 5: Commit.**
```bash
git add src/app/use-resource-planner.ts src/app/use-resource-planner.test.tsx
git commit -m "feat(resources): utilization/mode/override/plan-window handlers"
```

---

## Task 6: Planning grid view + wiring

Add a "planning" option to the existing `list / calendar` `SegmentedControl` and render an editable per-period grid. Wire the new props from `task-manager` → `workspace-section` → `resources-panel`.

**Files:** Modify `src/app/resources-panel.tsx`, `src/app/workspace-section.tsx`, `src/app/task-manager.tsx`, `src/app/resources-panel.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n** — add to both dicts: `resourcesViewPlanning` (en "Planning" / de "Planung"), `resourcesCapacityDays` (en "Capacity (days)" / de "Kapazität (Tage)"), `resourcesPlanStart` (en "From" / de "Von"), `resourcesPlanEnd` (en "To" / de "Bis"), `resourcesGranularityWeek` (en "Weeks" / de "Wochen"), `resourcesGranularityMonth` (en "Months" / de "Monate").

- [ ] **Step 2: Failing test** — append to `resources-panel.test.tsx`:

```tsx
test("planning view: editing a utilization cell calls onSetUtilization", () => {
  const onSetUtilization = vi.fn();
  const resources = [{ id: 1, name: "Sample", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
  const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
  render(<ResourcesPanel {...baseProps} resources={resources} plan={plan}
    workdayHours={8} onSetUtilization={onSetUtilization} onSetUtilizationMode={() => {}}
    onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} onSetPlanGranularity={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Planning" }));
  fireEvent.change(screen.getByLabelText("Utilization for Sample in 2026-02"), { target: { value: "80" } });
  expect(onSetUtilization).toHaveBeenCalledWith(1, "2026-02", 80);
});
```

- [ ] **Step 3: Implement.**

In `resources-panel.tsx`:
- Extend the `View` type to `"list" | "calendar" | "planning"`; add the option `{ value: "planning", label: t(lang, "resourcesViewPlanning") }` to the `SegmentedControl`.
- Import `generatePeriods, displayCapacityHours, absencesForResource` from `./resource-capacity` and `ResourcePlan` from `./types`.
- Add to `Props`:
  ```ts
  plan: ResourcePlan;
  workdayHours: number;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  onSetUtilizationMode: (resourceId: number, mode: "percent" | "hours") => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  onSetPlanGranularity: (granularity: "week" | "month") => void;
  ```
- Render the grid when `view === "planning"`:

```tsx
{view === "planning" && (() => {
  const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="text-left text-xs">
        <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
          <tr>
            <th className="px-2 py-1.5 text-left">{t(lang, "assignee")}</th>
            {periods.map((p) => (
              <th key={p.key} className="px-2 py-1.5 text-right tabular-nums">{p.key}</th>
            ))}
            <th className="px-2 py-1.5 text-right">{t(lang, "resourcesCapacityDays")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {resources.map((r) => {
            const resAbs = absencesForResource(absences, r);
            const totalDays = periods.reduce((sum, p) =>
              sum + displayCapacityHours(p, periods, r, resAbs, workdayHours, holidaySet, plan.granularity, plan.granularity) / workdayHours, 0);
            return (
              <tr key={r.id}>
                <td className="px-2 py-1 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{r.name}</td>
                {periods.map((p) => (
                  <td key={p.key} className="px-1 py-1 text-right">
                    <input type="number" min={0} step={r.utilizationMode === "percent" ? 5 : 1}
                      aria-label={`Utilization for ${r.name} in ${p.key}`}
                      value={r.utilization[p.key] ?? ""}
                      onChange={(e) => onSetUtilization(r.id, p.key, Number(e.target.value) || 0)}
                      className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
                  </td>
                ))}
                <td className="px-2 py-1 text-right tabular-nums font-medium">{totalDays.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
})()}
```

In `workspace-section.tsx`: destructure `plan` from `useWorkspace()` and use `settings.resources.workdayHours` (settings already in scope); pass `plan`, `workdayHours={settings.resources.workdayHours}`, and the five `onSet*` callbacks (new `WorkspaceSectionProps`) to `<ResourcesPanel>`.

In `task-manager.tsx`: destructure `handleSetUtilization, handleSetUtilizationMode, handleSetAbsenceOverride, handleSetPlanWindow, handleSetPlanGranularity` from `useResourcePlanner()`; add the five to `<WorkspaceSection>` (as `onSetUtilization`/etc.) and add the matching fields to `WorkspaceSectionProps`.

Update `resources-panel.test.tsx` `baseProps` to include the new required props (`plan`, `workdayHours: 8`, the five `onSet*` as `() => {}`).

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/resources-panel.test.tsx` + `npx tsc --noEmit` + `npm run test:run` (fix any other test fixtures that construct `WorkspaceSection`/`ResourcesPanel` directly with the now-required props).

- [ ] **Step 5: Commit.**
```bash
git add src/app/resources-panel.tsx src/app/workspace-section.tsx src/app/task-manager.tsx src/app/resources-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(resources): editable per-period planning grid"
```

---

## Task 7: Planning-window control + granularity switch

**Files:** Modify `src/app/resources-panel.tsx`, `src/app/resources-panel.test.tsx`.

- [ ] **Step 1: Failing test** — append:

```tsx
test("planning view: changing the From date calls onSetPlanWindow", () => {
  const onSetPlanWindow = vi.fn();
  const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
  render(<ResourcesPanel {...baseProps} resources={[]} plan={plan} workdayHours={8}
    onSetUtilization={() => {}} onSetUtilizationMode={() => {}} onSetAbsenceOverride={() => {}}
    onSetPlanWindow={onSetPlanWindow} onSetPlanGranularity={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Planning" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
  expect(onSetPlanWindow).toHaveBeenCalledWith("2026-01-01", "2026-02-28");
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — render a controls row above the planning grid table (only when `view === "planning"`):

```tsx
<div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
  <label className="flex items-center gap-1">
    <span>{t(lang, "resourcesPlanStart")}</span>
    <input type="date" aria-label={t(lang, "resourcesPlanStart")} value={plan.startDate}
      onChange={(e) => onSetPlanWindow(e.target.value, plan.endDate)}
      className="rounded border border-zinc-300 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900" />
  </label>
  <label className="flex items-center gap-1">
    <span>{t(lang, "resourcesPlanEnd")}</span>
    <input type="date" aria-label={t(lang, "resourcesPlanEnd")} value={plan.endDate}
      onChange={(e) => onSetPlanWindow(plan.startDate, e.target.value)}
      className="rounded border border-zinc-300 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900" />
  </label>
  <SegmentedControl<"week" | "month">
    value={plan.granularity}
    ariaLabel={t(lang, "resourcesViewPlanning")}
    options={[
      { value: "month", label: t(lang, "resourcesGranularityMonth") },
      { value: "week", label: t(lang, "resourcesGranularityWeek") },
    ]}
    onChange={onSetPlanGranularity}
  />
</div>
```

The `From`/`To` `aria-label`s come from `resourcesPlanStart`/`resourcesPlanEnd` ("From"/"To" in en), which the test's `getByLabelText("From")` resolves. Changing granularity calls `onSetPlanGranularity`, updating `plan.granularity` so the grid re-generates periods at the new canonical granularity.

> Per spec, the canonical granularity is what you edit; switching it re-keys the grid. A separate read-only rollup *view* of the non-canonical granularity (using `displayCapacityHours` with differing `canonicalGranularity`/`displayGranularity`) is available via the Task-4 engine and is a small follow-up polish — this task ships the canonical editable grid + window + granularity switch, which is the core capability.

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/resources-panel.test.tsx`.

- [ ] **Step 5: Commit.**
```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -m "feat(resources): planning window control + granularity switch"
```

---

## Final Verification

- [ ] `npm run test:run` — green (re-run `use-holiday-set.test.ts` alone if it's the sole failure).
- [ ] `npx tsc --noEmit` — only the 2 known pre-existing errors.
- [ ] Coverage: `npm run test:coverage` — `resource-capacity.ts` ≥ 80%.
- [ ] Smoke (`npm run dev`): Resources → Planning shows a grid of resources × periods; set From/To and toggle Months/Weeks (grid re-generates); type utilization values; per-row capacity (days) updates; an assignee with an absence shows reduced capacity; values persist across reload.

---

## Self-Review

**Spec coverage (Phase 3):** capacity engine ✓ (T1–T4); workdays from calendar minus weekends + holidays ✓ (T2); possibleHours = workdays × workdayHours ✓ (T3); absence auto-derived + per-period override ✓ (T3 formula, T5 handler); percent vs hours capacity formula ✓ (T3); Excel golden fixtures (Andre 13.775 days) ✓ (T3); week/month rollup engine ✓ (T4); per-period grid ✓ (T6); planning-window control ✓ (T7); week/month toggle (granularity switch) ✓ (T7). Persistence is Phase-1 (utilization/absenceOverride/plan round-trip already). The non-canonical read-only rollup *display* is engine-ready (T4) and flagged as a small follow-up; the canonical editable grid satisfies the core planning need.

**Type consistency:** handler names align hook → task-manager → workspace-section → panel: `handleSetUtilization`/`onSetUtilization`, `handleSetUtilizationMode`/`onSetUtilizationMode`, `handleSetAbsenceOverride`/`onSetAbsenceOverride`, `handleSetPlanWindow`/`onSetPlanWindow`, `handleSetPlanGranularity`/`onSetPlanGranularity`. Engine signatures (`generatePeriods`, `workdaysInRange`, `absencesForResource`, `absenceWorkdays`, `periodCapacityHours`, `displayCapacityHours`) and `Period = { key, start, end }` are consistent across tasks and imported into the panel in T6.

**Placeholder scan:** none — all shipped code is complete; test fixtures use real computed values (Feb 2026 = 20 workdays; W07 = 5 workdays).

**Scope (YAGNI / boundary approximation):** rollup attributes a fine period to the canonical period containing its **start** date (documented, tested; a week spanning a month boundary is attributed wholly to its start month — acceptable for Phase 3). The non-canonical read-only display toggle and per-cell absence-override editing UI are deferred (engine + handler already exist), keeping Phase 3 focused on the editable canonical grid + window + granularity.
