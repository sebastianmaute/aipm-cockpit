# SP-B — Kanban Board + Jira Gating + Edit-Modal Buttons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a switchable Kanban board to the tasks pane (one column per status, native-drag + per-card status select), with Jira-synced tasks read-only at their nearest Jira-equivalent column, plus Send inquiry / Push to Jira / Delete buttons in the task editor.

**Architecture:** Board is a pure view over `Task.status` (no new persisted Workspace field). A per-device `tasksViewMode` setting toggles table↔board in `tasks-section.tsx`. Status moves route through SP-A's `onStatusChange`→`applyStatusChange`. Jira sync derives `status` from `statusCategory` inside `issueToTaskFields` (self-consistent with completedDate); synced tasks (`jiraKey`) are UI-read-only.

**Tech Stack:** Forked Next.js 16 / React 19 / TypeScript; native HTML5 drag-and-drop (no DnD lib); vitest; i18n EN+DE (tsc parity); Tailwind AIPM palette tokens.

Spec: `docs/superpowers/specs/2026-06-19-task-kanban-spb-design.md`. Depends on SP-A (`task-status.ts`, `task-status-ui.ts`, `onStatusChange`).

---

## Conventions (read first)

- After editing ANY test file run `npx tsc --noEmit` (build + vitest don't typecheck tests). `getByRole` string `name` is already exact — never `{exact:...}`.
- `npm run lint` is `--max-warnings=0`: unused import/var is FATAL.
- i18n EN (`i18n.ts`) + DE (`i18n.de.ts`) key sets must be identical (tsc enforces). DE is CRLF; the Edit tool curls quotes + corrupts umlauts → add DE keys via a node UTF-8 write script (anchor on `\r\n`), then delete the script. Tests use `lang="en-US"`; assert DE via `loadI18n("de")` in `beforeAll`.
- Palette: sanctioned AIPM tokens only (`globals.css`) — no off-palette color, `shadow-*`, or gradient. Verify board/card by eye (palette-sweep only scans CSS box-shadow).
- Per-row/-card interactive control needs a row-UNIQUE accessible name.
- `npm run test:run` (vitest) green before each commit. Commit per task (conventional commits).

---

## File Map

- `src/app/task-kanban.ts` (NEW pure) — `groupByStatus(tasks): Record<TaskStatus, Task[]>`.
- `src/app/jira-status-map.ts` (NEW pure) — `jiraCategoryToStatus(key): TaskStatus`, `isJiraSynced(task): boolean`.
- `src/app/jira-api.ts` — add `status` to the `issueToTaskFields` patch.
- `src/app/use-jira-sync.ts` — apply `patch.status` in the new-task + update-synced paths.
- `src/app/use-task-row-handlers.ts` — `onStatusChange` no-ops when target is synced.
- `src/app/task-row.tsx` — disable the SP-A inline status select for synced tasks.
- `src/app/settings-types.ts` / `src/app/use-settings.ts` — `tasksViewMode` field + default + sanitize.
- `src/app/task-kanban.tsx` (NEW) — board: 6 columns, drop targets, drag.
- `src/app/task-kanban-card.tsx` (NEW) — compact card + per-card select.
- `src/app/tasks-section.tsx` — Table/Board toggle + branch render.
- editor caller (where `TaskEditView`/`TaskFormModal` get their `footer`) — Send inquiry / Push to Jira / Delete buttons.
- `src/app/i18n.ts` / `i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md`.

---

## Task 1: Pure helpers (groupByStatus + jira status map)

**Files:** Create `src/app/task-kanban.ts`, `src/app/jira-status-map.ts`, `src/app/task-kanban.test.ts`, `src/app/jira-status-map.test.ts`

- [ ] **Step 1: failing tests**

`src/app/task-kanban.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { groupByStatus } from "./task-kanban";
import { TASK_STATUSES, type Task } from "./types";

const t = (id: number, status: Task["status"]): Task =>
  ({ id, taskName: "T" + id, assignee: "", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "Medium", blockers: "", notes: "", status }) as Task;

describe("groupByStatus", () => {
  it("returns a bucket for every status, empty ones included", () => {
    const g = groupByStatus([]);
    for (const s of TASK_STATUSES) expect(g[s]).toEqual([]);
  });
  it("partitions tasks into their status bucket, order preserved", () => {
    const g = groupByStatus([t(1, "To Do"), t(2, "Done"), t(3, "To Do")]);
    expect(g["To Do"].map((x) => x.id)).toEqual([1, 3]);
    expect(g["Done"].map((x) => x.id)).toEqual([2]);
    expect(g["In Progress"]).toEqual([]);
  });
});
```

`src/app/jira-status-map.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { jiraCategoryToStatus, isJiraSynced } from "./jira-status-map";
import type { Task } from "./types";

describe("jiraCategoryToStatus", () => {
  it("maps the three Jira status categories", () => {
    expect(jiraCategoryToStatus("new")).toBe("To Do");
    expect(jiraCategoryToStatus("indeterminate")).toBe("In Progress");
    expect(jiraCategoryToStatus("done")).toBe("Done");
  });
  it("defaults unknown/empty to To Do", () => {
    expect(jiraCategoryToStatus("")).toBe("To Do");
    expect(jiraCategoryToStatus("weird")).toBe("To Do");
  });
});

describe("isJiraSynced", () => {
  it("is true only when jiraKey is set", () => {
    expect(isJiraSynced({ jiraKey: "LOP-1" } as Task)).toBe(true);
    expect(isJiraSynced({} as Task)).toBe(false);
  });
});
```

- [ ] **Step 2:** `npm run test:run -- task-kanban jira-status-map` → FAIL (modules missing).

- [ ] **Step 3: implement** `src/app/task-kanban.ts`:
```ts
// src/app/task-kanban.ts — pure, i18n-free Kanban grouping.
import { TASK_STATUSES, type Task, type TaskStatus } from "./types";

/** Partition tasks into one bucket per TaskStatus (all buckets present, even empty).
 *  Input order is preserved within each bucket. */
export function groupByStatus(tasks: readonly Task[]): Record<TaskStatus, Task[]> {
  const out = {} as Record<TaskStatus, Task[]>;
  for (const s of TASK_STATUSES) out[s] = [];
  for (const task of tasks) out[task.status].push(task);
  return out;
}
```

`src/app/jira-status-map.ts`:
```ts
// src/app/jira-status-map.ts — pure mapping of Jira status categories to our status.
import type { Task, TaskStatus } from "./types";

/** Jira exposes 3 statusCategory keys; map to our nearest workflow status. */
export function jiraCategoryToStatus(categoryKey: string): TaskStatus {
  switch (categoryKey) {
    case "indeterminate": return "In Progress";
    case "done": return "Done";
    case "new":
    default: return "To Do";
  }
}

/** A task whose status is owned by Jira (read-only locally). */
export function isJiraSynced(task: Pick<Task, "jiraKey">): boolean {
  return !!task.jiraKey;
}
```

- [ ] **Step 4:** `npm run test:run -- task-kanban jira-status-map` → PASS.
- [ ] **Step 5: commit**
```bash
npx tsc --noEmit
git add src/app/task-kanban.ts src/app/jira-status-map.ts src/app/task-kanban.test.ts src/app/jira-status-map.test.ts
git commit -m "feat(sp-b): pure groupByStatus + jiraCategoryToStatus/isJiraSynced helpers"
```

---

## Task 2: Jira sync derives status from statusCategory

**Files:** Modify `src/app/jira-api.ts` (`issueToTaskFields` ~line 201-230), `src/app/use-jira-sync.ts` (new-task path ~219, update path ~192-204). Test: `src/app/use-jira-sync.test.tsx` (extend).

Context: `issueToTaskFields(issue, today)` already computes `const statusKey = f.status?.statusCategory?.key ?? ""` and `isDone = statusKey === "done"`, and returns a patch including `completedDate` (set when done). It does NOT yet return `status`. We add it — so the patch is self-consistent (done ⇒ status "Done" + completedDate set; non-done ⇒ open status + completedDate cleared). The sync paths then apply `patch.status` directly. We deliberately do NOT route sync through `applyStatusChange` (it would stamp `today` instead of Jira's resolution date).

- [ ] **Step 1: failing test** — extend `src/app/use-jira-sync.test.tsx` (follow its harness for a pulled issue):
```ts
it("maps Jira statusCategory to task status on sync", () => {
  // issue with statusCategory.key "indeterminate" -> synced task.status === "In Progress"
  // issue with statusCategory.key "done" -> task.status === "Done" AND completedDate set
  // (assert via the resulting tasks passed to setTasks, mirroring existing sync tests)
});
```
If unit-testing `issueToTaskFields` directly is easier, add to a jira-api test instead:
```ts
import { issueToTaskFields } from "./jira-api";
it("issueToTaskFields derives status from statusCategory", () => {
  const mk = (key: string) => ({ key: "LOP-1", fields: { summary: "x", status: { statusCategory: { key } } } });
  expect(issueToTaskFields(mk("indeterminate") as never, "2026-06-19").status).toBe("In Progress");
  expect(issueToTaskFields(mk("done") as never, "2026-06-19").status).toBe("Done");
  expect(issueToTaskFields(mk("new") as never, "2026-06-19").status).toBe("To Do");
});
```

- [ ] **Step 2:** run it → FAIL (`status` not on the patch).

- [ ] **Step 3: add `status` to the patch** in `jira-api.ts` `issueToTaskFields`. Import `jiraCategoryToStatus` from `./jira-status-map`. In the returned object, add `status: jiraCategoryToStatus(statusKey),`. (The patch's TS type — `JiraTaskPatch` or inline — must gain `status: TaskStatus`; update that type/`SyncableField` if needed so tsc passes.)

- [ ] **Step 4: apply patch.status in use-jira-sync.ts:**
  - **New-task path (~line 219-232):** currently builds `migrateTaskStatus({ ... status: "To Do", completedDate: patch.completedDate ... })`. Replace the hardcoded `status: "To Do"` with `status: patch.status` and DROP the `migrateTaskStatus(...)` wrapper for this path (the patch is already invariant-consistent). Remove the now-stale "Seed open; migrateTaskStatus…" comment. If `migrateTaskStatus` becomes unused in the file, remove its import.
  - **Update-existing-synced path (~line 192-204):** where it currently merges `completedDate: patch.completedDate ?? row.completedDate`, also set `status: patch.status` so an existing synced task's column follows Jira. Keep completedDate consistent with patch (done ⇒ set, else patch clears it).
  - Leave the conflict-resolution path semantics intact; just ensure status rides along with completedDate.

- [ ] **Step 5:** `npm run test:run -- use-jira-sync jira-api` → PASS. Then `npm run test:run` (full) → green (watch the existing jira-sync tests; update any that asserted a synced task's status was "To Do" — it now reflects the issue's category).

- [ ] **Step 6: commit**
```bash
npx tsc --noEmit
git add -A
git commit -m "feat(sp-b): sync derives Task.status from Jira statusCategory"
```

---

## Task 3: Read-only gating for synced tasks

**Files:** Modify `src/app/use-task-row-handlers.ts` (`onStatusChange` ~247), `src/app/task-row.tsx` (inline status select). Test: extend `src/app/use-task-row-handlers.test.ts`, `src/app/task-row.test.tsx`.

- [ ] **Step 1: failing tests**
`use-task-row-handlers.test.ts`:
```ts
it("onStatusChange no-ops for a Jira-synced task", () => {
  // seed a task with jiraKey set; call onStatusChange(id, "Done"); assert setTasks was
  // NOT called with a changed status (the synced task is unchanged)
});
```
`task-row.test.tsx`:
```ts
it("disables the inline status select for a Jira-synced task", () => {
  // render a row for { id: 1, taskName: "Sync", status: "In Progress", jiraKey: "LOP-1" }
  expect(screen.getByRole("combobox", { name: "Status – Sync" })).toBeDisabled();
});
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: guard `onStatusChange`** in `use-task-row-handlers.ts`:
```ts
const onStatusChange = useCallback(
  (id: number, next: TaskStatus) => {
    const stamp = new Date().toISOString();
    setTasks((prev) =>
      prev.map((row) =>
        row.id === id && !row.jiraKey
          ? { ...applyStatusChange(row, next, today), localModifiedAt: stamp }
          : row,
      ),
    );
  },
  [today, setTasks],
);
```
(A synced row passes through unchanged.)

- [ ] **Step 4: disable the inline select** in `task-row.tsx` — add `disabled={!!task.jiraKey}` to the status `<select>` and a `title={task.jiraKey ? t(lang, "jiraManagedTooltip") : undefined}`. (`jiraManagedTooltip` i18n key added in Task 8; for now you may use a literal and switch to the key in Task 8, OR add the key now — prefer adding it in Task 8 and reference it here, committing Task 8's i18n is fine to do early if simpler. If referencing a missing key breaks tsc, add the key in this task's i18n too.)

To avoid a missing-key tsc break, ADD `jiraManagedTooltip` EN+DE in THIS task (EN "Managed in Jira"; DE "In Jira verwaltet" via node write) so the reference resolves.

- [ ] **Step 5:** `npm run test:run -- use-task-row-handlers task-row` → PASS. `npx tsc --noEmit` → 0.
- [ ] **Step 6: commit**
```bash
git add -A
git commit -m "feat(sp-b): synced tasks read-only (onStatusChange guard + disabled inline select)"
```

---

## Task 4: View-mode setting + Table/Board toggle

**Files:** `src/app/settings-types.ts` (interface + default), `src/app/use-settings.ts` (sanitize), `src/app/tasks-section.tsx` (toggle + branch). Test: `src/app/use-settings.test.ts`, `src/app/tasks-section.test.tsx`.

- [ ] **Step 1: failing tests**
`use-settings.test.ts`:
```ts
it("defaults tasksViewMode to 'table' and coerces invalid to 'table'", () => {
  // parse settings with no tasksViewMode -> "table"; with "garbage" -> "table"; with "board" -> "board"
});
```
`tasks-section.test.tsx`:
```ts
it("renders the board when tasksViewMode is 'board'", () => {
  // stubSettings({ tasksViewMode: "board" }); assert a board landmark/role is present
  // (e.g. getByRole("button", { name: "Board" }) is pressed, and a status column header shows)
});
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: setting** — `settings-types.ts`: add `tasksViewMode?: "table" | "board";` to `Settings`; default `tasksViewMode: "table"` in defaults. `use-settings.ts` parse (near the `hideFinishedTasks` coercion): `tasksViewMode: (parsed as Record<string, unknown>).tasksViewMode === "board" ? "board" : "table",`.

- [ ] **Step 4: toggle + branch** in `tasks-section.tsx`:
  - Read `tasksViewMode` from `useSettings()` (already destructures `settings`, `setSettings`).
  - Add a Table/Board segmented toggle in the header bar (beside hide-finished). Two buttons, each `aria-pressed={mode===x}`, labeled `t(lang,"tasksViewTable")` / `t(lang,"tasksViewBoard")`, onClick `setSettings((s) => ({ ...s, tasksViewMode: "table"|"board" }))`. (`tasksViewTable`/`tasksViewBoard` i18n added here — see Step 5.)
  - Branch the rendered body: when `tasksViewMode === "board"`, render `<TaskKanban tasks={visibleRowsForBoard} ... />` (board ignores hide-finished, so pass the search/people-filtered set WITHOUT the finished filter — i.e. `filteredSortedTasks`, not `visibleRows`); else render the existing table (`visibleRows`). The header bar (filters/toggles/add) stays above both. NOTE: hide-finished toggle may be shown always; it just has no effect in board mode (acceptable) — or hide it in board mode (optional, simpler to leave).
  - For THIS task, `<TaskKanban>` is created in Task 5 — to keep this task self-contained and green, render a minimal placeholder `<div role="region" aria-label={t(lang,"tasksViewBoard")}>` with the column headers, OR sequence Task 5 before wiring the branch. Recommended: in this task, add the toggle + setting + a MINIMAL inline board placeholder (just the 6 column headers via `TASK_STATUSES`/`statusLabelKey`) so the test passes; Task 5 replaces the placeholder with the real `<TaskKanban>`.

- [ ] **Step 5: i18n** — EN `tasksViewTable: "Table"`, `tasksViewBoard: "Board"`. DE via node write: `"Tabelle"`, `"Board"`. (Delete temp script.)

- [ ] **Step 6:** `npm run test:run -- use-settings tasks-section` → PASS. `npx tsc --noEmit` → 0. `npm run lint`.
- [ ] **Step 7: commit**
```bash
git add -A
git commit -m "feat(sp-b): tasksViewMode setting + Table/Board toggle"
```

---

## Task 5: Kanban board (columns + drag + drop)

**Files:** Create `src/app/task-kanban.tsx`, `src/app/task-kanban.component.test.tsx`. Modify `src/app/tasks-section.tsx` (replace the Task-4 placeholder with `<TaskKanban>`).

Context: `TaskKanban` receives the filtered tasks + the row handlers (`onStatusChange`, `onEdit`). It renders cards via `<TaskKanbanCard>` (Task 6) — for THIS task, render a minimal card inline (title + the status select) so the board is testable; Task 6 swaps in the full card. Avoid creating `task-kanban-card.tsx` here (Task 6 owns it) — keep the inline minimal card private to `TaskKanban` and replace it in Task 6.

- [ ] **Step 1: failing test** — `src/app/task-kanban.component.test.tsx`:
```ts
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskKanban } from "./task-kanban";
import type { Task } from "./types";

const t = (over: Partial<Task>): Task =>
  ({ id: 1, taskName: "Alpha", assignee: "", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "Medium", blockers: "", notes: "",
     status: "To Do", ...over }) as Task;

describe("TaskKanban", () => {
  it("renders all six status columns", () => {
    render(<TaskKanban lang="en-US" tasks={[]} onStatusChange={vi.fn()} onEdit={vi.fn()} />);
    for (const label of ["To Do", "In Progress", "On Hold", "In Review", "Cancelled", "Done"])
      expect(screen.getByRole("heading", { name: new RegExp(label) })).toBeInTheDocument();
  });
  it("dropping a card on a column calls onStatusChange(id, columnStatus)", () => {
    const onStatusChange = vi.fn();
    render(<TaskKanban lang="en-US" tasks={[t({ id: 7, status: "To Do" })]} onStatusChange={onStatusChange} onEdit={vi.fn()} />);
    const col = screen.getByTestId("kanban-col-In Progress");
    fireEvent.dragOver(col);
    fireEvent.drop(col, { dataTransfer: { getData: () => "7" } });
    expect(onStatusChange).toHaveBeenCalledWith(7, "In Progress");
  });
  it("a synced card is not draggable", () => {
    render(<TaskKanban lang="en-US" tasks={[t({ id: 9, jiraKey: "LOP-9" })]} onStatusChange={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByTestId("kanban-card-9").getAttribute("draggable")).toBe("false");
  });
});
```

- [ ] **Step 2:** run → FAIL (no module).

- [ ] **Step 3: implement** `src/app/task-kanban.tsx`:
```tsx
"use client";
import { type Lang, t } from "./i18n";
import { TASK_STATUSES, type Task, type TaskStatus } from "./types";
import { statusLabelKey } from "./task-status-ui";
import { groupByStatus } from "./task-kanban";
import { isJiraSynced } from "./jira-status-map";

interface TaskKanbanProps {
  lang: Lang;
  tasks: readonly Task[];
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
}

export function TaskKanban({ lang, tasks, onStatusChange, onEdit }: TaskKanbanProps) {
  const cols = groupByStatus(tasks);
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
      {TASK_STATUSES.map((status) => (
        <section
          key={status}
          data-testid={`kanban-col-${status}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = Number(e.dataTransfer.getData("text/plain"));
            if (id && status) onStatusChange(id, status);
          }}
          className="flex w-64 shrink-0 flex-col rounded-xl border border-line bg-surface"
        >
          <h3 className="flex items-center justify-between border-b border-line px-3 py-2 text-sm font-medium text-foreground">
            <span>{t(lang, statusLabelKey(status))}</span>
            <span className="text-xs text-muted-foreground">{cols[status].length}</span>
          </h3>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2 pr-2">
            {cols[status].map((task) => {
              const synced = isJiraSynced(task);
              return (
                <article
                  key={task.id}
                  data-testid={`kanban-card-${task.id}`}
                  draggable={!synced}
                  onDragStart={(e) => { if (!synced) e.dataTransfer.setData("text/plain", String(task.id)); }}
                  className="rounded-lg border border-line bg-surface-muted p-2 text-sm"
                >
                  {/* Minimal card — replaced by <TaskKanbanCard> in Task 6 */}
                  <button type="button" className="text-left font-medium text-foreground" onClick={() => onEdit(task)}>
                    {task.taskName}
                  </button>
                  <select
                    aria-label={`${t(lang, "colTaskStatus")} – ${task.taskName}`}
                    value={task.status}
                    disabled={synced}
                    onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
                    className="mt-1 block rounded border border-line bg-surface px-1 py-0.5 text-xs"
                  >
                    {TASK_STATUSES.map((s) => (<option key={s} value={s}>{t(lang, statusLabelKey(s))}</option>))}
                  </select>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
```
Note: the test stubs `dataTransfer.getData` returning "7"; the impl reads `"text/plain"` — in the test `getData` ignores the arg and returns "7", so it works. Use only sanctioned AIPM tokens.

- [ ] **Step 4: wire into tasks-section.tsx** — replace the Task-4 board placeholder with `<TaskKanban lang={lang} tasks={filteredSortedTasks} onStatusChange={onStatusChange} onEdit={onEdit} />`. `onStatusChange`/`onEdit` come from the row context/handlers already threaded for the table (reuse the same source). The board needs `min-h-0 flex-1` height context from the section wrapper.

- [ ] **Step 5:** `npm run test:run -- task-kanban tasks-section` → PASS. `npx tsc --noEmit` → 0. `npm run lint`.
- [ ] **Step 6: commit**
```bash
git add -A
git commit -m "feat(sp-b): Kanban board view (columns + native drag + drop to change status)"
```

---

## Task 6: Kanban card (compact essentials)

**Files:** Create `src/app/task-kanban-card.tsx`, `src/app/task-kanban-card.test.tsx`. Modify `src/app/task-kanban.tsx` (use the card).

- [ ] **Step 1: failing test** — `src/app/task-kanban-card.test.tsx`:
```ts
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskKanbanCard } from "./task-kanban-card";
import type { Task } from "./types";

const task = (over: Partial<Task> = {}): Task =>
  ({ id: 1, taskName: "Alpha", assignee: "Sam", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "High", blockers: "", notes: "",
     status: "In Progress", ...over }) as Task;

describe("TaskKanbanCard", () => {
  it("shows title, assignee, and a row-unique status select", () => {
    render(<TaskKanbanCard lang="en-US" task={task()} onStatusChange={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status – Alpha" })).toBeInTheDocument();
  });
  it("shows a Jira badge and disables the select when synced", () => {
    render(<TaskKanbanCard lang="en-US" task={task({ jiraKey: "LOP-5" })} onStatusChange={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText("LOP-5")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status – Alpha" })).toBeDisabled();
  });
});
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: implement** `src/app/task-kanban-card.tsx` — compact essentials. Reuse: priority badge classes from `task-row.tsx` (extract a shared `priorityBadgeClass` if convenient, else inline the same tokens), `computeTaskHealth` + the RAG dot, `statusLabelKey`/`statusBadgeClass`, and the RAID/Change ref lookups `task-row.tsx` uses (if those are local to task-row, lift the lookup to a small shared helper or pass the refs in). Card shows: title (button → onEdit), assignee, due date (overdue emphasis: `task.dueDate < todayISO() && !isTaskFinished(task)`), priority badge, health dot, Jira-key badge when synced, RAID/Change badges when present, and the per-card status `<select>` (aria-label `` `${t(lang,"colTaskStatus")} – ${task.taskName}` ``, `disabled={isJiraSynced(task)}`, styled `statusBadgeClass`). Props: `{ lang, task, onStatusChange, onEdit }`. AIPM tokens only.

- [ ] **Step 4: use it in `task-kanban.tsx`** — replace the inline minimal card with `<TaskKanbanCard lang={lang} task={task} onStatusChange={onStatusChange} onEdit={onEdit} />`, keeping the `draggable`/`onDragStart` wrapper (the `<article>` stays the drag source; the card content renders inside, or move draggable onto the card root and keep `data-testid={`kanban-card-${id}`}`). Ensure the synced card still reports `draggable="false"` (Task 5 test).

- [ ] **Step 5:** `npm run test:run -- task-kanban-card task-kanban` → PASS. `npx tsc --noEmit` → 0. `npm run lint`. Eyeball: no off-palette tokens.
- [ ] **Step 6: commit**
```bash
git add -A
git commit -m "feat(sp-b): compact Kanban card (assignee/due/priority/health/Jira/RAID + status select)"
```

---

## Task 7: Edit-modal buttons (Send inquiry / Push to Jira / Delete)

**Files:** the editor caller that supplies `footer` to `TaskEditView` (`task-edit-view.tsx` takes a `footer` prop) and `TaskFormModal` — find via `rg "<TaskEditView|<TaskFormModal" src/app`. Test: extend that caller's test or add a focused one.

Context: `TaskEditView` renders its `footer` prop inside the control bar (`task-edit-view.tsx:58`). `TaskFormModal` has its own footer area. The caller (likely `task-manager.tsx` or a task-editor wrapper) builds the Save/Cancel footer; add the three action buttons there, acting on the currently-edited task. Handlers exist in `use-task-row-handlers`: `onSendInquiry(task)`, `onPushToJira(taskId): Promise<boolean>` (already guards enabled+projectKey+not-synced+in-flight), `onDelete(id)` (already confirms). Confirm they're in the hook's returned object (`rg "onPushToJira|onSendInquiry|onDelete" src/app/use-task-row-handlers.ts` → returned).

- [ ] **Step 1: failing test** — in the editor caller's test (follow its harness; render the editor for a given task):
```ts
it("fires delete and send-inquiry from the editor; hides Push to Jira when already synced", () => {
  // render editor for a synced task (jiraKey set) -> Push to Jira button absent/hidden
  // click Delete -> onDelete called with the task id; click Send inquiry -> onSendInquiry called
});
it("shows Push to Jira for an unsynced task when Jira is configured", () => {
  // jira enabled + projectKey set, task has no jiraKey -> button present; click -> onPushToJira(id)
});
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: build the buttons** in the editor footer (the caller). For the task being edited (`editingTask`):
```tsx
<button type="button" onClick={() => onSendInquiry(editingTask)} className="…">{t(lang, "sendInquiry")}</button>
{settings.jira?.enabled && settings.jira?.projectKey && !editingTask.jiraKey && (
  <button type="button" onClick={() => onPushToJira(editingTask.id)} className="…">{t(lang, "pushToJira")}</button>
)}
<button type="button" onClick={() => onDelete(editingTask.id)} className="…">{t(lang, "delete")}</button>
```
Reuse EXISTING i18n keys — `rg '"sendInquiry"|"pushToJira"|"delete"|jiraPush' src/app/i18n.ts` and use whatever the app already has (e.g. there may be `sendInquiry`/`draftMessage`, `pushToJira`, `delete`). Only add a new key if none exists. Match the footer's existing button styling (sanctioned tokens). Place them left of Save/Cancel (destructive Delete visually separated). Thread `onSendInquiry`/`onPushToJira`/`onDelete` + the edited task into the footer-builder if not already in scope. Apply existing popout/read-only guards (Push-to-Jira/Delete should follow the same `isPopout`/read-only gating the rest of the editor uses, if any).

- [ ] **Step 4:** wire identically into BOTH surfaces (`TaskEditView` footer and `TaskFormModal` footer) — if both pull a shared footer node from the caller, one change covers both; otherwise mirror it.

- [ ] **Step 5:** `npm run test:run` (full) → green. `npx tsc --noEmit` → 0. `npm run lint`.
- [ ] **Step 6: commit**
```bash
git add -A
git commit -m "feat(sp-b): Send inquiry / Push to Jira / Delete buttons in the task editor"
```

---

## Task 8: i18n + release + verify

**Files:** `src/app/i18n.ts` / `i18n.de.ts` (any keys not already added), `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: confirm i18n keys** — ensure EN+DE exist for: `tasksViewTable`, `tasksViewBoard` (Task 4), `jiraManagedTooltip` (Task 3), and add `versionHighlightKanban` (EN: "Tasks can now be viewed as a drag-and-drop Kanban board grouped by status; Jira-synced tasks stay read-only at their Jira status."; DE via node write: "Aufgaben lassen sich jetzt als Drag-and-drop-Kanban-Board nach Status anzeigen; mit Jira synchronisierte Aufgaben bleiben schreibgeschützt auf ihrem Jira-Status."). Verify EN/DE parity (`npx tsc --noEmit`). DE via node write; delete temp script.

- [ ] **Step 2: version.ts** — `APP_VERSION = "0.108.0"`, `APP_MILESTONE = "Banks"` (Iain M. Banks), update the build-date comment + milestone JSDoc, append `"versionHighlightKanban"` as the last `APP_HIGHLIGHT_KEYS` entry.

- [ ] **Step 3: CHANGELOG.md** — new top entry, matching the file's actual format (`## [0.108.0] - 2026-06-19 "Banks"`):
```markdown
### Added
- Kanban board view for tasks (Table/Board toggle): one column per status, drag a card between columns or use the per-card status select. Compact cards show assignee, due date, priority, health, Jira key, and RAID/Change links.
- Send inquiry / Push to Jira / Delete buttons in the task editor.

### Changed
- Jira-synced tasks now derive their status from the Jira status category (To Do / In Progress / Done) on sync and are read-only in the board and the table status dropdown — change them in Jira and the next sync reflects it.
```

- [ ] **Step 4: build + suites** — `npm run build` (prebuild highlight-key sync) → PASS. `npm run test:run` → green. `npx tsc --noEmit` → 0. `npm run lint` → clean.

- [ ] **Step 5: a11y** — board mode is NOT auto-scanned by the axe gate (it shows the default table view). Verify board a11y by eye: every card select has a row-unique label, columns/cards keyboard-reachable, contrast OK. Confirm the table gate still passes: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"` → PASS.

- [ ] **Step 6: commit**
```bash
git add -A
git commit -m "chore(sp-b): release v0.108.0 Banks (Kanban board)"
```

---

## Final review

After all tasks, review `git diff main...HEAD`:
- Synced tasks are read-only at EVERY status-write surface (board card, table dropdown, `onStatusChange` guard) and their column follows Jira after sync.
- The sync patch keeps the completedDate invariant (done ⇒ status Done + completedDate; non-done ⇒ open status + cleared) WITHOUT stamping `today`.
- Board uses only AIPM palette tokens; card selects row-unique labels; drag works + select is the keyboard path.
- No new persisted Workspace field; `tasksViewMode` is per-device via `setSettings`.
- i18n EN/DE parity; tsc clean incl tests.

Then use **superpowers:finishing-a-development-branch**.
