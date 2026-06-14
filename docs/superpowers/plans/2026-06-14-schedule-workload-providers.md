# Schedule/EVM + Workload Action Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two new next-actions providers — `schedule` (project behind schedule via EVM SPI) and `workload` (resources over-allocated / overdue-overload) — plus a pure `buildWorkloadAlerts` helper. Additive; no engine change.

**Architecture:** `schedule` reads `ActionInput.dashboard` (no new input). `workload` consumes a new OPTIONAL `ActionInput.workloadAlerts` (default `[]`, surface-computed via pure `buildWorkloadAlerts`). Engine re-bands tier from score.

**Tech Stack:** Next.js 16, React 19, TS, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-06-14-schedule-workload-providers.md`

**Pinned facts:**
- `scoreAction(f: {urgency?,risk?,impact?,quickWin?,staleness?})` sums; `bandTier`: ≥60 now, ≥30 soon, else monitor (engine re-bands, providers just set score). `ACTION_WEIGHTS`: urgencyOverdue 40, urgencyToday 30, urgencySoon 15, riskCritical 30, riskHigh 15, impactBlocksMilestone 20.
- `ActionInput.dashboard.evm.spi: number|null`, `.dashboard.schedule.effective: Health` ("R"|"A"|"G"), `.dashboard.burndown: BurndownSeries|null`.
- `buildResourceWorkload(resources, tasks, absences, shifts, raid, today): WorkloadResult` → `{ managed: ManagedWorkloadRow[], unlinked }`; managed row has `resource: Resource`, `overdueCount: number`.
- `convertUtilization(util, fromMode, toMode, periods, workdayHours, holidaySet)` and `generatePeriods(start, end, granularity)` in `resource-capacity.ts`. `ResourcePlan` (types.ts) has `resources[]` each `{ id, utilizationMode: "percent"|"hours", utilization: Record<string,number> }` + granularity/date range.
- `ActionSource` (`next-actions/types.ts`) union + `SOURCE_LABEL` (`action-row.tsx`) must both gain the new sources or tsc fails (Record is exhaustive).
- task-manager `buildActionInput({...})` memo ~L600-633; `resources`, `plan`, `absences`, `shifts`, `tasks`, `raid` come from `useWorkspace()`; `holidaySet`, `workdayHours` available (used by the Resources views).

**Conventions:** `npx vitest run <p>`, `npx tsc --noEmit`, `npx eslint <f> --max-warnings=0`. i18n EN/DE parity + real umlauts. Providers are i18n-FREE (emit `{key,params}`).

---

## Task 1: i18n keys

**Files:** `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: EN** (after the SP4 `actionChips*` block):
```ts
  // --- Schedule + workload providers (0.80.0) ---
  actionSourceSchedule: "Schedule",
  actionSourceWorkload: "Workload",
  actionScheduleTitle: "{0} is behind schedule",
  actionScheduleWhyBehind: "Schedule performance index is {0} (under 1.0 = behind plan)",
  actionScheduleWhyBurndown: "Burn-up is trailing the planned line",
  actionWorkloadTitle: "{0}",
  actionWorkloadWhyOverAllocated: "Over-allocated — {0}% planned in the next period",
  actionWorkloadWhyOverload: "{0} overdue items assigned",
  versionHighlightScheduleWorkload: "Two new suggested-action signals: a schedule/EVM warning when the project trends behind plan, and workload alerts for over-allocated or overloaded people",
```
- [ ] **Step 2: DE** (real umlauts) at the matching position:
```ts
  // --- Termin- + Auslastungs-Provider (0.80.0) ---
  actionSourceSchedule: "Termin",
  actionSourceWorkload: "Auslastung",
  actionScheduleTitle: "{0} ist im Verzug",
  actionScheduleWhyBehind: "Schedule Performance Index liegt bei {0} (unter 1,0 = hinter Plan)",
  actionScheduleWhyBurndown: "Burn-up liegt hinter der geplanten Linie",
  actionWorkloadTitle: "{0}",
  actionWorkloadWhyOverAllocated: "Überlastet — {0}% im nächsten Zeitraum verplant",
  actionWorkloadWhyOverload: "{0} überfällige Aufgaben zugewiesen",
  versionHighlightScheduleWorkload: "Zwei neue Vorschlags-Signale: eine Termin-/EVM-Warnung, wenn das Projekt hinter den Plan fällt, und Auslastungs-Hinweise für überlastete Personen",
```
- [ ] **Step 3:** `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts` → PASS. Grep DE for `Verzug`, `Überlastet`, `überfällige` — real umlauts. (If Edit mangles umlauts, node UTF-8 write.)
- [ ] **Step 4: Commit** `feat: i18n keys for schedule + workload actions (EN/DE)`.

---

## Task 2: types + `buildWorkloadAlerts`

**Files:** Modify `src/app/next-actions/types.ts`. Create `src/app/next-actions-workload.ts`, `src/app/next-actions-workload.test.ts`.

- [ ] **Step 1: types.ts** — extend `ActionSource` and `ActionInput`:
```ts
export type ActionSource =
  | "task-due" | "raid" | "change-pending" | "milestone" | "budget" | "stakeholder-comms"
  | "schedule" | "workload";
```
Add import + optional field to `ActionInput`:
```ts
import type { WorkloadAlert } from "../next-actions-workload";
// …inside ActionInput, near taskDueEnabled?:
  workloadAlerts?: readonly WorkloadAlert[];   // optional; default [] (surface pre-computes)
```
- [ ] **Step 2: Write the failing test** `src/app/next-actions-workload.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildWorkloadAlerts } from "./next-actions-workload";
import type { Resource, ResourcePlan } from "./types";

function res(id: number, firstName: string): Resource {
  return { id, firstName, lastName: "X", email: "", role: "", discipline: "", grade: "", department: "", phone: "", birthday: "", notes: "", resourceId: undefined } as unknown as Resource;
}

describe("buildWorkloadAlerts", () => {
  const base = { resources: [res(1, "Aria")], tasks: [], absences: [], shifts: [], raid: [], today: "2026-06-15", workdayHours: 8, holidaySet: new Set<string>(), overdueThreshold: 3 };

  it("flags overload when a resource has >= threshold overdue tasks", () => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, taskName: "t", dueDate: "2026-06-01", assignee: "Aria", assigneeEmail: "", resourceId: 1, lastUpdateDate: "2026-05-01", priority: "Medium", blockers: "", notes: "" })) as unknown as never[];
    const alerts = buildWorkloadAlerts({ ...base, tasks });
    expect(alerts.some((a) => a.reason === "overload" && a.resourceId === 1 && a.value === 3)).toBe(true);
  });

  it("flags over-allocated when near-term planned utilization > 100%", () => {
    const plan: ResourcePlan = { granularity: "month", startDate: "2026-06-01", endDate: "2026-08-31", resources: [{ id: 1, utilizationMode: "percent", utilization: { "2026-06": 135 } }] } as unknown as ResourcePlan;
    const alerts = buildWorkloadAlerts({ ...base, plan });
    expect(alerts.some((a) => a.reason === "over-allocated" && a.resourceId === 1 && a.value === 135)).toBe(true);
  });

  it("returns nothing for a healthy resource", () => {
    expect(buildWorkloadAlerts(base)).toEqual([]);
  });
});
```
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4: Write `src/app/next-actions-workload.ts`**:
```ts
// src/app/next-actions-workload.ts
//
// Pure pre-computation of workload alerts for the next-actions `workload`
// provider. Two reasons: over-allocated (planned util > 100% near-term) and
// overload (>= N overdue tasks). The surface calls this once and passes the
// result into the engine via ActionInput.workloadAlerts.
import { buildResourceWorkload } from "./resource-workload-rows";
import { generatePeriods, convertUtilization } from "./resource-capacity";
import { resourceDisplayName } from "./resource-foundation";
import type { Resource, ResourcePlan, Task, Absence, Shift, RaidItem } from "./types";

export interface WorkloadAlert {
  resourceId: number;
  resourceName: string;
  reason: "over-allocated" | "overload";
  value: number; // utilization % (over-allocated) | overdue count (overload)
}

export interface BuildWorkloadAlertsArgs {
  resources: readonly Resource[];
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  raid: readonly RaidItem[];
  plan?: ResourcePlan;
  today: string;
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  overdueThreshold?: number;
}

const NEAR_TERM_PERIODS = 1; // check the current/next period only

export function buildWorkloadAlerts(a: BuildWorkloadAlertsArgs): WorkloadAlert[] {
  const threshold = a.overdueThreshold ?? 3;
  const out: WorkloadAlert[] = [];

  // (A) overload — from the existing workload builder's overdue counts
  const { managed } = buildResourceWorkload(a.resources, a.tasks, a.absences, a.shifts, a.raid, a.today);
  for (const row of managed) {
    if (row.overdueCount >= threshold) {
      out.push({ resourceId: row.resource.id, resourceName: resourceDisplayName(row.resource), reason: "overload", value: row.overdueCount });
    }
  }

  // (B) over-allocated — near-term planned utilization > 100%
  if (a.plan && a.plan.resources.length > 0) {
    const periods = generatePeriods(a.plan.startDate, a.plan.endDate, a.plan.granularity);
    const nearKeys = periods.slice(0, NEAR_TERM_PERIODS).map((p) => p.key);
    const byId = new Map(a.resources.map((r) => [r.id, r]));
    for (const pr of a.plan.resources) {
      const pct = convertUtilization(pr.utilization, pr.utilizationMode, "percent", periods, a.workdayHours, a.holidaySet);
      let max = 0;
      for (const k of nearKeys) if ((pct[k] ?? 0) > max) max = pct[k] ?? 0;
      if (max > 100) {
        const r = byId.get(pr.id);
        out.push({ resourceId: pr.id, resourceName: r ? resourceDisplayName(r) : `#${pr.id}`, reason: "over-allocated", value: Math.round(max) });
      }
    }
  }

  return out;
}
```
> If `resourceDisplayName` / `ResourcePlan` field names differ (e.g. `startDate`/`endDate`/`granularity`), READ `types.ts` + `resource-foundation.ts` and adjust — keep the two-signal logic. The test's `ResourcePlan` literal must match the real shape (fix the test's cast if needed).
- [ ] **Step 5:** Run → PASS. `npx tsc --noEmit` + `npx eslint src/app/next-actions-workload.ts src/app/next-actions-workload.test.ts src/app/next-actions/types.ts --max-warnings=0` → clean.
- [ ] **Step 6: Commit** `feat: WorkloadAlert type + buildWorkloadAlerts (over-allocated + overload)`.

---

## Task 3: `schedule` provider

**Files:** Create `src/app/next-actions/providers/schedule.ts`, `src/app/next-actions/providers/schedule.test.ts`.

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, expect, it } from "vitest";
import { scheduleProvider } from "./schedule";
import type { ActionInput } from "../types";

function input(spi: number | null): ActionInput {
  return {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], commsReminders: [],
    dashboard: { evm: { spi }, schedule: { effective: "A" }, burndown: null } as ActionInput["dashboard"],
    features: [], today: "2026-06-15", projectName: "Demo", now: new Date("2026-06-15T00:00:00Z"),
    reminderLeadDays: 0, dueSoonWorkdays: 3, raidReviewIntervalDays: 30, dismissed: new Set(),
  } as ActionInput;
}

describe("scheduleProvider", () => {
  it("emits a now-tier action when SPI < 0.8", () => {
    const a = scheduleProvider.provide(input(0.7));
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe("schedule:project:spi");
    expect(a[0].source).toBe("schedule");
    expect(a[0].cta).toEqual({ kind: "open", view: "dashboard", id: 0 });
    expect(a[0].score).toBeGreaterThanOrEqual(60);
  });
  it("emits a soon-tier action when SPI is 0.8–0.9", () => {
    const a = scheduleProvider.provide(input(0.85));
    expect(a).toHaveLength(1);
    expect(a[0].score).toBeGreaterThanOrEqual(30);
    expect(a[0].score).toBeLessThan(60);
  });
  it("emits nothing when SPI >= 0.9", () => {
    expect(scheduleProvider.provide(input(0.95))).toEqual([]);
  });
  it("emits nothing when SPI is null and no burndown gap", () => {
    expect(scheduleProvider.provide(input(null))).toEqual([]);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write `schedule.ts`:**
```ts
// src/app/next-actions/providers/schedule.ts
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const scheduleProvider: ActionProvider = {
  // core (no moduleId) — schedule health is project-wide
  provide(input: ActionInput): SuggestedAction[] {
    const spi = input.dashboard.evm?.spi ?? null;
    if (spi == null || spi >= 0.9) return [];
    // < 0.8 = serious (now-band 70), 0.8–0.9 = soon (30)
    const score = spi < 0.8
      ? scoreAction({ urgency: W.urgencyOverdue, risk: W.riskCritical })
      : scoreAction({ urgency: W.urgencySoon, risk: W.riskHigh });
    return [{
      id: "schedule:project:spi",
      source: "schedule",
      title: { key: "actionScheduleTitle", params: [input.projectName] },
      why: { key: "actionScheduleWhyBehind", params: [spi.toFixed(2)] },
      score,
      tier: bandTier(score),
      cta: { kind: "open", view: "dashboard", id: 0 },
    }];
  },
};
```
- [ ] **Step 4:** Run → PASS. tsc + eslint clean.
- [ ] **Step 5: Commit** `feat: schedule/EVM next-actions provider`.

---

## Task 4: `workload` provider

**Files:** Create `src/app/next-actions/providers/workload.ts`, `src/app/next-actions/providers/workload.test.ts`.

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, expect, it } from "vitest";
import { workloadProvider } from "./workload";
import type { ActionInput } from "../types";

function input(workloadAlerts: ActionInput["workloadAlerts"]): ActionInput {
  return {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], commsReminders: [],
    dashboard: {} as ActionInput["dashboard"], features: ["resources"], today: "2026-06-15",
    projectName: "", now: new Date("2026-06-15T00:00:00Z"), reminderLeadDays: 0, dueSoonWorkdays: 3,
    raidReviewIntervalDays: 30, dismissed: new Set(), workloadAlerts,
  } as ActionInput;
}

describe("workloadProvider", () => {
  it("maps an over-allocated alert to an action", () => {
    const a = workloadProvider.provide(input([{ resourceId: 1, resourceName: "Aria", reason: "over-allocated", value: 135 }]));
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe("workload:1:over-allocated");
    expect(a[0].source).toBe("workload");
    expect(a[0].why).toEqual({ key: "actionWorkloadWhyOverAllocated", params: [135] });
    expect(a[0].cta).toEqual({ kind: "open", view: "workload", id: 1 });
  });
  it("maps an overload alert to an action", () => {
    const a = workloadProvider.provide(input([{ resourceId: 2, resourceName: "Bo", reason: "overload", value: 4 }]));
    expect(a[0].why).toEqual({ key: "actionWorkloadWhyOverload", params: [4] });
  });
  it("emits nothing when there are no alerts", () => {
    expect(workloadProvider.provide(input([]))).toEqual([]);
    expect(workloadProvider.provide(input(undefined))).toEqual([]);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write `workload.ts`:**
```ts
// src/app/next-actions/providers/workload.ts
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

export const workloadProvider: ActionProvider = {
  moduleId: "resources",
  provide(input: ActionInput): SuggestedAction[] {
    const alerts = input.workloadAlerts ?? [];
    return alerts.map((al): SuggestedAction => {
      const score = al.reason === "over-allocated"
        ? scoreAction({ risk: al.value >= 130 ? W.riskCritical : W.riskHigh, urgency: W.urgencySoon })
        : scoreAction({ urgency: al.value >= 5 ? W.urgencyOverdue : W.urgencyToday, risk: W.riskHigh });
      const why = al.reason === "over-allocated"
        ? { key: "actionWorkloadWhyOverAllocated" as const, params: [al.value] }
        : { key: "actionWorkloadWhyOverload" as const, params: [al.value] };
      return {
        id: `workload:${al.resourceId}:${al.reason}`,
        source: "workload",
        moduleId: "resources",
        title: { key: "actionWorkloadTitle", params: [al.resourceName] },
        why,
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "workload", id: al.resourceId },
      };
    });
  },
};
```
- [ ] **Step 4:** Run → PASS. tsc + eslint clean.
- [ ] **Step 5: Commit** `feat: workload next-actions provider`.

---

## Task 5: wire — register, input, surface, source labels

**Files:** Modify `next-actions/index.ts`, `next-actions-input.ts`, `task-manager.tsx`, `action-row.tsx`.

- [ ] **Step 1: `next-actions/index.ts`** — import + register both at the END of `ALL_PROVIDERS`:
```ts
import { scheduleProvider } from "./providers/schedule";
import { workloadProvider } from "./providers/workload";
// …append to ALL_PROVIDERS: scheduleProvider, workloadProvider
```
- [ ] **Step 2: `next-actions-input.ts`** — add `workloadAlerts?: readonly WorkloadAlert[]` to `BuildActionInputArgs` (import the type) and pass `workloadAlerts: a.workloadAlerts ?? []` in the returned object.
- [ ] **Step 3: `action-row.tsx`** — add to `SOURCE_LABEL`: `schedule: "actionSourceSchedule", workload: "actionSourceWorkload",` (the Record is exhaustive over `ActionSource` — tsc enforces).
- [ ] **Step 4: `task-manager.tsx`** — import `buildWorkloadAlerts`; compute `const workloadAlerts = useMemo(() => buildWorkloadAlerts({ resources, tasks, absences, shifts, raid, plan, today, workdayHours: settings.resources.workdayHours, holidaySet }), [resources, tasks, absences, shifts, raid, plan, today, settings.resources.workdayHours, holidaySet])` (use the symbols actually in scope from `useWorkspace()` / settings — READ the component to confirm names; `holidaySet` may come from a hook). Pass `workloadAlerts` into the `buildActionInput({...})` call and add it to that memo's dep array.
- [ ] **Step 5: Verify** `npx tsc --noEmit && npx eslint src/app/next-actions src/app/next-actions-input.ts src/app/task-manager.tsx src/app/action-row.tsx --max-warnings=0` → clean. `npx vitest run src/app/next-actions src/app/action-row.test.tsx` → PASS.
- [ ] **Step 6: Commit** `feat: register schedule + workload providers; wire workloadAlerts`.

---

## Task 6: version + CHANGELOG + full sweep

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION` `"0.79.2"`→`"0.80.0"`; `APP_MILESTONE` `"Willis"`→`"Kress"` (Nancy Kress); build-date comment → `// 0.80.0 schedule/EVM + workload suggested-action providers`; append `"versionHighlightScheduleWorkload",` to `APP_HIGHLIGHT_KEYS`. Update the `0.80.x line is "…"` doc comment.
- [ ] **Step 2: CHANGELOG** above `## [0.79.2]`:
```markdown
## [0.80.0] - 2026-06-14 "Kress"

### Added
- **Two new suggested-action signals.** A **schedule** warning surfaces when the
  project trends behind plan (EVM schedule performance index below 1.0), and
  **workload** alerts flag people who are over-allocated (>100% planned) or
  carrying several overdue items. Both appear in the Action Center and as inline
  chips, clickable straight to the dashboard / workload view.
```
- [ ] **Step 3: FULL sweep** `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0` → all green. Report totals.
- [ ] **Step 4: Commit** `git add src/app/version.ts CHANGELOG.md && git commit -m "docs: 0.80.0 Kress — schedule + workload action providers"`.

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green; `npx eslint src/app --max-warnings=0` clean.
- [ ] Manual smoke: with a behind-schedule sample (SPI<0.9) the Action Center shows a "behind schedule" action → dashboard; an over-allocated / overdue-heavy resource shows a workload action → workload view; healthy project shows neither.
- [ ] e2e/a11y green (12-view gate).
- [ ] Use **superpowers:finishing-a-development-branch**.
