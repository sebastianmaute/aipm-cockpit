# Release 4 — AI planning & structure tools

Date: 2026-07-25
Target version: **0.201.0** (codename TBD at release time — verify unused via `CHANGELOG.md` grep)
Predecessor: R3 Dashboard, 0.200.0 "Kadrey" (MR !320)
Roadmap: `2026-07-24-multi-surface-feature-roadmap-design.md` §Release 4

---

## Scope decision

The roadmap's R4 carried four items. This release ships **three**:

| Item | Status |
|---|---|
| 4.1 `get_dashboard_snapshot` — read-only RAG + budget/cost | **IN** |
| 4.2 AI allocation planning (distribute hours) | **IN** |
| 4.3a `set_task_dependencies` — FS/FF/SS/SF links | **IN** |
| 4.3b `optimize_wbs` — propose a work-breakdown regrouping | **DEFERRED** (see §5) |

Rationale: 4.1 and 4.3a are crisp and mechanical, 4.2 is the headline user-facing ask, and 4.3b is
under-specified in a way that invites scope drift — "extrapolate / refine / optimize the work
breakdown" overlaps substantially with what `create_task` / `update_task` and the existing inline
Ask-Claude editor already do.

## Grounding corrections to the roadmap spec

The roadmap was written from `AGENTS.md`. Three of its R4 claims are wrong against the current tree
(the same failure mode that hit R1 on 3 of 5 slices and R3 on 3 requirements):

1. **The dispatcher can't see the data 4.1 needs.** `use-chat-dispatcher.ts:77-92` destructures only
   `tasks/raid/changes/milestones/stakeholders/resources/insights` from `useWorkspace()`. It has no
   `budgets`, `plan`, `roles`, `absences`, `status`, and the activity log isn't in workspace context
   at all (`useActivityLog()` lives in `task-manager.tsx:204`). Additionally `computeDashboard` calls
   `computeBudgetReport` **without** the `tasks` argument (`dashboard.ts:302-304`), so `earnedValue`
   and `costPerformanceIndex` inside `DashboardModel` are always `null`. Real EV/CPI requires a
   second, task-aware `computeBudgetReport` call.

2. **There is no "resource-planner allocation" entity.** A planner allocation is a key in
   `Resource.utilization: Record<periodKey, number>` (`types.ts:526-552`), whose **unit depends on
   that resource's own `utilizationMode: "percent" | "hours"`**. `handleSetUtilization`
   (`use-resource-planner.ts:908-920`) writes one resource × one period per call, applies **no
   clamping**, and captures **no undo**. Cells are editable only at `plan.granularity`; a key at the
   wrong granularity is silently dropped by `PERIOD_KEY_RE` on the next round-trip
   (`sanitize-entities.ts:193`). This is a different thing from `BucketAllocation` /
   `DisciplineAllocation`, which are budget-side and keyed by `roleId` / `disciplineId`.

3. **The reusable preview engine cannot carry dependencies.** `EditPlan.updates` is
   `{field, before, after}` — **strings** (`inline-ai-edit/plan.ts:13`); `str()` flattens arrays with
   `join(", ")` and `coerce()` reverses that by splitting on commas
   (`use-inline-entity-edit.ts:193-197`). An array-of-objects diff has no representation there.

One roadmap claim proved *cheaper* than written: `listTasks: () => tasksRef.current` and `getTask`
return the **whole `Task`** (`use-chat-dispatcher.ts:217-218`), so `dependencies` is already in the
read payload. Only the write side is missing.

---

## 1. Slice 4.1 — `get_dashboard_snapshot`

A read-only chat tool exposing the dashboard's RAG values and the budget/cost rollup.

### New pure module `src/app/ai-dashboard-snapshot.ts`

i18n-free, coverage-gated.

```ts
export type DashboardSnapshot = {
  today: string;
  rag: {
    overall: Health; schedule: Health; budget: SubStatus; scope: SubStatus;
    overridden: { overall: boolean; schedule: boolean; budget: boolean; scope: boolean };
  };
  progress: { total: number; completed: number; percent: number };
  evm: {
    pv: number; ev: number; ac: number;
    spi: number | null; cpi: number | null;
    coverage: { withEstimate: number; total: number };
  };
  budget: {
    budgetHours: number; actualHours: number;
    budgetValue: number; consumedValue: number;
    cost: number | null; revenue: number | null; contributionMarginPct: number | null;
    earnedValue: number | null; costPerformanceIndex: number | null;
    costUnknownReason: CostUnknownReason | null;
  } | null;
  counts: {
    overdueTasks: number; dueSoonTasks: number; openRaid: number;
    overdueMilestones: number; atRiskMilestones: number;
    changes: { pending: number; approved: number; implemented: number; total: number };
  };
};

export function buildDashboardSnapshot(
  model: DashboardModel,
  project: ProjectReport | null,
  today: string,
): DashboardSnapshot;
```

**Curation is deliberate.** `DashboardModel` carries `topChanges: ChangeItem[]`, `overdue: Task[]`,
`recentActivity`, and a `burndown` of five parallel arrays. A raw passthrough would be hundreds of
lines of `tool_result` that stay in the conversation for the rest of the turn, and it duplicates
`list_tasks` / `list_changes`. The snapshot emits ~25 scalars plus counts.

**Honesty rule (blocking):** the tool never invents a number the panel would refuse to show. When
`costIsKnowable(project)` is false, `cost` / `revenue` / `contributionMarginPct` are `null` and the
reason rides `costUnknownReason` — never `0`. This is the `cost = 0 → 100 % GREEN margin` defect
family that shipped twice (0.195.0, 0.195.1/.2). `budget` is `null` outright when the budget module
is disabled or the workspace has no real `plan` (never the placeholder `FALLBACK_PLAN`).

### Wiring

Two getters added to `ChatDispatcherArgs` (`use-chat-dispatcher.ts:66-75`), each refreshed into a
ref by its own single-dep effect alongside the existing eleven:

```ts
getDashboardModel: () => DashboardModel;        // task-manager already memoizes dashboardModel
getBudgetRollup: () => ProjectReport | null;    // plain fn: computeBudgetReport(..., tasks) on call
```

Precedent for the getter shape: `task-manager.tsx:1423` already passes
`getDashboardModel: () => dashboardModel` into `useMeetingReportActions`.

`getBudgetRollup` is defined in `task-manager.tsx` (which already holds `budgets`, `plan`, `roles`,
`resources`, `absences`, `workdayHours`, `holidaySet`) and is **deliberately not memoized** — it runs
only when the tool actually fires, so a read tool nobody calls costs nothing per render. It returns
`null` when the budget module is off or `ws.plan` is absent.

The dispatcher gains **no** new `useWorkspace()` destructuring.

### Tool + dispatch

- `chat-tool-defs.ts`: `get_dashboard_snapshot`, `input_schema: { type: "object", properties: {} }`.
- `chat-tools.ts`: `ToolDispatcher.getDashboardSnapshot(): DashboardSnapshot`; `runTool` case
  `return d.getDashboardSnapshot();`.
- No `isReadOnly` guard — it is a read.

### Tests

`ai-dashboard-snapshot.test.ts`: unknowable cost ⇒ nulls + reason passthrough; budget module off ⇒
`budget: null`; override flags mirror the model; `EvmMetrics` nulls (`spi` when `pv === 0`, `cpi`
when `ac === 0`) propagate unchanged.

---

## 2. Slice 4.2 — AI allocation planning

Natural-language planning ("distribute 200 hours across the design role in August", "give Ada 60
hours in W32") that writes resource-planner allocations, behind a mandatory per-cell preview.

**Adds no persisted field, no backend write path, no golden-fixture regeneration** — it writes the
existing `Resource.utilization` map.

### Trigger surface

A **"Plan with AI"** button in the Resources planning toolbar (`resources-panel-toolbar.tsx`), gated
`isAiEnabled(settings.ai) && !isPopout && resources.length > 0`, placed **before** the trailing
Print · reset-columns · reset-size group (toolbar-order convention). The button opens the modal; the
instruction is typed in the modal, mirroring the inline Ask-Claude popover.

**Not a chat write tool.** Every existing AI *bulk* write in this codebase (task dedup, insight
recommendations) is preview-gated, and no tool in `runTool` has ever blocked on user confirmation —
adding that pattern would mean a chat turn awaiting a modal. Conversational reach is served instead
by a read-only `list_allocations` tool (below).

### New folder `src/app/alloc-plan/` (mirrors `task-dedup/`)

`alloc-plan.ts` — pure, i18n-free:

```ts
buildAllocContext(resources, roles, plan, periods, absences, workdayHours, holidaySet): string
PROPOSE_ALLOCATIONS_TOOL          // { cells: [{resourceId, periodKey, hours}], rationale }
parseAllocationProposal(input: unknown): RawAllocCell[] | null
groundAllocationCells(raw, ctx): { cells: GroundedAllocCell[]; skipped: SkippedCell[] }
applyAllocationCells(resources, cells, nowIso): { nextResources: Resource[]; editedBefore: Resource[] }
```

```ts
type GroundedAllocCell = {
  resourceId: number; resourceName: string; periodKey: string;
  mode: UtilizationMode;
  currentValue: number; nextValue: number;   // in the resource's OWN stored unit
  hours: number; capacityHours: number;      // what the model asked for, and what fits
  clamped: boolean;
};
type SkippedCell = {
  resourceId: number; periodKey: string;
  reason: "unknown-resource" | "out-of-window" | "no-capacity" | "bad-hours" | "duplicate";
};
```

The context gives the model, per `(resource, period)`, **both** `capacityHours` and the current value
expressed in hours — it cannot distribute sensibly without knowing what fits. Resource rows carry
`id`, name, `roleId` + role label, `isExternal`, `utilizationMode`. Caps mirror `DEDUP_CONTEXT_CAP`.

### Grounding rules (the anti-hallucination gate — mirrors `groundMergeGroups`)

- `resourceId` absent from the live `resources` list → dropped (`unknown-resource`).
- `periodKey` not in `generatePeriods(plan.startDate, plan.endDate, plan.granularity)` → skipped
  (`out-of-window`). This also catches a wrong-granularity key **before** `PERIOD_KEY_RE` would
  silently eat it on the next round-trip.
- non-finite or negative `hours` → skipped (`bad-hours`); duplicate `(resourceId, periodKey)` → first
  wins, rest skipped (`duplicate`).
- **percent-mode conversion:** `nextValue = round(hours / availableCapacityHours(...) × 100)`.

  ★★ CORRECTED DURING IMPLEMENTATION — do NOT use `periodCapacityHours` here. Despite its name it
  APPLIES the resource's own stored utilization (`resource-capacity.ts:159-162`: percent mode returns
  `(util/100) × max(0, possible − absence)`, hours mode `max(0, util − absence)`), so it answers
  "hours already allocated", not "hours available". Used as the planner's capacity it reports **zero**
  for every resource whose `utilization` map is empty, and the percent conversion then divides by that.
  The module owns `availableCapacityHours` instead — workdays minus holidays and absences, no
  utilization applied — resolving the absence override with the SAME precedence
  (`resource.absenceOverride?.[key]` first, else computed absence days) so the planner and the grid
  cannot disagree about the same person. Any future consumer needing "what fits" uses that helper —
  including `buildAllocContext`'s digest and `buildAllocationsSnapshot`'s `capacityHours`.

  `capacityHours === 0` (e.g. a full-period absence) → skipped (`no-capacity`); it is never written
  as `0` or `100`.
- **clamped to the sanitizer's own ceilings** — percent ≤ 100, hours ≤ `HOURS_MAP_MAX` (1000,
  `sanitize-entities.ts:194`) — with `clamped: true` surfaced in the preview. Without this, a
  proposal above capacity survives the write and is silently trimmed on the next load, so what the
  user confirmed is not what persists.
- `currentValue === nextValue` → omitted entirely, so the preview lists only real changes (mirrors
  `planApply`, which omits unchanged lines).

### Write semantics — set, named cells only

The apply writes exactly the `(resourceId, periodKey)` cells the proposal names. **Nothing else in
the target window is touched.** A cell the user wants cleared is cleared by the model proposing `0`,
which appears in the preview like any other change.

Explicitly rejected: *window ownership* (claiming the whole target window and zeroing unnamed cells)
is the `timelog-apply.ts` period-ownership defect that zeroed hand-entered `actualHours` and needed
an itemized confirm to become safe. *Additive* semantics were rejected because the preview would then
misstate the outcome.

Also rejected: flipping a percent-mode resource to hours mode via `convertUtilization`. That rewrites
**every** period on that resource — an unrelated, invisible data change triggered by planning one
month.

### `alloc-plan-call.ts`

`runAllocProposal(context, ai, signal?)` — ONE forced tool call through the shared
`runForcedToolCall` (`ai-forced-call.ts`), mirroring `task-dedup-call.ts`. Never logs or echoes the
API key or the response body; thrown errors carry HTTP status digits or `"parse"` only.

### `use-alloc-plan.tsx` — glue hook

Coverage-**excluded** (`vitest.config.ts` `coverage.exclude`) per the Phase-3 `.tsx` glue-hook
convention. Phases `idle | thinking | preview | applying`. `reqIdRef` + `abortRef` nonce/abort guard
exactly as `use-tasks-dedup.tsx:70-79` — a slow, billed call that resolves after the user reopened or
cancelled must not land. Returns `{ button, modal }`.

Confirm:

```ts
setResources(() => next);                       // ONE tick
capture?.({ setter: setResources, kind: "bulk.edit", edited: editedBefore,
            fromArray: before, entityKey: "resource" });   // ONE undo entry
logActivity?.("ai.allocationPlan", cells.length);
```

Note: this makes AI allocation writes **more** recoverable than the manual grid, which captures no
undo at all today. Fixing the manual path is out of scope (see §6).

### `alloc-plan-modal.tsx`

Instruction input → itemized preview. **One checkbox per cell**, all selected by default; Confirm
applies only the selected cells. Rows read e.g. `Ada Lovelace · 2026-W32 · 60 % → 75 % (clamped)`,
showing the resource's own unit. Skipped cells are listed with their reason.

The itemization is not decoration: `Resource.utilization` holds hand-entered planning figures, and a
bare "N cells will change" count is precisely what made the timelog apply unsafe.

Resources is in the axe `A11Y_VIEWS` list → every checkbox needs a **row-unique** accessible name
(`${resourceName} – ${periodKey}`), and the button/modal need labels.

### Read tool `list_allocations`

`chat-tool-defs.ts` + `chat-tools.ts` + dispatcher. Returns the plan window, granularity, and
per-resource rows with **non-zero cells only**, capped at `ALLOC_TOOL_MAX_CELLS = 500` with a
`truncated: boolean` flag. Each cell carries `{ periodKey, value, unit, hours, capacityHours }` so the
model can answer in hours regardless of how that resource stores its value. Read-only, no popout
guard.

### Tests

`alloc-plan.test.ts` (pure): percent conversion against a known capacity; `capacityHours === 0`
skip; clamp-at-100 / clamp-at-1000 with the flag set; out-of-window and wrong-granularity keys
skipped; unknown `resourceId` dropped; duplicate first-wins; no-op cells omitted; `applyAllocationCells`
touches only named cells and stamps `localModifiedAt` only on changed resources.
`use-alloc-plan.test.tsx`: stale-response discard via the nonce; confirm applies **selected only** and
records exactly one undo entry.

---

## 3. Slice 4.3a — `set_task_dependencies`

Dependencies are currently AI-unreachable end-to-end: absent from `taskFields`
(`chat-tool-defs.ts:161-204`), from `buildPatch` (`chat-tools.ts:243-272`), and from the inline-edit
descriptor's `diffFields` (`inline-ai-edit/entity-descriptor.ts:94`). Reads already expose them.

### New pure module `src/app/task-dependency-write.ts`

```ts
export type DepRejection = {
  taskId: number; type?: string;
  reason: "unknown-id" | "self" | "cycle" | "duplicate" | "cap" | "bad-type";
};
export function resolveDependencyWrite(
  ownId: number, raw: unknown, tasks: readonly Task[],
): { applied: TaskDependency[]; rejected: DepRejection[] };
```

Composes what exists rather than reimplementing it:

1. `sanitizeDependencies(raw, knownTaskIds, ownId)` (`sanitize-core.ts:217`) — shape, dedupe,
   self-dep, unknown id, the 20-link cap.
2. A per-link `wouldCreateDependencyCycle(ownId, dep.taskId, taskById)` pass
   (`sanitize-core.ts:246`) against a map built plainly from the live tasks.

   ★★ CORRECTED DURING IMPLEMENTATION. This spec originally called for checking against a *working
   map carrying the links accepted so far*, so that "a set of links acyclic one at a time but cyclic
   together" would still be refused. That property is **unreachable**, and the mechanism was dead
   code: `wouldCreateDependencyCycle` returns as soon as the walk reaches `ownTaskId`, **before** it
   reads that node's `dependencies`, so the one entry such a map mutates is never dereferenced.
   Independently, every link in a single call is a predecessor of the *same* dependent, so a cycle
   would need a path `ownId → X → … → ownId` in which only the first edge is new and every later
   edge comes from the unmodified graph — accepting link A therefore cannot change whether link B's
   walk reaches `ownId`. Do not reintroduce the growing map; it buys nothing and reads as though it
   guards something.
3. Rejections diffed back out of the raw input, so the model is told why each link was refused.

★ This is the first time `wouldCreateDependencyCycle` is reachable from anywhere but
`dependencies-editor.tsx:67,80`. `sanitizeDependencies` deliberately does **not** cycle-check
(documented at `sanitize-core.ts:213-215`), so an AI path without step 2 would be the only writer in
the app that can create a cycle — and `gantt-engine.ts:504-522` fails *closed* on cycles (drops the
nodes from the critical set) without ever reporting one.

### Tool

Replace-the-whole-list semantics for one task; an empty array clears. The description teaches the
model the direction of the relationship, because getting it backwards is the obvious failure mode:

> A dependency lives on the DEPENDENT task and points at its PREDECESSOR: `{taskId: 12, type: "FS"}`
> on task 40 means 40 starts after 12 finishes. Types: FS, SS, FF, SF. Pass an empty array to clear
> all links. Links that would create a cycle, point at a missing task, or point at the task itself
> are refused and reported back.

`input_schema`: `{ id: number, dependencies: [{ taskId: number, type: enum DEPENDENCY_TYPES }] }`,
both required.

### Dispatcher

`setTaskDependencies(id, raw): { id, dependencies, rejected } | null`

`isReadOnly` guard first (`throw readOnlyError()`), then find in `tasksRef` (miss ⇒ `null` ⇒
`runTool` throws `#id not found`), then `resolveDependencyWrite`, stamp `localModifiedAt`, assign
`tasksRef.current = next` **before** `setTasks(next)` (the back-to-back-tool-call rule,
`use-chat-dispatcher.ts:256`). The return value carries `rejected` so a partial refusal is visible in
the transcript instead of silent.

**Jira-synced tasks are allowed.** `dependencies` is local-only (`types.ts:86`), the same class as
`blockers` / `group`, which the Jira sync already preserves. Only Jira-owned fields are read-only.

`update_task` / `buildPatch` stay untouched — cycle-checking every generic patch would make all
eleven other fields pay for one.

### Tests

`task-dependency-write.test.ts`: acyclic-individually-but-cyclic-as-a-set refused; self-dep; unknown
id; duplicate; 20-cap; bad type; empty array clears. Dispatcher test: a refused link leaves the task
unchanged and is reported in `rejected`.

---

## 4. Cross-cutting

**Gates.** The three new pure modules are coverage-gated and unit-tested directly; only
`use-alloc-plan.tsx` is added to `coverage.exclude`. `dup:check` is blocking and the alloc-plan
hook/modal pair will structurally resemble the dedup pair — keep them distinct or the gate trips.
`size:check`: `use-chat-dispatcher.ts` is already 712 lines and gains three methods — watch the
800-line ratchet; `resources-panel-toolbar.tsx` also grows. Run the targeted axe check
(`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"`) before pushing — the unit
suite never runs Playwright, so an axe regression would surface only in CI.

**i18n.** EN + DE for the button, modal chrome, phase labels, every skip reason, and the toasts. Key
parity is tsc-enforced; DE needs real umlauts (patch `i18n.de.ts` via a node UTF-8 write, not the
Edit tool, and match CRLF).

**Activity.** One new kind: `ai.allocationPlan`.

**Security.** The forced call routes through `runForcedToolCall` and never logs the key or body. The
two new read tools are ungated; the one new write tool guards `isReadOnly` first. The
`update_settings` allowlist is **not** widened.

**Release ops.** Bump `src/app/version.ts` to 0.201.0 with a codename verified unused via a
`CHANGELOG.md` grep; add the CHANGELOG entry; append the new `versionHighlight*` keys to
`APP_HIGHLIGHT_KEYS` with EN + DE strings. Full local gate run (lint · tsc · test:run · dup · size ·
targeted axe) before any push. No push, MR, or merge without an explicit instruction.

---

## 5. Deferred — `optimize_wbs` (roadmap 4.3b)

Explicitly out of scope for 0.201.0. The open question is preserved rather than answered:

> Is a work-breakdown "optimize" a tool at all, or a prompt affordance over the existing
> `create_task` / `update_task` tools plus the inline Ask-Claude editor?

If it becomes a tool, it must be propose-and-review only, bounded to task create / regroup / reorder,
with no destructive cascade — and it would need a preview shape the current `EditPlan` cannot supply
(see §Grounding correction 3). **Re-raise this before the implementation plan is finalised and again
before the release closes.**

---

## 6. Known gaps left open

- The manual planning grid still writes unclamped, one cell at a time, with no undo
  (`handleSetUtilization`, `use-resource-planner.ts:908-920`). The AI path is deliberately safer than
  the manual one. A follow-up slice should give the manual path the same clamp + undo treatment.
- A percent-mode cell's stored value is a percentage of a capacity computed at propose time. If
  absences change later, the implied hours drift — the same property every hand-entered percent cell
  already has, not a new defect.
- Cycles that already exist in a workspace (from an import, or from before the editor's guard) are
  neither detected nor reported; `gantt-engine.ts` merely drops them from the critical path.
  `set_task_dependencies` refuses to *add* a cycle but does not clean up an existing one.
