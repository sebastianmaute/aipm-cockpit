# SP-A — Task Status Model + Table UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class workflow `status` to tasks (To Do / In Progress / On Hold / In Review / Cancelled / Done), make it the field that drives "done", surface it in the table (badge column + inline dropdown + form picker) with a hide-finished toggle.

**Architecture:** `status` is the source of truth; `completedDate` is auto-managed to preserve the invariant `status==="Done" ⟺ completedDate set`, so existing completedDate-based logic keeps working untouched. A pure `task-status.ts` engine (i18n-free) holds all status logic. New persisted `Task.status` flows through all six write paths + codecs + golden fixtures. Cancelled is terminal-but-not-completed and is excluded only at active surfaces (overdue, next-actions). View prefs (hide-finished) live in per-device `Settings`.

**Tech Stack:** Forked Next.js 16 / React 19 / TypeScript; vitest; i18n EN+DE (tsc parity); Tailwind AIPM palette tokens; playwright axe gate.

Spec: `docs/superpowers/specs/2026-06-19-task-status-model-spa-design.md`

---

## Conventions every task must follow (read before starting)

- After editing **any** test file, run `npx tsc --noEmit` — `next build` and vitest do NOT typecheck tests; a test-only type error fails CI. A string `name` in `getByRole` is already an exact match — never pass `{ exact: ... }`.
- `npm run lint` runs with `--max-warnings=0`: an unused import/var is FATAL. Re-check after every extract.
- i18n: EN (`i18n.ts`) and DE (`i18n.de.ts`) key sets must be identical (tsc enforces). DE must use real German umlauts. **The Edit tool corrupts umlauts and curls quotes in `i18n.de.ts`** — add DE strings via a node UTF-8 write script, anchoring on `\r\n` (the file is CRLF), then re-verify. Tests use `lang="en-US"`; to assert DE call `loadI18n("de")` in `beforeAll`.
- Palette: only sanctioned AIPM tokens from `globals.css`. No off-palette colors, gradients, or `shadow-*` Tailwind classes. Verify the new badge by eye.
- Every new interactive control needs an accessible name. In a list of rows, per-row controls need a **row-unique** name.
- Commit after each task with a conventional-commit message.
- Run `npm run test:run` (vitest) before each commit; it must be green.

---

## File Map

- `src/app/types.ts` — `TaskStatus`, `TASK_STATUSES`, `DEFAULT_TASK_STATUS`; add `status: TaskStatus` to `Task`.
- `src/app/task-status.ts` (NEW, pure, i18n-free) — `isTaskFinished`, `applyStatusChange`, `migrateTaskStatus`, `statusSortIndex`.
- `src/app/task-status.test.ts` (NEW) — unit tests for the engine.
- `src/app/csv-codecs.ts` — add `"status"` to `CSV_COLUMNS`; parse it in `csvToTasks` via `migrateTaskStatus`.
- `src/app/markdown-codecs.ts` — add `{ key: "status", label: "Status" }` to `MD_COLUMNS`; migrate in the MD task-row parser.
- `src/app/workspace.ts` — map `migrateTaskStatus` over tasks in `jsonToWorkspace` (and verify Turso/IDB load paths).
- `src/app/due-dates.ts`, `src/app/health.ts`, `src/app/next-actions/` input builder — exclude Cancelled from active surfaces via `isTaskFinished`.
- `src/app/task-form-context.tsx` — `status` in `emptyForm`; form↔task mapping.
- task editor surfaces (`TaskFormModal`, modern `TaskEditView`) — status `<select>`.
- `src/app/tasks-section.tsx` + `src/app/use-column-manager.ts` — status column, badge cell, inline dropdown, sort, column registration.
- `src/app/settings-types.ts` — `view.hideFinishedTasks` pref + sanitizer; header toggle + table filter.
- `src/app/i18n.ts` / `i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md`.
- `src/app/__fixtures__/golden-*`, `src/sample-workspace-small.md`, `src/sample-workspace-small.csv`, generated `-big`/`-huge`/`.sqlite3`.

---

## Task 1: Status type + pure engine

**Files:**
- Modify: `src/app/types.ts` (add type + consts + field)
- Create: `src/app/task-status.ts`
- Create: `src/app/task-status.test.ts`

- [ ] **Step 1: Write the failing test** — `src/app/task-status.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  isTaskFinished,
  applyStatusChange,
  migrateTaskStatus,
  statusSortIndex,
} from "./task-status";
import type { Task } from "./types";

const base = (over: Partial<Task> = {}): Task =>
  ({
    id: 1,
    taskName: "T",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-06-01",
    lastUpdateDate: "2026-05-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    status: "To Do",
    ...over,
  }) as Task;

describe("isTaskFinished", () => {
  it("is true for Done and Cancelled", () => {
    expect(isTaskFinished(base({ status: "Done" }))).toBe(true);
    expect(isTaskFinished(base({ status: "Cancelled" }))).toBe(true);
  });
  it("is false for the four open statuses", () => {
    for (const s of ["To Do", "In Progress", "On Hold", "In Review"] as const)
      expect(isTaskFinished(base({ status: s }))).toBe(false);
  });
});

describe("applyStatusChange", () => {
  it("stamps completedDate when moving to Done", () => {
    const out = applyStatusChange(base({ status: "In Progress" }), "Done", "2026-06-19");
    expect(out.status).toBe("Done");
    expect(out.completedDate).toBe("2026-06-19");
  });
  it("keeps an existing completedDate when already Done", () => {
    const out = applyStatusChange(base({ status: "Done", completedDate: "2026-01-01" }), "Done", "2026-06-19");
    expect(out.completedDate).toBe("2026-01-01");
  });
  it("clears completedDate when moving off Done", () => {
    const out = applyStatusChange(base({ status: "Done", completedDate: "2026-01-01" }), "In Progress", "2026-06-19");
    expect(out.completedDate).toBe("");
  });
  it("leaves completedDate empty for Cancelled", () => {
    const out = applyStatusChange(base({ status: "In Progress" }), "Cancelled", "2026-06-19");
    expect(out.completedDate).toBe("");
  });
  it("returns a new object (immutable)", () => {
    const input = base({ status: "To Do" });
    const out = applyStatusChange(input, "In Progress", "2026-06-19");
    expect(out).not.toBe(input);
    expect(input.status).toBe("To Do");
  });
});

describe("migrateTaskStatus", () => {
  it("derives Done from a set completedDate when status is absent", () => {
    const raw = { ...base(), completedDate: "2026-01-01" } as Partial<Task>;
    delete (raw as Record<string, unknown>).status;
    expect(migrateTaskStatus(raw as Task).status).toBe("Done");
  });
  it("derives To Do when no completedDate and status absent", () => {
    const raw = { ...base() } as Partial<Task>;
    delete (raw as Record<string, unknown>).status;
    expect(migrateTaskStatus(raw as Task).status).toBe("To Do");
  });
  it("keeps a valid existing status", () => {
    expect(migrateTaskStatus(base({ status: "On Hold" })).status).toBe("On Hold");
  });
  it("falls back to To Do on an invalid status string", () => {
    expect(migrateTaskStatus(base({ status: "garbage" as unknown as Task["status"] })).status).toBe("To Do");
  });
});

describe("statusSortIndex", () => {
  it("orders by TASK_STATUSES position", () => {
    expect(statusSortIndex("To Do")).toBeLessThan(statusSortIndex("Done"));
    expect(statusSortIndex("Cancelled")).toBeLessThan(statusSortIndex("Done"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- task-status`
Expected: FAIL — `./task-status` and `Task.status` do not exist yet.

- [ ] **Step 3: Add the type to `types.ts`**

Add near the `Priority`/`PRIORITIES` block (after line ~84):

```ts
export type TaskStatus =
  | "To Do" | "In Progress" | "On Hold" | "In Review" | "Cancelled" | "Done";
export const TASK_STATUSES: TaskStatus[] = [
  "To Do", "In Progress", "On Hold", "In Review", "Cancelled", "Done",
];
export const DEFAULT_TASK_STATUS: TaskStatus = "To Do";
```

Add the field to the `Task` type (after `priority: Priority;`, around line 44):

```ts
  /** Workflow status. Source of truth for "done": status==="Done" keeps the
   *  invariant completedDate-set; "Cancelled" is terminal but not completed. */
  status: TaskStatus;
```

- [ ] **Step 4: Implement `src/app/task-status.ts`**

```ts
// src/app/task-status.ts — pure, i18n-free task workflow-status engine.
import { DEFAULT_TASK_STATUS, TASK_STATUSES, type Task, type TaskStatus } from "./types";

const STATUS_SET = new Set<string>(TASK_STATUSES);

/** Done and Cancelled are terminal. Cancelled is "finished" for hiding and for
 *  active-surface exclusion, but it is NOT "completed" (no completedDate). */
export function isTaskFinished(task: Pick<Task, "status">): boolean {
  return task.status === "Done" || task.status === "Cancelled";
}

/** Change a task's status while preserving the invariant
 *  `status==="Done" ⟺ completedDate set`. Pure: returns a new object. */
export function applyStatusChange(task: Task, next: TaskStatus, today: string): Task {
  if (next === "Done") {
    return { ...task, status: "Done", completedDate: task.completedDate || today };
  }
  return { ...task, status: next, completedDate: "" };
}

/** Normalize a raw/legacy task to a valid status. Absent/invalid status derives
 *  from completedDate (set => Done, else To Do). Valid status is kept as-is. */
export function migrateTaskStatus(task: Task): Task {
  if (typeof task.status === "string" && STATUS_SET.has(task.status)) return task;
  const derived: TaskStatus = task.completedDate ? "Done" : DEFAULT_TASK_STATUS;
  return { ...task, status: derived };
}

/** Sort index following TASK_STATUSES order. Unknown => end. */
export function statusSortIndex(status: string): number {
  const i = TASK_STATUSES.indexOf(status as TaskStatus);
  return i === -1 ? TASK_STATUSES.length : i;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- task-status`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/types.ts src/app/task-status.ts src/app/task-status.test.ts
git commit -m "feat(sp-a): TaskStatus type + pure task-status engine"
```

Note: `tsc` will now flag every place that constructs a `Task` without `status` (it's required). That is expected and is fixed in Task 2 (sanitize/migrate) and Task 5 (form). If too many call sites break the typecheck mid-plan, temporarily satisfy them by adding `status: "To Do"` — but the real fixes live in later tasks. Do NOT make `status` optional to dodge this.

---

## Task 2: Migrate status on all load paths

**Files:**
- Modify: `src/app/workspace.ts` (`jsonToWorkspace`, ~line 310; verify Turso/IDB read)
- Modify: `src/app/csv-codecs.ts` (`CSV_COLUMNS` ~line 68; `csvToTasks` ~line 1487)
- Modify: `src/app/markdown-codecs.ts` (`MD_COLUMNS` ~line 269; MD task-row parser)
- Test: `src/app/csv-codecs.test.ts` (or the existing task codec test), `src/app/workspace.test.ts`

- [ ] **Step 1: Write the failing test** — add to the CSV/MD round-trip test file (find the existing `csvToWorkspace`/`workspaceToCsv` test; if none, create `src/app/task-status-persistence.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { jsonToWorkspace } from "./workspace";

describe("status persistence", () => {
  it("round-trips status through CSV", () => {
    const ws = csvToWorkspace(
      workspaceToCsv(
        // minimal workspace with one In-Review task
        jsonToWorkspace(JSON.stringify({
          tasks: [{ id: 1, taskName: "T", assignee: "", assigneeEmail: "",
            dueDate: "2026-06-01", lastUpdateDate: "2026-05-01", priority: "Medium",
            blockers: "", notes: "", status: "In Review" }],
          raid: [],
        })),
      ),
    );
    expect(ws.tasks[0].status).toBe("In Review");
  });

  it("migrates a legacy task (no status, completedDate set) to Done on JSON load", () => {
    const ws = jsonToWorkspace(JSON.stringify({
      tasks: [{ id: 1, taskName: "T", assignee: "", assigneeEmail: "",
        dueDate: "2026-06-01", lastUpdateDate: "2026-05-01", priority: "Medium",
        blockers: "", notes: "", completedDate: "2026-01-01" }],
      raid: [],
    }));
    expect(ws.tasks[0].status).toBe("Done");
  });

  it("migrates a legacy open task (no status, no completedDate) to To Do", () => {
    const ws = jsonToWorkspace(JSON.stringify({
      tasks: [{ id: 1, taskName: "T", assignee: "", assigneeEmail: "",
        dueDate: "2026-06-01", lastUpdateDate: "2026-05-01", priority: "Medium",
        blockers: "", notes: "" }],
      raid: [],
    }));
    expect(ws.tasks[0].status).toBe("To Do");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- task-status-persistence` (or the test file you added to)
Expected: FAIL — `status` is `undefined` after load (raw cast / missing column).

- [ ] **Step 3: Add `"status"` to `CSV_COLUMNS`** in `src/app/csv-codecs.ts` — insert after `"priority"` (line ~76):

```ts
  "priority",
  "status",
  "blockers",
```

In `csvToTasks` (~line 1487), after the task object is assembled, run it through `migrateTaskStatus` so a missing/empty `status` column on legacy CSVs derives correctly. Import at top: `import { migrateTaskStatus } from "./task-status";`. Where each parsed task is pushed, wrap: `tasks.push(migrateTaskStatus(task));`. (The `status` cell, when present, is already assigned by the generic column→field mapping; `migrateTaskStatus` is a no-op for valid values.)

- [ ] **Step 4: Add status to Markdown** in `src/app/markdown-codecs.ts` — add to `MD_COLUMNS` (after `priority`, ~line 277):

```ts
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
```

In the MD task-row parser (the function that builds `Task` objects from the parsed markdown table — mirrors `MD_COLUMNS`), apply `migrateTaskStatus` to each built task before pushing (same pattern as CSV). Import `migrateTaskStatus` from `./task-status`.

- [ ] **Step 5: Migrate on JSON + Turso + IDB load** in `src/app/workspace.ts` — change line ~310:

```ts
      tasks: (p.tasks as Task[]).map(migrateTaskStatus),
```

Add `import { migrateTaskStatus } from "./task-status";` at the top of `workspace.ts`. Then **verify** the Turso load and IndexedDB/BrowserBackend load paths: if they build the workspace via `jsonToWorkspace`/`csvToWorkspace`, they are already covered. If a backend reconstructs tasks from columns directly (search for where Turso rows → `Task` and where BrowserBackend reads `tasks`), apply `.map(migrateTaskStatus)` there too. Grep: `rg "as Task\[\]" src/app` and `rg "tasks:" src/app/*backend*`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:run -- task-status-persistence`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/csv-codecs.ts src/app/markdown-codecs.ts src/app/workspace.ts src/app/task-status-persistence.test.ts
git commit -m "feat(sp-a): persist + migrate Task.status across load paths and codecs"
```

---

## Task 3: Regenerate golden fixtures + sample workspace

**Files:**
- Modify: `src/sample-workspace-small.md`, `src/sample-workspace-small.csv`
- Regenerate: `src/app/__fixtures__/golden-*`, generated `-big`/`-huge` JSON + `.sqlite3`
- Test: `src/app/golden-workspace.test.ts` (must pass after regen)

- [ ] **Step 1: Run the golden test to see it fail**

Run: `npm run test:run -- golden-workspace`
Expected: FAIL — serialized bytes now include the new `status` / `Status` column, diverging from the pinned fixtures. This is a **legitimate** new-column format change (not a bug to mask).

- [ ] **Step 2: Add the `status` column to the curated `.md` master**

Edit `src/sample-workspace-small.md` task table: add a `Status` column header + separator cell, and a value for every task row. Derive each row's value from its existing `Completed` cell: a non-empty Completed → `Done`, else `To Do`. **Edit by exact full-line replacement of each table row** (MD cells with internal `|` are `\|`-escaped — never naive-split).

- [ ] **Step 3: Add the `status` column to `sample-workspace-small.csv`**

The CSV has multi-line quoted fields — do NOT hand-split. Patch via the app codec round-trip: write a one-off node/vite-node snippet that reads the file, `csvToWorkspace` → for each task set `status` per the same Completed-derived rule → `workspaceToCsv` → write back. Verify the diff only adds the `status` column.

- [ ] **Step 4: Regenerate generated samples**

Run: `npx vite-node scripts/generate-sample-workspace.ts`
Expected: rewrites `sample-workspace-small.json`, `-big`, `-huge`, and `.sqlite3` from the `.md` master (status now flows through).

- [ ] **Step 5: Regenerate golden fixtures**

Regenerate `src/app/__fixtures__/golden-*` via the serializers (follow the existing regen step the repo documents — the golden test's failure message or a `scripts/` regen helper). Confirm the only change is the added column.

- [ ] **Step 6: Run the full suite**

Run: `npm run test:run`
Expected: PASS — golden-workspace + sample-data tests green; byte-stable again.

- [ ] **Step 7: Commit**

```bash
git add src/sample-workspace-small.md src/sample-workspace-small.csv src/app/__fixtures__ src/sample-workspace-small.json src/sample-workspace-big.json src/sample-workspace-huge.json src/*.sqlite3
git commit -m "chore(sp-a): regenerate golden fixtures + sample workspace with status column"
```

---

## Task 4: Exclude Cancelled from active surfaces

**Files:**
- Modify: `src/app/due-dates.ts` and/or `src/app/health.ts` (overdue derivation)
- Modify: `src/app/next-actions/` input builder (the module that maps tasks → `ActionInput`)
- Test: `src/app/task-status.active-surfaces.test.ts` (NEW) or extend existing `health.test.ts` / `due-dates.test.ts`

- [ ] **Step 1: Identify the chokepoints**

Run: `rg "completedDate" src/app/due-dates.ts src/app/health.ts src/app/next-actions` to see where "is this task still open/overdue" is decided. Today these read `completedDate`. A Done task is already excluded (completedDate set). The change: also exclude **Cancelled** (which has no completedDate) using `isTaskFinished`.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
// import the overdue predicate / health fn under test, e.g.:
import { isOverdue } from "./due-dates"; // adjust to the real export
import type { Task } from "./types";

const t = (over: Partial<Task>): Task =>
  ({ id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2020-01-01",
     lastUpdateDate: "2019-12-01", priority: "Medium", blockers: "", notes: "",
     status: "To Do", ...over }) as Task;

describe("Cancelled is not active", () => {
  it("a Cancelled task past due is not overdue", () => {
    expect(isOverdue(t({ status: "Cancelled" }), "2026-06-19")).toBe(false);
  });
  it("an open task past due is overdue", () => {
    expect(isOverdue(t({ status: "To Do" }), "2026-06-19")).toBe(true);
  });
});
```

Adjust imports/fn names to the actual exports you found in Step 1. If overdue is computed inline (no exported predicate), add the guard at that site and test via the public function that uses it (e.g. `health.ts`'s task-health fn, or the next-actions input builder output).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- active-surfaces` (or the file you used)
Expected: FAIL — Cancelled past-due currently treated as overdue.

- [ ] **Step 4: Add the guard**

At each active-surface chokepoint, early-return "not active / not overdue / skip" when `isTaskFinished(task)` (covers Done via existing completedDate path AND Cancelled). Import `isTaskFinished` from `./task-status`. For the next-actions input builder, filter Cancelled tasks out of (or mark inactive in) the task-derived signals the same way completed tasks are already handled.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- active-surfaces`
Expected: PASS. Then `npm run test:run` to confirm no regressions in `health.test.ts` / `due-dates.test.ts` / next-actions tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sp-a): exclude Cancelled tasks from overdue + next-actions"
```

---

## Task 5: Status in the task form (both editor surfaces)

**Files:**
- Modify: `src/app/task-form-context.tsx` (`emptyForm`, ~line 20)
- Modify: the form→Task save mapping (find via `rg "use-task-submit" src/app`; likely `use-task-submit.ts`)
- Modify: `TaskFormModal` and the modern `TaskEditView` control surface (add a status `<select>`)
- Test: `src/app/use-task-submit.test.ts` (extend), component test for the picker

- [ ] **Step 1: Write the failing test** — extend `src/app/use-task-submit.test.ts`:

```ts
it("saves the chosen status on a new task", () => {
  // arrange a form draft with status "In Progress", submit, assert the built task
  // (follow the existing submit-test harness in this file)
  const nextList = setTasks.mock.calls[0][0] as Task[];
  expect(nextList.find((x) => x.taskName === "New")!.status).toBe("In Progress");
});

it("defaults a new task to To Do when status untouched", () => {
  const nextList = setTasks.mock.calls[0][0] as Task[];
  expect(nextList[0].status).toBe("To Do");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- use-task-submit`
Expected: FAIL — form has no `status`; built task lacks/ignores it.

- [ ] **Step 3: Add `status` to `emptyForm`** in `task-form-context.tsx` (after `priority: "Medium" as Priority,`):

```ts
    status: "To Do" as TaskStatus,
```

Import `TaskStatus` from `./types`. When opening the editor for an existing task, the draft must carry that task's `status` (find where a `Task` is mapped into the form draft — likely a `draftFromTask`/`formFromTask` helper or inline in the row-handler — and copy `status`).

- [ ] **Step 4: Map form → task on save**

In the submit mapping (`use-task-submit.ts` or equivalent), set `status: form.status` on the built task. On **new** tasks, also keep the completedDate invariant: build the raw task then run it through `applyStatusChange(task, form.status, todayISO())` so a task created directly as "Done" gets a completedDate. Import `applyStatusChange` from `./task-status`.

- [ ] **Step 5: Add the picker to both editor surfaces**

In `TaskFormModal` and the modern `TaskEditView` control surface, add a labeled `<select>`:

```tsx
<label className="flex flex-col gap-1 text-sm">
  <span>{t(lang, "status")}</span>
  <select
    value={form.status}
    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaskStatus }))}
    className="rounded-md border border-line bg-surface px-2 py-1"
  >
    {TASK_STATUSES.map((s) => (
      <option key={s} value={s}>{t(lang, statusLabelKey(s))}</option>
    ))}
  </select>
</label>
```

`statusLabelKey` maps each status to its i18n key (defined in Task 8). Use the existing form-field layout/classes in each surface rather than the sketch above where they differ.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test:run -- use-task-submit` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sp-a): status picker in task form (both editor surfaces)"
```

---

## Task 6: Status column + badge + sort + column registration

**Files:**
- Modify: `src/app/use-column-manager.ts` (`DEFAULT_COL_WIDTHS`)
- Modify: `src/app/tasks-section.tsx` (`ALL_TASK_COLS`, `CONFIGURABLE_COLS`, `<th>` + sort, `<col>` widths)
- Modify: `src/app/task-row.tsx` (render the badge cell)
- Create: `src/app/task-status-badge.tsx` (small presentational badge)
- Test: `src/app/task-row.test.tsx` (extend), `src/app/tasks-section.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** — extend `src/app/task-row.test.tsx`:

```ts
it("renders the task status badge text", () => {
  // render a row for a task with status "In Review" (follow the file's render harness)
  expect(screen.getByText("In Review")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- task-row`
Expected: FAIL — no status cell yet.

- [ ] **Step 3: Create the badge** — `src/app/task-status-badge.tsx`:

```tsx
import { type Lang, t } from "./i18n";
import type { TaskStatus } from "./types";
import { statusLabelKey, statusBadgeClass } from "./task-status-ui";

export function TaskStatusBadge({ status, lang }: { status: TaskStatus; lang: Lang }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${statusBadgeClass(status)}`}>
      {t(lang, statusLabelKey(status))}
    </span>
  );
}
```

Create `src/app/task-status-ui.ts` holding `statusLabelKey(status): TranslationKey` and `statusBadgeClass(status): string` (palette tokens only — e.g. map open statuses to neutral/blue/amber surface tokens, Cancelled to muted, Done to green; reuse the exact tokens the priority/RAG chips already use; NO off-palette classes). Keep this separate from pure `task-status.ts` (it imports i18n keys).

- [ ] **Step 4: Register the column**

`use-column-manager.ts` `DEFAULT_COL_WIDTHS` — add `taskStatus: 110,` (after `priority`). In `tasks-section.tsx`:
- `ALL_TASK_COLS` — insert `"taskStatus"` after `"priority"`.
- `CONFIGURABLE_COLS` — add `{ key: "taskStatus", labelKey: "colTaskStatus" }`.
- Header row — add a sortable `<th>` guarded by `!hiddenCols.has("taskStatus")`:
  `{!hiddenCols.has("taskStatus") && <SortableTh label={t(lang, "colTaskStatus")} sortKey="taskStatus" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("taskStatus", e)} lang={lang} />}`
- The `<col>` width loop already maps over `ALL_TASK_COLS.filter(...)`, so the width applies automatically once added to `DEFAULT_COL_WIDTHS`.

- [ ] **Step 5: Wire the sort comparator**

Find the task sort (`sortKey` handling — likely in `tasks-section.tsx` or a `sortTasks` helper / `useFilters`). Add a `"taskStatus"` case comparing `statusSortIndex(a.status) - statusSortIndex(b.status)`. Import `statusSortIndex` from `./task-status`.

- [ ] **Step 6: Render the badge cell** in `task-row.tsx`, guarded by `!hiddenCols.has("taskStatus")`, positioned to match the header order (after the priority cell). Use `<TaskStatusBadge status={task.status} lang={lang} />`.

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test:run -- task-row tasks-section` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sp-a): task status column + badge + sort + column-chooser entry"
```

---

## Task 7: Inline status dropdown in the table cell

**Files:**
- Modify: `src/app/task-row.tsx` (replace the read-only badge cell with an editable dropdown)
- Modify: row-handlers to expose a status-change callback (find via `rg "onEdit" src/app/use-task-row-handlers.ts`)
- Test: `src/app/task-row.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** — extend `src/app/task-row.test.tsx`:

```ts
it("changes status via the inline dropdown with a row-unique label", () => {
  // render a row for task { taskName: "Alpha", status: "To Do" }
  const select = screen.getByRole("combobox", { name: "Status – Alpha" });
  fireEvent.change(select, { target: { value: "In Progress" } });
  expect(onStatusChange).toHaveBeenCalledWith(/* taskId */ 1, "In Progress");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- task-row`
Expected: FAIL — cell is a static badge, no combobox.

- [ ] **Step 3: Add the status-change handler**

In `use-task-row-handlers.ts`, add `onStatusChange(id: number, next: TaskStatus)` that does:
`setTasks((prev) => prev.map((row) => row.id === id ? applyStatusChange(row, next, todayISO()) : row))` and stamps `localModifiedAt`. Import `applyStatusChange` from `./task-status`. Thread the callback down to `TaskRow` (same wiring path as `onEdit`/`onDelete`).

- [ ] **Step 4: Replace the cell with a dropdown** in `task-row.tsx`:

```tsx
{!hiddenCols.has("taskStatus") && (
  <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
    <label className="sr-only" htmlFor={`status-${task.id}`}>
      {`${t(lang, "status")} – ${task.taskName}`}
    </label>
    <select
      id={`status-${task.id}`}
      aria-label={`${t(lang, "status")} – ${task.taskName}`}
      value={task.status}
      onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
      className="rounded border border-line bg-surface px-1 py-0.5 text-xs"
    >
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>{t(lang, statusLabelKey(s))}</option>
      ))}
    </select>
  </td>
)}
```

`onClick stopPropagation` keeps a row-click (open editor) from firing when changing status. The `aria-label` is **row-unique** (includes the task name) — required so the axe gate doesn't pass on a single-seeded row while real multi-row data fails WCAG 2.4.6.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test:run -- task-row` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sp-a): inline status dropdown in task table (row-unique a11y label)"
```

---

## Task 8: Hide-finished toggle + i18n keys

**Files:**
- Modify: `src/app/settings-types.ts` (add `view.hideFinishedTasks` + sanitize)
- Modify: `src/app/tasks-section.tsx` (header toggle + filter)
- Modify: `src/app/i18n.ts` and `src/app/i18n.de.ts` (all new keys)
- Create: `src/app/task-status-ui.ts` already created in Task 6 — add `statusLabelKey` there
- Test: `src/app/settings-types.test.ts` (extend), `src/app/tasks-section.test.tsx` (extend), `src/app/i18n.test.ts` if present

- [ ] **Step 1: Write the failing test** — extend `src/app/tasks-section.test.tsx`:

```ts
it("hides Done and Cancelled tasks when hide-finished is on", () => {
  // render TasksSection with settings.view.hideFinishedTasks = true and tasks:
  //   Alpha (To Do), Bravo (Done), Charlie (Cancelled)
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
  expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tasks-section`
Expected: FAIL — no hide-finished filter; all three render.

- [ ] **Step 3: Add the setting** in `settings-types.ts`

Add `hideFinishedTasks?: boolean` to the `view` settings group (find the existing `view`/`features` shape). In the settings sanitizer, default it: `hideFinishedTasks: obj.hideFinishedTasks === true` (default OFF). Persist only via the existing settings writer — never raw `setItem`.

- [ ] **Step 4: Add the toggle + filter** in `tasks-section.tsx`

Add a labeled toggle in the header bar (beside the column-config gear):

```tsx
<label className="flex items-center gap-1 text-xs text-muted-foreground">
  <input
    type="checkbox"
    checked={settings.view?.hideFinishedTasks ?? false}
    onChange={(e) => onChangeSettings((s) => ({
      ...s, view: { ...s.view, hideFinishedTasks: e.target.checked },
    }))}
    className="h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
  />
  {t(lang, "hideFinishedTasks")}
</label>
```

Apply the filter where `filteredSortedTasks` is consumed for rendering — wrap with: `const rows = (settings.view?.hideFinishedTasks ? filteredSortedTasks.filter((r) => !isTaskFinished(r)) : filteredSortedTasks);` and render `rows`. Import `isTaskFinished` from `./task-status`. Keep the count label using `rows.length`. (Thread `settings`/`onChangeSettings` into `TasksSection` if not already present — follow how other settings reach this component.)

- [ ] **Step 5: Add all i18n keys (EN)** in `src/app/i18n.ts`:

```ts
  statusToDo: "To Do",
  statusInProgress: "In Progress",
  statusOnHold: "On Hold",
  statusInReview: "In Review",
  statusCancelled: "Cancelled",
  statusDone: "Done",
  colTaskStatus: "Status",
  hideFinishedTasks: "Hide finished",
  versionHighlightTaskStatus: "Tasks now have a workflow status (To Do → Done) with a status column, inline editing, and a hide-finished toggle.",
```

Implement `statusLabelKey` in `task-status-ui.ts`:

```ts
import type { TranslationKey } from "./i18n";
import type { TaskStatus } from "./types";
const MAP: Record<TaskStatus, TranslationKey> = {
  "To Do": "statusToDo", "In Progress": "statusInProgress", "On Hold": "statusOnHold",
  "In Review": "statusInReview", "Cancelled": "statusCancelled", "Done": "statusDone",
};
export function statusLabelKey(s: TaskStatus): TranslationKey { return MAP[s]; }
```

- [ ] **Step 6: Add the DE keys via node UTF-8 write (NOT Edit)**

Write a one-off node script (run, then delete) that appends the identical keys to `src/app/i18n.de.ts`, using real umlauts and matching the file's CRLF + quote style:

```js
// scripts/_tmp-de.js — run with: node scripts/_tmp-de.js
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const block = [
  '  statusToDo: "Zu erledigen",',
  '  statusInProgress: "In Arbeit",',
  '  statusOnHold: "Pausiert",',
  '  statusInReview: "In Pruefung",',          // FIX BELOW — must be real umlaut
  '  statusCancelled: "Abgebrochen",',
  '  statusDone: "Erledigt",',
  '  colTaskStatus: "Status",',
  '  hideFinishedTasks: "Erledigte ausblenden",',
  '  versionHighlightTaskStatus: "Aufgaben haben jetzt einen Workflow-Status (Zu erledigen bis Erledigt) mit Statusspalte, Inline-Bearbeitung und Ausblenden erledigter Aufgaben.",',
].join("\r\n");
// anchor: insert before the closing of the DE dictionary (match the same anchor EN used)
s = s.replace(/(\r\n\}[^]*$)/, "\r\n" + block + "$1"); // adjust anchor to the real file
fs.writeFileSync(p, s, "utf8");
```

**Correct the umlaut:** `statusInReview` DE must be `"In Prüfung"` (real ü), not `Pruefung` — the `i18n-encoding` test BANS ASCII substitutions. Write the real character via the script (UTF-8). After running, `git diff` the file to confirm umlauts render correctly and no quotes got curled, then delete the temp script.

- [ ] **Step 7: Run tests + typecheck**

Run: `npm run test:run` then `npx tsc --noEmit`
Expected: PASS / clean (i18n EN/DE parity + encoding test green).

- [ ] **Step 8: Commit**

```bash
git add src/app/settings-types.ts src/app/tasks-section.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/task-status-ui.ts
git commit -m "feat(sp-a): hide-finished toggle + status i18n (EN+DE)"
```

---

## Task 9: Release bump + a11y verify + docs

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`
- Verify: axe gate for the tasks view

- [ ] **Step 1: Bump version** in `src/app/version.ts`

Set `APP_VERSION = "0.107.0"`, `APP_MILESTONE = "LeGuin"`, and append `"versionHighlightTaskStatus"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: Add CHANGELOG entry** at the top of `CHANGELOG.md`:

```markdown
## 0.107.0 "LeGuin" — 2026-06-19

### Added
- Task workflow status (To Do / In Progress / On Hold / In Review / Cancelled / Done):
  status column with palette-tokened badges, inline status dropdown, and a status
  picker in the task editor.
- "Hide finished" toggle in the tasks view (hides Done + Cancelled).

### Changed
- `status` is now the source of truth for task completion; `completedDate` is
  auto-managed (invariant: Done ⟺ completedDate set). Cancelled tasks are terminal
  but excluded from overdue flags, next-actions, and completion metrics.
- Legacy tasks migrate on load: completedDate set → Done, otherwise To Do.
```

- [ ] **Step 3: Build (prebuild checks) + full suite**

Run: `npm run build` then `npm run test:run`
Expected: build passes (script-docs sync, version highlight key present); vitest green.

- [ ] **Step 4: a11y gate for the tasks view**

The tasks/Open-Points view — confirm whether it is in `A11Y_VIEWS` (`e2e/a11y.spec.ts`). If yes:
Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"`
Expected: PASS (the inline status dropdown carries a row-unique aria-label). If the view is NOT in `A11Y_VIEWS`, the inline dropdown isn't auto-scanned — verify by eye that the label is present and unique, and that the badge uses palette tokens only.

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore(sp-a): release v0.107.0 LeGuin (task status model)"
```

---

## Final review

After all tasks: dispatch a final code review over the whole branch diff (`git diff main...HEAD`), focusing on:
- The completedDate invariant held at every status-write site (form save, inline dropdown, migration).
- All six persistence paths carry `status` (JSON/CSV/MD/Turso-single/Turso-tenant/IDB) — no backend silently drops it.
- No off-palette badge classes; row-unique a11y labels; no raw `setItem` for the new setting.
- i18n EN/DE parity + real umlauts; `tsc` clean including tests.

Then use **superpowers:finishing-a-development-branch**.
