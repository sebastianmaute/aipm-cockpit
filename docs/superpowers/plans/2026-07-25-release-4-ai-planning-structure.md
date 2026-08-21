# Release 4 — AI planning & structure tools: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI assistant a read-only view of the project's RAG/budget health, a preview-gated way to plan resource allocations from natural language, and the ability to set typed task dependencies with cycle protection.

**Architecture:** Three independent slices over the existing chat-tool stack. 4.1 and 4.3a add tools to `chat-tool-defs.ts` → `chat-tools.ts` → `use-chat-dispatcher.ts`, with all derived data reaching the dispatcher through non-memoized getter functions on `ChatDispatcherArgs` (so a read tool nobody calls costs nothing per render). 4.2 is a plan-then-apply flow modelled line-for-line on `task-dedup/`: pure engine + one forced tool call + a `.tsx` glue hook returning `{ button, modal }`, writing `Resource.utilization` via a single functional setter with one undo entry. No new persisted field, no backend write path, no golden-fixture regeneration.

**Tech Stack:** TypeScript, Next.js 16, React 19, vitest, Playwright/axe, Anthropic Messages API (forced tool call via the shared `runForcedToolCall` envelope).

**Spec:** `docs/superpowers/specs/2026-07-25-r4-ai-planning-structure-design.md`

---

## File structure

**Created**
| File | Responsibility |
|---|---|
| `src/app/ai-dashboard-snapshot.ts` | Pure: `DashboardModel` + `ProjectReport` → the curated flat `DashboardSnapshot` the tool returns |
| `src/app/ai-dashboard-snapshot.test.ts` | Tests for the above |
| `src/app/task-dependency-write.ts` | Pure: untrusted dependency array → `{ applied, rejected }`, composing `sanitizeDependencies` + `wouldCreateDependencyCycle` |
| `src/app/task-dependency-write.test.ts` | Tests for the above |
| `src/app/alloc-plan/alloc-plan.ts` | Pure: prompt context, forced tool def, parse, ground, apply, `list_allocations` payload builder |
| `src/app/alloc-plan/alloc-plan.test.ts` | Tests for the above |
| `src/app/alloc-plan-call.ts` | The single forced Anthropic call (no grounding, no React) |
| `src/app/alloc-plan-call.test.ts` | Tests for the above |
| `src/app/alloc-plan-modal.tsx` | Presentational preview/confirm modal, per-cell checkboxes |
| `src/app/use-alloc-plan.tsx` | Glue hook: propose→preview→confirm state machine, returns `{ button, modal }` |
| `src/app/use-alloc-plan.test.tsx` | Tests for the hook's guard + confirm behaviour |

**Modified**
| File | Change |
|---|---|
| `src/app/chat-tool-defs.ts` | +3 tool defs: `get_dashboard_snapshot`, `set_task_dependencies`, `list_allocations` |
| `src/app/chat-tools.ts` | +3 `ToolDispatcher` methods, +3 `runTool` cases |
| `src/app/use-chat-dispatcher.ts` | +3 getter args → refs, +3 dispatcher methods |
| `src/app/task-manager.tsx` | Build and pass the three getters |
| `src/app/sanitize-entities.ts` | Export the existing `HOURS_MAP_MAX` constant |
| `src/app/activity-log.ts` | +`ai.allocationPlan` kind + `ACTIVITY_KIND_TO_KEY` entry |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New strings (EN + DE) |
| `src/app/resources-panel.tsx` | Mount `useAllocPlan`, pass its button into the toolbar, render its modal |
| `src/app/resources-panel-toolbar.tsx` | +`aiPlanButton: ReactNode` prop, rendered before `headerActions` |
| `src/app/workspace-section-types.ts` | (verify only — `onCaptureUndo` + `logActivity` already exist) |
| `src/app/workspace-section.tsx` | Thread `onCaptureUndo` + `logActivity` into `ResourcesPanel` |
| `vitest.config.ts` | (verify only — `src/app/**/*.tsx` already excludes the glue hook) |
| `src/app/version.ts`, `CHANGELOG.md` | 0.201.0 bump + highlights |

---

## Task 1: Pure dashboard-snapshot builder

**Files:**
- Create: `src/app/ai-dashboard-snapshot.ts`
- Test: `src/app/ai-dashboard-snapshot.test.ts`

Background you need: `DashboardModel` (`src/app/dashboard.ts:191-217`) is the dashboard's full render model — it contains whole `Task[]` / `ChangeItem[]` arrays and a 5-array burndown. We deliberately emit a small flat object instead, because this payload lands in the chat transcript and stays there. `ProjectReport` (`src/app/budget-report.ts:412-451`) is the budget rollup. `costIsKnowable(r)` (`budget-report.ts:117`) is structurally typed as `(r: { costUnknownReason: CostUnknownReason | null }) => boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/app/ai-dashboard-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDashboardSnapshot } from "./ai-dashboard-snapshot";
import { type DashboardModel } from "./dashboard";
import { type ProjectReport } from "./budget-report";

function model(over: Partial<DashboardModel> = {}): DashboardModel {
  return {
    overall: { computed: "G", effective: "A", overridden: true },
    schedule: { computed: "G", effective: "G", overridden: false },
    budget: { computed: "R", effective: "R", overridden: false },
    scope: { computed: null, effective: null, overridden: false },
    changes: { pending: 2, approved: 1, implemented: 4, total: 7 },
    topChanges: [],
    progress: { total: 10, completed: 4, percent: 40, counts: { R: 1, A: 2, G: 7 } },
    burn: null,
    burndown: null,
    bucketChain: null,
    evm: {
      pv: 100, ev: 80, ac: 0,
      spi: 0.8, cpi: null,
      sv: -20, cv: 80,
      money: null,
      coverage: { withEstimate: 6, total: 10 },
    },
    topRaid: [],
    openRaidCount: 3,
    overdue: [],
    dueSoon: [],
    overdueMilestones: [],
    atRiskMilestones: [],
    dueSoonMilestones: [],
    recentActivity: [],
    narrative: { text: "" },
    ...over,
  } as DashboardModel;
}

function report(over: Partial<ProjectReport> = {}): ProjectReport {
  return {
    budgetHours: 200, plannedHours: 180, actualHours: 90,
    budgetValue: 20000, consumedValue: 9000,
    revenue: 20000, cost: 8000,
    winLossHours: 10, winLossValue: 1000,
    contributionMargin: { amount: 12000, percent: 60 },
    costPerformance: { amount: 1000, percent: 110 },
    consumption: { amount: 9000, percent: 45 },
    earnedValue: 7000, costPerformanceIndex: 0.875,
    budgetMirrorsPlan: false,
    costUnknownReason: null,
    unpricedDisciplineIds: [],
    ...over,
  } as ProjectReport;
}

describe("buildDashboardSnapshot", () => {
  it("emits the effective RAG values plus their override flags", () => {
    const snap = buildDashboardSnapshot(model(), report(), "2026-07-25");

    expect(snap.today).toBe("2026-07-25");
    expect(snap.rag.overall).toBe("A");
    expect(snap.rag.overridden.overall).toBe(true);
    expect(snap.rag.schedule).toBe("G");
    expect(snap.rag.overridden.schedule).toBe(false);
    expect(snap.rag.scope).toBeNull();
  });

  it("passes EVM nulls through unchanged", () => {
    const snap = buildDashboardSnapshot(model(), report(), "2026-07-25");

    expect(snap.evm.spi).toBe(0.8);
    expect(snap.evm.cpi).toBeNull();
    expect(snap.evm.coverage).toEqual({ withEstimate: 6, total: 10 });
  });

  it("nulls cost figures and keeps the reason when cost is not knowable", () => {
    const snap = buildDashboardSnapshot(
      model(),
      report({ costUnknownReason: "no-rates", cost: 0, revenue: 0 }),
      "2026-07-25",
    );

    expect(snap.budget?.cost).toBeNull();
    expect(snap.budget?.revenue).toBeNull();
    expect(snap.budget?.contributionMarginPct).toBeNull();
    expect(snap.budget?.costUnknownReason).toBe("no-rates");
    // Hours are still facts — only the money is unknowable.
    expect(snap.budget?.budgetHours).toBe(200);
  });

  it("emits budget: null when there is no rollup", () => {
    const snap = buildDashboardSnapshot(model(), null, "2026-07-25");

    expect(snap.budget).toBeNull();
  });

  it("emits counts, never the underlying entity arrays", () => {
    const snap = buildDashboardSnapshot(
      model({
        overdue: [{ id: 1 }, { id: 2 }] as DashboardModel["overdue"],
        openRaidCount: 3,
      }),
      report(),
      "2026-07-25",
    );

    expect(snap.counts.overdueTasks).toBe(2);
    expect(snap.counts.openRaid).toBe(3);
    expect(snap.counts.changes).toEqual({ pending: 2, approved: 1, implemented: 4, total: 7 });
    expect(JSON.stringify(snap)).not.toContain("topChanges");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/ai-dashboard-snapshot.test.ts`
Expected: FAIL — `Failed to resolve import "./ai-dashboard-snapshot"`

- [ ] **Step 3: Write the implementation**

Create `src/app/ai-dashboard-snapshot.ts`:

```ts
// src/app/ai-dashboard-snapshot.ts
//
// Pure, i18n-free projection of the dashboard render model + budget rollup into
// the compact payload the `get_dashboard_snapshot` chat tool returns. Curated on
// purpose: DashboardModel carries whole Task/ChangeItem arrays and a five-array
// burndown, and this payload stays in the chat transcript for the rest of the
// turn — entity lists are the other tools' job.
//
// HONESTY RULE: never emit a number the panel would refuse to show. When the
// cost basis is unsound (costIsKnowable === false) the money figures are null
// and the reason rides costUnknownReason — never 0, which reads as "free" and
// makes margin look perfect.
import { type DashboardModel, type SubStatus } from "./dashboard";
import { type CostUnknownReason, type ProjectReport, costIsKnowable } from "./budget-report";
import { type Health } from "./health";

export interface DashboardSnapshotBudget {
  budgetHours: number;
  actualHours: number;
  budgetValue: number;
  consumedValue: number;
  /** null when the cost basis is unsound — see costUnknownReason. */
  cost: number | null;
  revenue: number | null;
  contributionMarginPct: number | null;
  /** EVM earned value; null unless every budgeted bucket is scored. */
  earnedValue: number | null;
  /** EV / AC; null when earnedValue is null or actual cost is 0. */
  costPerformanceIndex: number | null;
  costUnknownReason: CostUnknownReason | null;
}

export interface DashboardSnapshot {
  today: string;
  rag: {
    overall: Health;
    schedule: Health;
    budget: SubStatus;
    scope: SubStatus;
    overridden: { overall: boolean; schedule: boolean; budget: boolean; scope: boolean };
  };
  progress: { total: number; completed: number; percent: number };
  evm: {
    pv: number;
    ev: number;
    ac: number;
    spi: number | null;
    cpi: number | null;
    coverage: { withEstimate: number; total: number };
  };
  /** null when the budget module is off or the workspace has no real plan. */
  budget: DashboardSnapshotBudget | null;
  counts: {
    overdueTasks: number;
    dueSoonTasks: number;
    openRaid: number;
    overdueMilestones: number;
    atRiskMilestones: number;
    changes: { pending: number; approved: number; implemented: number; total: number };
  };
}

/** Project the live dashboard model + budget rollup into the tool payload. */
export function buildDashboardSnapshot(
  model: DashboardModel,
  project: ProjectReport | null,
  today: string,
): DashboardSnapshot {
  const knowable = project !== null && costIsKnowable(project);
  return {
    today,
    rag: {
      overall: model.overall.effective,
      schedule: model.schedule.effective,
      budget: model.budget.effective,
      scope: model.scope.effective,
      overridden: {
        overall: model.overall.overridden,
        schedule: model.schedule.overridden,
        budget: model.budget.overridden,
        scope: model.scope.overridden,
      },
    },
    progress: {
      total: model.progress.total,
      completed: model.progress.completed,
      percent: model.progress.percent,
    },
    evm: {
      pv: model.evm.pv,
      ev: model.evm.ev,
      ac: model.evm.ac,
      spi: model.evm.spi,
      cpi: model.evm.cpi,
      coverage: {
        withEstimate: model.evm.coverage.withEstimate,
        total: model.evm.coverage.total,
      },
    },
    budget:
      project === null
        ? null
        : {
            budgetHours: project.budgetHours,
            actualHours: project.actualHours,
            budgetValue: project.budgetValue,
            consumedValue: project.consumedValue,
            cost: knowable ? project.cost : null,
            revenue: knowable ? project.revenue : null,
            contributionMarginPct: knowable ? project.contributionMargin.percent : null,
            earnedValue: project.earnedValue,
            costPerformanceIndex: project.costPerformanceIndex,
            costUnknownReason: project.costUnknownReason,
          },
    counts: {
      overdueTasks: model.overdue.length,
      dueSoonTasks: model.dueSoon.length,
      openRaid: model.openRaidCount,
      overdueMilestones: model.overdueMilestones.length,
      atRiskMilestones: model.atRiskMilestones.length,
      changes: {
        pending: model.changes.pending,
        approved: model.changes.approved,
        implemented: model.changes.implemented,
        total: model.changes.total,
      },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/ai-dashboard-snapshot.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If a field name in the test fixtures doesn't match the real type, fix the FIXTURE, not the type.

- [ ] **Step 6: Commit**

```bash
git add src/app/ai-dashboard-snapshot.ts src/app/ai-dashboard-snapshot.test.ts
git commit -F - <<'EOF'
feat(ai): pure dashboard snapshot builder for the read tool

Projects DashboardModel + ProjectReport into a compact flat payload.
Money figures are null (never 0) when costIsKnowable is false, with the
reason carried through, so the assistant cannot report a fabricated margin.
EOF
```

---

## Task 2: Wire `get_dashboard_snapshot`

**Files:**
- Modify: `src/app/chat-tool-defs.ts` (TOOL_DEFS array, after the `get_app_state` entry at ~:302)
- Modify: `src/app/chat-tools.ts` (`ToolDispatcher` ~:184-231, `runTool` switch ~:451)
- Modify: `src/app/use-chat-dispatcher.ts` (`ChatDispatcherArgs` :66-75, refs block :106-149, dispatcher useMemo)
- Modify: `src/app/task-manager.tsx` (the `useChatDispatcher` call site ~:1622-1629)
- Test: `src/app/chat-tools.test.ts` (existing file — add cases)

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-tools.test.ts`:

```ts
describe("get_dashboard_snapshot", () => {
  it("returns the dispatcher's snapshot verbatim", async () => {
    const snapshot = { today: "2026-07-25", budget: null } as unknown as ReturnType<
      ToolDispatcher["getDashboardSnapshot"]
    >;
    const d = { getDashboardSnapshot: () => snapshot } as unknown as ToolDispatcher;

    await expect(runTool(d, "get_dashboard_snapshot", {})).resolves.toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-tools.test.ts -t "get_dashboard_snapshot"`
Expected: FAIL — `unknown tool: get_dashboard_snapshot`

- [ ] **Step 3: Add the tool definition**

In `src/app/chat-tool-defs.ts`, insert into the `TOOL_DEFS` array immediately after the `get_app_state` entry:

```ts
  {
    name: "get_dashboard_snapshot",
    description:
      "Read the project's current health: RAG ratings (overall, schedule, budget, scope) with whether each was manually overridden, completion progress, earned-value metrics (PV/EV/AC/SPI/CPI), the budget rollup (hours, value, cost, margin, EV, CPI), and counts of overdue tasks, due-soon tasks, open RAID items, overdue and at-risk milestones, and changes by state. Read-only. When a money figure is null, `costUnknownReason` says why the cost basis is unsound — report it as unknown, never as zero.",
    input_schema: { type: "object", properties: {} },
  },
```

- [ ] **Step 4: Add the dispatcher method + runTool case**

In `src/app/chat-tools.ts`, add the import and the interface member:

```ts
import { type DashboardSnapshot } from "./ai-dashboard-snapshot";
```

Inside `ToolDispatcher`, after `getSnapshot()`:

```ts
  getDashboardSnapshot(): DashboardSnapshot;
```

In the `runTool` switch, beside the other read cases (after `case "get_app_state":`):

```ts
    case "get_dashboard_snapshot":
      return d.getDashboardSnapshot();
```

- [ ] **Step 5: Add the getters to the dispatcher args**

In `src/app/use-chat-dispatcher.ts`, add imports:

```ts
import { type DashboardModel } from "./dashboard";
import { type ProjectReport } from "./budget-report";
import { buildDashboardSnapshot } from "./ai-dashboard-snapshot";
```

Extend `ChatDispatcherArgs`:

```ts
  /** Live dashboard render model. A getter (not the value) so the dispatcher
   *  identity stays stable — it is read through a ref at tool-call time. */
  getDashboardModel: () => DashboardModel;
  /** Live budget rollup, or null when the budget module is off / there is no
   *  real plan. Deliberately NOT memoized upstream: it runs only when a tool
   *  actually asks, so an unused read tool costs nothing per render. */
  getBudgetRollup: () => ProjectReport | null;
```

Add refs beside the existing eleven (follow the exact surrounding style — one `useRef` seeded from the arg, one single-dep `useEffect` refreshing it):

```ts
  const getDashboardModelRef = useRef(args.getDashboardModel);
  useEffect(() => {
    getDashboardModelRef.current = args.getDashboardModel;
  }, [args.getDashboardModel]);

  const getBudgetRollupRef = useRef(args.getBudgetRollup);
  useEffect(() => {
    getBudgetRollupRef.current = args.getBudgetRollup;
  }, [args.getBudgetRollup]);
```

Add the method inside the dispatcher `useMemo`, next to `getSnapshot`:

```ts
      getDashboardSnapshot: () =>
        buildDashboardSnapshot(
          getDashboardModelRef.current(),
          getBudgetRollupRef.current(),
          todayRef.current,
        ),
```

- [ ] **Step 6: Build the rollup getter in task-manager**

In `src/app/task-manager.tsx`, above the `useChatDispatcher(...)` call, add a plain (deliberately un-memoized) function. `dashboardModel` already exists as a `useMemo` at ~:739.

```ts
  // Deliberately NOT memoized: this runs only when the assistant calls
  // get_dashboard_snapshot / list_allocations, so an unused read tool costs
  // nothing per render. Unlike the dashboard's own internal report, this one is
  // task-aware, so earnedValue / costPerformanceIndex are the real figures.
  const getBudgetRollup = (): ProjectReport | null => {
    if (!settings.features.includes("budget")) return null;
    if (!workspaceHasPlan) return null;
    return computeBudgetReport(
      budgets,
      plan,
      roles,
      resources,
      settings.resources.workdayHours,
      holidaySet,
      absences,
      tasks,
    ).project;
  };
```

Then extend the `useChatDispatcher` call:

```ts
    getDashboardModel: () => dashboardModel,
    getBudgetRollup,
```

Implementation notes for whoever writes this:
- Import `computeBudgetReport` and `type ProjectReport` from `./budget-report`.
- `workspaceHasPlan` is the local guard for "there is a real `ws.plan`, not the placeholder `FALLBACK_PLAN`". If no such local exists in `task-manager.tsx`, derive it the same way the dashboard's budget gating already does at the `buildDashboardInput` call site (~:741-747) and reuse that expression — do not invent a second rule.
- The feature-module id for budgets is whatever `FEATURE_MODULES` uses; confirm the literal by grepping `"budget"` in `feature-modules.ts` before writing the guard.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/app/chat-tools.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add src/app/chat-tool-defs.ts src/app/chat-tools.ts src/app/use-chat-dispatcher.ts src/app/task-manager.tsx src/app/chat-tools.test.ts
git commit -F - <<'EOF'
feat(ai): add the get_dashboard_snapshot read tool

The assistant can now read live RAG, progress, EVM and the budget rollup.
Derived data reaches the dispatcher through un-memoized getters read via
refs at tool-call time, so an unused read tool costs nothing per render.
EOF
```

---

## Task 3: Pure dependency-write resolver

**Files:**
- Create: `src/app/task-dependency-write.ts`
- Test: `src/app/task-dependency-write.test.ts`

Background: `sanitizeDependencies(input, knownTaskIds, ownTaskId)` (`src/app/sanitize-core.ts:217`) handles shape, dedupe, self-reference, unknown ids and the 20-link cap — but explicitly does **not** cycle-check (documented at `sanitize-core.ts:213-215`). `wouldCreateDependencyCycle(ownTaskId, candidatePredecessorId, taskById)` (`sanitize-core.ts:246`) does, and today is called only from `dependencies-editor.tsx:67,80`.

- [ ] **Step 1: Write the failing test**

Create `src/app/task-dependency-write.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveDependencyWrite } from "./task-dependency-write";
import { type Task } from "./types";

function task(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    taskName: `Task ${id}`,
    assignee: "",
    dueDate: "",
    status: "To Do",
    priority: "Medium",
    ...over,
  } as Task;
}

describe("resolveDependencyWrite", () => {
  it("accepts valid links", () => {
    const tasks = [task(1), task(2), task(3)];

    const r = resolveDependencyWrite(3, [{ taskId: 1, type: "FS" }, { taskId: 2, type: "SS" }], tasks);

    expect(r.applied).toEqual([{ taskId: 1, type: "FS" }, { taskId: 2, type: "SS" }]);
    expect(r.rejected).toEqual([]);
  });

  it("refuses a self-dependency", () => {
    const tasks = [task(1), task(2)];

    const r = resolveDependencyWrite(1, [{ taskId: 1, type: "FS" }], tasks);

    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([{ taskId: 1, type: "FS", reason: "self" }]);
  });

  it("refuses an unknown task id", () => {
    const tasks = [task(1)];

    const r = resolveDependencyWrite(1, [{ taskId: 99, type: "FS" }], tasks);

    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([{ taskId: 99, type: "FS", reason: "unknown-id" }]);
  });

  it("refuses a bad link type", () => {
    const tasks = [task(1), task(2)];

    const r = resolveDependencyWrite(2, [{ taskId: 1, type: "NOPE" }], tasks);

    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([{ taskId: 1, type: "NOPE", reason: "bad-type" }]);
  });

  it("refuses a direct cycle", () => {
    // 1 already depends on 2, so 2 -> 1 would close the loop.
    const tasks = [task(1, { dependencies: [{ taskId: 2, type: "FS" }] }), task(2)];

    const r = resolveDependencyWrite(2, [{ taskId: 1, type: "FS" }], tasks);

    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([{ taskId: 1, type: "FS", reason: "cycle" }]);
  });

  it("refuses a transitive cycle", () => {
    // 1 <- 2 <- 3 exists; adding 3 as a predecessor of 1 closes the loop.
    const tasks = [
      task(1),
      task(2, { dependencies: [{ taskId: 1, type: "FS" }] }),
      task(3, { dependencies: [{ taskId: 2, type: "FS" }] }),
    ];

    const r = resolveDependencyWrite(1, [{ taskId: 3, type: "FS" }], tasks);

    expect(r.applied).toEqual([]);
    expect(r.rejected[0]?.reason).toBe("cycle");
  });

  it("refuses a set that is acyclic link-by-link but cyclic together", () => {
    // Neither 2 nor 3 reaches 1 yet. Accepting BOTH 1<-2 and 2<-... is fine,
    // but the pair {2 -> 1, and 1 already becoming reachable from 2} must be
    // evaluated against the links accepted so far, not the original graph.
    const tasks = [task(1), task(2, { dependencies: [{ taskId: 1, type: "FS" }] }), task(3)];

    // Writing task 1's list: predecessor 3 is fine; predecessor 2 closes 1->2->1.
    const r = resolveDependencyWrite(1, [{ taskId: 3, type: "FS" }, { taskId: 2, type: "FS" }], tasks);

    expect(r.applied).toEqual([{ taskId: 3, type: "FS" }]);
    expect(r.rejected).toEqual([{ taskId: 2, type: "FS", reason: "cycle" }]);
  });

  it("drops a duplicate link", () => {
    const tasks = [task(1), task(2)];

    const r = resolveDependencyWrite(2, [{ taskId: 1, type: "FS" }, { taskId: 1, type: "FS" }], tasks);

    expect(r.applied).toEqual([{ taskId: 1, type: "FS" }]);
    expect(r.rejected).toEqual([{ taskId: 1, type: "FS", reason: "duplicate" }]);
  });

  it("clears every link for an empty array", () => {
    const tasks = [task(1), task(2, { dependencies: [{ taskId: 1, type: "FS" }] })];

    const r = resolveDependencyWrite(2, [], tasks);

    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it("treats a non-array input as a clear", () => {
    const tasks = [task(1), task(2)];

    expect(resolveDependencyWrite(2, null, tasks).applied).toEqual([]);
    expect(resolveDependencyWrite(2, "nope", tasks).applied).toEqual([]);
  });

  it("caps the link count and reports the overflow", () => {
    const tasks = [task(1), ...Array.from({ length: 25 }, (_, i) => task(i + 2))];
    const raw = Array.from({ length: 25 }, (_, i) => ({ taskId: i + 2, type: "FS" as const }));

    const r = resolveDependencyWrite(1, raw, tasks);

    expect(r.applied).toHaveLength(20);
    expect(r.rejected).toHaveLength(5);
    expect(r.rejected.every((x) => x.reason === "cap")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/task-dependency-write.test.ts`
Expected: FAIL — `Failed to resolve import "./task-dependency-write"`

- [ ] **Step 3: Write the implementation**

Create `src/app/task-dependency-write.ts`:

```ts
// src/app/task-dependency-write.ts
//
// Pure, i18n-free resolver for an UNTRUSTED dependency list written by the AI
// (`set_task_dependencies`). Composes the two guards that already exist rather
// than reimplementing either:
//   1. sanitizeDependencies  — shape, dedupe, self-reference, unknown id, cap.
//   2. wouldCreateDependencyCycle — the graph walk, which sanitizeDependencies
//      deliberately does NOT do (sanitize-core.ts:213-215) because it is a
//      cross-task concern. Until this module existed that guard was reachable
//      only from dependencies-editor.tsx, so an AI writer would have been the
//      one path in the app able to create a cycle.
//
// The cycle check runs against a WORKING map carrying the links accepted so far,
// so a set of links that is acyclic one at a time but cyclic together is still
// refused. Every refusal is reported with a reason so the assistant can say what
// it could not do instead of silently dropping links.
import { DEPENDENCY_TYPES, type Task, type TaskDependency } from "./types";
import { sanitizeDependencies, wouldCreateDependencyCycle } from "./sanitize";

export type DepRejectionReason =
  | "unknown-id"
  | "self"
  | "cycle"
  | "duplicate"
  | "cap"
  | "bad-type";

export interface DepRejection {
  taskId: number;
  /** The type as the model wrote it — echoed back even when invalid. */
  type?: string;
  reason: DepRejectionReason;
}

export interface DependencyWriteResult {
  applied: TaskDependency[];
  rejected: DepRejection[];
}

/** Max links per task — mirrors DEPENDENCIES_MAX_COUNT in sanitize-core. */
const MAX_LINKS = 20;

function isDependencyType(v: unknown): v is TaskDependency["type"] {
  return typeof v === "string" && (DEPENDENCY_TYPES as readonly string[]).includes(v);
}

/**
 * Resolve the dependency list the model proposed for one task.
 *
 * `raw` is untrusted: anything that is not an array is treated as "clear all
 * links", matching the tool's documented empty-array semantics.
 */
export function resolveDependencyWrite(
  ownId: number,
  raw: unknown,
  tasks: readonly Task[],
): DependencyWriteResult {
  const rejected: DepRejection[] = [];
  if (!Array.isArray(raw)) return { applied: [], rejected };

  const knownTaskIds = new Set(tasks.map((tk) => tk.id));

  // Pass 1 — reasons the sanitizer would silently drop. We classify first so we
  // can report WHY, then let the sanitizer be the single source of truth for
  // what actually survives.
  const seen = new Set<string>();
  let kept = 0;
  for (const item of raw) {
    const entry = (item ?? {}) as { taskId?: unknown; type?: unknown };
    const tid = typeof entry.taskId === "number" ? entry.taskId : Number(entry.taskId);
    const rawType = typeof entry.type === "string" ? entry.type : undefined;
    if (!Number.isFinite(tid)) {
      rejected.push({ taskId: Number.NaN, type: rawType, reason: "unknown-id" });
      continue;
    }
    if (!isDependencyType(entry.type)) {
      rejected.push({ taskId: tid, type: rawType, reason: "bad-type" });
      continue;
    }
    if (tid === ownId) {
      rejected.push({ taskId: tid, type: entry.type, reason: "self" });
      continue;
    }
    if (!knownTaskIds.has(tid)) {
      rejected.push({ taskId: tid, type: entry.type, reason: "unknown-id" });
      continue;
    }
    const key = `${tid}:${entry.type}`;
    if (seen.has(key)) {
      rejected.push({ taskId: tid, type: entry.type, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    if (kept >= MAX_LINKS) {
      rejected.push({ taskId: tid, type: entry.type, reason: "cap" });
      continue;
    }
    kept++;
  }

  const sanitized = sanitizeDependencies(raw, knownTaskIds, ownId);

  // Pass 2 — cycles, against a working map that grows with each accepted link.
  // Checking against the ORIGINAL graph would let a set of individually-safe
  // links close a loop together.
  const working = new Map<number, Task>(tasks.map((tk) => [tk.id, tk]));
  const own = working.get(ownId);
  const applied: TaskDependency[] = [];
  working.set(ownId, { ...(own ?? ({ id: ownId } as Task)), dependencies: applied });

  for (const dep of sanitized) {
    if (wouldCreateDependencyCycle(ownId, dep.taskId, working)) {
      rejected.push({ taskId: dep.taskId, type: dep.type, reason: "cycle" });
      continue;
    }
    applied.push(dep);
  }

  return { applied, rejected };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/task-dependency-write.test.ts`
Expected: PASS, 11 tests

Note on `applied` aliasing: `working.get(ownId).dependencies` is the same array instance as `applied`, so each `wouldCreateDependencyCycle` walk sees the links accepted so far. That is deliberate — if you refactor it into a copy, the "acyclic individually, cyclic together" test will fail, which is the point of that test.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If `wouldCreateDependencyCycle` is not re-exported from the `./sanitize` barrel, import it from `./sanitize-core` instead and note that in the import comment.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-dependency-write.ts src/app/task-dependency-write.test.ts
git commit -F - <<'EOF'
feat(tasks): pure resolver for AI-written task dependencies

Composes sanitizeDependencies with wouldCreateDependencyCycle, checking
cycles against a working map that grows with each accepted link so a set
of individually-safe links cannot close a loop together. Every refusal
carries a reason.
EOF
```

---

## Task 4: Wire `set_task_dependencies`

**Files:**
- Modify: `src/app/chat-tool-defs.ts`
- Modify: `src/app/chat-tools.ts`
- Modify: `src/app/use-chat-dispatcher.ts`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-tools.test.ts`:

```ts
describe("set_task_dependencies", () => {
  it("passes the id and the raw list to the dispatcher", async () => {
    const calls: unknown[] = [];
    const d = {
      setTaskDependencies: (id: number, raw: unknown) => {
        calls.push([id, raw]);
        return { id, dependencies: [], rejected: [] };
      },
    } as unknown as ToolDispatcher;

    await runTool(d, "set_task_dependencies", {
      id: 7,
      dependencies: [{ taskId: 3, type: "FS" }],
    });

    expect(calls).toEqual([[7, [{ taskId: 3, type: "FS" }]]]);
  });

  it("throws when the task is missing", async () => {
    const d = { setTaskDependencies: () => null } as unknown as ToolDispatcher;

    await expect(runTool(d, "set_task_dependencies", { id: 9, dependencies: [] })).rejects.toThrow(
      "#9 not found",
    );
  });

  it("throws when id is not a number", async () => {
    const d = { setTaskDependencies: () => null } as unknown as ToolDispatcher;

    await expect(
      runTool(d, "set_task_dependencies", { dependencies: [] }),
    ).rejects.toThrow("id must be a number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-tools.test.ts -t "set_task_dependencies"`
Expected: FAIL — `unknown tool: set_task_dependencies`

- [ ] **Step 3: Add the tool definition**

In `src/app/chat-tool-defs.ts`, add the import of the type list at the top:

```ts
import { DEPENDENCY_TYPES } from "./types";
```

Then insert into `TOOL_DEFS` after the `delete_task` / `delete_all_tasks` entries:

```ts
  {
    name: "set_task_dependencies",
    description:
      "Replace the predecessor links of one task. A dependency lives on the DEPENDENT task and points at its PREDECESSOR: {taskId: 12, type: 'FS'} on task 40 means task 40 starts after task 12 finishes. Types: FS (finish-to-start), SS (start-to-start), FF (finish-to-finish), SF (start-to-finish). Pass an empty array to clear all links. Links that would create a cycle, point at a task that does not exist, or point at the task itself are refused and reported back in the result — read `rejected` and tell the user what could not be linked. Use list_tasks first to see the current graph.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Id of the task whose links are being replaced." },
        dependencies: {
          type: "array",
          description: "The complete new list of predecessor links. An empty array clears them.",
          items: {
            type: "object",
            properties: {
              taskId: { type: "number", description: "Id of the PREDECESSOR task." },
              type: { type: "string", enum: [...DEPENDENCY_TYPES] },
            },
            required: ["taskId", "type"],
          },
        },
      },
      required: ["id", "dependencies"],
    },
  },
```

- [ ] **Step 4: Add the dispatcher method + runTool case**

In `src/app/chat-tools.ts`, add the import:

```ts
import { type DepRejection } from "./task-dependency-write";
import { type TaskDependency } from "./types";
```

Add to `ToolDispatcher`, next to the other task methods:

```ts
  setTaskDependencies(
    id: number,
    raw: unknown,
  ): { id: number; dependencies: TaskDependency[]; rejected: DepRejection[] } | null;
```

Add the `runTool` case beside the other task write cases:

```ts
    case "set_task_dependencies": {
      const id = requireId(input);
      const result = d.setTaskDependencies(id, input.dependencies);
      if (!result) throw new Error(`Task #${id} not found`);
      return result;
    }
```

- [ ] **Step 5: Implement it in the dispatcher**

In `src/app/use-chat-dispatcher.ts`, add the import:

```ts
import { resolveDependencyWrite } from "./task-dependency-write";
```

Add the method inside the dispatcher `useMemo`, beside `updateTask`:

```ts
      setTaskDependencies: (id, raw) => {
        if (args.isReadOnly) throw readOnlyError();
        const list = tasksRef.current;
        const target = list.find((row) => row.id === id);
        if (!target) return null;
        const { applied, rejected } = resolveDependencyWrite(id, raw, list);
        const next = list.map((row) =>
          row.id === id
            ? { ...row, dependencies: applied, localModifiedAt: new Date().toISOString() }
            : row,
        );
        tasksRef.current = next; // keep ref in sync for back-to-back tool calls
        setTasks(next);
        return { id, dependencies: applied, rejected };
      },
```

Notes:
- Jira-synced tasks are deliberately **allowed** — `dependencies` is local-only (`types.ts:86`), the same class as `blockers` / `group`, which the Jira sync already preserves. Do not add a `jiraKey` guard.
- `readOnlyError()` is the shared helper at `use-chat-dispatcher.ts:212`.
- The ref assignment **must** precede `setTasks`, per the back-to-back-tool-call rule already documented at `use-chat-dispatcher.ts:256`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/app/chat-tools.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-tool-defs.ts src/app/chat-tools.ts src/app/use-chat-dispatcher.ts src/app/chat-tools.test.ts
git commit -F - <<'EOF'
feat(ai): add the set_task_dependencies tool

Replace-the-whole-list semantics for one task, guarded by the existing
sanitizer plus the cycle walk, with refusals reported back so a partial
refusal is visible in the transcript instead of silent.
EOF
```

---

## Task 5: Allocation prompt context, tool schema and parser

**Files:**
- Create: `src/app/alloc-plan/alloc-plan.ts`
- Create: `src/app/alloc-plan/alloc-plan.test.ts`
- Modify: `src/app/sanitize-entities.ts` (export the existing `HOURS_MAP_MAX`)

Background you need before writing this: there is **no** allocation entity. A planner allocation is `Resource.utilization[periodKey]` — a `Record<string, number>` on the `Resource` (`types.ts:526-552`) whose unit depends on that resource's own `utilizationMode: "percent" | "hours"`. Period keys come from `generatePeriods(plan.startDate, plan.endDate, plan.granularity)` (`resource-capacity.ts:79`) and capacity from `periodCapacityHours(resource, period, resourceAbsences, workdayHours, holidaySet)` (`resource-capacity.ts:145`), with `absencesForResource(absences, resource)` (`resource-capacity.ts:108`) selecting a resource's absences.

- [ ] **Step 1: Export the sanitizer's hours cap**

In `src/app/sanitize-entities.ts:194`, change:

```ts
const HOURS_MAP_MAX = 1000;
```

to:

```ts
/** Per-period hours ceiling. Exported so the AI allocation planner clamps to the
 *  SAME bound the load-path sanitizer enforces — otherwise a confirmed value
 *  above it is silently trimmed on the next load and what the user approved is
 *  not what persists. */
export const HOURS_MAP_MAX = 1000;
```

`sanitize.ts` re-exports with `export *`, so it flows to the barrel automatically.

- [ ] **Step 2: Write the failing test**

Create `src/app/alloc-plan/alloc-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_ALLOC_CELLS,
  PROPOSE_ALLOCATIONS_TOOL,
  buildAllocContext,
  parseAllocationProposal,
} from "./alloc-plan";
import { type Discipline, type Grade, type Resource, type ResourcePlan, type Role } from "../types";

const plan: ResourcePlan = {
  startDate: "2026-08-01",
  endDate: "2026-09-30",
  granularity: "month",
  currency: "EUR",
};

function resource(id: number, over: Partial<Resource> = {}): Resource {
  return {
    id,
    firstName: "First",
    lastName: `Last${id}`,
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...over,
  } as Resource;
}

describe("PROPOSE_ALLOCATIONS_TOOL", () => {
  it("requires a cells array", () => {
    expect(PROPOSE_ALLOCATIONS_TOOL.name).toBe("propose_allocations");
    expect(PROPOSE_ALLOCATIONS_TOOL.input_schema.required).toContain("cells");
  });
});

describe("buildAllocContext", () => {
  it("lists each resource with its mode, role and per-period capacity", () => {
    const roles: Role[] = [{ id: 5, disciplineId: 1, gradeId: 2 } as Role];
    const disciplines: Discipline[] = [{ id: 1, name: "Design" } as Discipline];
    const grades: Grade[] = [{ id: 2, name: "Senior" } as Grade];
    const r = resource(3, { firstName: "Ada", lastName: "Lovelace", roleId: 5 });

    const text = buildAllocContext({
      resources: [r],
      roles,
      disciplines,
      grades,
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(text).toContain("#3 Ada Lovelace");
    expect(text).toContain("percent");
    expect(text).toContain("Design / Senior");
    expect(text).toContain("2026-08");
    expect(text).toContain("2026-09");
  });

  it("names the plan window and granularity so the model uses valid period keys", () => {
    const text = buildAllocContext({
      resources: [resource(1)],
      roles: [],
      disciplines: [],
      grades: [],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(text).toContain("month");
    expect(text).toContain("2026-08-01");
    expect(text).toContain("2026-09-30");
  });
});

describe("parseAllocationProposal", () => {
  it("returns null when the shape is unusable", () => {
    expect(parseAllocationProposal(null)).toBeNull();
    expect(parseAllocationProposal({})).toBeNull();
    expect(parseAllocationProposal({ cells: "nope" })).toBeNull();
  });

  it("keeps well-formed cells and drops malformed ones without failing", () => {
    const parsed = parseAllocationProposal({
      cells: [
        { resourceId: 1, periodKey: "2026-08", hours: 40 },
        { resourceId: "nope", periodKey: "2026-08", hours: 10 },
        { resourceId: 2, periodKey: 7, hours: 10 },
        { resourceId: 3, periodKey: "2026-09", hours: "12.5" },
      ],
      rationale: "spread the design load",
    });

    expect(parsed).toEqual([
      { resourceId: 1, periodKey: "2026-08", hours: 40 },
      { resourceId: 3, periodKey: "2026-09", hours: 12.5 },
    ]);
  });

  it("caps the number of cells it will parse", () => {
    const cells = Array.from({ length: MAX_ALLOC_CELLS + 10 }, (_, i) => ({
      resourceId: 1,
      periodKey: `2026-${String((i % 12) + 1).padStart(2, "0")}`,
      hours: 1,
    }));

    expect(parseAllocationProposal({ cells })).toHaveLength(MAX_ALLOC_CELLS);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/alloc-plan/alloc-plan.test.ts`
Expected: FAIL — `Failed to resolve import "./alloc-plan"`

- [ ] **Step 4: Write the implementation (part 1 of 3)**

Create `src/app/alloc-plan/alloc-plan.ts` with the context, schema and parser. Tasks 6 and 7 append to this same file.

```ts
// src/app/alloc-plan/alloc-plan.ts
//
// Pure, i18n-free contract + transforms for AI resource-allocation planning.
// Claude proposes ALLOCATION CELLS (resource × period × hours) via one forced
// tool call; its output is UNTRUSTED, so every id and period key it returns is
// re-grounded against the live workspace before anything can be previewed or
// applied. No React, no fetch, no i18n, no side effects.
//
// MODEL NOTE: an "allocation" is not an entity — it is a key in
// Resource.utilization, and its UNIT depends on that resource's own
// utilizationMode. The model always speaks HOURS; conversion to the stored unit
// happens in groundAllocationCells, which is also where the capacity a
// percentage is a percentage OF gets resolved.
import {
  type Absence,
  type Discipline,
  type Grade,
  type Resource,
  type ResourcePlan,
  type Role,
} from "../types";
import {
  type Period,
  absencesForResource,
  generatePeriods,
  periodCapacityHours,
} from "../resource-capacity";
import { HOURS_MAP_MAX } from "../sanitize";

/** A cell as parsed from the model's tool input — shape-validated only. */
export interface RawAllocCell {
  resourceId: number;
  periodKey: string;
  hours: number;
}

/** Bound on how many cells a single run may parse/apply (token + blast-radius
 *  budget). Mirrors MAX_MERGE_GROUPS in the dedup engine. */
export const MAX_ALLOC_CELLS = 200;
/** Bound on how many resources are described to the model. */
export const ALLOC_CONTEXT_MAX_RESOURCES = 120;

export interface AllocContextArgs {
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
}

/** Display label for a resource — a Role has no name of its own, so people are
 *  identified by their own name, never by role. */
export function resourceLabel(r: Resource): string {
  const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
  return name || r.email?.trim() || `#${r.id}`;
}

function roleLabelOf(
  roleId: number | null,
  roles: readonly Role[],
  disciplines: readonly Discipline[],
  grades: readonly Grade[],
): string {
  if (roleId === null) return "-";
  const role = roles.find((x) => x.id === roleId);
  if (!role) return "-";
  const d = disciplines.find((x) => x.id === role.disciplineId)?.name ?? "?";
  const g = grades.find((x) => x.id === role.gradeId)?.name ?? "?";
  return `${d} / ${g}`;
}

/**
 * Compact digest of the plan window and every resource's per-period capacity
 * and current load, IN HOURS regardless of how each resource stores its value.
 * Sent as the volatile user message, never in a cached system block.
 *
 * The model cannot distribute sensibly without knowing what fits, so capacity
 * is not optional context — it is the point of this digest.
 */
export function buildAllocContext(args: AllocContextArgs): string {
  const periods = generatePeriods(args.plan.startDate, args.plan.endDate, args.plan.granularity);
  const shown = args.resources.slice(0, ALLOC_CONTEXT_MAX_RESOURCES);
  const lines: string[] = [
    `PLAN: ${args.plan.startDate} .. ${args.plan.endDate} granularity=${args.plan.granularity} workday=${args.workdayHours}h`,
    `PERIOD KEYS (use ONLY these): ${periods.map((p) => p.key).join(", ")}`,
    "RESOURCES (capacity and current load are in HOURS):",
  ];
  for (const r of shown) {
    const abs = absencesForResource(args.absences, r);
    const cells = periods.map((p) => {
      const capacity = periodCapacityHours(r, p, abs, args.workdayHours, args.holidaySet);
      const stored = r.utilization[p.key] ?? 0;
      const currentHours =
        r.utilizationMode === "percent" ? Math.round((stored / 100) * capacity) : stored;
      return `${p.key}=${currentHours}/${Math.round(capacity)}`;
    });
    const ext = r.isExternal ? " external" : "";
    lines.push(
      `#${r.id} ${resourceLabel(r)} [${r.utilizationMode}] role=${roleLabelOf(
        r.roleId,
        args.roles,
        args.disciplines,
        args.grades,
      )}${ext} :: ${cells.join(" ")}`,
    );
  }
  if (args.resources.length > shown.length) {
    lines.push(`…(${args.resources.length - shown.length} more resources truncated)`);
  }
  return lines.join("\n");
}

/** Stable, cacheable system prompt. */
export function buildAllocSystemPrompt(): string {
  return [
    "You are a resource planner distributing work across a project team.",
    "You are given the plan window, the valid period keys, and one line per resource as `#id Name [mode] role=Discipline / Grade :: <periodKey>=<currentHours>/<capacityHours> …`.",
    "Call the propose_allocations tool exactly once.",
    "Every cell you return sets that resource's planned load for that period, IN HOURS, replacing whatever is there. Only the cells you return change; everything else is left alone.",
    "Use ONLY the period keys listed. Use ONLY resource ids that appear in the list.",
    "Respect capacity: do not plan more hours than the capacity shown for that resource and period unless the user explicitly asks to overload.",
    "When asked to spread work across a role, split it across the resources holding that role; prefer whoever has spare capacity.",
    "Return an empty cells array if the request cannot be satisfied from the data shown. Do not invent resources or periods.",
    "Keep `rationale` to one short line.",
  ].join(" ");
}

/** Anthropic tool definition, forced via tool_choice. */
export const PROPOSE_ALLOCATIONS_TOOL = {
  name: "propose_allocations",
  description:
    "Propose planned hours per resource per period. Call exactly once; return an empty cells array when the request cannot be satisfied.",
  input_schema: {
    type: "object" as const,
    properties: {
      cells: {
        type: "array",
        description: "Planned hours for one resource in one period. Replaces the current value.",
        items: {
          type: "object",
          properties: {
            resourceId: { type: "integer", description: "Resource id from the list." },
            periodKey: { type: "string", description: "One of the listed period keys." },
            hours: { type: "number", description: "Planned hours for that resource in that period." },
          },
          required: ["resourceId", "periodKey", "hours"],
        },
      },
      rationale: { type: "string", description: "One short line: how the work was distributed." },
    },
    required: ["cells"],
  },
};

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the untrusted tool input into raw cells (shape only — ids and period
 * keys are grounded later). Returns null only when the overall shape is
 * unusable; individual malformed cells are dropped, not fatal.
 */
export function parseAllocationProposal(input: unknown): RawAllocCell[] | null {
  if (!input || typeof input !== "object") return null;
  const cells = (input as { cells?: unknown }).cells;
  if (!Array.isArray(cells)) return null;
  const out: RawAllocCell[] = [];
  for (const raw of cells) {
    if (out.length >= MAX_ALLOC_CELLS) break;
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { resourceId?: unknown; periodKey?: unknown; hours?: unknown };
    const resourceId = toNum(c.resourceId);
    const hours = toNum(c.hours);
    if (resourceId === null || hours === null) continue;
    if (typeof c.periodKey !== "string" || !c.periodKey.trim()) continue;
    out.push({ resourceId, periodKey: c.periodKey.trim(), hours });
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/alloc-plan/alloc-plan.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0

If `Role` does not have `disciplineId` / `gradeId` under those exact names, correct `roleLabelOf` to the real field names (check `types.ts:498-522`) — do not change the test's intent.

- [ ] **Step 6: Commit**

```bash
git add src/app/alloc-plan/alloc-plan.ts src/app/alloc-plan/alloc-plan.test.ts src/app/sanitize-entities.ts
git commit -F - <<'EOF'
feat(planning): allocation prompt context, tool schema and parser

The digest gives the model per-period capacity AND current load in hours
for every resource, so it can distribute against what actually fits. The
sanitizer's hours cap is now exported so the planner clamps to the same
bound the load path enforces.
EOF
```

---

## Task 6: Ground allocation cells against the live workspace

**Files:**
- Modify: `src/app/alloc-plan/alloc-plan.ts` (append)
- Modify: `src/app/alloc-plan/alloc-plan.test.ts` (append)

This is the anti-hallucination gate and the unit conversion, in one place.

- [ ] **Step 1: Write the failing test**

Append to `src/app/alloc-plan/alloc-plan.test.ts`:

```ts
import { groundAllocationCells, cellKey } from "./alloc-plan";

const groundCtx = (resources: Resource[], over: Partial<Parameters<typeof groundAllocationCells>[1]> = {}) => ({
  resources,
  plan,
  absences: [],
  workdayHours: 8,
  holidaySet: new Set<string>(),
  ...over,
});

describe("groundAllocationCells", () => {
  it("drops a cell whose resource does not exist", () => {
    const r = groundAllocationCells(
      [{ resourceId: 99, periodKey: "2026-08", hours: 10 }],
      groundCtx([resource(1)]),
    );

    expect(r.cells).toEqual([]);
    expect(r.skipped).toEqual([{ resourceId: 99, periodKey: "2026-08", reason: "unknown-resource" }]);
  });

  it("skips a period key outside the plan window", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2027-01", hours: 10 }],
      groundCtx([resource(1)]),
    );

    expect(r.cells).toEqual([]);
    expect(r.skipped[0]?.reason).toBe("out-of-window");
  });

  it("skips a key at the wrong granularity", () => {
    // The plan is monthly; a week key would be silently dropped by the
    // sanitizer's PERIOD_KEY_RE on the next round-trip, so refuse it here.
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-W32", hours: 10 }],
      groundCtx([resource(1)]),
    );

    expect(r.cells).toEqual([]);
    expect(r.skipped[0]?.reason).toBe("out-of-window");
  });

  it("skips negative or non-finite hours", () => {
    const r = groundAllocationCells(
      [
        { resourceId: 1, periodKey: "2026-08", hours: -5 },
        { resourceId: 1, periodKey: "2026-09", hours: Number.NaN },
      ],
      groundCtx([resource(1)]),
    );

    expect(r.cells).toEqual([]);
    expect(r.skipped.every((s) => s.reason === "bad-hours")).toBe(true);
  });

  it("converts hours to a percentage of the period's capacity", () => {
    // August 2026: 21 workdays x 8h = 168h capacity. 84h => 50%.
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 84 }],
      groundCtx([resource(1, { utilizationMode: "percent" })]),
    );

    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]?.mode).toBe("percent");
    expect(r.cells[0]?.nextValue).toBe(50);
    expect(r.cells[0]?.capacityHours).toBe(168);
    expect(r.cells[0]?.clamped).toBe(false);
  });

  it("writes hours straight through for an hours-mode resource", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 84 }],
      groundCtx([resource(1, { utilizationMode: "hours" })]),
    );

    expect(r.cells[0]?.nextValue).toBe(84);
  });

  it("clamps a percentage above 100 and flags it", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 400 }],
      groundCtx([resource(1, { utilizationMode: "percent" })]),
    );

    expect(r.cells[0]?.nextValue).toBe(100);
    expect(r.cells[0]?.clamped).toBe(true);
  });

  it("clamps hours to the sanitizer's ceiling and flags it", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 5000 }],
      groundCtx([resource(1, { utilizationMode: "hours" })]),
    );

    expect(r.cells[0]?.nextValue).toBe(1000);
    expect(r.cells[0]?.clamped).toBe(true);
  });

  it("skips a percent-mode cell with zero capacity instead of writing 0 or 100", () => {
    const away = resource(1, { utilizationMode: "percent" });
    const absences = [
      { id: 1, resourceId: 1, assignee: "", startDate: "2026-08-01", endDate: "2026-08-31", type: "vacation" },
    ] as unknown as Absence[];

    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 40 }],
      groundCtx([away], { absences }),
    );

    expect(r.cells).toEqual([]);
    expect(r.skipped[0]?.reason).toBe("no-capacity");
  });

  it("keeps the first of two cells for the same resource and period", () => {
    const r = groundAllocationCells(
      [
        { resourceId: 1, periodKey: "2026-08", hours: 80 },
        { resourceId: 1, periodKey: "2026-08", hours: 20 },
      ],
      groundCtx([resource(1, { utilizationMode: "hours" })]),
    );

    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]?.nextValue).toBe(80);
    expect(r.skipped[0]?.reason).toBe("duplicate");
  });

  it("omits a cell that would not change anything", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 40 }],
      groundCtx([resource(1, { utilizationMode: "hours", utilization: { "2026-08": 40 } })]),
    );

    expect(r.cells).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("keeps an explicit zero, so a cell can be cleared", () => {
    const r = groundAllocationCells(
      [{ resourceId: 1, periodKey: "2026-08", hours: 0 }],
      groundCtx([resource(1, { utilizationMode: "hours", utilization: { "2026-08": 40 } })]),
    );

    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]?.currentValue).toBe(40);
    expect(r.cells[0]?.nextValue).toBe(0);
  });

  it("builds a stable cell key", () => {
    expect(cellKey({ resourceId: 3, periodKey: "2026-08" })).toBe("3:2026-08");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/alloc-plan/alloc-plan.test.ts`
Expected: FAIL — `groundAllocationCells is not exported`

- [ ] **Step 3: Append the implementation**

Append to `src/app/alloc-plan/alloc-plan.ts`:

```ts
export type SkipReason =
  | "unknown-resource"
  | "out-of-window"
  | "no-capacity"
  | "bad-hours"
  | "duplicate";

export interface SkippedCell {
  resourceId: number;
  periodKey: string;
  reason: SkipReason;
}

/** A cell whose resource and period are real and whose value has been converted
 *  into that resource's own storage unit. Only these ever reach the preview or
 *  the apply. */
export interface GroundedAllocCell {
  resourceId: number;
  resourceName: string;
  periodKey: string;
  mode: Resource["utilizationMode"];
  /** Value currently stored for that cell, in the resource's own unit. */
  currentValue: number;
  /** Value that will be stored, in the resource's own unit. */
  nextValue: number;
  /** Hours the model asked for. */
  hours: number;
  /** Hours that actually fit in that period for that resource. */
  capacityHours: number;
  /** True when the request exceeded the storable bound and was trimmed. */
  clamped: boolean;
}

export interface AllocGroundContext {
  resources: readonly Resource[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
}

/** Stable identity for a cell — the selection key in the preview modal. */
export function cellKey(c: { resourceId: number; periodKey: string }): string {
  return `${c.resourceId}:${c.periodKey}`;
}

/**
 * Re-ground raw model cells against the LIVE workspace. This is the
 * anti-hallucination gate AND the unit conversion. Rules:
 *   - resourceId must be a live resource, else dropped.
 *   - periodKey must be one the plan actually generates — this also refuses a
 *     key at the wrong granularity, which the load-path sanitizer would drop
 *     silently later.
 *   - hours must be finite and >= 0.
 *   - a (resourceId, periodKey) pair may appear once; the first wins.
 *   - percent-mode: value = round(hours / capacity * 100). Zero capacity (a
 *     full-period absence) is SKIPPED — hours cannot be expressed as a
 *     percentage of nothing, and writing 0 or 100 would both be lies.
 *   - values are clamped to the same bounds the sanitizer enforces (100 /
 *     HOURS_MAP_MAX) with `clamped` set, so the preview shows what will really
 *     be stored.
 *   - a cell that would not change the stored value is omitted entirely, so the
 *     preview lists only real changes. An explicit 0 against a non-zero current
 *     value IS a change and is kept.
 */
export function groundAllocationCells(
  raw: readonly RawAllocCell[],
  ctx: AllocGroundContext,
): { cells: GroundedAllocCell[]; skipped: SkippedCell[] } {
  const periods: Period[] = generatePeriods(
    ctx.plan.startDate,
    ctx.plan.endDate,
    ctx.plan.granularity,
  );
  const periodByKey = new Map(periods.map((p) => [p.key, p]));
  const byId = new Map(ctx.resources.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const cells: GroundedAllocCell[] = [];
  const skipped: SkippedCell[] = [];

  for (const c of raw) {
    if (cells.length >= MAX_ALLOC_CELLS) break;
    const key = cellKey(c);
    if (seen.has(key)) {
      skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "duplicate" });
      continue;
    }
    seen.add(key);

    const resource = byId.get(c.resourceId);
    if (!resource) {
      skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "unknown-resource" });
      continue;
    }
    const period = periodByKey.get(c.periodKey);
    if (!period) {
      skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "out-of-window" });
      continue;
    }
    if (!Number.isFinite(c.hours) || c.hours < 0) {
      skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "bad-hours" });
      continue;
    }

    const capacityHours = periodCapacityHours(
      resource,
      period,
      absencesForResource(ctx.absences, resource),
      ctx.workdayHours,
      ctx.holidaySet,
    );

    let nextValue: number;
    let clamped = false;
    if (resource.utilizationMode === "percent") {
      if (capacityHours <= 0) {
        skipped.push({ resourceId: c.resourceId, periodKey: c.periodKey, reason: "no-capacity" });
        continue;
      }
      const pct = Math.round((c.hours / capacityHours) * 100);
      nextValue = Math.min(100, pct);
      clamped = pct > 100;
    } else {
      const hours = Math.round(c.hours * 100) / 100;
      nextValue = Math.min(HOURS_MAP_MAX, hours);
      clamped = hours > HOURS_MAP_MAX;
    }

    const currentValue = resource.utilization[c.periodKey] ?? 0;
    if (currentValue === nextValue) continue; // no-op — nothing to preview or write

    cells.push({
      resourceId: resource.id,
      resourceName: resourceLabel(resource),
      periodKey: c.periodKey,
      mode: resource.utilizationMode,
      currentValue,
      nextValue,
      hours: c.hours,
      capacityHours,
      clamped,
    });
  }

  return { cells, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/alloc-plan/alloc-plan.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0

If the August-2026 workday count in the capacity test is not 21, compute it from `workdaysInRange` and correct the expected numbers — the assertion's point is the ratio, not the calendar.

- [ ] **Step 5: Commit**

```bash
git add src/app/alloc-plan/alloc-plan.ts src/app/alloc-plan/alloc-plan.test.ts
git commit -F - <<'EOF'
feat(planning): ground AI allocation cells against the live workspace

Hallucinated resource ids and out-of-window or wrong-granularity period
keys are refused with a reason. Hours convert into each resource's own
storage unit, clamped to the sanitizer's own bounds so what the user
confirms is what persists, and a zero-capacity period is skipped rather
than written as 0 or 100.
EOF
```

---

## Task 7: Apply allocation cells purely

**Files:**
- Modify: `src/app/alloc-plan/alloc-plan.ts` (append)
- Modify: `src/app/alloc-plan/alloc-plan.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/app/alloc-plan/alloc-plan.test.ts`:

```ts
import { applyAllocationCells, type GroundedAllocCell } from "./alloc-plan";

function cell(over: Partial<GroundedAllocCell> = {}): GroundedAllocCell {
  return {
    resourceId: 1,
    resourceName: "First Last1",
    periodKey: "2026-08",
    mode: "hours",
    currentValue: 0,
    nextValue: 40,
    hours: 40,
    capacityHours: 168,
    clamped: false,
    ...over,
  };
}

describe("applyAllocationCells", () => {
  it("writes only the named cells and leaves the rest of the map alone", () => {
    const before = [
      resource(1, {
        utilizationMode: "hours",
        utilization: { "2026-08": 10, "2026-09": 99 },
      }),
    ];

    const { nextResources } = applyAllocationCells(before, [cell()], "2026-07-25T00:00:00.000Z");

    expect(nextResources[0]?.utilization).toEqual({ "2026-08": 40, "2026-09": 99 });
  });

  it("leaves untouched resources byte-identical", () => {
    const other = resource(2, { utilizationMode: "hours", utilization: { "2026-08": 5 } });
    const before = [resource(1, { utilizationMode: "hours", utilization: {} }), other];

    const { nextResources } = applyAllocationCells(before, [cell()], "2026-07-25T00:00:00.000Z");

    expect(nextResources[1]).toBe(other);
  });

  it("returns the pre-edit images an undo entry needs", () => {
    const original = resource(1, { utilizationMode: "hours", utilization: { "2026-08": 10 } });

    const { editedBefore } = applyAllocationCells([original], [cell()], "2026-07-25T00:00:00.000Z");

    expect(editedBefore).toEqual([original]);
    expect(editedBefore[0]?.utilization["2026-08"]).toBe(10);
  });

  it("stamps localModifiedAt only on changed resources", () => {
    const before = [resource(1, { utilizationMode: "hours", utilization: {} })];

    const { nextResources } = applyAllocationCells(before, [cell()], "2026-07-25T00:00:00.000Z");

    expect(nextResources[0]?.localModifiedAt).toBe("2026-07-25T00:00:00.000Z");
  });

  it("applies several cells for one resource in a single pass", () => {
    const before = [resource(1, { utilizationMode: "hours", utilization: {} })];

    const { nextResources, editedBefore } = applyAllocationCells(
      before,
      [cell(), cell({ periodKey: "2026-09", nextValue: 20 })],
      "2026-07-25T00:00:00.000Z",
    );

    expect(nextResources[0]?.utilization).toEqual({ "2026-08": 40, "2026-09": 20 });
    expect(editedBefore).toHaveLength(1);
  });

  it("does not mutate the input array or its resources", () => {
    const original = resource(1, { utilizationMode: "hours", utilization: { "2026-08": 10 } });
    const before = [original];

    applyAllocationCells(before, [cell()], "2026-07-25T00:00:00.000Z");

    expect(original.utilization).toEqual({ "2026-08": 10 });
    expect(before).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/alloc-plan/alloc-plan.test.ts`
Expected: FAIL — `applyAllocationCells is not exported`

- [ ] **Step 3: Append the implementation**

Append to `src/app/alloc-plan/alloc-plan.ts`:

```ts
export interface AllocApplyResult {
  /** The resource array after the write. */
  nextResources: Resource[];
  /** Pre-edit images of the resources whose utilization changed — the undo
   *  entry's `edited` payload. */
  editedBefore: Resource[];
}

/**
 * Apply grounded cells to the resource list, purely.
 *
 * SET, NAMED CELLS ONLY: exactly the (resource, period) pairs in `cells` are
 * written; every other period in the window keeps its value. The rejected
 * alternative — claiming the whole target window and zeroing what the proposal
 * did not name — is the period-ownership behaviour that silently zeroed
 * hand-entered figures in the timelog apply path.
 *
 * A resource whose cells all match what is already stored is returned by
 * reference, so the Turso dirty-table save (which detects changes by reference
 * equality) does not mark it dirty.
 */
export function applyAllocationCells(
  resources: readonly Resource[],
  cells: readonly GroundedAllocCell[],
  nowIso: string,
): AllocApplyResult {
  const byResource = new Map<number, GroundedAllocCell[]>();
  for (const c of cells) {
    const list = byResource.get(c.resourceId);
    if (list) list.push(c);
    else byResource.set(c.resourceId, [c]);
  }

  const editedBefore: Resource[] = [];
  const nextResources: Resource[] = [];
  for (const r of resources) {
    const list = byResource.get(r.id);
    if (!list || list.length === 0) {
      nextResources.push(r);
      continue;
    }
    const utilization = { ...r.utilization };
    let changed = false;
    for (const c of list) {
      if (utilization[c.periodKey] === c.nextValue) continue;
      utilization[c.periodKey] = c.nextValue;
      changed = true;
    }
    if (!changed) {
      nextResources.push(r);
      continue;
    }
    editedBefore.push(r);
    nextResources.push({ ...r, utilization, localModifiedAt: nowIso });
  }

  return { nextResources, editedBefore };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/alloc-plan/alloc-plan.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0

- [ ] **Step 5: Commit**

```bash
git add src/app/alloc-plan/alloc-plan.ts src/app/alloc-plan/alloc-plan.test.ts
git commit -F - <<'EOF'
feat(planning): pure apply for AI allocation cells

Writes only the named cells; every other period keeps its value. Returns
the pre-edit images the single undo entry needs, and hands back untouched
resources by reference so the dirty-table save stays accurate.
EOF
```

---

## Task 8: The forced Anthropic call

**Files:**
- Create: `src/app/alloc-plan-call.ts`
- Create: `src/app/alloc-plan-call.test.ts`

Mirrors `src/app/task-dedup-call.ts` exactly. `runForcedToolCall` (`ai-forced-call.ts:52`) throws `AiHttpError(status, errorType?, safeMessage?)` on a non-OK response — message is status-only — and returns the forced tool's raw `input`.

- [ ] **Step 1: Write the failing test**

Create `src/app/alloc-plan-call.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runAllocProposal } from "./alloc-plan-call";

const okResponse = (input: unknown) =>
  new Response(
    JSON.stringify({
      content: [{ type: "tool_use", name: "propose_allocations", input }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("runAllocProposal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed cells", async () => {
    vi.mocked(fetch).mockResolvedValue(
      okResponse({ cells: [{ resourceId: 1, periodKey: "2026-08", hours: 40 }] }),
    );

    const cells = await runAllocProposal("CTX", { apiKey: "sk-ant-x", model: "claude-x" });

    expect(cells).toEqual([{ resourceId: 1, periodKey: "2026-08", hours: 40 }]);
  });

  it("throws 'parse' on unusable tool output", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse({ nope: true }));

    await expect(
      runAllocProposal("CTX", { apiKey: "sk-ant-x", model: "claude-x" }),
    ).rejects.toThrow("parse");
  });

  it("never puts the api key in a thrown error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { type: "rate_limit_error" } }), { status: 429 }),
    );

    await expect(
      runAllocProposal("CTX", { apiKey: "sk-ant-SECRET", model: "claude-x" }),
    ).rejects.toThrow(/^(?!.*sk-ant-SECRET).*$/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/alloc-plan-call.test.ts`
Expected: FAIL — `Failed to resolve import "./alloc-plan-call"`

- [ ] **Step 3: Write the implementation**

Create `src/app/alloc-plan-call.ts`:

```ts
// src/app/alloc-plan-call.ts
//
// Non-hook single forced-tool Anthropic call for AI allocation planning.
// Mirrors task-dedup-call.ts: ONE request, tool_choice forced, NO agentic loop.
// Returns the RAW parsed cells — grounding against the live workspace happens in
// the caller (groundAllocationCells), never here.
//
// SECURITY: the shared runForcedToolCall envelope never logs or echoes the api
// key or the raw response body. Thrown errors carry only the HTTP status
// (AiHttpError, message status-only) or the token "parse" for malformed output.
import {
  PROPOSE_ALLOCATIONS_TOOL,
  buildAllocSystemPrompt,
  parseAllocationProposal,
  type RawAllocCell,
} from "./alloc-plan/alloc-plan";
import { runForcedToolCall } from "./ai-forced-call";

interface AiCreds {
  apiKey: string;
  model: string;
}

/** Run one forced propose_allocations call and return the raw parsed cells.
 *  Throws AiHttpError(status, errorType?, safeMessage?) on a non-OK response and
 *  Error("parse") on absent/malformed tool output. */
export async function runAllocProposal(
  context: string,
  ai: AiCreds,
  instruction: string,
  signal?: AbortSignal,
): Promise<RawAllocCell[]> {
  const input = await runForcedToolCall({
    apiKey: ai.apiKey,
    model: ai.model,
    system: buildAllocSystemPrompt(),
    tools: [PROPOSE_ALLOCATIONS_TOOL],
    toolName: PROPOSE_ALLOCATIONS_TOOL.name,
    messages: [{ role: "user", content: `${context}\n\nREQUEST: ${instruction}` }],
    maxTokens: 4096,
    signal,
  });
  const parsed = parseAllocationProposal(input);
  if (!parsed) throw new Error("parse");
  return parsed;
}
```

- [ ] **Step 4: Fix the test signature**

The test in Step 1 calls `runAllocProposal(context, creds)` but the implementation takes an `instruction` third argument. Update every call in `alloc-plan-call.test.ts` to pass an instruction:

```ts
await runAllocProposal("CTX", { apiKey: "sk-ant-x", model: "claude-x" }, "spread 200h over August");
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/alloc-plan-call.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/app/alloc-plan-call.ts src/app/alloc-plan-call.test.ts
git commit -F - <<'EOF'
feat(planning): forced tool call for allocation proposals

One request, tool_choice forced, no agentic loop. Grounding stays in the
caller; the key never reaches a log or a thrown error.
EOF
```

---

## Task 9: i18n strings + the new activity kind

**Files:**
- Modify: `src/app/activity-log.ts` (`ActivityKind` union ~:12-58, `ACTIVITY_KIND_TO_KEY` ~:160)
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts and curls double quotes in it. Patch it with a node UTF-8 write and verify afterwards.

- [ ] **Step 1: Add the activity kind**

In `src/app/activity-log.ts`, add to the `ActivityKind` union next to the other `ai.*` members:

```ts
  | "ai.allocationPlan"
```

and to `ACTIVITY_KIND_TO_KEY`:

```ts
  "ai.allocationPlan": "activityAiAllocationPlan",
```

- [ ] **Step 2: Add the EN strings**

In `src/app/i18n.ts`, add:

```ts
  activityAiAllocationPlan: "AI planned {0} allocation cells",
  allocPlan: "Plan with AI",
  allocPlanTitle: "Plan resource allocations with AI",
  allocPlanIntro:
    "Describe how the work should be distributed. Nothing is written until you confirm — every change is listed below first.",
  allocPlanInstructionLabel: "What should be planned?",
  allocPlanInstructionPlaceholder: "e.g. distribute 200 hours across the design role in August",
  allocPlanThinking: "Planning…",
  allocPlanPropose: "Propose",
  allocPlanCancel: "Cancel",
  allocPlanConfirm: "Apply selected",
  allocPlanInclude: "Include this change",
  allocPlanNoChanges: "No allocation changes were proposed.",
  allocPlanError: "Could not plan allocations.",
  allocPlanApplied: "Applied {0} allocation changes.",
  allocPlanClamped: "trimmed to the maximum",
  allocPlanSkippedTitle: "Not planned",
  allocPlanSkipUnknownResource: "unknown resource",
  allocPlanSkipOutOfWindow: "period outside the plan window",
  allocPlanSkipNoCapacity: "no capacity in that period",
  allocPlanSkipBadHours: "invalid hours",
  allocPlanSkipDuplicate: "duplicate cell",
```

Also add the release highlight key (used in Task 14):

```ts
  versionHighlight0201: "AI planning: read project health, plan allocations, set task dependencies.",
```

- [ ] **Step 3: Add the DE strings**

Write a node script and run it — do not use the Edit tool on `i18n.de.ts`. The file is CRLF, so the anchor must match `\r\n`.

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  activityUndo:";   // any existing key line; adjust if absent
const add = [
  "  activityAiAllocationPlan: \"KI hat {0} Planungszellen geplant\",",
  "  allocPlan: \"Mit KI planen\",",
  "  allocPlanTitle: \"Ressourcenplanung mit KI\",",
  "  allocPlanIntro: \"Beschreiben Sie, wie die Arbeit verteilt werden soll. Es wird nichts geschrieben, bis Sie best\\u00e4tigen \\u2014 jede \\u00c4nderung wird zuerst unten aufgef\\u00fchrt.\",",
  "  allocPlanInstructionLabel: \"Was soll geplant werden?\",",
  "  allocPlanInstructionPlaceholder: \"z. B. 200 Stunden im August auf die Rolle Design verteilen\",",
  "  allocPlanThinking: \"Planung l\\u00e4uft \\u2026\",",
  "  allocPlanPropose: \"Vorschlagen\",",
  "  allocPlanCancel: \"Abbrechen\",",
  "  allocPlanConfirm: \"Auswahl anwenden\",",
  "  allocPlanInclude: \"Diese \\u00c4nderung \\u00fcbernehmen\",",
  "  allocPlanNoChanges: \"Es wurden keine \\u00c4nderungen an der Planung vorgeschlagen.\",",
  "  allocPlanError: \"Planung konnte nicht erstellt werden.\",",
  "  allocPlanApplied: \"{0} Planungs\\u00e4nderungen angewendet.\",",
  "  allocPlanClamped: \"auf das Maximum gek\\u00fcrzt\",",
  "  allocPlanSkippedTitle: \"Nicht geplant\",",
  "  allocPlanSkipUnknownResource: \"unbekannte Ressource\",",
  "  allocPlanSkipOutOfWindow: \"Periode au\\u00dferhalb des Planungszeitraums\",",
  "  allocPlanSkipNoCapacity: \"keine Kapazit\\u00e4t in dieser Periode\",",
  "  allocPlanSkipBadHours: \"ung\\u00fcltige Stunden\",",
  "  allocPlanSkipDuplicate: \"doppelte Zelle\",",
  "  versionHighlight0201: \"KI-Planung: Projektstatus lesen, Auslastung planen, Aufgaben-Abh\\u00e4ngigkeiten setzen.\",",
].join("\r\n");
const i = s.indexOf(anchor);
if (i < 0) { console.error("anchor not found — pick an existing key line"); process.exit(1); }
s = s.slice(0, i) + add + "\r\n" + s.slice(i);
fs.writeFileSync(p, s, "utf8");
console.log("ok");
'
```

- [ ] **Step 4: Verify the German encoding**

Run: `npx vitest run src/app/i18n-encoding.test.ts`
Expected: PASS. This test bans ASCII substitutes (`fuer`, `druecken`) **and** `\uXXXX` escapes surviving into the source — if it fails on escapes, the node write produced literal escape sequences instead of characters; re-run writing real UTF-8 characters in the strings.

Run: `npx tsc --noEmit`
Expected: exit 0 — this is what enforces EN/DE key parity.

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-log.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(i18n): strings and activity kind for AI allocation planning
EOF
```

---

## Task 10: The preview/confirm modal

**Files:**
- Create: `src/app/alloc-plan-modal.tsx`

Presentational only — no state, no context, mirroring `task-dedup-modal.tsx`.

- [ ] **Step 1: Write the component**

Create `src/app/alloc-plan-modal.tsx`:

```tsx
"use client";

// Presentational preview/confirm modal for AI allocation planning. The caller
// (the resources-pane glue hook) owns the instruction text, the grounded cells
// and the selection; this component owns NO state and reaches into NO context.
// Nothing here mutates the workspace — Confirm calls back to the caller.
//
// Every proposed cell is itemized with its current and next value on purpose.
// Resource.utilization holds hand-entered planning figures, and a bare "N cells
// will change" count is exactly what made an earlier bulk apply unsafe.

import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { Button } from "./button";
import { Input } from "./form-controls";
import { cellKey, type GroundedAllocCell, type SkippedCell, type SkipReason } from "./alloc-plan/alloc-plan";

const SKIP_KEY: Record<SkipReason, Parameters<typeof t>[1]> = {
  "unknown-resource": "allocPlanSkipUnknownResource",
  "out-of-window": "allocPlanSkipOutOfWindow",
  "no-capacity": "allocPlanSkipNoCapacity",
  "bad-hours": "allocPlanSkipBadHours",
  duplicate: "allocPlanSkipDuplicate",
};

export interface AllocPlanModalProps {
  lang: Lang;
  open: boolean;
  /** "input" while collecting the instruction, "preview" once cells are back. */
  stage: "input" | "preview";
  instruction: string;
  onInstruction: (value: string) => void;
  onPropose: () => void;
  cells: readonly GroundedAllocCell[];
  skipped: readonly SkippedCell[];
  /** cellKey()s the user has selected to apply. */
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while proposing or applying (disables the controls). */
  busy: boolean;
}

function unitSuffix(mode: GroundedAllocCell["mode"]): string {
  return mode === "percent" ? "%" : "h";
}

export function AllocPlanModal({
  lang,
  open,
  stage,
  instruction,
  onInstruction,
  onPropose,
  cells,
  skipped,
  selected,
  onToggle,
  onConfirm,
  onCancel,
  busy,
}: AllocPlanModalProps) {
  const title = t(lang, "allocPlanTitle");
  const selectedCount = cells.reduce((n, c) => (selected.has(cellKey(c)) ? n + 1 : n), 0);

  return (
    <Modal open={open} onClose={onCancel} ariaLabel={title}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[620px] max-w-[95vw] flex-col rounded-xl border border-line bg-surface"
      >
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, "allocPlanIntro")}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <label className="block text-sm font-medium text-foreground" htmlFor="alloc-plan-instruction">
            {t(lang, "allocPlanInstructionLabel")}
          </label>
          <Input
            id="alloc-plan-instruction"
            className="mt-1 w-full"
            value={instruction}
            disabled={busy}
            aria-label={t(lang, "allocPlanInstructionLabel")}
            placeholder={t(lang, "allocPlanInstructionPlaceholder")}
            onChange={(e) => onInstruction(e.target.value)}
          />

          {stage === "preview" && (
            <ul className="mt-4 space-y-2">
              {cells.map((c) => {
                const key = cellKey(c);
                const on = selected.has(key);
                const unit = unitSuffix(c.mode);
                return (
                  <li key={key} className="rounded-md border border-line bg-surface-muted px-3 py-2">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={busy}
                        onChange={() => onToggle(key)}
                        aria-label={`${t(lang, "allocPlanInclude")} – ${c.resourceName} – ${c.periodKey}`}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-ui-dark-blue focus:ring-ui-green"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {c.resourceName} · {c.periodKey}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {c.currentValue}
                          {unit} → {c.nextValue}
                          {unit}
                          {c.clamped ? ` (${t(lang, "allocPlanClamped")})` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {stage === "preview" && skipped.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                {t(lang, "allocPlanSkippedTitle")}
              </h3>
              <ul className="mt-1 space-y-1">
                {skipped.map((s) => (
                  <li key={`${s.resourceId}:${s.periodKey}:${s.reason}`} className="text-xs text-muted-foreground">
                    #{s.resourceId} · {s.periodKey} — {t(lang, SKIP_KEY[s.reason])}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {t(lang, "allocPlanCancel")}
          </Button>
          {stage === "input" ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onPropose}
              disabled={busy || !instruction.trim()}
            >
              {busy ? t(lang, "allocPlanThinking") : t(lang, "allocPlanPropose")}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={busy || selectedCount === 0}
            >
              {t(lang, "allocPlanConfirm")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

If `Input` does not accept `id` / `placeholder` / `aria-label` passthrough (check `form-controls.tsx`), use a bare `<input>` with the same classes as the other modal inputs — but keep the `aria-label`: Resources is in the axe `A11Y_VIEWS` list and a placeholder is not an accessible name.

If `Parameters<typeof t>[1]` does not resolve to the translation-key type, import the key type directly from `./i18n` and use it in `SKIP_KEY`.

- [ ] **Step 3: Commit**

```bash
git add src/app/alloc-plan-modal.tsx
git commit -F - <<'EOF'
feat(planning): preview/confirm modal for AI allocation planning

Every proposed cell is itemized with current and next value and its own
checkbox; skipped cells are listed with the reason they were refused.
EOF
```

---

## Task 11: The glue hook

**Files:**
- Create: `src/app/use-alloc-plan.tsx`
- Create: `src/app/use-alloc-plan.test.tsx`
- Verify: `vitest.config.ts` (no change needed — `src/app/**/*.tsx` is already excluded from coverage)

- [ ] **Step 1: Write the failing test**

Create `src/app/use-alloc-plan.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAllocPlan, type AllocPlanDeps } from "./use-alloc-plan";
import { type Resource } from "./types";

vi.mock("./alloc-plan-call", () => ({
  runAllocProposal: vi.fn(),
}));
vi.mock("./toast-context", () => ({
  useToastContext: () => vi.fn(),
}));

import { runAllocProposal } from "./alloc-plan-call";

function baseDeps(over: Partial<AllocPlanDeps> = {}): AllocPlanDeps {
  const resources = [
    {
      id: 1,
      firstName: "Ada",
      lastName: "Lovelace",
      roleId: null,
      utilizationMode: "hours",
      utilization: {},
    } as Resource,
  ];
  return {
    settings: {
      ai: { enabled: true, apiKey: "sk-ant-x", model: "claude-x" },
    } as AllocPlanDeps["settings"],
    isPopout: false,
    lang: "en-US",
    resources,
    setResources: vi.fn(),
    roles: [],
    disciplines: [],
    grades: [],
    plan: { startDate: "2026-08-01", endDate: "2026-09-30", granularity: "month", currency: "EUR" },
    absences: [],
    workdayHours: 8,
    holidaySet: new Set<string>(),
    ...over,
  };
}

describe("useAllocPlan", () => {
  it("renders no button in a popout", () => {
    const { result } = renderHook(() => useAllocPlan(baseDeps({ isPopout: true })));

    expect(result.current.button).toBeNull();
  });

  it("discards a proposal that resolves after cancel", async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.mocked(runAllocProposal).mockReturnValue(
      new Promise((r) => {
        resolve = r as (v: unknown) => void;
      }) as ReturnType<typeof runAllocProposal>,
    );
    const deps = baseDeps();
    const { result } = renderHook(() => useAllocPlan(deps));

    act(() => result.current.open());
    act(() => result.current.setInstruction("plan august"));
    await act(async () => {
      void result.current.propose();
    });
    act(() => result.current.cancel());
    await act(async () => {
      resolve([{ resourceId: 1, periodKey: "2026-08", hours: 40 }]);
    });

    expect(result.current.stage).toBe("idle");
    expect(deps.setResources).not.toHaveBeenCalled();
  });

  it("applies only the selected cells and records one undo entry", async () => {
    vi.mocked(runAllocProposal).mockResolvedValue([
      { resourceId: 1, periodKey: "2026-08", hours: 40 },
      { resourceId: 1, periodKey: "2026-09", hours: 80 },
    ]);
    const capture = vi.fn();
    const deps = baseDeps({ capture });
    const { result } = renderHook(() => useAllocPlan(deps));

    act(() => result.current.open());
    act(() => result.current.setInstruction("plan august and september"));
    await act(async () => {
      await result.current.propose();
    });
    act(() => result.current.toggle("1:2026-09"));   // deselect september
    act(() => result.current.confirm());

    expect(deps.setResources).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
    const [updater] = vi.mocked(deps.setResources).mock.calls[0] as [
      (prev: readonly Resource[]) => readonly Resource[],
    ];
    const next = updater(deps.resources);
    expect(next[0]?.utilization).toEqual({ "2026-08": 40 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-alloc-plan.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-alloc-plan"`

- [ ] **Step 3: Write the hook**

Create `src/app/use-alloc-plan.tsx`:

```tsx
"use client";

// Resources-pane glue for AI allocation planning. Owns the
// idle→thinking→preview→applying state machine plus the toolbar trigger and the
// review modal element, so resources-panel stays lean. Plan-then-apply: the
// single forced Anthropic call PROPOSES cells but NOTHING mutates the workspace
// until the user confirms. Pure logic (grounding + apply) lives in
// ./alloc-plan/alloc-plan and is unit-tested there; this file is render glue,
// excluded from the coverage gate (src/app/**/*.tsx).
//
// SECURITY: the api key is read from the in-memory hydrated settings and passed
// straight to the call; it is never logged. Model output is UNTRUSTED and is
// re-grounded against the LIVE resources and plan window
// (groundAllocationCells) before it can be shown or applied.

import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useRef, useState } from "react";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { type Settings, aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import {
  type Absence,
  type Discipline,
  type Grade,
  type Resource,
  type ResourcePlan,
  type Role,
} from "./types";
import { type ActivityKind } from "./activity-log";
import { type UndoStackApi } from "./undo/use-undo-stack";
import { useToastContext } from "./toast-context";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { runAllocProposal } from "./alloc-plan-call";
import {
  applyAllocationCells,
  buildAllocContext,
  cellKey,
  groundAllocationCells,
  type GroundedAllocCell,
  type SkippedCell,
} from "./alloc-plan/alloc-plan";
import { AllocPlanModal } from "./alloc-plan-modal";
import { INTERACTIVE } from "./interaction-styles";

type Stage = "idle" | "input" | "thinking" | "preview" | "applying";

export interface AllocPlanDeps {
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  resources: readonly Resource[];
  setResources: Dispatch<SetStateAction<readonly Resource[]>>;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  /** Single-entry undo capture for the edited resources. */
  capture?: UndoStackApi["capture"];
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export interface AllocPlan {
  button: ReactNode;
  modal: ReactNode;
  // Exposed for tests; the panel only uses button + modal.
  stage: Stage;
  open: () => void;
  cancel: () => void;
  setInstruction: (v: string) => void;
  propose: () => Promise<void>;
  toggle: (key: string) => void;
  confirm: () => void;
}

const TRIGGER_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50";

export function useAllocPlan(deps: AllocPlanDeps): AllocPlan {
  const showToast = useToastContext();

  const [stage, setStage] = useState<Stage>("idle");
  const [instruction, setInstruction] = useState("");
  const [cells, setCells] = useState<readonly GroundedAllocCell[]>([]);
  const [skipped, setSkipped] = useState<readonly SkippedCell[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Monotonic request generation: a slow proposal that resolves after cancel /
  // a new open is discarded (can't land a stale proposal or a stale error).
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const apiKey = aiKeyIfEnabled(deps.settings.ai);
  const enabled =
    isAiEnabled(deps.settings.ai) && !deps.isPopout && !!apiKey.trim() && deps.resources.length > 0;

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    setStage("idle");
    setCells([]);
    setSkipped([]);
    setSelected(new Set());
    setInstruction("");
  }, []);

  const open = useCallback(() => {
    abortRef.current?.abort();
    reqIdRef.current++;
    setCells([]);
    setSkipped([]);
    setSelected(new Set());
    setStage("input");
  }, []);

  const propose = useCallback(async () => {
    if (!enabled || !instruction.trim()) return;
    const reqId = ++reqIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setStage("thinking");
    try {
      const context = buildAllocContext({
        resources: deps.resources,
        roles: deps.roles,
        disciplines: deps.disciplines,
        grades: deps.grades,
        plan: deps.plan,
        absences: deps.absences,
        workdayHours: deps.workdayHours,
        holidaySet: deps.holidaySet,
      });
      const raw = await runAllocProposal(
        context,
        { apiKey, model: deps.settings.ai.model },
        instruction.trim(),
        controller.signal,
      );
      if (reqId !== reqIdRef.current) return; // superseded — discard
      // Re-ground UNTRUSTED model output against the LIVE workspace before it
      // can be shown or applied.
      const grounded = groundAllocationCells(raw, {
        resources: deps.resources,
        plan: deps.plan,
        absences: deps.absences,
        workdayHours: deps.workdayHours,
        holidaySet: deps.holidaySet,
      });
      if (grounded.cells.length === 0) {
        showToast("info", t(deps.lang, "allocPlanNoChanges"));
        setSkipped(grounded.skipped);
        setStage("input");
        return;
      }
      setCells(grounded.cells);
      setSkipped(grounded.skipped);
      setSelected(new Set(grounded.cells.map(cellKey)));
      setStage("preview");
    } catch (e) {
      if (reqId !== reqIdRef.current) return; // stale failure — ignore
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") {
        showToast("error", t(deps.lang, "aiUsageLimitReached"));
      } else if (e instanceof AiHttpError && e.safeMessage) {
        showToast("error", e.safeMessage);
      } else {
        showToast("error", t(deps.lang, "allocPlanError"));
      }
      setStage("input");
    }
  }, [enabled, instruction, apiKey, deps, showToast]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const confirm = useCallback(() => {
    if (stage !== "preview") return;
    const chosen = cells.filter((c) => selected.has(cellKey(c)));
    if (chosen.length === 0) return;
    setStage("applying");
    const nowIso = new Date().toISOString();
    // ONE functional write + ONE undo entry covering every edited resource.
    let editedBefore: readonly Resource[] = [];
    deps.setResources((prev) => {
      const result = applyAllocationCells(prev, chosen, nowIso);
      editedBefore = result.editedBefore;
      return result.nextResources;
    });
    deps.capture?.({
      setter: deps.setResources,
      kind: "bulk.edit",
      edited: editedBefore,
      fromArray: deps.resources,
      entityKey: "resource",
    });
    deps.logActivity?.("ai.allocationPlan", chosen.length);
    showToast("info", t(deps.lang, "allocPlanApplied", chosen.length));
    cancel();
  }, [stage, cells, selected, deps, showToast, cancel]);

  const button = enabled ? (
    <button
      type="button"
      onClick={open}
      disabled={stage === "thinking" || stage === "applying"}
      aria-label={t(deps.lang, "allocPlanTitle")}
      title={t(deps.lang, "allocPlanTitle")}
      className={`${TRIGGER_CLASS} ${INTERACTIVE}`}
    >
      <SparklesIcon
        aria-hidden="true"
        className={`h-4 w-4 ${stage === "thinking" ? "animate-spin" : ""}`}
      />
      {stage === "thinking" ? t(deps.lang, "allocPlanThinking") : t(deps.lang, "allocPlan")}
    </button>
  ) : null;

  const modal =
    stage === "idle" ? null : (
      <AllocPlanModal
        lang={deps.lang}
        open
        stage={stage === "preview" || stage === "applying" ? "preview" : "input"}
        instruction={instruction}
        onInstruction={setInstruction}
        onPropose={() => void propose()}
        cells={cells}
        skipped={skipped}
        selected={selected}
        onToggle={toggle}
        onConfirm={confirm}
        onCancel={cancel}
        busy={stage === "thinking" || stage === "applying"}
      />
    );

  return { button, modal, stage, open, cancel, setInstruction, propose, toggle, confirm };
}
```

★ The `editedBefore` capture reads a value assigned **inside** the `setResources` updater. React may run that updater lazily, so read it back only after the setter returns — which is what this code does, and it is why the undo capture is a separate statement rather than being folded into the updater. If the test shows `editedBefore` empty, compute the apply result **before** the setter instead and pass `() => result.nextResources` to the setter; do not read a variable that the updater has not written yet.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-alloc-plan.test.tsx`
Expected: PASS, 3 tests

The `editedBefore` caveat above is likely to bite here. If the undo `edited` payload comes back empty, restructure `confirm` to:

```ts
    const before = deps.resources;
    const result = applyAllocationCells(before, chosen, nowIso);
    deps.setResources(() => result.nextResources);
    deps.capture?.({
      setter: deps.setResources,
      kind: "bulk.edit",
      edited: result.editedBefore,
      fromArray: before,
      entityKey: "resource",
    });
```

which is exactly what `use-tasks-dedup.tsx:138-155` does. Prefer this form.

- [ ] **Step 5: Typecheck + confirm the coverage exclusion**

Run: `npx tsc --noEmit`
Expected: exit 0

Confirm `vitest.config.ts` still lists `"src/app/**/*.tsx"` in `coverage.exclude` — it does, so `use-alloc-plan.tsx` needs no new entry. Do **not** add one.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-alloc-plan.tsx src/app/use-alloc-plan.test.tsx
git commit -F - <<'EOF'
feat(planning): glue hook for AI allocation planning

Propose-preview-confirm with a nonce and abort guard so a slow billed
call cannot land after cancel. Confirm writes once through a functional
setter and records a single undo entry for every edited resource.
EOF
```

---

## Task 12: Mount the button in the Resources planning toolbar

**Files:**
- Modify: `src/app/resources-panel-toolbar.tsx` (`PlanningToolbarProps` :19-33, JSX :82-83)
- Modify: `src/app/resources-panel.tsx` (props :59-109, `<PlanningToolbar>` :478-491)
- Modify: `src/app/workspace-section.tsx` (`<ResourcesPanel>` :506-544)

`PlanningToolbar` renders only under `{view === "planning"}` (`resources-panel.tsx:476`), so a button added there is planning-only by construction. The Print / reset-columns / reset-size group arrives as the opaque `headerActions` node rendered inside `<div className="ml-auto">` at `resources-panel-toolbar.tsx:83` — inserting before it satisfies the toolbar-order convention.

- [ ] **Step 1: Add the toolbar prop**

In `src/app/resources-panel-toolbar.tsx`, add to `PlanningToolbarProps` (after `hideExternalToggle`):

```ts
  /** AI planning trigger, or null when AI is off / this is a popout. */
  aiPlanButton?: ReactNode;
```

Destructure it in the component signature, and render it between `{hideExternalToggle}` and the trailing group:

```tsx
        {hideExternalToggle}
        {aiPlanButton}
        <div className="ml-auto">{headerActions}</div>
```

- [ ] **Step 2: Mount the hook in the panel**

In `src/app/resources-panel.tsx`:

Add the imports:

```ts
import { useWorkspace } from "./workspace-context";
import { useAllocPlan } from "./use-alloc-plan";
```

Add two props to the local `interface Props`:

```ts
  /** Single-entry undo capture for an AI allocation write. */
  onCaptureUndo?: import("./undo/use-undo-stack").UndoStackApi["capture"];
  logActivity?: (kind: import("./activity-log").ActivityKind, ...args: (string | number)[]) => void;
```

Inside the component (the panel already calls `useSettings()` at :192 — reuse that `settings`):

```ts
  const { setResources, disciplines, grades } = useWorkspace();
  const allocPlan = useAllocPlan({
    settings,
    isPopout: isPopout ?? false,
    lang,
    resources,
    setResources,
    roles,
    disciplines,
    grades,
    plan,
    absences,
    workdayHours,
    holidaySet,
    capture: onCaptureUndo,
    logActivity,
  });
```

Pass the button to the toolbar:

```tsx
            hideExternalToggle={hideExternalToggle}
            aiPlanButton={view === "planning" ? allocPlan.button : null}
```

and render the modal inside the `{view === "planning" && ( … )}` block, after `<PlanningTable … />`:

```tsx
            {allocPlan.modal}
```

- [ ] **Step 3: Thread the two new props from workspace-section**

In `src/app/workspace-section.tsx`, the `<ResourcesPanel …>` element at :506-544 — add:

```tsx
              onCaptureUndo={onCaptureUndo}
              logActivity={logActivity}
```

Both are already destructured in that file (`onCaptureUndo` at :110, `logActivity` at :126) and already exist on `WorkspaceSectionProps` (`workspace-section-types.ts:144` and `:167`) — they are currently forwarded only to `MilestonesPanel`. No new props on `WorkspaceSectionProps` are needed; verify this before adding any.

- [ ] **Step 4: Run the suites**

Run: `npx vitest run src/app/resources-panel.test.tsx src/app/workspace-section.test.tsx`
Expected: PASS. If a `workspace-section` test stubs `useSettings()` with `mockReturnValueOnce`, a second consumer will break it — convert the stub to `mockReturnValue` (this exact trap bit R2).

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0 both. Lint runs with `--max-warnings=0`: an unused import or destructured variable is fatal.

- [ ] **Step 5: Check the axe gate on Resources**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"`
Expected: PASS. The new button carries an `aria-label`; the modal's checkboxes carry row-unique labels (`Include this change – <name> – <period>`). The unit suite never runs Playwright, so an axe regression here would surface only in CI.

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-panel-toolbar.tsx src/app/resources-panel.tsx src/app/workspace-section.tsx
git commit -F - <<'EOF'
feat(planning): mount the Plan-with-AI button in the planning toolbar

Sits before the trailing Print / reset group per the toolbar-order
convention, and only on the planning sub-tab. Undo capture and activity
logging reach the pane through the props workspace-section already holds.
EOF
```

---

## Task 13: The `list_allocations` read tool

**Files:**
- Modify: `src/app/alloc-plan/alloc-plan.ts` (append the payload builder)
- Modify: `src/app/alloc-plan/alloc-plan.test.ts` (append)
- Modify: `src/app/chat-tool-defs.ts`, `src/app/chat-tools.ts`, `src/app/use-chat-dispatcher.ts`, `src/app/task-manager.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/alloc-plan/alloc-plan.test.ts`:

```ts
import { ALLOC_TOOL_MAX_CELLS, buildAllocationsSnapshot } from "./alloc-plan";

describe("buildAllocationsSnapshot", () => {
  it("emits the plan window, granularity and only non-zero cells", () => {
    const snap = buildAllocationsSnapshot({
      resources: [
        resource(1, { utilizationMode: "hours", utilization: { "2026-08": 40, "2026-09": 0 } }),
        resource(2, { utilizationMode: "percent", utilization: {} }),
      ],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    expect(snap.granularity).toBe("month");
    expect(snap.periods).toEqual(["2026-08", "2026-09"]);
    expect(snap.truncated).toBe(false);
    expect(snap.resources).toHaveLength(2);
    expect(snap.resources[0]?.cells).toHaveLength(1);
    expect(snap.resources[0]?.cells[0]).toMatchObject({ periodKey: "2026-08", value: 40, unit: "hours", hours: 40 });
    expect(snap.resources[1]?.cells).toEqual([]);
  });

  it("reports the hours a percentage stands for", () => {
    const snap = buildAllocationsSnapshot({
      resources: [resource(1, { utilizationMode: "percent", utilization: { "2026-08": 50 } })],
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    const cell = snap.resources[0]?.cells[0];
    expect(cell?.unit).toBe("percent");
    expect(cell?.value).toBe(50);
    expect(cell?.hours).toBe(Math.round(cell!.capacityHours * 0.5));
  });

  it("caps the emitted cells and flags truncation", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      resource(i + 1, {
        utilizationMode: "hours",
        utilization: { "2026-08": 1, "2026-09": 1 },
      }),
    );

    const snap = buildAllocationsSnapshot({
      resources: many,
      plan,
      absences: [],
      workdayHours: 8,
      holidaySet: new Set<string>(),
    });

    const total = snap.resources.reduce((n, r) => n + r.cells.length, 0);
    expect(total).toBeLessThanOrEqual(ALLOC_TOOL_MAX_CELLS);
    expect(snap.truncated).toBe(120 > ALLOC_TOOL_MAX_CELLS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/alloc-plan/alloc-plan.test.ts`
Expected: FAIL — `buildAllocationsSnapshot is not exported`

- [ ] **Step 3: Append the payload builder**

Append to `src/app/alloc-plan/alloc-plan.ts`:

```ts
/** Bound on how many allocation cells the read tool will emit (token budget). */
export const ALLOC_TOOL_MAX_CELLS = 500;

export interface AllocationsSnapshotCell {
  periodKey: string;
  /** The stored value, in this resource's own unit. */
  value: number;
  unit: Resource["utilizationMode"];
  /** What that value means in hours, so the model can answer in hours. */
  hours: number;
  capacityHours: number;
}

export interface AllocationsSnapshotResource {
  id: number;
  name: string;
  roleId: number | null;
  unit: Resource["utilizationMode"];
  cells: AllocationsSnapshotCell[];
}

export interface AllocationsSnapshot {
  planStartDate: string;
  planEndDate: string;
  granularity: ResourcePlan["granularity"];
  periods: string[];
  resources: AllocationsSnapshotResource[];
  /** True when the cell cap was hit and some cells were omitted. */
  truncated: boolean;
}

export interface AllocationsSnapshotArgs {
  resources: readonly Resource[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
}

/**
 * Read-only projection of the planner grid for the `list_allocations` tool.
 * Emits only NON-ZERO cells — a full grid is resources × periods and would
 * dominate the chat transcript — and reports both the stored value and what it
 * means in hours, so the assistant can answer in hours whatever the storage
 * unit is.
 */
export function buildAllocationsSnapshot(args: AllocationsSnapshotArgs): AllocationsSnapshot {
  const periods = generatePeriods(args.plan.startDate, args.plan.endDate, args.plan.granularity);
  let emitted = 0;
  let truncated = false;
  const resources: AllocationsSnapshotResource[] = [];

  for (const r of args.resources) {
    const abs = absencesForResource(args.absences, r);
    const cells: AllocationsSnapshotCell[] = [];
    for (const p of periods) {
      const value = r.utilization[p.key] ?? 0;
      if (value === 0) continue;
      if (emitted >= ALLOC_TOOL_MAX_CELLS) {
        truncated = true;
        break;
      }
      // ★★ availableCapacityHours, NOT periodCapacityHours — the latter applies the
      // resource's own stored utilization and so reports "already allocated", which
      // reads as zero capacity for anyone unallocated. See the spec's corrected note.
      const capacityHours = availableCapacityHours(r, p, abs, args.workdayHours, args.holidaySet);
      const hours =
        r.utilizationMode === "percent" ? Math.round((value / 100) * capacityHours) : value;
      cells.push({
        periodKey: p.key,
        value,
        unit: r.utilizationMode,
        hours,
        capacityHours: Math.round(capacityHours),
      });
      emitted++;
    }
    resources.push({
      id: r.id,
      name: resourceLabel(r),
      roleId: r.roleId,
      unit: r.utilizationMode,
      cells,
    });
  }

  return {
    planStartDate: args.plan.startDate,
    planEndDate: args.plan.endDate,
    granularity: args.plan.granularity,
    periods: periods.map((p) => p.key),
    resources,
    truncated,
  };
}
```

- [ ] **Step 4: Add the tool, the dispatcher method and the getter**

`src/app/chat-tool-defs.ts` — add to `TOOL_DEFS` beside `list_resources`:

```ts
  {
    name: "list_allocations",
    description:
      "Read the resource planning grid: the plan window, its granularity, the valid period keys, and each resource's planned load per period. Each cell reports the stored value with its unit (percent or hours), what that means in hours, and the capacity available in that period. Only non-zero cells are listed; `truncated` is true when some were omitted. Read-only — planning changes are made in the app's Plan-with-AI review, not from chat.",
    input_schema: { type: "object", properties: {} },
  },
```

`src/app/chat-tools.ts` — import and add the method + case:

```ts
import { type AllocationsSnapshot } from "./alloc-plan/alloc-plan";
```
```ts
  listAllocations(): AllocationsSnapshot;
```
```ts
    case "list_allocations":
      return d.listAllocations();
```

`src/app/use-chat-dispatcher.ts` — one more getter arg, ref and method:

```ts
  /** Live planner-grid payload. Un-memoized getter, read through a ref. */
  getAllocationsSnapshot: () => AllocationsSnapshot;
```
```ts
  const getAllocationsSnapshotRef = useRef(args.getAllocationsSnapshot);
  useEffect(() => {
    getAllocationsSnapshotRef.current = args.getAllocationsSnapshot;
  }, [args.getAllocationsSnapshot]);
```
```ts
      listAllocations: () => getAllocationsSnapshotRef.current(),
```

`src/app/task-manager.tsx` — build the getter beside `getBudgetRollup` and pass it:

```ts
  const getAllocationsSnapshot = () =>
    buildAllocationsSnapshot({
      resources,
      plan,
      absences,
      workdayHours: settings.resources.workdayHours,
      holidaySet,
    });
```
```ts
    getAllocationsSnapshot,
```

- [ ] **Step 5: Run the suites**

Run: `npx vitest run src/app/alloc-plan/alloc-plan.test.ts src/app/chat-tools.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/app/alloc-plan/alloc-plan.ts src/app/alloc-plan/alloc-plan.test.ts src/app/chat-tool-defs.ts src/app/chat-tools.ts src/app/use-chat-dispatcher.ts src/app/task-manager.tsx
git commit -F - <<'EOF'
feat(ai): add the list_allocations read tool

Gives the assistant conversational reach over the planner grid without a
chat write path: every cell reports its stored value, what it means in
hours, and the capacity behind it. Writes stay behind the review modal.
EOF
```

---

## Task 14: Version bump, changelog and highlights

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `src/app/i18n.ts` (`APP_HIGHLIGHT_KEYS`)

- [ ] **Step 1: Pick an unused codename**

Run: `grep -oE '"[A-Z][a-z]+"' CHANGELOG.md | sort -u`
Pick a science-fiction author surname that does **not** appear. Codenames must be unique per version block.

- [ ] **Step 2: Bump the version**

In `src/app/version.ts`:

```ts
export const APP_VERSION = "0.201.0";
```
```ts
export const APP_MILESTONE = "<ChosenName>";
```

- [ ] **Step 3: Append the highlight key**

In `src/app/i18n.ts`, add `"versionHighlight0201"` to `APP_HIGHLIGHT_KEYS`. The EN and DE strings were added in Task 9 — verify both exist.

- [ ] **Step 4: Write the changelog entry**

Prepend to `CHANGELOG.md`, matching the surrounding entry format:

```markdown
## 0.201.0 "<ChosenName>" — 2026-07-25

### AI planning & structure tools

- **`get_dashboard_snapshot`** — the assistant can read the project's live RAG ratings (with
  override flags), completion progress, earned-value metrics and the budget rollup. When the cost
  basis is unsound the money figures are `null` with the reason attached, never `0`.
- **Plan with AI** (Resources → Planning) — describe how work should be distributed and review every
  proposed allocation cell, with its current and next value, before anything is written. Hours are
  converted into each resource's own storage unit against real capacity; a period with no capacity is
  refused rather than guessed. Only the cells you approve are written, and the whole apply is one
  undo entry.
- **`list_allocations`** — read-only view of the planner grid, reporting each cell in both its stored
  unit and hours.
- **`set_task_dependencies`** — set FS/SS/FF/SF predecessor links from chat, with cycle protection.
  Refused links are reported back rather than silently dropped.
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run src/app/version.test.ts`
Expected: exit 0, PASS (if a version test exists; skip if not)

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts CHANGELOG.md
git commit -F - <<'EOF'
chore(release): 0.201.0

AI planning and structure tools: dashboard snapshot read tool, AI
allocation planning with a per-cell review, list_allocations, and
set_task_dependencies with cycle protection.
EOF
```

---

## Task 15: Full gate run

**Files:** none — verification only.

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: exit 0. CI uses `--max-warnings=0`, so an unused import or a `react-hooks/exhaustive-deps` warning is fatal. If a `useMemo`/`useCallback` dep array contains an `obj.member` expression, hoist it to a scalar local first.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. This is also what enforces EN/DE i18n key parity. Note that `next build` does not typecheck test files — this command is the only gate that does.

- [ ] **Step 3: Unit tests + coverage**

Run: `npm run test:run`
Expected: PASS. Coverage floors are global lines 92 / functions 91 / branches 80 / statements 89. The three new `.ts` engines are gated; `use-alloc-plan.tsx` and `alloc-plan-modal.tsx` are not (`src/app/**/*.tsx` is excluded).

- [ ] **Step 4: Duplication gate**

Run: `npm run dup:check`
Expected: exit 0. `alloc-plan-call.ts` / `use-alloc-plan.tsx` / `alloc-plan-modal.tsx` mirror their dedup counterparts closely. If jscpd flags a clone, extract the shared shape rather than paraphrasing it — but do not merge the two state machines: their phases and payloads differ.

- [ ] **Step 5: File-size ratchet**

Run: `npm run size:check`
Expected: exit 0. `use-chat-dispatcher.ts` started at 712 lines and gained three methods plus imports; if it now exceeds 800, stop and report — a split is a decision to raise, not to make silently.

- [ ] **Step 6: a11y**

Run: `PORT=3100 npm run dev` in the background, then
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"`, then `PORT=3100 npm run stop`.
Expected: PASS.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 8: Byte-check the working tree**

Run: `git diff --stat` and confirm no file shows as `Bin`. A binary-looking diff on a text file means the Edit tool wrote a NUL byte — find and fix it before committing.

- [ ] **Step 9: Report and stop**

Report the gate results. **Do not push, open an MR, or merge** — those require an explicit instruction.

Raise the deferred item now: **`optimize_wbs` (spec §5)** — is it a tool at all, or a prompt affordance over `create_task` / `update_task` plus the inline Ask-Claude editor? It was scoped out of this release deliberately and is the last open question from the roadmap's Release 4.

---

## Self-review notes

**Spec coverage:** §1 → Tasks 1-2. §2 → Tasks 5-8, 10-13 (engine, call, i18n, modal, hook, mount, read tool). §3 → Tasks 3-4. §4 cross-cutting → Tasks 9, 14, 15. §5 deferred → surfaced in Task 15 Step 9. §6 known gaps → no tasks by design (documented, not fixed).

**Known soft spots the implementer must resolve against real code, not guess:**
- `workspaceHasPlan` in Task 2 Step 6 — reuse the dashboard's existing budget-gating expression; do not invent a second rule.
- `Role.disciplineId` / `Role.gradeId` field names in Task 5 `roleLabelOf`.
- The August-2026 capacity numbers in Task 6 — derive them, don't trust the comment.
- The `editedBefore` closure in Task 11 — prefer the `use-tasks-dedup.tsx` form shown in Step 4.
- Whether `wouldCreateDependencyCycle` is re-exported from the `./sanitize` barrel (Task 3 Step 5).
