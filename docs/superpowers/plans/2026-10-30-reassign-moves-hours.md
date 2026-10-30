# Reassigning a Task Moves Its Planned Hours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a task changes owner, its remaining estimate moves from the old owner's planned hours to the new owner's, as one undoable action with a notice.

**Architecture:** A pure, i18n-free planner (`reassign-hours.ts`) computes per-period moves and the patched resources. A deps-object hook (`use-reassign-hours.ts`) turns a plan into an undo fragment, a notice and an activity entry. It offers two entry points: one folds the move into a path's own undo entry, the other is a full reassign for paths that capture nothing today. Every owner-change path driven by a person or by Claude calls one of the two, and a guard test fails on an unrouted new writer.

**Tech Stack:** Next.js (repo-pinned), React, TypeScript, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-10-30-reassign-moves-hours-design.md` (approved 2026-10-30). Read it first. Its "My call" lines are binding.

## Global Constraints

- **Repo rules:**
  - Read `AGENTS.md`, `docs/AGENTS/undo.md` and `docs/AGENTS/activity-log.md` before Task 3.
  - `src/app` files are CRLF: edit with the Edit tool or node `\r\n` anchors, never `sed -i`. Edit `i18n.de.ts` only through a node utf8 script, with real umlauts.
  - eslint `--max-warnings=0` and `npx tsc --noEmit` before every commit. `react-hooks/set-state-in-effect` is banned. No `Date.now()` in a render body: `today` is passed in.
  - Run vitest only under `/c/Projects/.vitest-lock` (`if mkdir …; then …; rmdir …; fi`), never two at once, and never the full suite (that runs in CI). Read exit codes unpiped.
  - Commits: `git commit --only <paths>`, never `--amend`. No `Claude-Session:` trailer, no URLs, no `Closes #`.
- **Hours to move:** `remainingEstimateMinutes / 60`. A task with none or 0 moves nothing (reason `noEstimate`). `originalEstimateMinutes` is never used.
- **Span:** from `max(startDate ?? today, today)` to `dueDate`. When `dueDate < today`, everything goes to the period that contains `today`.
- **Split:** by each plan period's workdays inside the span (the overlap; `workdaysInRange` with `holidaySet`). Periods come from `generatePeriods(plan.startDate, plan.endDate, plan.granularity)`. Hours in span days outside the plan window count as `outsideWindowHours`.
- **Cap:** per period, at most the old owner's shown planned hours (`periodCapacityHours`). The new owner gets exactly what was taken.
- **Units:** each stored value changes so the shown hours (`periodCapacityHours`) change by exactly the moved hours:
  - percent mode: `Δ% = Δh / max(0, possible − absence) × 100`;
  - hours mode, giver: `util − Δh`;
  - hours mode, receiver: `max(util, absenceHours) + Δh`.
  - A percent receiver with no net capacity in a period receives nothing there; that share stays with the giver.
- **Percent cap (found while planning):** `sanitizeResource` clamps percent-mode `utilization` to 100 (`sanitize-entities.ts`, `coercePeriodMap(…, 100)`). A percent-mode receiver therefore cannot be raised above 100 % in a period, or the next load silently drops the excess. The planner caps the receiver at 100 % and leaves the rest with the giver, as `receiverCapHours`. The notice says so. Hours-mode receivers may exceed capacity (owner decision (a)), up to `HOURS_MAP_MAX` (1000).
- **Over capacity:** after the move, report each receiver period where shown planned hours exceed `availableCapacityHours` (`alloc-plan/alloc-plan.ts`), as a whole percentage, for example "Liam is now at 130 % in Sep".
- **No move, with notice:** `noEstimate`, `closed` (`isTaskClosed`), `unlinked` (either side has no linked resource), `outsideWindow` (the whole span lies outside the plan).
- **No move, no notice:** the owner is unchanged (the linked resource decides, `Task.resourceId`), or the owner was cleared to nobody.
- **Estimate used:** the task's values after the edit.
- **Rounding:**
  - moved hours: 0.1 h, computed per period before conversion;
  - stored hours: 0.1;
  - stored percent: 0.01;
  - hours in the notice: whole hours, or one decimal when under 1.
- **Undo:** one entry per action. Two `captureFieldPart` fragments go in one `captureComposite`: the task fields (`assignee`, `assigneeEmail`, `resourceId`, plus whatever the path writes) and `utilization` on each touched resource, stamped `localModifiedAt`. `toastText` carries the notice. Undo merges per key (`mergeFieldValue`).
- **Activity:** one new `ActivityKind`, `"resource.hoursMoved"`, logged once per action. Its label comes from `activityResourceHoursMoved` (EN/DE). Its prefix `resource` is already an undo entity.
- **Exempt from moving hours:** Jira sync, Outlook imports, CSV/MD/JSON decode, project load, templates, undo/redo, the load-time FK backfill, "Clear unlinked".
- **Popout** (`isPopout`): move the hours and show the notice. No undo is available there, so do not call capture.
- **Load hold:** do nothing while `loadPending`. AI paths capture `getScopeEpoch()` before awaiting and drop through `dropStaleScopeWrite`, as they already do.

## Review Focus

1. Bulk edit hands several of one person's tasks to the same receiver. The running cap must stop the giver going negative across tasks. Owner: Task 1, test "caps the running total across a batch".
2. A percent-mode receiver already at 90 %. Only 10 % fits, and the notice must not claim the full move. Owner: Task 1, test "caps a percent-mode receiver at 100 %".
3. Undo after the user edited another period of the giver's plan. The other period must survive. Owner: Task 3, test "undo keeps a later edit to another period".
4. A reassign that also edits the estimate in the same save moves the new estimate. Owner: Task 4, test "the editor moves the estimate after the edit".
5. Redo re-applies both the owner and the hours. Owner: Task 3, test "redo re-applies owner and hours together".

---

### Task 1: The pure planner

**Files:**
- Create: `src/app/reassign-hours.ts`
- Test: `src/app/reassign-hours.test.ts`

**Interfaces:**
- Produces:

```ts
export type NoMoveReason = "noEstimate" | "closed" | "unlinked" | "outsideWindow";
export interface OwnerChange { task: Task; fromResourceId: number | undefined; toResourceId: number | undefined }
export interface HoursMoveCtx { plan: ResourcePlan; absences: readonly Absence[]; workdayHours: number; holidaySet: ReadonlySet<string>; today: string }
export interface PeriodMove { periodKey: string; hours: number }
export interface TaskHoursMove {
  taskId: number; fromResourceId?: number; toResourceId?: number;
  perPeriod: PeriodMove[];          // moved, > 0 only
  movedHours: number; shortfallHours: number; receiverCapHours: number; outsideWindowHours: number;
  reason?: NoMoveReason;            // set when movedHours === 0 for one of the listed reasons
}
export interface OverCapacity { resourceId: number; periodKey: string; percent: number }
export interface ResourceUtilEdit { id: number; before: { utilization: Record<string, number> }; after: { utilization: Record<string, number> } }
export interface HoursMovePlan { moves: TaskHoursMove[]; nextResources: Resource[]; edits: ResourceUtilEdit[]; overCapacity: OverCapacity[] }
export function planHoursMoves(changes: readonly OwnerChange[], resources: readonly Resource[], ctx: HoursMoveCtx): HoursMovePlan;
```

- [ ] **Step 1: Write the failing tests.**
  - **Fixture:** month plan `2026-09-01..2026-10-31`, `workdayHours` 8, no holidays, `today` `2026-09-14`.
  - **Resources:**
    - Maya (id 1, hours mode, `{ "2026-09": 120, "2026-10": 80 }`);
    - Liam (id 2, hours mode, `{}`);
    - Ana (id 3, percent mode, `{ "2026-09": 90 }`).
  - **Task:** id 7, `remainingEstimateMinutes` 24 × 60, `startDate` `2026-09-21`, `dueDate` `2026-10-09`, `status` "In Progress". The span covers part of September and part of October. Compute each month's overlap workdays with `workdaysInRange` in the test, not by hand, then assert the shares are proportional to them and sum to 24.

  Tests, each asserting `moves[0]` and `nextResources`:
  - "splits the remaining estimate by workdays inside the span"
  - "takes from the giver and gives the receiver exactly the same shown hours"
  - "caps at the giver's shown planned hours and reports the shortfall": Maya `{ "2026-09": 4 }`, so `shortfallHours > 0` and Liam gets only what was taken.
  - "starts the span today when the start date has passed": `startDate` `2026-09-01`.
  - "puts an overdue task's hours in today's period": `dueDate` `2026-09-10`; everything goes to `2026-09`.
  - "counts span days outside the plan as outsideWindowHours": `dueDate` `2026-11-20`. An entirely-outside span gives `reason: "outsideWindow"`.
  - "moves nothing for a closed task": status "Done", then "Cancelled", both give `reason: "closed"`.
  - "moves nothing without a remaining estimate": `undefined` and `0` both give `reason: "noEstimate"`.
  - "moves nothing when either side is unlinked": `toResourceId: undefined` gives `reason: "unlinked"`.
  - "converts to percent for a percent-mode receiver": Liam → Ana, with Ana's Δ% equal to `Δh / available × 100` to 0.01.
  - "caps a percent-mode receiver at 100 %": Ana at 90 % receives only 10 % worth. `receiverCapHours` equals the rest, which stays with Maya.
  - "raises an hours-mode receiver past absence": Liam with an absence covering 3 days in September and `util` 0. After the move, `periodCapacityHours` rises by exactly the moved hours.
  - "reports a receiver pushed over capacity": Liam `{ "2026-09": 170 }`, so `overCapacity` holds `{ resourceId: 2, periodKey: "2026-09", percent: <rounded> }`.
  - "caps the running total across a batch": two tasks from Maya to Liam. Maya ends at ≥ 0 in every period, and the second task's shortfall reflects what the first took.
  - "leaves the input resources untouched": deep-equal the input after the call.
- [ ] **Step 2:** Run `npx vitest run src/app/reassign-hours.test.ts` under the lock. Expect FAIL (module missing).
- [ ] **Step 3:** Implement `planHoursMoves` in `src/app/reassign-hours.ts`.
  - Fold the changes in order over a working copy of the resources, so the cap uses the running total.
  - Use `generatePeriods`, `workdaysInRange`, `absencesForResource` and `periodCapacityHours` (`resource-capacity.ts`), `availableCapacityHours` (`alloc-plan/alloc-plan.ts`) and `isTaskClosed` (`task-closed.ts`).
  - Pure: no React, no i18n, no `Date`.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit: `feat: plan how a reassigned task's hours move (§774)`.

### Task 2: The notice text

**Files:**
- Create: `src/app/reassign-hours-notice.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/reassign-hours-notice.test.ts`

**Interfaces:**
- Consumes: `HoursMovePlan`, `TaskHoursMove` (Task 1).
- Produces: `export function hoursMoveNotice(plan: HoursMovePlan, ctx: { lang: Lang; resourceName: (id: number) => string; periodLabel: (key: string) => string; taskName: (id: number) => string }): string | null`. It returns null when no move carries movedHours > 0 or a reason, which covers both silent cases.

- [ ] **Step 1: Write the failing tests** (EN and DE; DE after `loadI18n("de")`):
  - one task moved: "Moved 16 h from Maya Patel to Liam Foster (Sep 8 h, Oct 8 h)";
  - a shortfall appends "(4 h not in Maya Patel's plan)";
  - a receiver cap appends "(6 h kept: Ana is at 100 % in Sep)";
  - over capacity appends "Liam Foster is now at 130 % in Sep.";
  - each `reason` gives its own sentence, for example noEstimate "Data migration has no remaining estimate, so no planned hours moved.";
  - a batch of N tasks to one receiver sums per person: "Moved 24 h for 3 tasks from Maya Patel to Liam Foster (…)";
  - a plan with only silent entries returns `null`.

  The exact wording is the builder's within the spec. Pin it in the tests, and use positional placeholders `{0}`.
- [ ] **Step 2:** Run the test under the lock. Expect FAIL.
- [ ] **Step 3:** Implement `hoursMoveNotice`. Add the keys:
  - `hoursMoved`, `hoursMovedBatch`, `hoursMovedShortfall`, `hoursMovedReceiverCap`, `hoursMovedOverCapacity`;
  - `hoursMovedNoEstimate`, `hoursMovedClosed`, `hoursMovedUnlinked`, `hoursMovedOutsideWindow`;
  - `activityResourceHoursMoved`.

  Add them to `i18n.ts`, and to `i18n.de.ts` through a node utf8 script with real umlauts.
- [ ] **Step 4:** Run the test, plus `src/app/i18n.test.ts` and `src/app/i18n-encoding.test.ts`. Expect PASS. Run tsc to check key parity.
- [ ] **Step 5:** Commit: `feat: the notice for a reassigned task's hours (§774)`.

### Task 3: The hook, undo and activity

**Files:**
- Create: `src/app/use-reassign-hours.ts`
- Modify:
  - `src/app/activity-log.ts`: the kind and its label key;
  - `src/app/undo/use-undo-stack.ts`: only if the `resource` prefix needs a new registration; the sweep test there decides;
  - `task-manager.tsx`: call the hook and thread its result.
- Test: `src/app/use-reassign-hours.test.tsx`

**Interfaces:**
- Consumes: `planHoursMoves` (Task 1), `hoursMoveNotice` (Task 2), `captureFieldPart` and `CompositeFragment` (`undo/use-undo-stack.ts`).
- Produces:

```ts
export interface ReassignHoursDeps {
  lang: Lang; today: string; isPopout: boolean; loadPending: boolean;
  resources: readonly Resource[]; setResources: Dispatch<SetStateAction<Resource[]>>;
  plan: ResourcePlan; absences: readonly Absence[]; workdayHours: number; holidaySet: ReadonlySet<string>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  captureComposite?: (opts: CaptureCompositeOpts) => void;
  logActivityAs?: LogActivityAsFn; showToast: (kind: "info" | "error", text: string) => void;
}
export interface HoursMoveStep {
  /** Resources fragment to add to the caller's own captureComposite parts; null when nothing moved. */
  resourcesPart: CompositeFragment | null;
  /** Writes the resources (functional setter) and logs the activity. Call once, after the task write. */
  commit(actor: ActivityActor): void;
  /** Text for the caller's toastText (or for showToast when it captures nothing); null when silent. */
  notice: string | null;
  plan: HoursMovePlan;
}
export interface ReassignHours {
  /** For a path that already records its own undo entry for this save. */
  prepare(changes: readonly OwnerChange[]): HoursMoveStep;
  /** For a path that records nothing today: writes the task owner fields AND the hours, one undo entry, one notice. */
  reassignTasks(edits: readonly { taskId: number; assignee: string; assigneeEmail: string; resourceId: number | undefined }[], actor: ActivityActor): void;
}
export function useReassignHours(deps: ReassignHoursDeps): ReassignHours;
```

- `prepare` filters out changes where `from === to` or the new owner is cleared (`assignee` blank). It returns an inert step while `loadPending`.

- [ ] **Step 1: Write the failing tests.**
  - Render the hook with an undo stack (`useUndoStack`) and a toast spy, as `use-alloc-plan.test.tsx` does.
  - "reassignTasks writes owner and hours and records one undo entry": the stack depth grows by 1, and its toast text equals `hoursMoveNotice(...)`.
  - "undo restores owner and hours together".
  - "redo re-applies owner and hours together".
  - "undo keeps a later edit to another period": after the reassign, edit Maya's `2026-11` by hand. Undo leaves `2026-11` at the edited value.
  - "logs one resource.hoursMoved entry per action".
  - "a popout moves the hours and shows the notice without an undo entry".
  - "does nothing while loadPending".
  - "prepare returns an inert step when nothing moves silently": the owner is unchanged, or was cleared.
- [ ] **Step 2:** Run the test under the lock. Expect FAIL.
- [ ] **Step 3:** Implement the hook. Add `"resource.hoursMoved"` to `ActivityKind` and its label map, then run the undo sweep test to see whether a registration is missing. Call the hook unconditionally in `task-manager.tsx` beside `useResourcePlanner`, with live render-scope values. The hook is a `.ts` file holding logic, so it is coverage-gated: keep its test.
- [ ] **Step 4:** Run the test, plus `src/app/undo/use-undo-stack.test.tsx` and `src/app/activity-log.test.ts`. Expect PASS.
- [ ] **Step 5:** Commit: `feat: one undo entry for a reassignment and its hours (§774)`.

### Task 4: Paths a person drives

**Files** (modify; extend the existing test of each):
- `src/app/workload-triage-handlers.ts` `onReassignTask`: today it captures nothing, so switch it to `reassignTasks`;
- `src/app/use-action-center-handlers.ts` `assignOwnerBundle`: it assigns an unassigned task, so `reassignTasks` gives no move and no notice, but routes it for one rule;
- `src/app/use-task-submit.ts`: the editor's save; fold `prepare(...).resourcesPart` into its `captureComposite` and `notice` into `toastText`;
- `src/app/use-task-row-handlers.ts`: the inline and Kanban assignee path, now `captureFieldEdit` (~line 370). Convert it to `captureComposite` with the task `captureFieldPart` plus `resourcesPart`;
- `src/app/use-bulk-operations.ts`: the bulk assignee, one `prepare` over all changed tasks;
- thread `ReassignHours` from `task-manager.tsx` through the deps of each hook, and through `workspace-section` for the triage.

**Interfaces:**
- Consumes: `ReassignHours` (Task 3).

- [ ] **Step 1: Write the failing tests**, one per path, asserting the receiver's `utilization` changed and the undo toast text is the notice:
  - "triage reassign moves the hours";
  - "the editor moves the estimate after the edit": owner and `remainingEstimateMinutes` changed in one save, and the move uses the new value;
  - "inline assignee moves the hours";
  - "bulk edit moves every task's hours in one entry";
  - "assigning an unassigned task moves nothing and shows no hours notice".
- [ ] **Step 2:** Run those test files under the lock. Expect FAIL.
- [ ] **Step 3:** Wire each path. Keep each path's existing functional setters. A single-row `captureFieldEdit` that gains a resources part becomes a `captureComposite` whose task fragment comes first, with `primaryCount` 1 and the same `kind` and name.
- [ ] **Step 4:** Run the same files, plus `src/app/task-manager.characterization.test.tsx`. Expect PASS.
- [ ] **Step 5:** Commit: `feat: reassigning a task in the app moves its hours (§774)`.

### Task 5: Paths Claude drives

**Files** (modify; extend existing tests):
- `src/app/use-chat-dispatcher.ts` `update_task`: fold into its `captureComposite`. The tool result tells the model what moved: append the notice text, or the no-move reason.
- the inline AI edit apply path (`inline-ai-edit/`, where `withReassignFields` feeds the write): fold the same way;
- a staged chat plan applied through `useUndoBatch`: the resources part rides in that batch.

**Interfaces:**
- Consumes: `ReassignHours.prepare` (Task 3).

- [ ] **Step 1: Write the failing tests:**
  - "update_task reassign moves the hours and reports them in the tool result";
  - "inline AI edit reassign moves the hours";
  - "a staged plan's reassign is one undo entry with its hours".
- [ ] **Step 2:** Run them under the lock. Expect FAIL.
- [ ] **Step 3:** Wire both. Log with actor `"ai"`.
- [ ] **Step 4:** Run the same files, plus `src/app/use-chat-dispatcher-wiring.test.tsx`. Expect PASS.
- [ ] **Step 5:** Commit: `feat: a reassignment by Claude moves the hours too (§774)`.

### Task 6: Guard test for owner writers

**Files:**
- Create: `src/app/reassign-hours.guard.test.ts`

- [ ] **Step 1:** Write a test that scans `src/app/**/*.{ts,tsx}` (not tests) with the TypeScript parser for object literals and spreads that set `resourceId` together with `assignee` on a task. Use the parser, not a regex, per the repo's lexer rule. Each hit's file must be in one of two lists:
  - **ROUTED:** the files of Tasks 4–5, plus `use-reassign-hours.ts`;
  - **EXEMPT:** each with a one-line reason, covering the spec's exempt paths: Jira sync, Outlook imports, decoders, load and FK backfill, templates, undo and redo, "Clear unlinked".

  It fails naming any unlisted file. It also asserts both lists are non-empty and that every listed file exists, so it cannot go vacuous.
- [ ] **Step 2:** Run it under the lock. Expect PASS once the lists are complete. Mutant: delete one ROUTED entry and confirm it fails.
- [ ] **Step 3:** Commit: `test: every task-owner writer moves hours or says why not (§774)`.

### Task 7: Docs and register

**Files:**
- Modify:
  - `docs/open-followups.md`: add §774 as CLOSED, with an index row; run `npm run followups:index:check`;
  - `CHANGELOG.md` `[Unreleased]` → `### Added`;
  - `docs/AGENTS/undo.md`: the new two-collection composite under "What is undoable";
  - `docs/AGENTS/task-manager.md`: the new hook, gated.

- [ ] **Step 1:** Write the entries. Every count and path must be reproducible with a grep beside it.
- [ ] **Step 2:** Run `LEAK_LIST_FILE="$HOME/.config/aipm-cockpit/leak-list.txt" node scripts/gate-local.mjs --group static`. Expect `gate:local PASS`.
- [ ] **Step 3:** Commit: `docs: close §774, reassigning a task moves its planned hours`.
