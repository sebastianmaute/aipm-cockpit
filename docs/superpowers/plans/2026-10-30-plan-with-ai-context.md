# Plan with AI understands the project (§769) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan with AI sees open tasks, milestones, RACI and rates, and proposes one to three alternatives of task moves plus hour edits that the user picks from, ticks, and applies as one undo step.

**Architecture:** The one forced tool call stays. New pure, i18n-free modules under `src/app/alloc-plan/` build the extra digest lines, parse the alternatives, ground task moves (with §774's `planHoursMoves`) and compute each alternative's effect (warnings, cost). `useAllocPlan` keeps one state per alternative and applies through `useReassignHours.reassignTasks`, extended to carry extra undo parts, so tasks, moved hours and hour edits are ONE undo entry.

**Tech Stack:** TypeScript, React 19, Next.js (this repo's version — see AGENTS.md), vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-10-30-plan-with-ai-context-design.md` (approved 2026-10-30). Read it before Task 1.

## Global Constraints

- Worktree `C:/Projects/aipm-cockpit-wt769`, branch `feat/769-plan-with-ai-context`. `node_modules` is a junction: never `npm ci`/`npm install`.
- `src/app/*` files are CRLF: edit with the Edit tool or node scripts that anchor on `\r\n`; never `sed -i`. `i18n.de.ts` only via a node utf8 script, real umlauts.
- Every new string in EN (`i18n.ts`) and DE (`i18n.de.ts`); `t(lang, key, a, b)` placeholders `{0}`/`{1}`; tests use `"en-US"`, and `loadI18n("de")` before a DE assertion.
- Model output is untrusted until grounded; free text in the digest is one line per item via `oneLine` (§770).
- At most 3 alternatives. Caps count across ALL alternatives: `MAX_ALLOC_CELLS` (200) cells, `MAX_ALLOC_MOVES` (50) moves.
- Digest budgets: `ALLOC_CONTEXT_MAX_TASKS` = 150 task lines, `ALLOC_CONTEXT_MAX_MILESTONES` = 40.
- RACI: only R and A, only stakeholders with a `resourceId` that names a listed resource.
- Cost = internal cost (hours × role `internalRate`, via `periodCost`), added minus removed; a resource with `isExternal` carries no cost and is named with its hours; a resource with no role adds nothing and is counted.
- Jira-synced tasks (`!!task.jiraKey`) and closed tasks (`isTaskClosed`) cannot be moved.
- A task with no linked owner may be given one; it carries no hours (§774 `unlinked`/silent), the AI may add cells for the new owner, and `covered-by-move` does not apply to it.
- `covered-by-move`: a cell whose (resource, period) is touched by any kept LINKED move of the same alternative is dropped.
- The model's `summary` text is never stored in the activity log.
- Run vitest only under the lock: `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then npx vitest run <files> > "$TEMP/<name>.log" 2>&1; echo "EXIT=$?"; rmdir /c/Projects/.vitest-lock; fi`, then read the `Test Files N` line (a missing path drops silently). Never the full suite locally.
- Before every push: `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit`, both exit 0; `gate-local --group static` with `LEAK_LIST_FILE` on a committed tree.
- Commits: conventional prefix, cite `§769`, no `Claude-Session:` trailer, no URLs, no `Closes #`; never `--amend`.

## Review Focus

1. **A move the user unticks after the AI also proposed an hour edit for the same cell** — the edit stays dropped (`covered-by-move` is decided at grounding, never resurrected); the skipped list says so. Test in Task 3.
2. **The same task moved in two alternatives, and switching alternatives** — each alternative keeps its own ticks and its own §774 plan; applying alternative 2 never writes alternative 1's rows. Test in Task 6.
3. **A move whose task has no remaining estimate, or whose receiver is a percent-mode person at 100 %** — kept, shown with §774's reason ("no remaining estimate" / receiver full), the task still changes owner. Test in Task 3.
4. **A task name containing a line break or `#12 ...`** — stays on its own digest line and cannot start a fake task row. Test in Task 1.
5. **Hours moved by a ticked move AND an hour edit on a different period of the same receiver push them over capacity** — the warning counts both. Test in Task 4.

---

### Task 1: Project digest (tasks, milestones, RACI, rates)

**Files:**
- Create: `src/app/alloc-plan/alloc-project-digest.ts`
- Create: `src/app/alloc-plan/alloc-project-digest.test.ts`
- Modify: `src/app/reassign-hours.ts` (export the workday split)
- Modify: `src/app/alloc-plan/alloc-plan.ts` (`AllocContextArgs`, `buildAllocContext`, `buildAllocSystemPrompt`)
- Modify: `src/app/alloc-plan/alloc-plan.test.ts`

**Interfaces:**
- Produces: `export function splitTaskHoursByPeriod(task: Task, ctx: HoursMoveCtx): { periodKey: string; hours: number }[]` in `reassign-hours.ts` (the existing private `splitAcrossPeriods` behaviour, rounded to tenths as the planner does; empty for no estimate or no span in the plan).
- Produces: `export const ALLOC_CONTEXT_MAX_TASKS = 150; export const ALLOC_CONTEXT_MAX_MILESTONES = 40;`
- Produces: `export function buildProjectDigest(args: ProjectDigestArgs): string[]` where `ProjectDigestArgs = { tasks; milestones; stakeholders; resources; instruction: string; hoursCtx: HoursMoveCtx }` and the lines are `TASKS (open only):`, one `#<id> <name> owner=#<rid>|unassigned|name:<typed> remaining=<h>h start=<d> due=<d> status=<s> after=#a,#b milestones=#m hours=<key>=<h> …` per task, then `MILESTONES:` with `#<id> <name> date=<d> achieved|open`, then `RACI (R/A only):` with `milestone #<id>: R=#r1,#r2 A=#a1`, then a `…(N more tasks truncated)` / `…(N more milestones truncated)` line when cut.
- Produces: `AllocContextArgs` gains `tasks: readonly Task[]; milestones: readonly Milestone[]; stakeholders: readonly Stakeholder[]; instruction: string; today: string`. Each RESOURCES line gains ` rate=<internalRate>/h` (omitted for an external or a resource without a role); the PLAN line gains ` currency=<plan.currency>`.

- [ ] **Step 1: Write failing tests** in `alloc-project-digest.test.ts`:
  - `"lists open tasks only"`: a Done and a Cancelled task are absent; an open one is present with `remaining=16h`.
  - `"one line per task even with a line break or a #id in its name"`: name `"Fix\n#99 fake owner=#1"` → exactly one line starts with `#` for that task and no line starts with `#99`.
  - `"derives milestones from linkedTaskIds"`: task 10 in milestone 5's `linkedTaskIds` → its line contains `milestones=#5`.
  - `"RACI keeps R and A of linked stakeholders only"`: a C letter, an I letter and a stakeholder without `resourceId` are absent; R and A appear as `R=#2 A=#1`.
  - `"truncates tasks of people named in the instruction last"`: 160 tasks, instruction `"help Maya Patel"`; every task owned by Maya is shown and the trailing line is `…(10 more tasks truncated)`.
  - `"orders remaining tasks by due date"`: with the budget cut and no names in the instruction, the shown tasks are the earliest-due.
  - `"hours per period match the workday split"`: a 16 h task Sep 1–Oct 30 → `hours=2026-09=8 2026-10=8` (same figures `planHoursMoves` gives with an empty receiver).
  - In `alloc-plan.test.ts`: `"resource line carries the internal rate, none for an external"` and `"plan line names the currency"`.
- [ ] **Step 2: Run** `alloc-project-digest.test.ts alloc-plan.test.ts` under the lock. Expected: FAIL (module missing / lines absent).
- [ ] **Step 3: Implement** `splitTaskHoursByPeriod` (export, reuse the private split, no behaviour change in `planHoursMoves`), `buildProjectDigest` (closed check via `isTaskClosed`; names via `oneLine`; truncation order: tasks whose owner's display name (case-insensitive) appears in the instruction, then tasks overlapping a period key or month name the instruction contains, then by due date ascending, ties by id), and extend `buildAllocContext` to append the project lines after RESOURCES. Add to `buildAllocSystemPrompt`, verbatim:
  - "A task move carries that task's hours automatically, as shown in its hours= list: never also return cells for those hours."
  - "A task whose owner is unassigned or a typed name carries no hours when moved; you may add cells for the new owner for that work."
  - "Return more than one alternative only when they are genuinely different ways (moving tasks versus shifting hours, or different people); at most three."
  - "Prefer people with R or A on a task's milestone."
  - "A task not listed may still exist when the TASKS list is truncated."
- [ ] **Step 4: Run** the same files. Expected: PASS, and the existing `alloc-plan.test.ts` tests still pass (update only fixtures that build `AllocContextArgs`, adding empty `tasks`/`milestones`/`stakeholders`, `instruction: ""`).
- [ ] **Step 5: Commit** `feat: Plan with AI digest shows open tasks, milestones, RACI and rates (§769)`.

### Task 2: Alternatives in the tool answer

**Files:**
- Create: `src/app/alloc-plan/alloc-alternatives.ts`, `src/app/alloc-plan/alloc-alternatives.test.ts`
- Modify: `src/app/alloc-plan/alloc-plan.ts` (`PROPOSE_ALLOCATIONS_TOOL`)
- Modify: `src/app/alloc-plan-call.ts` (`runAllocProposal` return type)

**Interfaces:**
- Produces: `export const MAX_ALLOC_ALTERNATIVES = 3; export const MAX_ALLOC_MOVES = 50;`
- Produces: `export interface RawTaskMove { taskId: number; toResourceId: number }`, `export interface RawAllocAlternative { summary: string; taskMoves: RawTaskMove[]; cells: RawAllocCell[] }`, `export interface ParsedAllocAlternatives { alternatives: RawAllocAlternative[]; truncated: boolean }`.
- Produces: `export function parseAllocationAlternatives(input: unknown): ParsedAllocAlternatives | null`.
- Produces: `runAllocProposal(...)` now resolves `ParsedAllocAlternatives` (context argument unchanged).

- [ ] **Step 1: Write failing tests**:
  - `"reads up to three alternatives with summary, moves and cells"`; a fourth is dropped and `truncated` is true.
  - `"accepts the old top-level cells answer as one alternative"` (summary `""`, no moves).
  - `"caps cells and moves across all alternatives"`: 3 × 100 cells → 200 kept in total, `truncated: true`; same for 3 × 30 moves → 50.
  - `"drops malformed moves and cells, keeps the rest"`; `"summary is one line and at most 200 characters"`.
  - `"returns null when neither alternatives nor cells is an array"`.
  - Tool schema test: `PROPOSE_ALLOCATIONS_TOOL.input_schema.required` is `["alternatives"]`, and each alternative item requires `summary`, `taskMoves`, `cells`.
- [ ] **Step 2: Run** under the lock. Expected: FAIL.
- [ ] **Step 3: Implement** the parser (reuse `parseAllocationProposal`'s cell rules for each alternative's cells; `oneLine` + slice for summary) and the schema. In `runAllocProposal` call `parseAllocationAlternatives`; keep the 8192 first budget and 16 384 retry; if a test answer at the caps (200 cells + 50 moves + 3 summaries) serialised needs more than ~6000 tokens by the file's own estimate, raise the first budget to 12 288 and say so in the comment.
- [ ] **Step 4: Run.** Expected: PASS; `alloc-plan-call` tests updated for the new return shape still pass.
- [ ] **Step 5: Commit** `feat: Plan with AI answers in up to three alternatives (§769)`.

### Task 3: Grounding task moves and `covered-by-move`

**Files:**
- Create: `src/app/alloc-plan/alloc-ground-moves.ts`, `src/app/alloc-plan/alloc-ground-moves.test.ts`
- Modify: `src/app/alloc-plan/alloc-plan.ts` (`SkipReason` gains `"covered-by-move"`)

**Interfaces:**
- Consumes: `RawAllocAlternative` (Task 2); `planHoursMoves`, `OwnerChange`, `HoursMovePlan`, `HoursMoveCtx` (`reassign-hours.ts`); `groundAllocationCells` (unchanged).
- Produces:
  ```ts
  export type MoveSkipReason = "unknown-task" | "closed" | "jira" | "same-owner" | "unknown-resource" | "duplicate";
  export interface SkippedMove { taskId: number; toResourceId: number; reason: MoveSkipReason }
  export interface MoveSnapshot { owner: Pick<Task, "assignee" | "assigneeEmail" | "resourceId">; remainingEstimateMinutes?: number; startDate?: string; dueDate: string; status: Task["status"]; utilization: Record<number, Record<string, number>> }
  export interface GroundedMove { key: string; taskId: number; taskName: string; fromResourceId?: number; fromLabel: string; toResourceId: number; toLabel: string; linked: boolean; plan: HoursMovePlan; snapshot: MoveSnapshot }
  export interface GroundedAlternative { summary: string; moves: GroundedMove[]; skippedMoves: SkippedMove[]; cells: GroundedAllocCell[]; skipped: SkippedCell[]; truncated: boolean }
  export interface MoveGroundContext extends AllocGroundContext { tasks: readonly Task[]; today: string }
  export function groundAlternative(raw: RawAllocAlternative, ctx: MoveGroundContext): GroundedAlternative
  export function moveKey(m: { taskId: number }): string   // "move:<taskId>"
  ```
  `linked` is true when the task's live owner is a listed resource (`resourceId` set and present). `plan` is `planHoursMoves([that one change], ctx.resources, …)` — one plan per move, so ticking moves independently is exact. `snapshot.utilization` holds the giver's and receiver's stored values for every period key in `plan`'s edits.

- [ ] **Step 1: Write failing tests**, one per rule:
  - each `MoveSkipReason` (a missing task, a Done task, a Jira task, an unchanged owner, a target not in resources, the same task twice → first kept, second `duplicate`);
  - `"a linked move carries its planned hours"`: 16 h Maya→Liam → `plan.moves[0].movedHours === 16`;
  - `"an unassigned task's move is kept, unlinked, with no hours"`: `linked: false`, `movedHours === 0`;
  - `"a cell on a period a linked move touches is skipped as covered-by-move"` (giver's cell and receiver's cell both);
  - `"a cell for the receiver of an UNLINKED move is kept"`;
  - `"no remaining estimate: the move is kept and its plan says why"` and `"percent receiver at 100 %: kept with the receiver-cap periods"` (Review Focus 3);
  - `"a cell dropped as covered-by-move stays dropped when grounding the same raw answer again"` — grounding is pure and deterministic; the hook never re-grounds on untick (Review Focus 1, the hook half is asserted in Task 6);
  - `"snapshot holds owner, estimate, dates, status and the touched utilization"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `groundAlternative`: moves first (cap already applied by the parser), then `groundAllocationCells(raw.cells, ctx)`, then move each grounded cell whose `cellKey` is in the set of (giver|receiver, period) keys of linked moves' `plan.edits` into `skipped` with `"covered-by-move"`. Labels via `resourceDisplayName` / the typed assignee.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: ground Plan with AI task moves with §774's planner; drop hour edits a move covers (§769)`.

### Task 4: Effect of an alternative (warnings, cost)

**Files:**
- Create: `src/app/alloc-plan/alloc-effect.ts`, `src/app/alloc-plan/alloc-effect.test.ts`

**Interfaces:**
- Consumes: `GroundedAlternative`, `GroundedMove` (Task 3); `periodCost` (`resource-cost.ts`); `availableCapacityHours`.
- Produces:
  ```ts
  export interface OverCapacity { resourceId: number; periodKey: string; hours: number; capacityHours: number }
  export interface AltEffect { movedTasks: number; movedHours: number; editedCells: number; costDelta: number; externalHours: number; noRateCount: number; overCapacity: OverCapacity[] }
  export function alternativeEffect(alt: GroundedAlternative, selected: ReadonlySet<string>, ctx: AllocGroundContext & { roles: readonly Role[] }): AltEffect
  ```
  `selected` holds `moveKey`s and `cellKey`s. Shown hours after = live shown hours + ticked moves' per-period deltas (from each `plan`) + (ticked cell's `hours` − its current shown hours). `costDelta` = Σ over changed (resource, period) of Δhours × `periodCost(1, role).internal` for non-external resources with a role; `externalHours` = Σ |Δhours| for externals moved TO or FROM; `noRateCount` = distinct non-external resources with a change and no role.

- [ ] **Step 1: Write failing tests**: `"moving 16 h from a €50/h to a €80/h person costs +€480"`; `"an external receiver adds no cost and counts its hours"`; `"a person with no role is counted once"`; `"unticking a move removes its cost and its warning"`; `"a ticked move plus a ticked cell on another period of the same receiver are both counted toward over-capacity"` (Review Focus 5, two periods, the warning lists the period where the sum exceeds capacity); `"percent-mode resources are compared in shown hours"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: Plan with AI alternative effect — over-capacity warnings and internal cost (§769)`.

### Task 5: The review window

**Files:**
- Modify: `src/app/alloc-plan-modal.tsx`, `src/app/alloc-plan-modal.test.tsx`
- Create (if the modal would pass ~400 lines): `src/app/alloc-plan-moves.tsx` (moves section, presentational)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

**Interfaces:**
- Consumes: `GroundedAlternative`, `AltEffect`, `moveKey`, `cellKey`.
- Produces: `AllocPlanModal` props change from `cells/skipped/truncated/selected/onToggle` to `alternatives: readonly GroundedAlternative[]; activeIndex: number; onSelectAlternative: (i: number) => void; selected: ReadonlySet<string>` (the ACTIVE alternative's ticks); `effect: AltEffect; onToggle: (key: string) => void; truncated: boolean; currency: string`, plus the unchanged `lang/open/stage/onPropose/onConfirm/onCancel/busy/canCancel`.
- New i18n keys (EN shown; DE written by the implementer, real umlauts): `allocPlanAlternatives` "Alternatives", `allocPlanAlternativeN` "Alternative {0}", `allocPlanEffect` "Moves {0} tasks ({1} h) · edits {2} cells · {3}", `allocPlanCostInternal` "{0} internal", `allocPlanCostExternals` "{0} h to or from externals, not costed", `allocPlanNoRate` "{0} people have no rate", `allocPlanMovesHeading` "Task moves", `allocPlanCellsHeading` "Hour edits", `allocPlanMoveRow` "#{0} {1}: {2} → {3}", `allocPlanMoveUnlinked` "No planned hours move with this task; any hours come from the hour edits.", `allocPlanOverCapacity` "{0}: {1} h of {2} h in {3}", and one text per `MoveSkipReason` plus `covered-by-move` ("Already covered by a task move"). Plural forms where a count leads, following the file's `tPlural` pattern.

- [ ] **Step 1: Write failing tests** (RTL, `"en-US"`):
  - `"shows a picker only with two or more alternatives"` (`SegmentedControl`, accessible names "Alternative 1"/"Alternative 2", visible summary as description);
  - `"switching alternatives shows that alternative's moves and keeps each one's ticks"` (the hook owns ticks; the test drives `activeIndex`/`selected` props and asserts the rendered checkboxes);
  - `"each move row has a row-unique checkbox name and shows §774's hours"` ("#42 Design review: Maya Patel → Liam Foster", "16 h: Sep 8 h, Oct 8 h");
  - `"an unlinked move says its hours come from the hour edits"`;
  - `"over-capacity warning is text, not colour alone"` (the warning text is in the document and has an icon marked `aria-hidden`);
  - `"effect line shows cost, externals and no-rate counts"`;
  - `"skipped list names covered-by-move and each move reason"`;
  - a DE test with `loadI18n("de")` for `allocPlanEffect`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `SegmentedControl`, the shared `Button`, the palette tokens; row names via `rowLabel`/`buildRowTokens`. Period labels in move rows via `defaultPeriodLabel`; the hours line via the same formatting §774's notice uses (`formatMovedHours`).
- [ ] **Step 4: Run** the modal test, then `npx tsc --noEmit` (i18n parity). Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat: Plan with AI review window — alternatives, task moves, warnings and cost (§769)`.

### Task 6: Hook, apply, one undo entry

**Files:**
- Modify: `src/app/use-alloc-plan.tsx`, `src/app/use-alloc-plan.test.tsx`
- Modify: `src/app/use-reassign-hours.ts`, `src/app/use-reassign-hours.test.tsx`
- Modify: `src/app/activity-log.ts`, `src/app/activity-message.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `ReassignHours.reassignTasks(edits, actor, opts?: { toastText?: string; extraParts?: readonly (CompositeFragment | null)[]; kind?: ActivityKind; primaryCount?: number; entityKey?: UndoEntityKey })` — `extraParts` are appended to the composite after `[taskPart, step.resourcesPart]`; `kind`/`primaryCount`/`entityKey` override the defaults (`"task.updated"`, the task count). Returns `boolean`: true when it recorded (or would have, outside a popout) an entry; false when there were no task edits (caller then captures its own parts).
- Produces: `AllocPlanDeps` gains `tasks; milestones; stakeholders; today; reassignTasks: ReassignHours["reassignTasks"]; captureComposite?: UndoStackApi["captureComposite"]`.
- Activity: kind `"ai.allocationPlan"` keeps its one-arg meaning (cells applied) for old entries; a new kind `"ai.allocationPlanAlt"` with args `(alternativeNumber, moves, cells)` — EN "AI applied alternative {0}: {1} task moves, {2} hour edits" — added to the `ActivityKind` union and every map keyed by it in `activity-log.ts` and `activity-message.ts` (tsc lists any it misses; DE written by the implementer). The single-alternative, cells-only apply keeps logging `"ai.allocationPlan"` as today.

- [ ] **Step 1: Write failing tests**:
  - `use-reassign-hours.test.tsx`: `"reassignTasks appends extraParts to the same undo entry"` — one `undo()` restores the task owner, the moved hours AND an extra utilization cell; `"returns false and records nothing when no task changes"`.
  - `use-alloc-plan.test.tsx` (mock `runAllocProposal`):
    - `"applying one move and one cell is one undo entry; undo restores owner, hours and cell"`;
    - `"a cell write does not clobber the hours a move wrote in the same apply"` (functional setters: Maya Sep and the receiver's Oct cell both end right);
    - `"a move whose task changed while the window was open is skipped as stale"` and `"…whose giver's planned hours changed is skipped as stale"`; one toast reports applied and stale counts;
    - `"switching alternatives keeps each one's ticks; applying alternative 2 writes only its rows"` (Review Focus 2);
    - `"unticking a move does not bring back a covered-by-move cell"` (Review Focus 1);
    - `"an unlinked move assigns the owner and its cells add the hours"`;
    - `"logs ai.allocationPlanAlt with the alternative number, never the summary"` (the summary string is absent from every logged arg);
    - `"only cells ticked: captures one bulk.edit entry as today"`.
- [ ] **Step 2: Run** both files under the lock. Expected: FAIL.
- [ ] **Step 3: Implement.** State: `alternatives: GroundedAlternative[]`, `activeIndex`, `selectedByAlt: ReadonlyMap<number, ReadonlySet<string>>` (preselect every move and cell of each alternative). Propose: build the context with the new args, ground every alternative with `groundAlternative`. Confirm (active alternative only):
  1. stale-filter moves (snapshot vs live task fields and live utilization of the snapshot's keys) and cells (today's check);
  2. cells part: group fresh cells per resource into `captureFieldPart<Resource>({ setter: setResources, edits: [{ id, before: { utilization: <only the cell keys, current values> }, after: { utilization: <only the cell keys, next values> } }], stampField: "localModifiedAt" })` and write them with a FUNCTIONAL setter (`setResources(prev => applyAllocationCells(prev, fresh, now).nextResources)`);
  3. if any fresh move: `reassignTasks(moves → OwnerEdit with the receiver's display name and email, resourceId), "ai", { toastText, extraParts: [cellsPart], kind: "bulk.edit", entityKey: "task", primaryCount: moves + cells })`; otherwise `captureComposite({ kind: "bulk.edit", entityKey: "resource", primaryCount: cells, parts: [cellsPart], toastText })` (or today's `capture` if `captureComposite` is absent);
  4. log `"ai.allocationPlanAlt"` (with moves) or `"ai.allocationPlan"` (cells only); one toast.
- [ ] **Step 4: Run.** Expected: PASS; existing `use-alloc-plan` and `use-reassign-hours` tests still pass.
- [ ] **Step 5: Commit** `feat: Plan with AI applies task moves, moved hours and hour edits as one undo step (§769)`.

### Task 7: Wiring, guard, docs

**Files:**
- Modify: `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`, `src/app/workspace-section-types.ts`, `src/app/resources-panel.tsx`
- Modify: `src/app/reassign-hours.guard.test.ts` (ROUTED entry if the guard flags `use-alloc-plan.tsx`)
- Modify: `src/app/workspace-section.test.tsx` (the §1 `makeProps` supplies the new handlers)
- Modify: `docs/open-followups.md` (§769 entry: add the register entry and close it; index row), `CHANGELOG.md`, `docs/AGENTS/ai-assistant.md` (allocation planning section), and file the "other projects' load" follow-up as a new register entry with its index row (number from `origin/main`'s max + 1).

**Interfaces:**
- Consumes: `AllocPlanDeps` (Task 6).
- `ResourcesPanel` new props: `milestones`, `stakeholders`, `onReassignTasks: ReassignHours["reassignTasks"]`, `onCaptureComposite?: UndoStackApi["captureComposite"]`. The two functions go through `resourcesHandlers` (`useStableHandlers`); never pass the `reassignHours` object, never call `useWorkspace()` in the panel.

- [ ] **Step 1: Write failing tests**: in `workspace-section.test.tsx` the §1 memo-bail describe — `"ResourcesPanel keeps its memo bail with the new handlers"` (supply `onReassignTasks`/`onCaptureComposite` in `makeProps`, re-render with fresh function identities, panel does not re-render); a `resources-panel` test that the Plan with AI hook receives `tasks`, `milestones`, `stakeholders`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the threading task-manager → workspace-section → `resourcesHandlers` → `ResourcesPanel` → `useAllocPlan`. Run the guard test; add `use-alloc-plan.tsx` to ROUTED ("Plan with AI task moves → reassignTasks") if it flags the file.
- [ ] **Step 4: Run** the touched test files plus `reassign-hours.guard.test.ts`, then eslint and tsc. Expected: PASS, exit 0.
- [ ] **Step 5: Docs and commit.** Register §769 CLOSED with what shipped and the owner decisions; the follow-up entry; CHANGELOG line; ai-assistant.md. Run `gate-local --group static` on the committed tree. Commit `docs: close §769; file the other-projects follow-up (§769)`.

## Final review

Whole-branch review on the most capable model with the spec, this plan's Review Focus, and the ledger's rulings.
