# Gantt View Controls + Task Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the blocked-save bug, make Cancelled behave as a closed task everywhere it should, and give the Gantt a View menu with holidays / absences / grid / dependency / milestone toggles plus a status filter that includes milestones and treats "nothing ticked" as "show nothing".

**Architecture:** Three independent workstreams. **A** (task lifecycle) touches pure engines and their consumers; **B** (Gantt) adds prefs + two new presentational layers + a popover menu; **C** (Open Points / Settings) is small UI corrections. Every filtering or bucketing decision lands in a pure, i18n-free module with unit tests; React files only consume them.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest + @testing-library/react, Playwright + axe, Tailwind v4 with AIPM palette tokens.

---

## Read before starting

`AGENTS.md` in the repo root. These landmines apply to *every* task below:

- **Never read a gate's exit code through a pipe.** `npm run test:run | tail` reports `tail`'s status. Redirect, check unpiped, then read the file:
  ```bash
  npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
  npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
  ```
- `npm run lint` is bare `eslint` with no `--max-warnings` flag — it exits 0 with warnings present. The real gate is `npx eslint --max-warnings=0 src/app`.
- CI lint is `--max-warnings=0`: an unused import or variable is **fatal**.
- `react-hooks/exhaustive-deps` rejects an `obj.member` dependency — hoist to a local const first.
- `react-hooks/set-state-in-effect` is **banned**. To sync state to a changed prop use the render-time reconcile pattern.
- A react-hooks purity rule bans `Date.now()` / `new Date()` in a render body.
- `next build` does **not** typecheck `*.test.tsx` and vitest never typechecks. Run `npx tsc --noEmit` after editing **any** test.
- `i18n.ts` (EN) and `i18n.de.ts` (DE) key sets must be identical — `tsc` enforces it. **The Edit tool corrupts umlauts in `i18n.de.ts`** (the file is CRLF). Patch DE strings with a node utf8 write and verify afterwards; see Task 18 for the exact recipe.
- Interpolated i18n strings use 0-based positional placeholders (`{0}`, `{1}`).
- `Lang` is `"en-US" | "en-GB" | "de"` — never `"en"`.

Run the whole file's tests after each task, not just the new ones.

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `src/app/task-closed.ts` | Pure predicate + doc comment naming the "closed vs delivered" distinction. Single import point for the sweep. |
| `src/app/task-closed.test.ts` | Its tests. |
| `src/app/gantt-status-buckets.ts` | Pure: task → status buckets, milestone → status bucket. i18n-free. |
| `src/app/gantt-status-buckets.test.ts` | Its tests. |
| `src/app/gantt-view-menu.tsx` | The "View" popover holding every Gantt display toggle. |
| `src/app/gantt-view-menu.test.tsx` | Its tests. |
| `src/app/gantt-overlays.tsx` | `GanttNonWorkingLayer` (holiday columns) + `GanttGridLayer` (dotted day lines). Presentational, pure. |
| `src/app/gantt-overlays.test.tsx` | Its tests. |
| `src/app/visible-task-rows.ts` | Pure: the single definition of "rows the Open Points table actually renders". |
| `src/app/visible-task-rows.test.ts` | Its tests. |

**Modified** — `task-validation.ts`, `use-task-submit.ts`, `dashboard.ts`, `snapshot.ts`, `reports-stats.ts`, `reports-tables.tsx`, `resource-workload-rows.ts`, `resources-panel.tsx`, `task-row.tsx`, `gantt-rows.tsx`, `gantt.tsx`, `gantt-engine.ts`, `use-gantt-prefs.ts`, `gantt-chrome.tsx`, `gantt-view.tsx`, `modal-header.tsx`, `icon-button.tsx`, `tasks-section.tsx`, `use-bulk-operations.ts`, `task-manager.tsx`, `bulk-edit-modal.tsx`, `settings-sections/general-section.tsx`, `settings-sections/appearance-section.tsx`, `settings-view.tsx`, `i18n.ts`, `i18n.de.ts`, plus the release files in Task 18.

---

# Workstream A — task lifecycle

## Task 1: Past due date must not block editing an existing task

The reported symptom ("changed status to Done, cannot save") is a side effect: `validateTaskForm` rejects any `dueDate < today`, so **every** overdue task is unsavable regardless of what changed.

**Files:**
- Modify: `src/app/task-validation.ts:36-51`
- Modify: `src/app/use-task-submit.ts:105-118`
- Test: `src/app/task-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/task-validation.test.ts` (if the file has no `import` for these, add them at the top: `import { describe, expect, it } from "vitest";` and `import { validateTaskForm } from "./task-validation";`):

```ts
describe("validateTaskForm past-date rule", () => {
  const base = {
    taskName: "Ship the thing",
    assignee: "Ada",
    assigneeEmail: "",
    dueDate: "2020-01-01",
  } as Parameters<typeof validateTaskForm>[0];

  it("rejects a past due date when creating", () => {
    expect(validateTaskForm(base, "2026-08-03", true).dueDate).toBe("errorPastDate");
  });

  it("accepts a past due date when editing an existing task", () => {
    expect(validateTaskForm(base, "2026-08-03", false).dueDate).toBeUndefined();
  });

  it("still requires a due date when editing", () => {
    const noDue = { ...base, dueDate: "" } as typeof base;
    expect(validateTaskForm(noDue, "2026-08-03", false).dueDate).toBe("errorDueDateRequired");
  });
});
```

The third case is not padding: it is the one that fails if the implementation short-circuits the whole `dueDate` branch on edit instead of only the past-date arm.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/task-validation.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t1.log
```

Expected: FAIL — `validateTaskForm` currently takes two arguments, so `tsc`-less vitest passes `true` into nothing and the second case reports `"errorPastDate"`.

- [ ] **Step 3: Add the parameter**

`src/app/task-validation.ts` — replace the signature and the due-date block:

```ts
/**
 * Validate a task-form draft. `today` is an ISO date (YYYY-MM-DD).
 *
 * `isNew` gates the past-date rule ONLY. A due date that has since gone stale
 * must never block editing an existing task — that made every overdue task
 * unsavable, whatever the user was actually changing. Creating a task with a
 * past due date is still refused, which is the case the rule exists for.
 */
export function validateTaskForm(
  form: TaskFormDraft,
  today: string,
  isNew: boolean,
): TaskFieldErrors {
  const errors: TaskFieldErrors = {};

  if (!sanitizeTaskName(form.taskName)) errors.taskName = "errorTaskNameRequired";
  if (!sanitizeAssignee(form.assignee)) errors.assignee = "errorAssigneeRequired";

  const dueDate = sanitizeIsoDate(form.dueDate);
  if (!dueDate) errors.dueDate = "errorDueDateRequired";
  else if (isNew && dueDate < today) errors.dueDate = "errorPastDate";

  // A blank email is allowed (the field is optional); a non-empty one must parse.
  const email = sanitizeEmail(form.assigneeEmail);
  if (email && !isValidEmail(email)) errors.assigneeEmail = "errorInvalidEmail";

  return errors;
}
```

- [ ] **Step 4: Thread the flag from the submit hook**

`src/app/use-task-submit.ts`. The hook already knows whether this is a create — `editingId === null` means create. Read the surrounding code for the exact name in scope, then:

Line 105 becomes:

```ts
  const isNewTask = editingId === null;
  const fieldErrors = useMemo(
    () => validateTaskForm(form, today, isNewTask),
    [form, today, isNewTask],
  );
```

Line 118 becomes:

```ts
      if (hasTaskErrors(validateTaskForm(form, today, isNewTask))) return;
```

`isNewTask` must be a hoisted scalar const, not `editingId === null` inline in the dep array — `exhaustive-deps` is fine with a scalar and this keeps the array readable.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/app/task-validation.test.ts src/app/use-task-submit.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t1.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both PASS, tsc exits 0. If other test files call `validateTaskForm` with two arguments, tsc will name them — add the third argument at each.

- [ ] **Step 6: Manually confirm the reported bug is gone**

```bash
npm run dev
```

Open Points → edit a task whose due date is in the past → change Status to Done → Save must be enabled and the save must land.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-validation.ts src/app/task-validation.test.ts src/app/use-task-submit.ts
git commit -m "fix(tasks): stop a stale due date blocking edits to an existing task"
```

---

## Task 2: `isTaskClosed` predicate

A single named predicate for the sweep, so each call site documents which question it is asking.

**Files:**
- Create: `src/app/task-closed.ts`
- Test: `src/app/task-closed.test.ts`

- [ ] **Step 1: Write the failing test**

`src/app/task-closed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isTaskClosed, isTaskDelivered } from "./task-closed";
import { type Task } from "./types";

const task = (over: Partial<Task>): Task => ({
  id: 1,
  taskName: "t",
  assignee: "a",
  priority: "Medium",
  status: "To Do",
  dueDate: "2026-08-01",
  ...over,
} as Task);

describe("isTaskClosed", () => {
  it("is true for Done", () => {
    expect(isTaskClosed(task({ status: "Done", completedDate: "2026-08-01" }))).toBe(true);
  });

  it("is true for Cancelled even with no completedDate", () => {
    expect(isTaskClosed(task({ status: "Cancelled" }))).toBe(true);
  });

  it("is false for In Progress", () => {
    expect(isTaskClosed(task({ status: "In Progress" }))).toBe(false);
  });
});

describe("isTaskDelivered", () => {
  it("is true only for a task carrying a completion date", () => {
    expect(isTaskDelivered(task({ status: "Done", completedDate: "2026-08-01" }))).toBe(true);
    expect(isTaskDelivered(task({ status: "Cancelled" }))).toBe(false);
    expect(isTaskDelivered(task({ status: "To Do" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/task-closed.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

`src/app/task-closed.ts`:

```ts
// src/app/task-closed.ts — the two questions a caller can ask about a finished
// task, kept apart on purpose.
//
// CLOSED   = the task will not be worked on again (Done or Cancelled). Use for
//            anything about ACTIVE work: overdue, due-soon, workload, forecast,
//            row styling, chasing the assignee.
// DELIVERED = the work was actually completed (Done, i.e. it carries a
//            completedDate). Use for anything counting OUTPUT: completion
//            percentage numerator, earned value, on-time/late.
//
// Cancelled is CLOSED but never DELIVERED. Reading `!!task.completedDate` as
// "closed" is what made cancelled tasks keep reporting as open and overdue.
import { isTaskFinished } from "./task-status";
import { type Task } from "./types";

export function isTaskClosed(task: Pick<Task, "status">): boolean {
  return isTaskFinished(task);
}

export function isTaskDelivered(task: Pick<Task, "completedDate">): boolean {
  return !!task.completedDate;
}
```

`isTaskClosed` deliberately delegates to `isTaskFinished` rather than replacing it: `isTaskFinished` is already used correctly in several places and re-implementing the check would give two definitions to keep in step. The new name exists so the sweep's call sites read as answers to the right question.

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/app/task-closed.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-closed.ts src/app/task-closed.test.ts
git commit -m "feat(tasks): add isTaskClosed/isTaskDelivered predicates"
```

---

## Task 3: Dashboard and forecast stop treating Cancelled as active

Four sites. Three switch to `isTaskClosed`; one changes the completion-percentage denominator.

**Files:**
- Modify: `src/app/dashboard.ts:77` (denominator), `:94`, `:154`
- Modify: `src/app/snapshot.ts:155`
- Test: `src/app/dashboard.test.ts`, `src/app/snapshot.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/dashboard.test.ts` (reuse whatever task factory the file already defines; if none, copy the `task()` helper from Task 2's test):

```ts
describe("Cancelled tasks are closed, not active", () => {
  const holidays = new Set<string>();

  it("excludes a cancelled task from the schedule RAG", () => {
    const tasks = [task({ id: 1, status: "Cancelled", dueDate: "2020-01-01" })];
    expect(computeScheduleStatus(tasks, "2026-08-03", holidays)).toBe("G");
  });

  it("excludes a cancelled task from the overdue list", () => {
    const tasks = [task({ id: 1, status: "Cancelled", dueDate: "2020-01-01" })];
    expect(computeOverdueAndDueSoon(tasks, "2026-08-03", holidays).overdue).toEqual([]);
  });

  it("drops cancelled work from the completion-percentage denominator", () => {
    const tasks = [
      task({ id: 1, status: "Done", completedDate: "2026-08-01" }),
      task({ id: 2, status: "Cancelled" }),
    ];
    const p = computeDashboardProgress(tasks, "2026-08-03", holidays);
    expect(p.percent).toBe(100);
    expect(p.completed).toBe(1);
  });
});
```

Check the real exported name of the overdue/due-soon function at `src/app/dashboard.ts:145` and use it; the block above assumes `computeOverdueAndDueSoon`.

Append to `src/app/snapshot.test.ts`:

```ts
it("a cancelled task does not push out the forecast end date", () => {
  const tasks = [task({ id: 1, status: "Cancelled", dueDate: "2027-12-31" })];
  expect(forecastEndDate(tasks, [], new Map(), "2026-08-31")).toBe("2026-08-31");
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/app/dashboard.test.ts src/app/snapshot.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t3.log
```

Expected: FAIL — RAG returns `"R"`, the overdue list has one entry, percent is 50, forecast is `"2027-12-31"`.

- [ ] **Step 3: Change the four sites**

`src/app/dashboard.ts` — add `import { isTaskClosed, isTaskDelivered } from "./task-closed";` at the top, then:

Line 77 region (`computeDashboardProgress`):

```ts
  const total = tasks.length;
  // Cancelled work is out of scope, not outstanding: leaving it in the
  // denominator means a project with cancelled scope can never read 100%.
  const cancelled = tasks.filter((t) => isTaskClosed(t) && !isTaskDelivered(t)).length;
  const denominator = Math.max(0, total - cancelled);
  const completed = tasks.filter((t) => isTaskDelivered(t)).length;
  const percent = denominator === 0 ? 0 : Math.round((completed / denominator) * 100);
  return { total, completed, percent, counts };
```

`total` keeps its original meaning (every task) because callers render it as the task count. Only the percentage divides by `denominator`.

Line 94 (`computeScheduleStatus`) and line 154 (the overdue/due-soon list): replace

```ts
    if (t.completedDate || !t.dueDate) continue;
```

with

```ts
    if (isTaskClosed(t) || !t.dueDate) continue;
```

in **both** loops.

`src/app/snapshot.ts` — add the same import, then at line 155 replace

```ts
    if (t.completedDate) continue;
```

with

```ts
    if (isTaskClosed(t)) continue;
```

Do **not** touch `snapshot.ts:139` or `milestones.ts:19` — those read `completedDate` as a *date* for "effective end", not as a predicate. A cancelled task has no completion date, so `completedDate || dueDate` already falls through to the due date correctly.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/dashboard.test.ts src/app/snapshot.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t3.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: PASS. If an existing dashboard test asserted a percentage over a fixture containing cancelled tasks, the expected number legitimately changed — verify by hand that the new number is right before editing the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts src/app/snapshot.ts src/app/snapshot.test.ts
git commit -m "fix(dashboard): treat Cancelled as closed in RAG, overdue, forecast and % complete"
```

---

## Task 4: Reports gain a Cancelled bucket

`reports-stats.ts` has one `isComplete` flag splitting every task into completed-vs-open, so a cancelled task currently counts as open *and* overdue. It becomes a third bucket rather than joining either.

**Files:**
- Modify: `src/app/reports-stats.ts` (types at `:8-43`, `bump()` around `:88`, main loop around `:106`, assignee loop around `:163`)
- Modify: `src/app/reports-tables.tsx` (`REPORTS_ASSIGNEE_COL_WIDTHS:25`, `REPORTS_BY_X_COL_WIDTHS:36`, the sort-key unions at `:46` and `:49`, the column arrays at `:68` and `:76`, the `<td>` rows at `:161` and `:243`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (key `reportsCancelled`)
- Test: `src/app/reports-stats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/reports-stats.test.ts`:

```ts
describe("cancelled bucket", () => {
  it("counts a cancelled task as neither open nor completed, and never overdue", () => {
    const tasks = [
      task({ id: 1, status: "Cancelled", dueDate: "2020-01-01", assignee: "Ada", group: "G" }),
      task({ id: 2, status: "To Do", dueDate: "2020-01-01", assignee: "Ada", group: "G" }),
    ];
    const s = computeStats(tasks, "2026-08-03", new Set(), new Map());
    expect(s.total).toBe(2);
    expect(s.open).toBe(1);
    expect(s.completed).toBe(0);
    expect(s.cancelled).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.byAssignee[0]).toMatchObject({ open: 1, completed: 0, cancelled: 1, overdue: 1 });
    expect(s.byGroup[0]).toMatchObject({ open: 1, completed: 0, cancelled: 1, overdue: 1 });
  });
});
```

`overdue` is 1, not 2: only the To Do task is overdue.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/reports-stats.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t4.log
```

Expected: FAIL — `open` is 2, `overdue` is 2, `cancelled` is undefined.

- [ ] **Step 3: Add the bucket to the engine**

`src/app/reports-stats.ts` — add `import { isTaskClosed, isTaskDelivered } from "./task-closed";`.

Add `cancelled: number;` to `GroupOrLabelRow` (after `completed`), to `Stats` (after `completed`), and to the `byAssignee` element type. Seed each to `0` wherever the row/stats object is constructed (the `stats` literal at `:52`, the `map.set` row literal around `:76`, and the `assigneeMap.set` entry literal around `:150`).

In `bump()` (around `:88`) replace:

```ts
    if (task.completedDate) row.completed++;
    else {
      row.open++;
      if (task.dueDate && task.dueDate < today) row.overdue++;
    }
```

with:

```ts
    if (isTaskDelivered(task)) row.completed++;
    else if (isTaskClosed(task)) row.cancelled++;
    else {
      row.open++;
      if (task.dueDate && task.dueDate < today) row.overdue++;
    }
```

In the main loop replace `const isComplete = !!task.completedDate;` and its `if/else` with:

```ts
    const isDelivered = isTaskDelivered(task);
    const isCancelled = !isDelivered && isTaskClosed(task);
    if (isDelivered) {
      stats.completed++;
      if (task.dueDate && task.completedDate) {
        if (task.completedDate <= task.dueDate) stats.completedOnTime++;
        else stats.completedLate++;
      }
    } else if (isCancelled) {
      stats.cancelled++;
    } else {
      stats.open++;
      if (task.dueDate) {
        if (task.dueDate < today) stats.overdue++;
        if (task.dueDate <= today) {
          stats.openByStatus.red++;
        } else {
          const days = workdaysUntil(task.dueDate, today, holidaySet);
          if (days <= 3) stats.openByStatus.yellow++;
          else stats.openByStatus.green++;
        }
      } else {
        stats.openByStatus.green++;
      }
    }
```

In the assignee loop lower down, the same three-way split (it currently reuses `isComplete`):

```ts
    if (isDelivered) {
      entry.completed++;
      if (task.dueDate && task.completedDate) {
        if (task.completedDate <= task.dueDate) entry.onTime++;
        else entry.late++;
      }
    } else if (isCancelled) {
      entry.cancelled++;
    } else {
      entry.open++;
      if (task.dueDate && task.dueDate < today) entry.overdue++;
    }
```

- [ ] **Step 4: Run the engine test**

```bash
npx vitest run src/app/reports-stats.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t4.log
```

Expected: PASS.

- [ ] **Step 5: Surface the column**

`src/app/i18n.ts` — add next to the other `reports*` keys:

```ts
  reportsCancelled: "Cancelled",
```

`src/app/i18n.de.ts` — add the same key with value `"Abgebrochen"`. No umlaut here, but the file is CRLF: if the Edit tool mangles anything, use the node recipe in Task 18.

`src/app/reports-tables.tsx`:

- `REPORTS_ASSIGNEE_COL_WIDTHS` and `REPORTS_BY_X_COL_WIDTHS` each gain `cancelled: 90,` immediately after their `completed` entry (assignee's map may not have a `completed` key — put `cancelled` directly after `open` there).
- `AssigneeSortKey` and `GroupOrLabelSortKey` each gain `| "cancelled"`.
- The two column-descriptor arrays (`:68` and `:76`) gain `{ key: "cancelled", labelKey: "reportsCancelled" },` after the `completed` entry.
- Both table bodies gain a cell after the completed cell:

```tsx
                  <td className="px-3 py-2 text-right text-muted-foreground">{row.cancelled}</td>
```

Muted, not a RAG token: cancelled is neither good nor bad news.

- The sort comparators in this file switch on the sort key — add a `cancelled` arm alongside the existing `completed` arm, mirroring it exactly.

- [ ] **Step 6: Run the tests and the gates**

```bash
npx vitest run src/app/reports-stats.test.ts src/app/reports-tables.test.tsx src/app/reports.test.tsx --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t4.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

All three must exit 0. tsc is the one that catches a missed `cancelled: 0` seed or a missing sort arm.

- [ ] **Step 7: Reports is axe-scanned — re-run the gate for it**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Reports" > /tmp/a11y.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a11y.log
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/reports-stats.ts src/app/reports-stats.test.ts src/app/reports-tables.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(reports): count Cancelled as its own bucket instead of open+overdue"
```

---

## Task 5: Workload, resource rows and task rows stop chasing cancelled work

**Files:**
- Modify: `src/app/resource-workload-rows.ts:88`
- Modify: `src/app/resources-panel.tsx:340`
- Modify: `src/app/task-row.tsx:346-350`, `:646-648`
- Test: `src/app/resource-workload-rows.test.ts`, `src/app/task-row.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/resource-workload-rows.test.ts`:

```ts
it("a cancelled task adds no open or overdue load", () => {
  const rows = buildResourceWorkload({
    tasks: [task({ id: 1, status: "Cancelled", dueDate: "2020-01-01", assignee: "Ada" })],
    resources: [{ id: 1, name: "Ada" } as Resource],
    absences: [],
    today: "2026-08-03",
  } as Parameters<typeof buildResourceWorkload>[0]);
  const ada = rows.managed.find((r) => r.name === "Ada");
  expect(ada?.openCount).toBe(0);
  expect(ada?.overdueCount).toBe(0);
});
```

Match the real `buildResourceWorkload` argument shape from the module — read its signature first rather than trusting the sketch above.

Append to `src/app/task-row.test.tsx`:

```tsx
it("a cancelled task offers no send-inquiry action and shows no completion date", () => {
  renderRow(task({ id: 1, status: "Cancelled", taskName: "Dropped" }));
  expect(screen.queryByRole("button", { name: /send inquiry/i })).toBeNull();
  expect(screen.queryByText(/completed on/i)).toBeNull();
});
```

Use whatever render helper the file already has instead of `renderRow` if it is named differently.

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/app/resource-workload-rows.test.ts src/app/task-row.test.tsx --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t5.log
```

- [ ] **Step 3: Change the sites**

`src/app/resource-workload-rows.ts` — add `import { isTaskClosed } from "./task-closed";` and replace `if (!t.completedDate) {` with `if (!isTaskClosed(t)) {`.

`src/app/resources-panel.tsx` — same import, replace `if (!task.completedDate) {` with `if (!isTaskClosed(task)) {`.

`src/app/task-row.tsx` — same import, plus `isTaskDelivered`. Then **split** the flag; this is the one site where reusing a single boolean breaks:

```ts
  const isClosed = isTaskClosed(task);
  const health: TaskHealth = computeTaskHealth(task, today, holidaySet);
  // The label needs a real date, which only a delivered task has — a cancelled
  // task would render "Completed on undefined".
  const label = isTaskDelivered(task)
    ? t(lang, "completedOn", task.completedDate!)
    : formatHealthTooltip(health, lang);
```

Every remaining use of the old `isComplete` in this component (row state class, strike-through styling) becomes `isClosed`. Grep the file for `isComplete` and make sure none is left.

Lines 646-648:

```ts
  const showSendInquiry = !isClosed;
  const showPushToJira =
    jiraEnabled && !!jiraProjectKey && !task.jiraKey && !isClosed;
```

Note these are in a *different component* in the same file, so `isClosed` must be computed there too — do not assume the earlier const is in scope.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/resource-workload-rows.test.ts src/app/task-row.test.tsx src/app/resources-panel.test.tsx --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t5.log
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/resource-workload-rows.ts src/app/resource-workload-rows.test.ts src/app/resources-panel.tsx src/app/task-row.tsx src/app/task-row.test.tsx
git commit -m "fix(tasks): cancelled work no longer counts as open load or invites chasing"
```

---

# Workstream B — Gantt

## Task 6: Gantt status buckets (pure)

**Files:**
- Create: `src/app/gantt-status-buckets.ts`
- Test: `src/app/gantt-status-buckets.test.ts`

- [ ] **Step 1: Write the failing test**

`src/app/gantt-status-buckets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { milestoneStatusBucket, taskStatusBuckets } from "./gantt-status-buckets";
import { type Milestone, type Task } from "./types";

const today = new Date("2026-08-03T00:00:00Z");
const bar = (end: string) => ({ start: new Date("2026-01-01T00:00:00Z"), end: new Date(`${end}T00:00:00Z`) });
const task = (over: Partial<Task>): Task => ({ id: 1, status: "To Do" } as Task & typeof over);

describe("taskStatusBuckets", () => {
  it("an unfinished task past its end is open AND overdue", () => {
    const b = taskStatusBuckets(task({ status: "To Do" }), bar("2026-07-01"), today);
    expect([...b].sort()).toEqual(["open", "overdue"]);
  });

  it("an unfinished task in the future is open only", () => {
    const b = taskStatusBuckets(task({ status: "In Progress" }), bar("2026-09-01"), today);
    expect([...b]).toEqual(["open"]);
  });

  it("a done task is completed only", () => {
    const b = taskStatusBuckets(
      task({ status: "Done", completedDate: "2026-07-01" }),
      bar("2026-07-01"),
      today,
    );
    expect([...b]).toEqual(["completed"]);
  });

  it("a CANCELLED task is completed, never open or overdue", () => {
    const b = taskStatusBuckets(task({ status: "Cancelled" }), bar("2026-07-01"), today);
    expect([...b]).toEqual(["completed"]);
  });
});

describe("milestoneStatusBucket", () => {
  const ms = (over: Partial<Milestone>): Milestone => ({ id: 1, name: "M", date: "2026-09-01" } as Milestone & typeof over);

  it("achieved is completed", () => {
    expect(milestoneStatusBucket(ms({ achievedDate: "2026-07-01" }), "2026-08-03")).toBe("completed");
  });

  it("unachieved and past due is overdue", () => {
    expect(milestoneStatusBucket(ms({ date: "2026-07-01" }), "2026-08-03")).toBe("overdue");
  });

  it("unachieved and future is open", () => {
    expect(milestoneStatusBucket(ms({ date: "2026-09-01" }), "2026-08-03")).toBe("open");
  });

  it("an unparseable date is open, never overdue", () => {
    expect(milestoneStatusBucket(ms({ date: "" }), "2026-08-03")).toBe("open");
  });
});
```

The Cancelled case is item 13 and the unparseable-date case stops a bad record being reported as a schedule problem — neither is optional.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/gantt-status-buckets.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t6.log
```

- [ ] **Step 3: Write the module**

`src/app/gantt-status-buckets.ts`:

```ts
// src/app/gantt-status-buckets.ts — pure, i18n-free mapping from an entity to
// the Gantt status-filter buckets it belongs to. No clock: `today` is passed in.
import { isTaskClosed } from "./task-closed";
import { type GanttStatus } from "./gantt-engine";
import { type Milestone, type Task } from "./types";

/** Which buckets a task belongs to. A task can be in several (an unfinished
 *  task past its end is both open and overdue). Cancelled counts as COMPLETED:
 *  it is closed, and reporting it as open work is what this fixes. */
export function taskStatusBuckets(
  task: Pick<Task, "status">,
  bar: { end: Date },
  today: Date,
): ReadonlySet<GanttStatus> {
  if (isTaskClosed(task)) return new Set<GanttStatus>(["completed"]);
  const out = new Set<GanttStatus>(["open"]);
  if (bar.end.getTime() < today.getTime()) out.add("overdue");
  return out;
}

/** A milestone belongs to exactly one bucket. An unparseable date falls to
 *  "open" rather than "overdue" — a malformed record is not a schedule slip. */
export function milestoneStatusBucket(
  milestone: Pick<Milestone, "date" | "achievedDate">,
  todayISO: string,
): GanttStatus {
  if (milestone.achievedDate) return "completed";
  const date = (milestone.date ?? "").trim();
  if (!date) return "open";
  return date < todayISO ? "overdue" : "open";
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/app/gantt-status-buckets.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t6.log
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/gantt-status-buckets.ts src/app/gantt-status-buckets.test.ts
git commit -m "feat(gantt): pure status-bucket helpers for tasks and milestones"
```

---

## Task 7: Gantt prefs v2 — new toggles and the migration

**Files:**
- Modify: `src/app/gantt-engine.ts:38-74` (type + defaults), `:127-172` (`loadPrefs`)
- Modify: `src/app/use-gantt-prefs.ts`
- Test: `src/app/gantt-engine.test.ts`, `src/app/use-gantt-prefs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/gantt-engine.test.ts`:

```ts
describe("prefs v2 migration", () => {
  beforeEach(() => window.localStorage.clear());

  it("a legacy blob with an empty statuses array migrates to all statuses ticked", () => {
    window.localStorage.setItem(
      "aipm-cockpit:gantt-prefs",
      JSON.stringify({ sort: "auto", statuses: [] }),
    );
    expect(loadPrefs().statuses.sort()).toEqual(["completed", "open", "overdue"]);
  });

  it("a legacy blob with a non-empty statuses array is left alone", () => {
    window.localStorage.setItem(
      "aipm-cockpit:gantt-prefs",
      JSON.stringify({ sort: "auto", statuses: ["overdue"] }),
    );
    expect(loadPrefs().statuses).toEqual(["overdue"]);
  });

  it("a v2 blob with an empty statuses array keeps it empty", () => {
    window.localStorage.setItem(
      "aipm-cockpit:gantt-prefs",
      JSON.stringify({ v: 2, sort: "auto", statuses: [] }),
    );
    expect(loadPrefs().statuses).toEqual([]);
  });

  it("defaults the new display toggles when absent", () => {
    window.localStorage.setItem("aipm-cockpit:gantt-prefs", JSON.stringify({ v: 2, statuses: [] }));
    const p = loadPrefs();
    expect(p.showHolidays).toBe(true);
    expect(p.showAbsences).toBe(true);
    expect(p.showDependencies).toBe(true);
    expect(p.showMilestones).toBe(true);
    expect(p.showGrid).toBe(false);
  });

  it("DEFAULT_PREFS ticks every status", () => {
    expect(DEFAULT_PREFS.statuses.sort()).toEqual(["completed", "open", "overdue"]);
  });
});
```

The third case is the one that matters most: without the `v` marker the migration would keep re-expanding a deliberately-emptied filter on every reload, and the user could never see the new "show nothing" state.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/gantt-engine.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t7.log
```

- [ ] **Step 3: Extend the type and defaults**

`src/app/gantt-engine.ts` — in `GanttPrefs`, change the `statuses` doc comment and add the five booleans:

```ts
  /** Selected status buckets. EMPTY MEANS SHOW NOTHING (v2 semantics) — the
   *  chart renders an explicit "no status selected" message instead of an
   *  empty grid. Pre-v2 blobs stored `[]` to mean "show everything"; loadPrefs
   *  migrates those. */
  statuses: GanttStatus[];
```

after `milestonePlacement`:

```ts
  /** Shade non-working public holidays as full-height columns. */
  showHolidays: boolean;
  /** Draw the per-row absence bands. */
  showAbsences: boolean;
  /** Draw the dependency arrows between task bars. */
  showDependencies: boolean;
  /** Render milestone rows at all (independent of the status filter). */
  showMilestones: boolean;
  /** Dotted vertical day lines, aligned to the header's day columns. */
  showGrid: boolean;
```

Add the version constant and update the defaults:

```ts
/** Persisted prefs schema version. v2 flipped the meaning of an empty
 *  `statuses` array from "show everything" to "show nothing". */
export const GANTT_PREFS_VERSION = 2;

export const ALL_GANTT_STATUSES: GanttStatus[] = [...GANTT_STATUS_VALUES];

export const DEFAULT_PREFS: GanttPrefs = {
  sort: "auto",
  search: "",
  statuses: [...GANTT_STATUS_VALUES],
  priorities: [],
  assignees: [],
  customOrder: [],
  showCriticalPath: true,
  showBaseline: true,
  milestonePlacement: "below",
  showHolidays: true,
  showAbsences: true,
  showDependencies: true,
  showMilestones: true,
  showGrid: false,
};
```

`priorities` and `assignees` keep empty-means-all. Only the status filter flips; nothing about the priority or assignee dropdowns changes.

- [ ] **Step 4: Migrate in `loadPrefs`**

In `loadPrefs`, after `const statuses = parseStatusFilters(parsed);` insert:

```ts
    // v1 stored `[]` to mean "show everything". Under v2 that means "show
    // nothing", so carrying it forward verbatim would open the chart empty for
    // every existing user. A non-empty v1 list means the same under both
    // schemas and passes through untouched.
    const isV2 = parsed.v === GANTT_PREFS_VERSION;
    const migratedStatuses =
      !isV2 && statuses.length === 0 ? [...GANTT_STATUS_VALUES] : statuses;
```

Use `migratedStatuses` in the returned object, and add the five booleans to that object following the exact shape of the existing `showBaseline` arm:

```ts
      showHolidays:
        typeof parsed.showHolidays === "boolean"
          ? parsed.showHolidays
          : DEFAULT_PREFS.showHolidays,
      showAbsences:
        typeof parsed.showAbsences === "boolean"
          ? parsed.showAbsences
          : DEFAULT_PREFS.showAbsences,
      showDependencies:
        typeof parsed.showDependencies === "boolean"
          ? parsed.showDependencies
          : DEFAULT_PREFS.showDependencies,
      showMilestones:
        typeof parsed.showMilestones === "boolean"
          ? parsed.showMilestones
          : DEFAULT_PREFS.showMilestones,
      showGrid:
        typeof parsed.showGrid === "boolean" ? parsed.showGrid : DEFAULT_PREFS.showGrid,
```

In `savePrefs`, stamp the version so the next load knows the blob is migrated:

```ts
export function savePrefs(p: GanttPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ ...p, v: GANTT_PREFS_VERSION }),
    );
  } catch {
    // Quota / disabled — drop silently.
  }
}
```

- [ ] **Step 5: Add the setters**

`src/app/use-gantt-prefs.ts` — add to `GanttPrefsApi` and implement, following the `toggleBaseline` shape exactly:

```ts
  toggleHolidays: () => void;
  toggleAbsences: () => void;
  toggleDependencies: () => void;
  toggleMilestones: () => void;
  toggleGrid: () => void;
```

```ts
  function toggleHolidays() {
    setPrefs((p) => ({ ...p, showHolidays: !p.showHolidays }));
  }
  function toggleAbsences() {
    setPrefs((p) => ({ ...p, showAbsences: !p.showAbsences }));
  }
  function toggleDependencies() {
    setPrefs((p) => ({ ...p, showDependencies: !p.showDependencies }));
  }
  function toggleMilestones() {
    setPrefs((p) => ({ ...p, showMilestones: !p.showMilestones }));
  }
  function toggleGrid() {
    setPrefs((p) => ({ ...p, showGrid: !p.showGrid }));
  }
```

Add all five to the returned object. And change `resetFilters` so it restores the full status set instead of clearing it:

```ts
  function resetFilters() {
    setPrefs((p) => ({
      ...p,
      search: "",
      statuses: [...ALL_GANTT_STATUSES],
      priorities: [],
      assignees: [],
    }));
  }
```

Import `ALL_GANTT_STATUSES` from `./gantt-engine`.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/app/gantt-engine.test.ts src/app/use-gantt-prefs.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t7.log
npx tsc --noEmit; echo "EXIT=$?"
```

Existing `gantt.test.tsx` cases that relied on "no filter ⇒ everything shows" will fail in the next task, not this one, because `DEFAULT_PREFS` now ticks everything — which produces the same visible result. If one fails here, read it: it is telling you it asserted on the literal `[]`.

- [ ] **Step 7: Commit**

```bash
git add src/app/gantt-engine.ts src/app/gantt-engine.test.ts src/app/use-gantt-prefs.ts src/app/use-gantt-prefs.test.ts
git commit -m "feat(gantt): prefs v2 with display toggles and empty-status migration"
```

---

## Task 8: Wire the status filter, milestone filtering and the empty state

**Files:**
- Modify: `src/app/gantt.tsx:263-283` (the filter), `:220` (critical-path completed set), the `rows` memo at `:363-367`, and the chart body
- Modify: `src/app/gantt-rows.tsx:76`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (key `ganttNoStatusSelected`)
- Test: `src/app/gantt.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/gantt.test.tsx`, using the file's existing render helper:

```tsx
it("shows nothing and says why when no status is ticked", () => {
  window.localStorage.setItem(
    "aipm-cockpit:gantt-prefs",
    JSON.stringify({ v: 2, statuses: [] }),
  );
  renderGantt({ tasks: [task({ id: 1, taskName: "Visible normally" })] });
  expect(screen.queryByText("Visible normally")).toBeNull();
  expect(screen.getByText(t("en-US", "ganttNoStatusSelected"))).toBeInTheDocument();
});

it("hides a cancelled task when only 'open' is ticked and shows it under 'completed'", () => {
  window.localStorage.setItem(
    "aipm-cockpit:gantt-prefs",
    JSON.stringify({ v: 2, statuses: ["open"] }),
  );
  renderGantt({ tasks: [task({ id: 1, taskName: "Dropped", status: "Cancelled" })] });
  expect(screen.queryByText("Dropped")).toBeNull();
});

it("filters milestone rows by the status buckets", () => {
  window.localStorage.setItem(
    "aipm-cockpit:gantt-prefs",
    JSON.stringify({ v: 2, statuses: ["completed"] }),
  );
  renderGantt({
    tasks: [],
    milestones: [
      { id: 1, name: "Shipped", date: "2026-07-01", achievedDate: "2026-07-01", linkedTaskIds: [] },
      { id: 2, name: "Pending", date: "2026-09-01", linkedTaskIds: [] },
    ],
  });
  expect(screen.getByText("Shipped")).toBeInTheDocument();
  expect(screen.queryByText("Pending")).toBeNull();
});

it("hides every milestone when the milestones toggle is off", () => {
  window.localStorage.setItem(
    "aipm-cockpit:gantt-prefs",
    JSON.stringify({ v: 2, statuses: ["open", "completed", "overdue"], showMilestones: false }),
  );
  renderGantt({
    tasks: [],
    milestones: [{ id: 1, name: "Pending", date: "2026-09-01", linkedTaskIds: [] }],
  });
  expect(screen.queryByText("Pending")).toBeNull();
});
```

`renderGantt` and `task` stand for whatever the file already provides — read the top of `gantt.test.tsx` and use the real names. Clear `localStorage` in a `beforeEach` if the file does not already.

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/app/gantt.test.tsx --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t8.log
```

- [ ] **Step 3: Add the i18n key**

`src/app/i18n.ts`:

```ts
  ganttNoStatusSelected: "No status selected — tick at least one status to show rows.",
```

`src/app/i18n.de.ts` — value `"Kein Status ausgewählt – wählen Sie mindestens einen Status, um Zeilen anzuzeigen."`. **This string has umlauts and the Edit tool corrupts them.** Use the node recipe from Task 18 and verify with a grep afterwards.

- [ ] **Step 4: Flip the filter**

`src/app/gantt.tsx` — add `import { milestoneStatusBucket, taskStatusBuckets } from "./gantt-status-buckets";` and `import { isTaskClosed } from "./task-closed";`.

Replace the status block inside the `visible` memo:

```ts
      // Status filter — a task shows when it lands in ANY ticked bucket. An
      // EMPTY selection shows nothing (v2 semantics); the chart renders an
      // explicit message rather than a blank grid.
      const buckets = taskStatusBuckets(task, bar, today);
      if (!prefs.statuses.some((s) => buckets.has(s))) continue;
```

Delete the old `isComplete`/`isOverdue`/`isOpen` locals and the `if (prefs.statuses.length > 0)` wrapper — the `length > 0` escape hatch **is** the bug.

Line 220, the critical-path completed set:

```ts
    const completed = new Set<number>();
    for (const t of tasks) {
      // Closed, not merely delivered: a cancelled task is not a schedule driver.
      if (isTaskClosed(t)) completed.add(t.id);
    }
```

- [ ] **Step 5: Filter the milestones**

Immediately before the `rows` memo, add a memo over the already-sorted milestones. Hoist every complex expression out of the dep array first:

```ts
  const statusesKey = prefs.statuses.join(",");
  const showMilestones = prefs.showMilestones;
  const visibleMilestones = useMemo(() => {
    if (!showMilestones) return [];
    const ticked = new Set(statusesKey ? statusesKey.split(",") : []);
    return sortedMilestones.filter((m) => ticked.has(milestoneStatusBucket(m, todayISO)));
  }, [showMilestones, statusesKey, sortedMilestones, todayISO]);
```

`statusesKey` is a string precisely because `prefs.statuses` is a fresh array identity each render and `exhaustive-deps` rejects `prefs.statuses` as an `obj.member` dep.

Feed `visibleMilestones` into the `rows` memo (replacing `sortedMilestones`) **and** into `GanttDependencyLayer`'s `sortedMilestones` prop and the `milestoneRowIndexById` lookup — a milestone that is not rendered must not get a connector drawn to a row index that no longer exists.

- [ ] **Step 6: Render the empty state**

In the chart body, wrap the rows list. Directly after the `<GanttHeader …/>` element, before `<div className="relative">`:

```tsx
        {prefs.statuses.length === 0 ? (
          <div className="flex flex-col items-center gap-3 border-t border-line p-10 text-center text-sm text-muted-foreground">
            <span>{t(lang, "ganttNoStatusSelected")}</span>
          </div>
        ) : (
          <div className="relative">
            {/* …existing today marker, dependency layer and rows… */}
          </div>
        )}
```

Keep the header rendered: the user needs the toolbar and the axis to get back out of this state.

- [ ] **Step 7: Row styling follows closed-ness**

`src/app/gantt-rows.tsx:76` — add `import { isTaskClosed } from "./task-closed";` and:

```ts
  const isComplete = isTaskClosed(task);
  const isOverdue = !isComplete && bar.end.getTime() < today.getTime();
```

A cancelled bar now renders struck-through rather than overdue-red, matching the filter.

- [ ] **Step 8: Run the tests and gates**

```bash
npx vitest run src/app/gantt.test.tsx src/app/gantt-rows.test.tsx src/app/gantt-view.test.tsx --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t8.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 9: Commit**

```bash
git add src/app/gantt.tsx src/app/gantt.test.tsx src/app/gantt-rows.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(gantt): status filter covers milestones, empty selection shows nothing, Cancelled counts as completed"
```

---

## Task 9: The View popover

**Files:**
- Create: `src/app/gantt-view-menu.tsx`, `src/app/gantt-view-menu.test.tsx`
- Modify: `src/app/gantt-chrome.tsx` (remove the three inline toggles, mount the menu)
- Modify: `src/app/gantt.tsx` (pass the new toggle callbacks through)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the i18n keys**

`src/app/i18n.ts`:

```ts
  ganttViewMenu: "View",
  ganttViewMenuHint: "Show or hide chart layers",
  ganttShowHolidays: "Holidays",
  ganttShowAbsences: "Absences",
  ganttShowDependencies: "Dependencies",
  ganttShowMilestones: "Milestones",
  ganttShowGrid: "Day grid",
```

`src/app/i18n.de.ts` — same keys: `"Ansicht"`, `"Ebenen ein- oder ausblenden"`, `"Feiertage"`, `"Abwesenheiten"`, `"Abhängigkeiten"`, `"Meilensteine"`, `"Tagesraster"`. **`Abhängigkeiten` carries an umlaut** — node recipe, then verify.

- [ ] **Step 2: Write the failing test**

`src/app/gantt-view-menu.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GanttViewMenu } from "./gantt-view-menu";
import { DEFAULT_PREFS } from "./gantt-engine";
import { t } from "./i18n";

const noop = () => {};
const props = {
  lang: "en-US" as const,
  prefs: DEFAULT_PREFS,
  hasBaseline: true,
  hasMilestones: true,
  toggleCriticalPath: noop,
  toggleBaseline: noop,
  toggleMilestonePlacement: noop,
  toggleHolidays: noop,
  toggleAbsences: noop,
  toggleDependencies: noop,
  toggleMilestones: noop,
  toggleGrid: noop,
};

describe("GanttViewMenu", () => {
  it("keeps the toggles out of the DOM until it is opened", () => {
    render(<GanttViewMenu {...props} />);
    expect(screen.queryByRole("button", { name: t("en-US", "ganttShowGrid") })).toBeNull();
  });

  it("opens and fires the matching toggle", () => {
    const toggleGrid = vi.fn();
    render(<GanttViewMenu {...props} toggleGrid={toggleGrid} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttShowGrid") }));
    expect(toggleGrid).toHaveBeenCalledTimes(1);
  });

  it("reports each toggle's state through aria-pressed", () => {
    render(<GanttViewMenu {...props} prefs={{ ...DEFAULT_PREFS, showGrid: false, showHolidays: true }} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    expect(screen.getByRole("button", { name: t("en-US", "ganttShowGrid") })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: t("en-US", "ganttShowHolidays") })).toHaveAttribute("aria-pressed", "true");
  });

  it("omits the baseline toggle when there is no baseline data", () => {
    render(<GanttViewMenu {...props} hasBaseline={false} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    expect(screen.queryByRole("button", { name: t("en-US", "ganttBaseline") })).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run src/app/gantt-view-menu.test.tsx --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t9.log
```

- [ ] **Step 4: Write the component**

`src/app/gantt-view-menu.tsx`. Use the repo's existing primitives — `PopoverPanel` for the dropdown and `ToggleButton` for each row. Read `popover-panel.tsx` and `toggle-button.tsx` for their exact prop names before writing; the sketch below shows structure and the load-bearing details:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { AdjustmentsHorizontalIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { PopoverPanel } from "./popover-panel";
import { ToggleButton } from "./toggle-button";
import { type GanttPrefs } from "./gantt-engine";

export function GanttViewMenu({
  lang,
  prefs,
  hasBaseline,
  hasMilestones,
  toggleCriticalPath,
  toggleBaseline,
  toggleMilestonePlacement,
  toggleHolidays,
  toggleAbsences,
  toggleDependencies,
  toggleMilestones,
  toggleGrid,
}: {
  lang: Lang;
  prefs: GanttPrefs;
  hasBaseline: boolean;
  hasMilestones: boolean;
  toggleCriticalPath: () => void;
  toggleBaseline: () => void;
  toggleMilestonePlacement: () => void;
  toggleHolidays: () => void;
  toggleAbsences: () => void;
  toggleDependencies: () => void;
  toggleMilestones: () => void;
  toggleGrid: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  // PopoverPanel requires a STABLE onClose identity.
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button
        ref={anchorRef}
        variant="secondary"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        title={t(lang, "ganttViewMenuHint")}
      >
        <AdjustmentsHorizontalIcon aria-hidden="true" className="h-3.5 w-3.5" />
        {t(lang, "ganttViewMenu")}
      </Button>
      {open && (
        <PopoverPanel anchorRef={anchorRef} onClose={close}>
          <div className="flex w-56 flex-col gap-1 p-2">
            <ToggleButton lang={lang} pressed={prefs.showDependencies} onToggle={toggleDependencies}>
              {t(lang, "ganttShowDependencies")}
            </ToggleButton>
            <ToggleButton lang={lang} pressed={prefs.showHolidays} onToggle={toggleHolidays}>
              {t(lang, "ganttShowHolidays")}
            </ToggleButton>
            <ToggleButton lang={lang} pressed={prefs.showAbsences} onToggle={toggleAbsences}>
              {t(lang, "ganttShowAbsences")}
            </ToggleButton>
            <ToggleButton lang={lang} pressed={prefs.showGrid} onToggle={toggleGrid}>
              {t(lang, "ganttShowGrid")}
            </ToggleButton>
            <ToggleButton lang={lang} pressed={prefs.showCriticalPath} onToggle={toggleCriticalPath} accent="pink">
              {t(lang, "ganttCriticalPath")}
            </ToggleButton>
            {hasBaseline && (
              <ToggleButton lang={lang} pressed={prefs.showBaseline} onToggle={toggleBaseline}>
                {t(lang, "ganttBaseline")}
              </ToggleButton>
            )}
            {hasMilestones && (
              <>
                <ToggleButton lang={lang} pressed={prefs.showMilestones} onToggle={toggleMilestones}>
                  {t(lang, "ganttShowMilestones")}
                </ToggleButton>
                <ToggleButton
                  lang={lang}
                  pressed={prefs.milestonePlacement === "inline"}
                  onToggle={toggleMilestonePlacement}
                >
                  {t(lang, "ganttMilestonesInline")}
                </ToggleButton>
              </>
            )}
          </div>
        </PopoverPanel>
      )}
    </>
  );
}
```

Every label is **pinned to what the toggle enables**, and `aria-pressed` tracks that state — so "Day grid, pressed" means the grid is on. Do not flip a label to the opposite action; `ToggleButton` also supplies the non-colour pressed marker that WCAG 1.4.1 needs in the dark schemes. That is exactly why these are `ToggleButton`s and not hand-rolled `<button aria-pressed>`s.

- [ ] **Step 5: Run the component test**

```bash
npx vitest run src/app/gantt-view-menu.test.tsx --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t9.log
```

- [ ] **Step 6: Mount it in the toolbar**

`src/app/gantt-chrome.tsx` — delete the three inline `ToggleButton` blocks (critical path, baseline, milestone placement) and render `<GanttViewMenu … />` in their place, i.e. **after** the reset-filters button and **before** `<PrintButton />`. Widen `GanttToolbar`'s props with the five new callbacks and pass all eight through. Remove any now-unused imports (`BoltIcon`, `FlagIcon`, `MapPinIcon`, possibly `ToggleButton`) — an unused import is a fatal lint error.

`src/app/gantt.tsx` — pass the five new callbacks from `useGanttPrefs()` into `GanttToolbar`.

- [ ] **Step 7: Pin the toolbar order**

Append to `src/app/gantt.test.tsx`, using the shared helper (never a hand-rolled `compareDocumentPosition` walk — `buttonIndex` throws when a key matches zero or several buttons, which a `findIndex` would silently swallow):

```tsx
import { expectButtonOrder } from "../test/toolbar-order";

it("keeps View ahead of the contiguous trailing reset group", () => {
  renderGantt({ tasks: [task({ id: 1 })] });
  expectButtonOrder(
    [
      t("en-US", "ganttViewMenu"),
      t("en-US", "print"),
      t("en-US", "ganttResetNameCol"),
      t("en-US", "tableResetSizeHint"),
    ],
    { contiguous: true, from: 1 },
  );
});
```

Read `src/test/toolbar-order.ts` for its real signature and option names, and for how it expresses "these three must be contiguous but the first only has to precede them". Use the real i18n keys for the print and reset buttons.

- [ ] **Step 8: Run everything for the Gantt**

```bash
npx vitest run src/app/gantt.test.tsx src/app/gantt-view-menu.test.tsx src/app/gantt-view.test.tsx --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t9.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 9: Commit**

```bash
git add src/app/gantt-view-menu.tsx src/app/gantt-view-menu.test.tsx src/app/gantt-chrome.tsx src/app/gantt.tsx src/app/gantt.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(gantt): collect display toggles into a View popover"
```

---

## Task 10: Holiday columns and the day grid

**Files:**
- Create: `src/app/gantt-overlays.tsx`, `src/app/gantt-overlays.test.tsx`
- Modify: `src/app/gantt.tsx` (accept `holidaySet`, mount both layers, gate the absence bands)
- Modify: `src/app/gantt-rows.tsx` (accept `showAbsences`)
- Modify: `src/app/gantt-view.tsx` (pass `holidaySet` down)

- [ ] **Step 1: Write the failing test**

`src/app/gantt-overlays.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GanttGridLayer, GanttNonWorkingLayer } from "./gantt-overlays";

const range = { min: new Date("2026-08-01T00:00:00Z"), days: 3 };

describe("GanttNonWorkingLayer", () => {
  it("renders one column per holiday inside the window", () => {
    const { container } = render(
      <GanttNonWorkingLayer
        range={range}
        holidaySet={new Set(["2026-08-02", "2027-01-01"])}
        nameColWidth={100}
        heightPx={64}
      />,
    );
    expect(container.querySelectorAll("[data-holiday]")).toHaveLength(1);
  });

  it("renders nothing for an empty holiday set", () => {
    const { container } = render(
      <GanttNonWorkingLayer range={range} holidaySet={new Set()} nameColWidth={100} heightPx={64} />,
    );
    expect(container.querySelectorAll("[data-holiday]")).toHaveLength(0);
  });
});

describe("GanttGridLayer", () => {
  it("renders one line per day in the window", () => {
    const { container } = render(
      <GanttGridLayer range={range} nameColWidth={100} heightPx={64} />,
    );
    expect(container.querySelectorAll("[data-grid-line]")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/gantt-overlays.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t10.log
```

- [ ] **Step 3: Write the layers**

`src/app/gantt-overlays.tsx`:

```tsx
"use client";

// src/app/gantt-overlays.tsx — two decorative full-height overlays behind the
// Gantt rows. Both take the SAME geometry the header uses (range.min +
// DAY_WIDTH_PX), so a holiday band and a grid line always sit under the day
// label they belong to. Pure and presentational; no state, no data derivation.
import { addDays, DAY_WIDTH_PX } from "./gantt-engine";

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function GanttNonWorkingLayer({
  range,
  holidaySet,
  nameColWidth,
  heightPx,
}: {
  range: { min: Date; days: number };
  holidaySet: ReadonlySet<string>;
  nameColWidth: number;
  heightPx: number;
}) {
  if (holidaySet.size === 0) return null;
  const cells = [];
  for (let i = 0; i < range.days; i += 1) {
    const day = addDays(range.min, i);
    if (!holidaySet.has(isoOf(day))) continue;
    cells.push(
      <div
        key={i}
        data-holiday={isoOf(day)}
        aria-hidden
        className="pointer-events-none absolute top-0 bg-ui-medium-grey/15"
        style={{ left: nameColWidth + i * DAY_WIDTH_PX, width: DAY_WIDTH_PX, height: heightPx }}
      />,
    );
  }
  return <>{cells}</>;
}

export function GanttGridLayer({
  range,
  nameColWidth,
  heightPx,
}: {
  range: { min: Date; days: number };
  nameColWidth: number;
  heightPx: number;
}) {
  return (
    <>
      {Array.from({ length: range.days }).map((_, i) => (
        <div
          key={i}
          data-grid-line={i}
          aria-hidden
          className="pointer-events-none absolute top-0 border-l border-dashed border-line"
          style={{ left: nameColWidth + i * DAY_WIDTH_PX, height: heightPx }}
        />
      ))}
    </>
  );
}
```

Both are `aria-hidden` decoration and `pointer-events-none` so they cannot intercept a bar drag. No gradient: the palette guard bans `bg-gradient-` outright, and it scans comments too — do not write the word for a drop-shadow anywhere in this file.

- [ ] **Step 4: Mount them**

`src/app/gantt.tsx` — add `holidaySet?: ReadonlySet<string>` to the props (default `new Set()` via a hoisted module-level `const EMPTY_HOLIDAYS: ReadonlySet<string> = new Set();`, never an inline `new Set()` default, which would be a fresh identity every render). Import both layers, then render them inside `<div className="relative">` **before** the today marker so they paint underneath it:

```tsx
            {prefs.showHolidays && (
              <GanttNonWorkingLayer
                range={range}
                holidaySet={holidaySet}
                nameColWidth={nameColWidth}
                heightPx={totalRowsCount * ROW_HEIGHT_PX}
              />
            )}
            {prefs.showGrid && (
              <GanttGridLayer
                range={range}
                nameColWidth={nameColWidth}
                heightPx={totalRowsCount * ROW_HEIGHT_PX}
              />
            )}
```

Pass `showAbsences={prefs.showAbsences}` to `GanttTaskRow`.

`src/app/gantt-rows.tsx` — add `showAbsences: boolean` to `GanttTaskRow`'s props and wrap the absence-band block:

```tsx
        {showAbsences && (() => {
          /* …existing band-rendering IIFE body… */
        })()}
```

`src/app/gantt-view.tsx` — pass `holidaySet` into `<GanttPanel>`. Read the file to find what it already has in scope; if `holidaySet` is not there, thread it from `workspace-section` the same way the other panes receive it.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/app/gantt-overlays.test.tsx src/app/gantt.test.tsx src/app/gantt-rows.test.tsx src/app/gantt-view.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t10.log
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 6: Look at it**

```bash
npm run dev
```

Gantt → View → toggle Holidays and Day grid. Confirm a grid line lands under each day label in the header, and that a holiday column aligns with its date. jsdom reports every rect as zero, so **no test can check this alignment** — the eye is the only instrument here.

- [ ] **Step 7: Commit**

```bash
git add src/app/gantt-overlays.tsx src/app/gantt-overlays.test.tsx src/app/gantt.tsx src/app/gantt-rows.tsx src/app/gantt-view.tsx
git commit -m "feat(gantt): holiday columns and an optional dotted day grid"
```

---

## Task 11: Dependency arrows — diagnose, then gate and strengthen

The arrows are already implemented (`gantt-chrome.tsx:381-450`) and drawn unconditionally for any task carrying `dependencies`. Find out why the reporter does not see them **before** changing the drawing code.

**Files:**
- Modify: `src/app/gantt.tsx` (gate the layer)
- Modify: `src/app/gantt-chrome.tsx:441-447` (stroke weight)
- Test: `src/app/gantt.test.tsx`

- [ ] **Step 1: Diagnose**

```bash
npm run dev
```

In the browser console on the Gantt view, check whether any task actually carries predecessors:

```js
JSON.parse(localStorage.getItem("aipm-cockpit:settings") ?? "{}") && "settings readable"
```

Then open a task in the editor and look for the dependency picker. Record which of these is true:

1. **No task has any dependency.** Then nothing is broken in the drawing code — the finding is that the reporter has not set predecessors, and the arrows will appear as soon as they do. Say so plainly and continue with steps 2-5 (toggle + contrast) as the actual deliverable.
2. **Dependencies exist but no arrow is painted.** Then it is a rendering defect. Inspect the `<svg>` in DevTools: check whether it has a non-zero `height`, whether the `<path>` elements exist with sane `d` coordinates, and whether a later sibling paints over it. Fix what you find and add a regression test.

Write the answer into the commit message. Do not skip this step and do not guess.

- [ ] **Step 2: Write the failing test for the toggle**

Append to `src/app/gantt.test.tsx`:

```tsx
it("hides the dependency layer when the toggle is off", () => {
  window.localStorage.setItem(
    "aipm-cockpit:gantt-prefs",
    JSON.stringify({ v: 2, statuses: ["open", "completed", "overdue"], showDependencies: false }),
  );
  const { container } = renderGantt({
    tasks: [
      task({ id: 1, taskName: "Pred", dueDate: "2026-08-10" }),
      task({ id: 2, taskName: "Succ", dueDate: "2026-08-20", dependencies: [{ taskId: 1, type: "FS" }] }),
    ],
  });
  expect(container.querySelector("svg path[marker-end]")).toBeNull();
});

it("draws the dependency layer when the toggle is on", () => {
  window.localStorage.setItem(
    "aipm-cockpit:gantt-prefs",
    JSON.stringify({ v: 2, statuses: ["open", "completed", "overdue"], showDependencies: true }),
  );
  const { container } = renderGantt({
    tasks: [
      task({ id: 1, taskName: "Pred", dueDate: "2026-08-10" }),
      task({ id: 2, taskName: "Succ", dueDate: "2026-08-20", dependencies: [{ taskId: 1, type: "FS" }] }),
    ],
  });
  expect(container.querySelector("svg path[marker-end]")).not.toBeNull();
});
```

The second case is not redundant with the first: without it, deleting the layer entirely would still pass.

- [ ] **Step 3: Run them to verify the first fails**

```bash
npx vitest run src/app/gantt.test.tsx --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t11.log
```

Expected: the "hides" case FAILS (the layer is unconditional), the "draws" case PASSES.

- [ ] **Step 4: Gate the layer and raise contrast**

`src/app/gantt.tsx` — wrap the existing `<GanttDependencyLayer …/>`:

```tsx
          {prefs.showDependencies && (
            <GanttDependencyLayer
              /* …unchanged props… */
            />
          )}
```

`src/app/gantt-chrome.tsx` — the non-critical arrow is drawn at `strokeOpacity={0.45}` and `strokeWidth={1.25}`, which is close to invisible against the row borders. Raise the non-critical arm only:

```tsx
              strokeOpacity={isCritical ? 0.85 : 0.7}
              strokeWidth={isCritical ? 2 : 1.5}
```

The critical arm keeps its values so the red chain still reads as the stronger signal.

- [ ] **Step 5: Run and verify**

```bash
npx vitest run src/app/gantt.test.tsx --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t11.log
npx tsc --noEmit; echo "EXIT=$?"
```

Then look at the chart with two dependent tasks and confirm the arrow is legible.

- [ ] **Step 6: Commit**

```bash
git add src/app/gantt.tsx src/app/gantt.test.tsx src/app/gantt-chrome.tsx
git commit -m "feat(gantt): dependency-arrow toggle and legible non-critical strokes

Diagnosis: <write what step 1 actually established>"
```

- [ ] **Step 7: Gantt is axe-scanned — run the gate on a FRESH server**

```bash
PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium -g "Gantt" > /tmp/a11y-gantt.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a11y-gantt.log
PORT=3100 npm run stop
```

Use a fresh isolated port, never a long-running dev server: Playwright's `reuseExistingServer` will attach to a stale `:3000` whose Tailwind has not regenerated the new utility classes, producing phantom failures.

---

# Workstream C — Open Points and Settings

## Task 12: Modal reset-size icon matches the main windows

**Files:**
- Modify: `src/app/modal-header.tsx:4`, `:84`
- Test: `src/app/modal-header.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/modal-header.test.tsx`:

```tsx
it("uses the inward-arrows reset glyph, matching the main-window reset buttons", () => {
  renderHeader({ onResetSize: () => {} });
  const button = screen.getByRole("button", { name: t("en-US", "modalResetSize") });
  // heroicons stamp their name on the rendered <svg> path set; the inward-arrows
  // glyph is a single path whose d starts with the arrow-in corner move.
  expect(button.querySelector("svg")).toBeTruthy();
  expect(button.innerHTML).toContain("M9 9V4.5M9 9H4.5");
});
```

Confirm the real path prefix by rendering `ArrowsPointingInIcon` once and reading its markup; substitute whatever the installed heroicons version emits. If the version's markup makes this brittle, assert instead that the header's icon markup equals `ResetSizeIcon`'s rendered markup — that is the property that actually matters.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/modal-header.test.tsx --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t12.log
```

- [ ] **Step 3: Swap the icon**

`src/app/modal-header.tsx` line 4:

```ts
import { ArrowsPointingInIcon, XMarkIcon } from "@heroicons/react/24/outline";
```

Line 84:

```tsx
            <ArrowsPointingInIcon aria-hidden="true" className="h-4 w-4" />
```

Import the icon straight from heroicons rather than `ResetSizeIcon` from `task-manager-ui`: `modal-header` is a low-level primitive and pulling in an orchestrator-level module for one glyph is the wrong direction of dependency. Both render the identical `ArrowsPointingInIcon`.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/app/modal-header.test.tsx --reporter=dot > /tmp/t12.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t12.log
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/modal-header.tsx src/app/modal-header.test.tsx
git commit -m "fix(ui): modal reset-size uses the same glyph as the main windows"
```

---

## Task 13: Destructive bordered `IconButton`, used by Clear all

**Files:**
- Modify: `src/app/icon-button.tsx:14`, `:22-32`
- Modify: `src/app/tasks-section.tsx:773-781`
- Test: `src/app/icon-button.test.tsx`, `src/app/tasks-section.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/icon-button.test.tsx`:

```tsx
it("dangerBordered carries the destructive border and text at rest", () => {
  render(<IconButton variant="dangerBordered" label="Clear all"><span /></IconButton>);
  const btn = screen.getByRole("button", { name: "Clear all" });
  expect(btn.className).toContain("border-ui-pink/50");
  expect(btn.className).toContain("text-ui-pink-strong");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/icon-button.test.tsx --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t13.log
```

- [ ] **Step 3: Add the variant**

`src/app/icon-button.tsx`:

```ts
export type IconButtonVariant = "ghost" | "danger" | "bordered" | "dangerBordered";
```

```ts
  // Destructive AND bordered: a standing destructive affordance in a toolbar,
  // matching Settings → General's "Reset to clean slate". `danger` above is the
  // per-row remove glyph, which stays muted until hover; this one reads as
  // destructive at rest because it wipes everything.
  dangerBordered:
    "border border-ui-pink/50 bg-surface text-ui-pink-strong hover:bg-ui-pink/10",
```

- [ ] **Step 4: Use it**

`src/app/tasks-section.tsx` — the Clear-all `IconButton` changes `variant="bordered"` to `variant="dangerBordered"`. Nothing else about it moves: it stays where it is in the toolbar, before the trailing Print · reset-columns · reset-size group.

- [ ] **Step 5: Run, check contrast, commit**

```bash
npx vitest run src/app/icon-button.test.tsx src/app/tasks-section.test.tsx --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t13.log
npx tsc --noEmit; echo "EXIT=$?"
```

`--ui-pink-strong` is tuned to AA on `bg-surface`, which is what this variant uses — no alpha, no opacity fade on the element, or it drops under AA.

```bash
git add src/app/icon-button.tsx src/app/icon-button.test.tsx src/app/tasks-section.tsx
git commit -m "feat(ui): dangerBordered IconButton variant, used by Open Points Clear all"
```

---

## Task 14: "I am this resource" moves to Settings → General

**Files:**
- Modify: `src/app/settings-sections/appearance-section.tsx:176-201` (remove), props at `:24-33`
- Modify: `src/app/settings-sections/general-section.tsx` (add)
- Modify: `src/app/settings-view.tsx:304`, `:311`
- Test: `src/app/settings-sections/general-section.test.tsx`, `appearance-section.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `general-section.test.tsx`:

```tsx
it("renders the self-resource picker and writes the chosen id", () => {
  const onChange = vi.fn();
  render(
    <GeneralSection
      lang="en-US"
      settings={defaultSettings}
      onChange={onChange}
      resources={[{ id: 7, name: "Ada" } as Resource]}
    />,
  );
  fireEvent.change(screen.getByLabelText(t("en-US", "selfResourceLabel")), {
    target: { value: "7" },
  });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selfResourceId: 7 }));
});
```

Append to `appearance-section.test.tsx`:

```tsx
it("no longer renders the self-resource picker", () => {
  render(<AppearanceSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
  expect(screen.queryByLabelText(t("en-US", "selfResourceLabel"))).toBeNull();
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/app/settings-sections/general-section.test.tsx src/app/settings-sections/appearance-section.test.tsx --reporter=dot > /tmp/t14.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t14.log
```

- [ ] **Step 3: Move the block**

Cut lines 176-201 out of `appearance-section.tsx` and paste them into `general-section.tsx`, changing the element id so it no longer claims to live in Appearance:

```tsx
      <div className="mb-4">
        <label htmlFor="general-self-resource" className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "selfResourceLabel")}
          <InfoTooltip text={t(lang, "selfResourceHint")} />
        </label>
        <Select
          size="xs"
          id="general-self-resource"
          value={settings.selfResourceId != null ? String(settings.selfResourceId) : ""}
          aria-label={t(lang, "selfResourceLabel")}
          onChange={(e) =>
            onChange({
              ...settings,
              selfResourceId: e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
          className="w-full"
        >
          <option value="">{t(lang, "selfResourceNone")}</option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {resourceDisplayName(r)}
            </option>
          ))}
        </Select>
      </div>
```

Place it above the reset block so the destructive control stays last in the pane.

`GeneralSectionProps` gains `resources?: readonly Resource[];` and the component signature gains `resources = []`. Import `Select`, `resourceDisplayName` and the `Resource` type; drop whichever of those `appearance-section.tsx` no longer uses — an unused import is a fatal lint error.

If `AppearanceSection` has no other use for `resources`, remove the prop from its interface **and** from its call site at `settings-view.tsx:304`. Add `resources={props.resources}` to the `GeneralSection` call at `:311`.

- [ ] **Step 4: Run the tests and the a11y gate**

```bash
npx vitest run src/app/settings-sections/general-section.test.tsx src/app/settings-sections/appearance-section.test.tsx src/app/settings-view.test.tsx --reporter=dot > /tmp/t14.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t14.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings" > /tmp/a11y-settings.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a11y-settings.log
PORT=3100 npm run stop
```

Settings → General is axe-scanned and the control is moving **into** that scan, so the gate genuinely re-checks it here.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/general-section.tsx src/app/settings-sections/general-section.test.tsx src/app/settings-sections/appearance-section.tsx src/app/settings-sections/appearance-section.test.tsx src/app/settings-view.tsx
git commit -m "refactor(settings): move the self-resource picker from Appearance to General"
```

---

## Task 15: Bulk-edit panel scrolls instead of overflowing

**Files:**
- Modify: `src/app/bulk-edit-modal.tsx:51-52`, `:363`
- Test: `src/app/bulk-edit-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/bulk-edit-modal.test.tsx`:

```tsx
it("caps the field list height and scrolls it, keeping the actions reachable", () => {
  const { container } = renderBulkEditModal({ selectedIds: new Set([1]) });
  const scroller = container.querySelector("[data-bulk-fields]");
  expect(scroller).not.toBeNull();
  expect(scroller!.className).toContain("overflow-y-auto");
  expect(scroller!.className).toContain("max-h-[60vh]");
  const actions = container.querySelector("[data-bulk-actions]");
  expect(actions!.className).toContain("sticky");
});
```

Use the file's real render helper. jsdom has no layout engine, so this asserts the classes that produce the behaviour — the only thing testable here. Confirm the real scrolling by eye in step 4.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/bulk-edit-modal.test.tsx --reporter=dot > /tmp/t15.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t15.log
```

- [ ] **Step 3: Cap and stick**

`src/app/bulk-edit-modal.tsx` — the field wrapper at line 59 becomes:

```tsx
      <div data-bulk-fields className="max-h-[60vh] space-y-4 overflow-y-auto pr-2">
```

`pr-2` is the repo's content-to-scrollbar gap convention for any new inner scroller.

The action row at line 363 becomes:

```tsx
      <div
        data-bulk-actions
        className="sticky bottom-0 mt-6 flex justify-end gap-2 border-t border-line bg-surface pt-4"
      >
```

The panel's own outer `bg-surface` is what makes the sticky footer opaque over the scrolling content behind it; do not make it transparent.

- [ ] **Step 4: Run and look**

```bash
npx vitest run src/app/bulk-edit-modal.test.tsx --reporter=dot > /tmp/t15.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t15.log
npx tsc --noEmit; echo "EXIT=$?"
npm run dev
```

Open Points → select rows → Bulk edit, on a short window. The field list must scroll and Apply/Cancel must stay visible.

- [ ] **Step 5: Commit**

```bash
git add src/app/bulk-edit-modal.tsx src/app/bulk-edit-modal.test.tsx
git commit -m "fix(tasks): bulk-edit panel scrolls its fields and keeps its actions in reach"
```

---

## Task 16: One definition of "the rows the table renders"

Select-all currently reaches every task in `filteredSortedTasks`, which is upstream of both the hide-finished toggle and the RAG health filter. Rather than duplicating that filtering in the hook (two definitions that can drift), extract one pure helper and have both callers use it.

**Files:**
- Create: `src/app/visible-task-rows.ts`, `src/app/visible-task-rows.test.ts`
- Modify: `src/app/tasks-section.tsx:364-370`
- Modify: `src/app/use-bulk-operations.ts:100-141` and its args interface
- Modify: `src/app/task-manager.tsx:1543` (pass `today` + `holidaySet`)
- Test: `src/app/use-bulk-operations.test.tsx`

- [ ] **Step 1: Write the failing test for the helper**

`src/app/visible-task-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { visibleTaskRows } from "./visible-task-rows";
import { type Task } from "./types";

const task = (over: Partial<Task>): Task => ({
  id: 1, taskName: "t", assignee: "a", priority: "Medium", status: "To Do", dueDate: "2026-09-01",
} as Task & typeof over);

describe("visibleTaskRows", () => {
  const args = { today: "2026-08-03", holidaySet: new Set<string>() };

  it("keeps finished tasks when hideFinished is off", () => {
    const tasks = [task({ id: 1 }), task({ id: 2, status: "Done", completedDate: "2026-08-01" })];
    expect(visibleTaskRows(tasks, "all", false, args).map((t) => t.id)).toEqual([1, 2]);
  });

  it("drops finished tasks when hideFinished is on", () => {
    const tasks = [task({ id: 1 }), task({ id: 2, status: "Done", completedDate: "2026-08-01" })];
    expect(visibleTaskRows(tasks, "all", true, args).map((t) => t.id)).toEqual([1]);
  });

  it("drops a cancelled task when hideFinished is on", () => {
    const tasks = [task({ id: 1 }), task({ id: 3, status: "Cancelled" })];
    expect(visibleTaskRows(tasks, "all", true, args).map((t) => t.id)).toEqual([1]);
  });

  it("applies the health filter as well", () => {
    const tasks = [task({ id: 1, dueDate: "2020-01-01" }), task({ id: 2, dueDate: "2027-01-01" })];
    expect(visibleTaskRows(tasks, "R", false, args).map((t) => t.id)).toEqual([1]);
  });
});
```

Check `HealthFilter`'s real member names in `health.ts` and use them.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/visible-task-rows.test.ts --reporter=dot > /tmp/t16.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t16.log
```

- [ ] **Step 3: Write the helper**

`src/app/visible-task-rows.ts`:

```ts
// src/app/visible-task-rows.ts — the SINGLE definition of which task rows the
// Open Points table actually renders: the health filter, then hide-finished.
//
// Both the pane (which draws the rows) and useBulkOperations (which decides
// what select-all reaches) call this. They used to disagree: the hook read
// `filteredSortedTasks`, which is upstream of both filters, so select-all
// silently picked up rows the user could not see.
import { filterTasksByHealth, type HealthFilter } from "./health";
import { isTaskClosed } from "./task-closed";
import { type Task } from "./types";

export function visibleTaskRows<T extends Task>(
  tasks: readonly T[],
  healthFilter: HealthFilter,
  hideFinished: boolean,
  ctx: { today: string; holidaySet: ReadonlySet<string> },
): T[] {
  const byHealth = filterTasksByHealth(tasks, healthFilter, ctx.today, ctx.holidaySet);
  return hideFinished ? byHealth.filter((t) => !isTaskClosed(t)) : byHealth;
}
```

Check `filterTasksByHealth`'s real signature at `health.ts:121` and match its parameter order and `Set` vs `ReadonlySet` typing exactly.

- [ ] **Step 4: Use it in the pane**

`src/app/tasks-section.tsx` — replace lines 364-370:

```ts
  const healthFilteredTasks = useMemo(
    () => filterTasksByHealth(filteredSortedTasks, healthFilter, today, holidaySet),
    [filteredSortedTasks, healthFilter, today, holidaySet],
  );
  const visibleRows = useMemo(
    () => visibleTaskRows(filteredSortedTasks, healthFilter, hideFinished, { today, holidaySet }),
    [filteredSortedTasks, healthFilter, hideFinished, today, holidaySet],
  );
```

`healthFilteredTasks` stays: the Kanban lanes and the swimlane drop handler read it and they deliberately ignore hide-finished.

- [ ] **Step 5: Write the failing test for select-all**

Append to `src/app/use-bulk-operations.test.tsx`:

```tsx
it("select-all skips rows hidden by hide-finished", () => {
  const api = renderBulkOps({
    tasks: [task({ id: 1 }), task({ id: 2, status: "Done", completedDate: "2026-08-01" })],
    settings: { ...defaultSettings, hideFinishedTasks: true },
  });
  act(() => api.current.toggleSelectAllVisible());
  expect([...api.current.selectedIds]).toEqual([1]);
});

it("bulk apply never touches a selected row that a filter has since hidden", () => {
  const api = renderBulkOps({
    tasks: [task({ id: 1 }), task({ id: 2, status: "Done", completedDate: "2026-08-01" })],
    settings: { ...defaultSettings, hideFinishedTasks: false },
  });
  act(() => api.current.toggleSelectAllVisible());
  // The user now turns hide-finished on, so #2 is no longer rendered.
  act(() => api.rerenderWith({ settings: { ...defaultSettings, hideFinishedTasks: true } }));
  act(() => api.current.applyBulkEdit({ priority: "High" }));
  expect(api.tasksNow().find((t) => t.id === 2)!.priority).not.toBe("High");
});
```

The second case needs the selection made **while the row is visible** and applied **after** it is hidden — a fixture that never changes the filter passes whether or not the guard exists. Match the file's real harness names and the real bulk-apply entry point.

- [ ] **Step 6: Run them to verify they fail**

```bash
npx vitest run src/app/use-bulk-operations.test.tsx --reporter=dot > /tmp/t16.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t16.log
```

- [ ] **Step 7: Feed the hook the same rows**

`src/app/use-bulk-operations.ts` — add to `UseBulkOperationsArgs`:

```ts
  /** Day-boundary context for the health filter, so the hook's idea of a
   *  visible row is byte-for-byte the pane's. */
  today: string;
  holidaySet: ReadonlySet<string>;
```

Pull `healthFilter` out of the `useFilters()` destructure the hook already performs, then replace `visibleIds`:

```ts
  const hideFinished = args.settings.hideFinishedTasks ?? false;
  const visibleRows = useMemo(
    () =>
      visibleTaskRows(filteredSortedTasks, healthFilter, hideFinished, {
        today: args.today,
        holidaySet: args.holidaySet,
      }),
    [filteredSortedTasks, healthFilter, hideFinished, args.today, args.holidaySet],
  );
  const visibleIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
```

`args.today` and `args.holidaySet` in a dep array are `obj.member` expressions, which `exhaustive-deps` rejects — hoist both to scalar/local consts above the memo and depend on those.

Then, in the bulk-apply path, intersect before writing:

```ts
    // A row selected while visible and hidden by a later filter change must not
    // be edited from under the user. `visibleIds` is what they can see now.
    const visible = new Set(visibleIds);
    const targetIds = [...selectedIds].filter((id) => visible.has(id));
```

and use `targetIds` in place of the raw selection for the edit loop. Leave the delete-selected and send-inquiry paths alone unless their tests say otherwise — this task's scope is bulk *edit*.

`src/app/task-manager.tsx:1543` — add `today,` and `holidaySet,` to the `useBulkOperations({ … })` argument object. Both are already in scope there.

- [ ] **Step 8: Run everything and the gates**

```bash
npx vitest run src/app/visible-task-rows.test.ts src/app/use-bulk-operations.test.tsx src/app/tasks-section.test.tsx --reporter=dot > /tmp/t16.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/t16.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 9: Commit**

```bash
git add src/app/visible-task-rows.ts src/app/visible-task-rows.test.ts src/app/tasks-section.tsx src/app/use-bulk-operations.ts src/app/use-bulk-operations.test.tsx src/app/task-manager.tsx
git commit -m "fix(tasks): select-all and bulk apply only reach rows the table renders"
```

---

## Task 17: Full gate run

**Files:** none — this is verification.

- [ ] **Step 1: Unit suite with coverage**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |ERROR|threshold" /tmp/cov.log | tail -30
```

Must exit 0. The coverage floors are blocking in CI and `test:run` does not enforce them. Four new `.ts` files land in this plan (`task-closed`, `gantt-status-buckets`, `visible-task-rows`, plus the `.tsx` overlays/menu) — the three pure `.ts` modules are coverage-gated and each has tests, so they should clear. If a floor fails, add the missing cases rather than adding an exclude.

- [ ] **Step 2: Lint and typecheck, unpiped**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 3: Duplication and size ratchets**

```bash
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dup.log
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/size.log
```

`gantt.tsx` and `tasks-section.tsx` both grow in this plan and both are near their baselines. If `size:check` fails, split the offending file along the existing orchestrator / rows / chrome convention — do not baseline the growth.

- [ ] **Step 4: Full axe gate on a fresh isolated server**

```bash
PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium > /tmp/a11y-all.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/a11y-all.log
PORT=3100 npm run stop
```

Expected: 86 passing. Gantt, Open Points, Settings, Reports and Dashboard are all touched by this plan and all are scanned.

- [ ] **Step 5: Eye-verify what no gate covers**

The Gantt chart body is not covered by any assertion that can see pixels, and the Kanban board and Resources → Calendar are not axe-scanned at all. Walk through by hand:

1. Gantt → View popover: every toggle flips the right layer; keyboard reachable; Escape closes it.
2. Holiday columns and grid lines align with their header day labels.
3. Untick every status → the message appears; tick one → rows return.
4. A cancelled task renders struck-through, not overdue-red.
5. Open Points → Clear all reads as destructive and matches the clean-slate button.
6. Bulk edit scrolls on a short window with the actions pinned.
7. Settings → General shows the self-resource picker; Appearance no longer does.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "test: fixes from the full gate run"
```

---

## Task 18: Release 0.213.0

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` (5 files), `AGENTS.md`, `docs/open-followups.md`

- [ ] **Step 1: Pick a codename**

Codenames are unique. Check every one already used before choosing:

```bash
grep -oE '"[A-Z][a-z]+"' CHANGELOG.md | sort -u | head -50
```

- [ ] **Step 2: Bump every place the version lives**

`src/app/version.ts` — `APP_VERSION`, `APP_BUILD_DATE`, milestone/codename.

**Five more places carry the version and no gate checks any of them:**

- `package.json` `version`
- `package-lock.json` — **two** occurrences (the root `version` and the `packages[""]` one)
- the README shields badge — version **and** codename
- the `<!-- Generated: … | App <version> "<codename>" … -->` header on all five `docs/CODEMAPS/*.md`

Bump them in this same commit or the drift restarts.

- [ ] **Step 3: Changelog and highlight strings**

Add the `CHANGELOG.md` entry. Any new `versionHighlight*` i18n key must also be appended to `APP_HIGHLIGHT_KEYS` with EN **and** DE strings.

- [ ] **Step 4: Write DE strings safely**

Every DE string added across this plan (`ganttNoStatusSelected`, `ganttShowDependencies`, `ganttViewMenuHint`, `reportsCancelled`, the highlight) goes in through node, not the Edit tool, because `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts and curls double quotes:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
// Anchor on \r\n — a \n anchor silently matches nothing in this CRLF file.
s = s.replace("  ganttBaseline:", "  ganttShowDependencies: \"Abhängigkeiten\",\r\n  ganttBaseline:");
fs.writeFileSync(p, s, "utf8");
'
grep -c "Abhängigkeiten" src/app/i18n.de.ts
```

The grep must print a non-zero count with the umlaut intact. Then confirm key parity:

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot > /tmp/i18n.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/i18n.log
```

The encoding test bans ASCII substitutions (`fuer`, `druecken`) — it is what catches a mangled write.

- [ ] **Step 5: Update the docs this plan invalidates**

`AGENTS.md` claims things that stop being true here. Correct them in the same commit:

- the Gantt module map gains `gantt-status-buckets.ts`, `gantt-overlays.tsx`, `gantt-view-menu.tsx`
- the task-status bullet says Cancelled is "excluded from overdue/next-actions/health-red, but completion-% still counts Done only" — completion-% now also **drops cancelled from the denominator**, and reports carry a third bucket
- the toolbar-order bullet should name the Gantt View menu's position

No gate checks `AGENTS.md`. Every claim you leave stale becomes a landmine for the next contributor.

- [ ] **Step 6: Full gate, then commit**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/cov.log
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run build > /tmp/build.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/build.log
```

```bash
git add -A
git commit -m "chore(release): 0.213.0 \"<Codename>\""
```

Do **not** push, open an MR, or merge unless the user explicitly says so.
