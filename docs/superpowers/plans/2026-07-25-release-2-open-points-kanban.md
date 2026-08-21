# Release 2 — Open Points & Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `Task.createdDate` as a persisted, sortable, default-hidden Open Points column; a per-device "hide externals" view filter applied at a single source; and a Kanban person-swimlane view mode with drag-to-assign.

**Architecture:** Three independent slices landed in sequence (they share the Open Points toolbar). Slice 1 adds a field across the six persistence paths and rides the existing per-task load migrator for backfill. Slice 2 derives one `visibleTasks` list inside `WorkspaceProvider` that feeds all four filter derivations, so rows and dropdown options can never drift. Slice 3 adds a sibling component to the existing Kanban board rather than branching it, backed by a new pure grouping function.

**Tech Stack:** Next.js 16 (app dir, flat `src/app/`), React 19, TypeScript strict, Tailwind v4 with AIPM palette tokens, vitest + @testing-library/react (jsdom), Playwright + axe for the a11y gate, GitLab CI ( (GitLab)).

**Spec:** `docs/superpowers/specs/2026-07-24-r2-open-points-kanban-design.md`

---

## Before you start

Read these once — the whole plan assumes them:

- `AGENTS.md` in the repo root. Non-negotiable gates: `npm run lint` runs with `--max-warnings=0` (an unused import is fatal), `npx tsc --noEmit` enforces EN/DE i18n key parity **and** typechecks test files that `next build` skips, `npm run dup:check` and `npm run size:check` are blocking ratchets.
- `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it. Every German string in this plan is added with a node utf8 write (exact command given in the task) and then grep-verified.
- Commit messages use conventional-commit prefixes (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`). Commit with a Bash heredoc (`git commit -F - <<'EOF'`), never a PowerShell here-string.

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /c/Projects/aipm-cockpit
git checkout main && git pull
git checkout -b feature/release-2-open-points-kanban
```

- [ ] **Step 2: Confirm a green baseline**

Run: `npm run test:run`
Expected: all suites pass. If anything is red *before* you start, stop and report it — do not build on a red baseline.

---

## File Structure

**Slice 1 — `Task.createdDate`**

| File | Responsibility |
|---|---|
| `src/app/types.ts` | `createdDate?: string` on `Task` |
| `src/app/task-status.ts` | `migrateTaskStatus` → `migrateTask`; adds the createdDate backfill |
| `src/app/csv-codecs-core.ts` | `CSV_COLUMNS` entry (drives CSV + Turso single + tenant) |
| `src/app/markdown-codecs-core.ts` | `MD_COLUMNS` entry |
| `src/app/use-task-submit.ts` | stamp on create |
| `src/app/filters-context.tsx` | `SortKey` union entry |
| `src/app/tasks-section.tsx` | `ALL_TASK_COLS`, `CONFIGURABLE_COLS`, header cell |
| `src/app/task-row.tsx` | body cell |
| `src/app/use-column-manager.ts` | width default + hidden-cols v2 migration |
| `src/app/workspace-context.tsx` | sort arm for the optional string field |
| `src/app/i18n.ts` / `i18n.de.ts` | `colCreatedDate` |
| `scripts/generate-sample-workspace.ts` | synthesize `createdDate` into the sample |
| `src/app/__fixtures__/golden-workspace.{csv,md}` | regenerated |

**Slice 2 — hide externals**

| File | Responsibility |
|---|---|
| `src/app/task-external.ts` | **new** — pure `isExternalTask`, one responsibility, unit-tested |
| `src/app/settings-types.ts` | `hideExternalTasks?: boolean` |
| `src/app/use-settings.ts` | load parse |
| `src/app/workspace-context.tsx` | `visibleTasks` feeding four derivations |
| `src/app/tasks-section.tsx` | toolbar checkbox |
| `src/app/chat-tool-defs.ts`, `chat-tools.ts`, `use-chat-dispatcher.ts` | AI `update_settings` safe-subset |

**Slice 3 — swimlanes**

| File | Responsibility |
|---|---|
| `src/app/task-kanban.ts` | **extend** — `groupByStatusAndPerson`, pure |
| `src/app/task-kanban-swimlanes.tsx` | **new** — the 2-D surface (presentational, props only) |
| `src/app/task-swimlane-toolbar.tsx` | **new** — lane picker, keeps `tasks-section.tsx` under the size ratchet |
| `src/app/task-kanban-card.tsx` | optional person `<select>` (keyboard assign path) |
| `src/app/use-task-row-handlers.ts` | `onSwimlaneDrop` (undo capture + status invariant) |
| `src/app/settings-types.ts`, `project-appearance-prefs.ts`, `chat-tool-defs.ts`, `use-chat-dispatcher.ts` | `tasksViewMode` union widening |

---

# SLICE 1 — `Task.createdDate`

### Task 1: Add the field to the Task type

**Files:**
- Modify: `src/app/types.ts:49-109`

- [ ] **Step 1: Add the field**

In `types.ts`, inside `export type Task = {`, directly after the `lastUpdateDate: string;` line (line 60), insert:

```ts
  /** YYYY-MM-DD the task was created. Optional: absent on legacy data until the
   *  load migrator backfills it from `lastUpdateDate`. Date-only like every
   *  other Task date field — there is deliberately no instant precision here. */
  createdDate?: string;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0. (Optional field ⇒ no existing `Task` literal breaks.)

- [ ] **Step 3: Commit**

```bash
git add src/app/types.ts
git commit -F - <<'EOF'
feat(tasks): add optional Task.createdDate field

Date-only YYYY-MM-DD, matching every other Task date field. Optional so
legacy data and existing test fixtures stay valid until the load migrator
backfills it.
EOF
```

---

### Task 2: Rename the load migrator and add the backfill

`migrateTaskStatus` already runs on all six load paths, so it is the correct backfill seam. It grows a second responsibility, so it is renamed to `migrateTask`.

**Files:**
- Modify: `src/app/task-status.ts:23-27`
- Modify (call sites): `src/app/workspace.ts:18`, `src/app/browser-backend.ts:13,250`, `src/app/csv-codecs-decode.ts:47,448`, `src/app/markdown-codecs-decode.ts:11,396`, `src/app/templates.ts:2,167`
- Test: `src/app/task-status.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/task-status.test.ts`:

```ts
describe("migrateTask createdDate backfill", () => {
  const base: Task = {
    id: 1, taskName: "T", assignee: "", assigneeEmail: "",
    dueDate: "2026-03-01", lastUpdateDate: "2026-02-01",
    priority: "Medium", status: "To Do", blockers: "", description: "",
  };

  test("keeps an existing createdDate", () => {
    const out = migrateTask({ ...base, createdDate: "2026-01-15" });
    expect(out.createdDate).toBe("2026-01-15");
  });

  test("backfills from lastUpdateDate when absent", () => {
    const out = migrateTask(base);
    expect(out.createdDate).toBe("2026-02-01");
  });

  test("falls back to empty string when there is nothing to backfill from", () => {
    const out = migrateTask({ ...base, lastUpdateDate: "" });
    expect(out.createdDate).toBe("");
  });

  test("still migrates status (the original responsibility)", () => {
    const out = migrateTask({ ...base, status: "bogus" as TaskStatus, completedDate: "2026-02-02" });
    expect(out.status).toBe("Done");
    expect(out.createdDate).toBe("2026-02-01");
  });

  test("returns a new object and never mutates its input", () => {
    const input = { ...base };
    const out = migrateTask(input);
    expect(out).not.toBe(input);
    expect(input.createdDate).toBeUndefined();
  });
});
```

Update the file's import to `import { applyStatusChange, isTaskFinished, migrateTask, statusSortIndex } from "./task-status";` (keep whatever else that file already imports) and rename every existing `migrateTaskStatus(` call in this test file to `migrateTask(`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/task-status.test.ts`
Expected: FAIL — `migrateTask is not exported by ./task-status`.

- [ ] **Step 3: Implement**

Replace lines 21-27 of `src/app/task-status.ts` with:

```ts
/** Normalize a raw/legacy task on LOAD. Two jobs, both idempotent:
 *  - status: absent/invalid derives from completedDate (set => Done, else To Do)
 *  - createdDate: absent falls back to lastUpdateDate, else "" (never invented)
 *  Runs on all six load paths, so it is the single backfill seam. */
export function migrateTask(task: Task): Task {
  const statusOk = typeof task.status === "string" && STATUS_SET.has(task.status);
  const createdOk = typeof task.createdDate === "string";
  if (statusOk && createdOk) return task;
  const out = { ...task };
  if (!statusOk) out.status = task.completedDate ? "Done" : DEFAULT_TASK_STATUS;
  if (!createdOk) out.createdDate = task.lastUpdateDate || "";
  return out;
}
```

- [ ] **Step 4: Rename the six call sites**

Each is an import plus a call. Apply verbatim:

- `src/app/workspace.ts` — import `migrateTask`, call `migrateTask`
- `src/app/browser-backend.ts:13` import, `:250` `tasks = tasks.map(migrateTask);`
- `src/app/csv-codecs-decode.ts:47` import, `:448` `return migrateTask({`
- `src/app/markdown-codecs-decode.ts:11` import, `:396` `tasks.push(migrateTask({`
- `src/app/templates.ts:2` import, `:167` `return migrateTask(task);`

Verify none is missed:

Run: `grep -rn "migrateTaskStatus" src/ scripts/`
Expected: no output.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/app/task-status.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-status.ts src/app/task-status.test.ts src/app/workspace.ts src/app/browser-backend.ts src/app/csv-codecs-decode.ts src/app/markdown-codecs-decode.ts src/app/templates.ts
git commit -F - <<'EOF'
feat(tasks): backfill createdDate on load; rename migrateTaskStatus to migrateTask

The per-task load migrator already runs on all six load paths, so it is the
right backfill seam. Missing createdDate falls back to lastUpdateDate, else
empty — the migrator never invents a date. Renamed because it now does two
jobs; all six call sites updated.
EOF
```

---

### Task 3: Persist the column (CSV + Markdown + Turso)

`CSV_COLUMNS` drives CSV **and** both Turso schemas (DDL and insert derive from it), and `turso-migrate.ts` PRAGMA-diffs existing DBs on its own — so this task is two array entries.

**Files:**
- Modify: `src/app/csv-codecs-core.ts:43-56`
- Modify: `src/app/markdown-codecs-core.ts:343`
- Test: `src/app/entity-persistence-registry.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/app/entity-persistence-registry.test.ts`, find the table of per-entity persisted fields and add a `createdDate` row for Task. If the file drives its assertions from a list of `{ entity, field }` pairs, add:

```ts
  { entity: "task", field: "createdDate" },
```

If instead it asserts per-entity column arrays, add `"createdDate"` to the Task expectations for both the CSV and MD registries. Read the file first and follow its existing shape exactly — do not restructure it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/entity-persistence-registry.test.ts`
Expected: FAIL — `createdDate` missing from the task CSV/MD columns.

- [ ] **Step 3: Add the CSV column**

In `src/app/csv-codecs-core.ts`, in `export const CSV_COLUMNS: Array<keyof Task>`, insert `"createdDate",` immediately after `"lastUpdateDate",`:

```ts
  "startDate",
  "dueDate",
  "lastUpdateDate",
  "createdDate",
  "priority",
```

No encoder/decoder edit is needed: the generic `fieldToString` arm and `buildTaskFromObj` handle a plain optional string column.

- [ ] **Step 4: Add the Markdown column**

In `src/app/markdown-codecs-core.ts`, in `const MD_COLUMNS: Array<{ key: keyof Task; label: string }>` (line 343), insert after the `lastUpdateDate` entry:

```ts
  { key: "createdDate", label: "Created" },
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/app/entity-persistence-registry.test.ts`
Expected: PASS.

Run: `npx vitest run src/app/golden-workspace.test.ts`
Expected: **FAIL** — the emitted bytes now carry a new column while the fixtures do not. This is the expected, legitimate format change; Task 4 regenerates them. Do not touch the fixtures yet.

- [ ] **Step 6: Commit**

```bash
git add src/app/csv-codecs-core.ts src/app/markdown-codecs-core.ts src/app/entity-persistence-registry.test.ts
git commit -F - <<'EOF'
feat(codecs): persist Task.createdDate across CSV, Markdown and Turso

CSV_COLUMNS drives CSV plus both Turso schemas (DDL and insert derive from
it) and turso-migrate self-heals existing DBs via PRAGMA diff, so the field
reaches five of six paths from one entry; JSON/IDB pass the object through.
Golden fixtures are regenerated in the next commit.
EOF
```

---

### Task 4: Regenerate the sample and golden fixtures

**The trap:** `jsonToWorkspace` runs DOMPurify and returns an EMPTY workspace under bare node (no DOM). Regeneration must run in the jsdom environment, i.e. through vitest — not `vite-node`.

**Files:**
- Modify: `scripts/generate-sample-workspace.ts`
- Modify: `sample-workspace-small.json`, `sample-workspace-big.json`, `sample-workspace-huge.json`
- Modify: `src/app/__fixtures__/golden-workspace.csv`, `golden-workspace.md`
- Temporary: `src/app/regen-golden.test.ts` (deleted in the same task)

- [ ] **Step 1: Seed createdDate into the sample master**

Open `scripts/generate-sample-workspace.ts` and find where each task object is synthesized. Give every task a `createdDate` derived from its existing dates so the sample stays deterministic — no clock reads:

```ts
    createdDate: task.startDate ?? task.lastUpdateDate,
```

Place it beside the other date fields of the task literal. If the generator builds tasks in more than one place, apply it in each.

- [ ] **Step 2: Regenerate the sample tiers**

Run: `npx vite-node scripts/generate-sample-workspace.ts`
Expected: `sample-workspace-small.json` gains `createdDate` on every task; `-big` and `-huge` are regenerated from it.

Verify: `grep -c createdDate sample-workspace-small.json`
Expected: a count equal to the number of tasks in the sample (non-zero).

- [ ] **Step 3: Write the temporary regeneration test**

Create `src/app/regen-golden.test.ts`:

```ts
// TEMPORARY — regenerates the golden fixtures under jsdom, then is deleted.
// jsonToWorkspace needs a DOM (DOMPurify); under bare node it returns EMPTY.
import { test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace, workspaceToCsv, workspaceToMarkdown } from "./storage";

test("regenerate golden fixtures", () => {
  const repoRoot = join(import.meta.dirname, "..", "..");
  const ws = jsonToWorkspace(readFileSync(join(repoRoot, "sample-workspace-small.json"), "utf8"));
  if (ws.tasks.length === 0) throw new Error("empty workspace — DOM missing, refusing to write");
  const fixtures = join(import.meta.dirname, "__fixtures__");
  writeFileSync(join(fixtures, "golden-workspace.csv"), workspaceToCsv(ws), "utf8");
  writeFileSync(join(fixtures, "golden-workspace.md"), workspaceToMarkdown(ws), "utf8");
});
```

- [ ] **Step 4: Run it, then delete it**

```bash
npx vitest run src/app/regen-golden.test.ts
rm src/app/regen-golden.test.ts
```

Expected: PASS, then the file is gone.

- [ ] **Step 5: Inspect the diff before trusting it**

Run: `git diff --stat src/app/__fixtures__/`
Then: `git diff src/app/__fixtures__/golden-workspace.md | head -40`

Expected: the Tasks table gains exactly one `Created` column; no other section changes. **If any other section moved, stop** — that is a real format regression, not a new column.

Run: `npx vitest run src/app/golden-workspace.test.ts`
Expected: PASS, including the CRLF/LF guards (CSV stays CRLF, MD stays LF).

- [ ] **Step 6: Commit**

```bash
git add sample-workspace-small.json sample-workspace-big.json sample-workspace-huge.json scripts/generate-sample-workspace.ts src/app/__fixtures__/
git commit -F - <<'EOF'
chore(fixtures): regenerate sample tiers and golden files for createdDate

Legitimate new-column format change: the Tasks table/section gains one
column and nothing else moves. Regenerated through the real decoder +
serializers under jsdom (jsonToWorkspace needs a DOM).
EOF
```

---

### Task 5: Stamp createdDate on create

**Files:**
- Modify: `src/app/use-task-submit.ts`
- Test: `src/app/use-task-submit.test.tsx` (or the existing task-submit test file — check with `ls src/app | grep task-submit`)

- [ ] **Step 1: Read the create path**

Run: `grep -n "lastUpdateDate" src/app/use-task-submit.ts`

The create branch builds a new `Task` and sets `lastUpdateDate` from the effective today. Note the exact variable holding today (it is passed in, not read from a clock — the react-hooks purity rule bans `new Date()` in render).

- [ ] **Step 2: Write the failing test**

Add to the task-submit test file:

```ts
test("a newly created task records its creation date", async () => {
  // ...existing arrange/submit helpers of this file...
  const created = savedTasks.at(-1)!;
  expect(created.createdDate).toBe(created.lastUpdateDate);
});
```

Follow the file's existing arrange helpers rather than inventing new ones.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/app/use-task-submit.test.tsx`
Expected: FAIL — `expected undefined to be "…"`.

- [ ] **Step 4: Implement**

In the create branch of `use-task-submit.ts`, beside the `lastUpdateDate` assignment, add:

```ts
    createdDate: today,
```

(using the same `today` value that line already uses). The UPDATE branch must **not** touch `createdDate` — editing a task never rewrites when it was created.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/app/use-task-submit.test.tsx && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-task-submit.ts src/app/use-task-submit.test.tsx
git commit -F - <<'EOF'
feat(tasks): stamp createdDate when a task is created

Uses the same timezone-effective today the create path already stamps into
lastUpdateDate. The update branch deliberately leaves createdDate alone.
EOF
```

---

### Task 6: i18n key

**Files:**
- Modify: `src/app/i18n.ts:119` area
- Modify: `src/app/i18n.de.ts:122` area

- [ ] **Step 1: Add the English string**

In `src/app/i18n.ts`, beside `colTaskStatus: "Status",`, add:

```ts
  colCreatedDate: "Created",
```

- [ ] **Step 2: Add the German string via a node write (never the Edit tool)**

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  colTaskStatus: \"Status\",\r\n";
if (!s.includes(anchor)) throw new Error("anchor not found — check CRLF");
s = s.replace(anchor, anchor + "  colCreatedDate: \"Erstellt\",\r\n");
fs.writeFileSync(p, s, "utf8");
'
```

Note the `\r\n` in the anchor: the file is CRLF and an `\n`-only anchor silently no-ops.

- [ ] **Step 3: Verify both sides**

Run: `grep -n "colCreatedDate" src/app/i18n.ts src/app/i18n.de.ts`
Expected: one hit in each file.

Run: `npx tsc --noEmit`
Expected: exit 0 (this is what enforces EN/DE key parity).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add colCreatedDate (EN/DE)"
```

---

### Task 7: Render and sort the column

**Files:**
- Modify: `src/app/filters-context.tsx:27-37` (`SortKey`)
- Modify: `src/app/workspace-context.tsx` (sort arm, ~line 285)
- Modify: `src/app/tasks-section.tsx:60` (`ALL_TASK_COLS`), `:66-81` (`CONFIGURABLE_COLS`), `:883` area (header)
- Modify: `src/app/task-row.tsx:525` area (cell)
- Modify: `src/app/use-column-manager.ts:18-36` (width)
- Test: `src/app/tasks-section.test.tsx` (or the nearest existing Open Points table test — `ls src/app | grep tasks-section`)

- [ ] **Step 1: Write the failing test**

```ts
test("the Created column renders its value when unhidden", async () => {
  // arrange with the file's existing render helper, one task carrying
  // createdDate: "2026-01-15", and hiddenCols NOT containing "createdDate"
  expect(await screen.findByText("2026-01-15")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/tasks-section.test.tsx -t "Created column"`
Expected: FAIL — text not found.

- [ ] **Step 3: Widen the SortKey union**

`src/app/filters-context.tsx`, in `export type SortKey`, after `| "lastUpdateDate"`:

```ts
  | "createdDate"
```

- [ ] **Step 4: Add the sort arm**

In `workspace-context.tsx`'s `filteredSortedTasks` comparator, **before** the final `else cmp = a[sortKey].localeCompare(b[sortKey]);`:

```ts
      else if (sortKey === "createdDate")
        cmp = (a.createdDate ?? "").localeCompare(b.createdDate ?? "");
```

This arm is mandatory: the generic fallback indexes `a[sortKey]` assuming a required string and would be a type error (and a runtime throw on a legacy row) for an optional field.

- [ ] **Step 5: Register the column**

`tasks-section.tsx` line 60 — insert `"createdDate"` after `"lastUpdateDate"`:

```ts
const ALL_TASK_COLS = ["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","createdDate","priority","taskStatus","blockers","description","notesLog","depRelations","estimate","spent","actions"] as const;
```

`CONFIGURABLE_COLS`, after the `lastUpdateDate` row:

```ts
  { key: "createdDate",    labelKey: "colCreatedDate" },
```

`use-column-manager.ts` `DEFAULT_COL_WIDTHS`, after `lastUpdateDate: 110,`:

```ts
  createdDate: 110,
```

- [ ] **Step 6: Add the header cell**

`tasks-section.tsx`, directly after the `lastUpdateDate` header line:

```tsx
                {!hiddenCols.has("createdDate") && <SortResizeTh label={t(lang, "colCreatedDate")} sortCol="createdDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} onResize={startColResize} title={t(lang, "sortBy", t(lang, "colCreatedDate"))} />}
```

- [ ] **Step 7: Add the body cell**

`task-row.tsx`, directly after the `lastUpdateDate` cell (line 525):

```tsx
      {!hiddenCols.has("createdDate") && <Td title={`${t(lang, "colCreatedDate")}: ${task.createdDate || "—"}`}>{task.createdDate || "—"}</Td>}
```

- [ ] **Step 8: Run tests + lint + typecheck**

Run: `npx vitest run src/app/tasks-section.test.tsx src/app/task-row.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0, no warnings.

If a colspan-based test fails, it is because the table gained a column — update the expected count; do not hide the column to make it pass.

- [ ] **Step 9: Commit**

```bash
git add src/app/filters-context.tsx src/app/workspace-context.tsx src/app/tasks-section.tsx src/app/task-row.tsx src/app/use-column-manager.ts src/app/tasks-section.test.tsx
git commit -F - <<'EOF'
feat(tasks): render and sort the Created column

Explicit sort arm rather than the generic a[sortKey] fallback, which assumes
a required string field and would throw on a legacy row.
EOF
```

---

### Task 8: Default-hide the column, including for existing users

`hiddenCols` persists per device and its `["estimate","spent"]` seed only applies on a fresh install, so without a migration every existing user sees the new column.

**Files:**
- Modify: `src/app/use-column-manager.ts:16,57-73`
- Test: `src/app/use-column-manager.test.ts` (create if absent)

- [ ] **Step 1: Write the failing tests**

```ts
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { useColumnManager } from "./use-column-manager";

const KEY = "aipm-cockpit:hidden-cols";

describe("hidden-cols storage migration", () => {
  beforeEach(() => window.localStorage.clear());

  test("fresh install hides estimate, spent and createdDate", () => {
    const { result } = renderHook(() => useColumnManager());
    expect([...result.current.hiddenCols].sort()).toEqual(["createdDate", "estimate", "spent"]);
  });

  test("a legacy bare array keeps its hides and gains createdDate", () => {
    window.localStorage.setItem(KEY, JSON.stringify(["blockers"]));
    const { result } = renderHook(() => useColumnManager());
    expect([...result.current.hiddenCols].sort()).toEqual(["blockers", "createdDate"]);
  });

  test("a v2 payload is honoured verbatim — createdDate is not re-added once unhidden", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 2, hidden: ["estimate"] }));
    const { result } = renderHook(() => useColumnManager());
    expect([...result.current.hiddenCols]).toEqual(["estimate"]);
  });

  test("a corrupt payload falls back to the fresh-install seed", () => {
    window.localStorage.setItem(KEY, "{not json");
    const { result } = renderHook(() => useColumnManager());
    expect([...result.current.hiddenCols].sort()).toEqual(["createdDate", "estimate", "spent"]);
  });
});
```

The third test is the one that matters most: without the `v` marker the migration would re-hide the column on every reload and the user could never keep it visible.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/use-column-manager.test.ts`
Expected: FAIL on the legacy-array and v2 cases.

- [ ] **Step 3: Implement**

Replace lines 16 and 57-73 of `use-column-manager.ts`:

```ts
const HIDDEN_COLS_KEY = "aipm-cockpit:hidden-cols";
/** Columns hidden on a fresh install. */
const DEFAULT_HIDDEN = ["estimate", "spent", "createdDate"] as const;
/** Columns introduced in v2. A stored v1 payload (a bare array) predates them,
 *  so they are unioned in ONCE — the `v` marker is what stops the union from
 *  re-hiding a column the user has since chosen to show. */
const NEW_HIDDEN_IN_V2 = ["createdDate"] as const;
```

```ts
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_COLS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        // v1: a bare array, written before NEW_HIDDEN_IN_V2 existed.
        if (Array.isArray(parsed)) {
          return new Set([...(parsed as string[]), ...NEW_HIDDEN_IN_V2]);
        }
        // v2: { v, hidden } — honoured verbatim.
        if (parsed && typeof parsed === "object" && Array.isArray((parsed as { hidden?: unknown }).hidden)) {
          return new Set((parsed as { hidden: string[] }).hidden);
        }
      }
    } catch { /* non-fatal */ }
    return new Set<string>(DEFAULT_HIDDEN);
  });

  // Persist hiddenCols on every change, always in the v2 shape.
  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify({ v: 2, hidden: [...hiddenCols] }));
    } catch { /* non-fatal */ }
  }, [hiddenCols]);
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/use-column-manager.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-column-manager.ts src/app/use-column-manager.test.ts
git commit -F - <<'EOF'
feat(tasks): hide the Created column by default, including for existing users

hiddenCols persists per device and its seed only applies on a fresh install,
so a new column would otherwise appear for everyone who has ever opened the
app. Storage moves to { v, hidden }; a legacy bare array is migrated once by
unioning the v2 additions. The version marker is what keeps a deliberately
unhidden column visible across reloads.
EOF
```

---

### Task 9: Slice 1 verification

- [ ] **Step 1: Full suite + gates**

```bash
npm run test:run
npx tsc --noEmit
npm run lint
npm run dup:check
npm run size:check
```

Expected: all green. A `size:check` failure on `tasks-section.tsx` here means the header line pushed it over — extract nothing yet; note it and continue (Slice 3 extracts the toolbar).

- [ ] **Step 2: Eye-verify in the app**

```bash
PORT=3100 npm run dev
```

Open `http://localhost:3100/#open-points`, confirm: no Created column by default → enable it in the column-config popover → values render for existing tasks (backfilled) → sorting by it works → create a task and confirm today's date appears.

```bash
PORT=3100 npm run stop
```

---

# SLICE 2 — Hide externals

### Task 10: Pure external-task classifier

**Files:**
- Create: `src/app/task-external.ts`
- Test: `src/app/task-external.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/task-external.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { isExternalTask } from "./task-external";
import type { Resource, Task } from "./types";

const task = (over: Partial<Task>): Task => ({
  id: 1, taskName: "T", assignee: "", assigneeEmail: "",
  dueDate: "2026-03-01", lastUpdateDate: "2026-02-01",
  priority: "Medium", status: "To Do", blockers: "", description: "",
  ...over,
});

const resources = new Map<number, Resource>([
  [1, { id: 1, firstName: "Ext", lastName: "Ernal", isExternal: true } as Resource],
  [2, { id: 2, firstName: "In", lastName: "Ternal" } as Resource],
]);

describe("isExternalTask", () => {
  test("a task linked to an external resource is external", () => {
    expect(isExternalTask(task({ resourceId: 1 }), resources)).toBe(true);
  });

  test("a task linked to an internal resource is not external", () => {
    expect(isExternalTask(task({ resourceId: 2 }), resources)).toBe(false);
  });

  test("an unlinked task is never external, even when its assignee string names an external", () => {
    expect(isExternalTask(task({ assignee: "Ext Ernal" }), resources)).toBe(false);
  });

  test("a dangling link (resource deleted) is not external", () => {
    expect(isExternalTask(task({ resourceId: 99 }), resources)).toBe(false);
  });
});
```

The third test pins the deliberate direction of failure: classification is link-only, because a name collision must never hide real work.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/task-external.test.ts`
Expected: FAIL — cannot resolve `./task-external`.

- [ ] **Step 3: Implement**

Create `src/app/task-external.ts`:

```ts
// src/app/task-external.ts — pure, i18n-free external-ownership test for a task.
//
// Classification is LINK-ONLY: a task counts as externally owned when its
// resourceId resolves to a directory resource flagged isExternal. A free-string
// assignee is never classified, even when the string equals an external's name.
// resource-workload does name-match, but there a miss only misroutes a row into
// "Unlinked"; here a name collision would HIDE REAL WORK, so this fails safe.
import type { Resource, Task } from "./types";

export function isExternalTask(
  task: Pick<Task, "resourceId">,
  resourcesById: ReadonlyMap<number, Pick<Resource, "isExternal">>,
): boolean {
  if (task.resourceId == null) return false;
  return resourcesById.get(task.resourceId)?.isExternal === true;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/task-external.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-external.ts src/app/task-external.test.ts
git commit -F - <<'EOF'
feat(tasks): add pure isExternalTask classifier

Link-only by design: an unlinked free-string assignee is never classified as
external, so a name collision cannot hide real work.
EOF
```

---

### Task 11: The setting

**Files:**
- Modify: `src/app/settings-types.ts:541-544`
- Modify: `src/app/use-settings.ts:267` area
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the field**

`settings-types.ts`, directly after the `hideFinishedTasks?: boolean;` line:

```ts
  /** Per-device tasks-view toggle: hide tasks owned by external resources.
   *  Default OFF. View-level only — never filters exports or engines. */
  hideExternalTasks?: boolean;
```

If the file has a `defaultSettings` object carrying `hideFinishedTasks: false`, add `hideExternalTasks: false,` beside it (check `grep -n "hideFinishedTasks" src/app/settings-types.ts` — line 633 in the current tree).

- [ ] **Step 2: Parse it on load**

`use-settings.ts`, beside line 267's `hideFinishedTasks` parse:

```ts
            hideExternalTasks: (parsed as Record<string, unknown>).hideExternalTasks === true,
```

- [ ] **Step 3: Add i18n**

`i18n.ts`, beside `hideFinishedTasks: "Hide finished",`:

```ts
  hideExternalTasks: "Hide externals",
```

German, via node (CRLF anchor):

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  hideFinishedTasks: \"Erledigte ausblenden\",\r\n";
if (!s.includes(anchor)) throw new Error("anchor not found — check CRLF");
s = s.replace(anchor, anchor + "  hideExternalTasks: \"Externe ausblenden\",\r\n");
fs.writeFileSync(p, s, "utf8");
'
```

- [ ] **Step 4: Verify**

Run: `grep -n "hideExternalTasks" src/app/i18n.ts src/app/i18n.de.ts src/app/settings-types.ts src/app/use-settings.ts && npx tsc --noEmit`
Expected: hits in all four, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-types.ts src/app/use-settings.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(settings): add per-device hideExternalTasks flag (EN/DE)"
```

---

### Task 12: Apply it at one source in workspace-context

**Files:**
- Modify: `src/app/workspace-context.tsx:123` (provider), `:167-190` (option lists), `:240` (`filteredSortedTasks`)
- Test: `src/app/workspace-context.test.tsx` (create if absent — check `ls src/app | grep workspace-context`)

- [ ] **Step 1: Write the failing tests**

```ts
test("hiding externals removes their rows AND their assignee option", () => {
  // arrange: settings.hideExternalTasks = true; one task linked to an external
  // resource, one to an internal one.
  expect(result.current.filteredSortedTasks.map((t) => t.id)).toEqual([internalTaskId]);
  expect(result.current.uniqueAssignees).not.toContain("Ext Ernal");
});

test("group and label options drop values only hidden tasks carried", () => {
  // the external's task is the sole carrier of group "OnlyExternal"
  expect(result.current.uniqueGroups).not.toContain("OnlyExternal");
});

test("tasksById still resolves a hidden external's task", () => {
  // a dependency chip on that task must still render a name
  expect(result.current.tasksById.get(externalTaskId)).toBeDefined();
});

test("an assignee filter pointing at a hidden external resolves to All", () => {
  // assigneeFilter = "Ext Ernal", then hideExternalTasks flips on
  expect(result.current.effectiveFilters.assignee).toBe("All");
});
```

Follow the file's existing provider-wrapping helper; if the file does not exist, wrap `WorkspaceProvider` + `FiltersProvider` the way `test-providers.tsx` does and seed settings through the same mechanism the other settings-reading tests use.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/workspace-context.test.tsx`
Expected: FAIL — externals still present.

- [ ] **Step 3: Implement**

In `workspace-context.tsx`, add the imports:

```ts
import { isExternalTask } from "./task-external";
import { useSettings } from "./use-settings";
```

Inside `WorkspaceProvider`, after `resourcesById` is built (line ~161):

```ts
  // View-level "hide externals" is applied ONCE, here, so the row filter and
  // every derived option list share a single source and cannot drift — the
  // orphan-filter failure task-filters.ts exists to prevent.
  const { settings } = useSettings();
  const hideExternalTasks = settings.hideExternalTasks === true;
  const visibleTasks = useMemo(
    () => (hideExternalTasks ? tasks.filter((t) => !isExternalTask(t, resourcesById)) : tasks),
    [hideExternalTasks, tasks, resourcesById],
  );
```

(If `useSettings()` returns a differently-shaped tuple/object in this codebase, match the call shape used in `tasks-section.tsx`.)

Then swap the source of exactly four derivations from `tasks` to `visibleTasks`:

- `uniqueAssignees` (`.map` + dep array)
- `uniqueGroups` (`.map` + dep array)
- `uniqueLabels` (loop + dep array)
- `filteredSortedTasks` (`tasks.filter(...)` → `visibleTasks.filter(...)` + dep array)

Leave `tasksById` and `taskSearchIndex` on the full `tasks` list — a dependency chip pointing at a hidden task must still resolve its name, and the search index is a keyed lookup that filtered rows never reach. Add a short comment saying so at each of those two memos.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/workspace-context.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0, no warnings. Exhaustive-deps is fatal here — every changed memo's dep array must list `visibleTasks` instead of `tasks`.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-context.tsx src/app/workspace-context.test.tsx
git commit -F - <<'EOF'
feat(tasks): apply hide-externals at a single source

visibleTasks feeds the row filter and all three option lists, so a hidden
task's assignee/group/label cannot linger as an option that matches no row.
tasksById and the search index deliberately stay on the full list: a
dependency chip on a hidden task must still resolve.
EOF
```

---

### Task 13: The toolbar toggle

**Files:**
- Modify: `src/app/tasks-section.tsx:274` (read), `:526-535` (checkbox)
- Test: `src/app/tasks-section.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("the hide-externals checkbox is labelled and toggles the setting", async () => {
  const user = userEvent.setup();
  // render with the file's helper
  const box = screen.getByRole("checkbox", { name: "Hide externals" });
  await user.click(box);
  expect(setSettings).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/tasks-section.test.tsx -t "hide-externals"`
Expected: FAIL — no such checkbox.

- [ ] **Step 3: Implement**

Beside the existing `hideFinished` read (line 274):

```ts
  const hideExternal = settings.hideExternalTasks ?? false;
```

Directly after the "Hide finished" `<label>` block, add the twin:

```tsx
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hideExternal}
            onChange={(e) => setSettings((s) => ({ ...s, hideExternalTasks: e.target.checked }))}
            className="h-3.5 w-3.5 rounded border-line text-ui-dark-blue focus:ring-ui-green"
          />
          {t(lang, "hideExternalTasks")}
        </label>
```

The wrapping `<label>` is what gives the checkbox its accessible name — Open Points is axe-scanned and an unlabelled checkbox is a critical failure.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/tasks-section.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks-section.tsx src/app/tasks-section.test.tsx
git commit -m "feat(tasks): add the Hide externals toolbar toggle"
```

---

### Task 14: Expose the flag to the AI `update_settings` tool

Four sites in lockstep. The dispatcher case throws when nothing recognized applied, so the new arm must feed `applied`, not only `changes`.

**Files:**
- Modify: `src/app/chat-tool-defs.ts:485-500`
- Modify: `src/app/chat-tools.ts:142-150`
- Modify: `src/app/use-chat-dispatcher.ts:405-417`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/app/chat-tools.test.ts`, following the shape of the existing `update_settings` cases:

```ts
test("update_settings applies hideExternalTasks", async () => {
  const dispatcher = makeDispatcher(); // the file's existing helper
  await runTool("update_settings", { hideExternalTasks: true }, dispatcher);
  expect(dispatcher.updateSettings).toHaveBeenCalledWith(
    expect.objectContaining({ hideExternalTasks: true }),
  );
});

test("update_settings still rejects a payload with no recognized field", async () => {
  await expect(runTool("update_settings", { apiKey: "sk-ant-nope" }, makeDispatcher())).rejects.toThrow();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/chat-tools.test.ts -t "hideExternalTasks"`
Expected: FAIL.

- [ ] **Step 3: Schema**

`chat-tool-defs.ts`, inside the `update_settings` `properties`, after `showViewHints`:

```ts
        hideExternalTasks: {
          type: "boolean",
          description: "Whether Open Points hides tasks owned by external resources.",
        },
```

And extend the tool `description` string so its enumeration stays truthful — it currently reads "…dashboard density, per-view hint banners, the Open Points table/board mode, which feature modules are enabled, and next-actions ranking weights." Make it "…dashboard density, per-view hint banners, the Open Points table/board/swimlane mode and its hide-externals filter, which feature modules are enabled, and next-actions ranking weights." (The swimlane wording lands with Task 16; write the full sentence now.)

- [ ] **Step 4: Type**

`chat-tools.ts`, on `SettingsUpdateInput`, after `showViewHints?: boolean;`:

```ts
  hideExternalTasks?: boolean;
```

- [ ] **Step 5: Dispatcher arm**

`use-chat-dispatcher.ts`, after the `showViewHints` arm (line ~413):

```ts
        if (typeof patch.hideExternalTasks === "boolean") {
          changes.hideExternalTasks = patch.hideExternalTasks;
          applied.hideExternalTasks = patch.hideExternalTasks;
        }
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/app/chat-tools.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-tool-defs.ts src/app/chat-tools.ts src/app/use-chat-dispatcher.ts src/app/chat-tools.test.ts
git commit -F - <<'EOF'
feat(ai): let update_settings toggle hideExternalTasks

Boolean member of the existing safe subset; the tool description is updated
in step with the schema so the model is not told a stale list. Secrets,
storage and integration config remain unreachable.
EOF
```

---

### Task 15: Slice 2 verification

- [ ] **Step 1: Gates**

```bash
npm run test:run
npx tsc --noEmit
npm run lint
```

- [ ] **Step 2: axe on a fresh isolated port**

```bash
PORT=3100 npm run dev
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"
PORT=3100 npm run stop
```

Expected: PASS. A reused long-running dev server can serve stale Tailwind and produce phantom failures — use the fresh port.

- [ ] **Step 3: Eye-verify the toggle-time behavior**

With the app open: filter the assignee dropdown to an external, then tick "Hide externals". Expected: the filter falls back to All and the table shows everyone minus externals (documented, self-healing). Untick: the filter returns.

---

# SLICE 3 — Kanban person swimlanes

### Task 16: Widen the tasksViewMode union

Four validator/consumer sites. `project-appearance-prefs.ts` silently drops an unrecognized value, so missing it loses a per-project override on reload with no error.

**Files:**
- Modify: `src/app/settings-types.ts:544`
- Modify: `src/app/project-appearance-prefs.ts:21,49-51`
- Modify: `src/app/use-settings.ts:268`
- Modify: `src/app/tasks-section.tsx:288-297,536-544`
- Modify: `src/app/chat-tool-defs.ts` (enum), `src/app/use-chat-dispatcher.ts:414`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/project-appearance-prefs.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/app/project-appearance-prefs.test.ts`:

```ts
test("swimlane is a valid persisted tasksViewMode", () => {
  saveProjectAppearance("p1", { tasksViewMode: "swimlane" });
  expect(getAppearanceSnapshot("p1").tasksViewMode).toBe("swimlane");
});

test("an unknown mode is still dropped", () => {
  saveProjectAppearance("p2", { tasksViewMode: "grid" as never });
  expect(getAppearanceSnapshot("p2").tasksViewMode).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/project-appearance-prefs.test.ts -t "swimlane"`
Expected: FAIL — value dropped by the validator.

- [ ] **Step 3: Widen every site**

`settings-types.ts:544`:

```ts
  /** Per-device tasks-pane layout: table list, Kanban board, or person swimlanes. Default "table". */
  tasksViewMode?: "table" | "board" | "swimlane";
```

`project-appearance-prefs.ts:21`:

```ts
  tasksViewMode?: "table" | "board" | "swimlane";
```

`project-appearance-prefs.ts:49`:

```ts
  if (o.tasksViewMode === "table" || o.tasksViewMode === "board" || o.tasksViewMode === "swimlane") {
```

`use-settings.ts:268` — the current ternary collapses everything that is not `"board"` to `"table"`:

```ts
            tasksViewMode:
              (parsed as Record<string, unknown>).tasksViewMode === "board" ? "board"
              : (parsed as Record<string, unknown>).tasksViewMode === "swimlane" ? "swimlane"
              : "table",
```

`tasks-section.tsx:290` — widen the writer's parameter type:

```ts
  const setTasksViewMode = useCallback(
    (mode: "table" | "board" | "swimlane") => {
```

`tasks-section.tsx:536` — third segment:

```tsx
            { value: "swimlane", label: t(lang, "tasksViewSwimlane") },
```

`chat-tool-defs.ts` — the `tasksViewMode` enum becomes `["table", "board", "swimlane"]` and its description "Open Points layout: sortable table, Kanban board, or person swimlanes."

`use-chat-dispatcher.ts:414`:

```ts
        if (patch.tasksViewMode === "table" || patch.tasksViewMode === "board" || patch.tasksViewMode === "swimlane") {
```

- [ ] **Step 4: i18n**

`i18n.ts`, beside `tasksViewBoard: "Board",`:

```ts
  tasksViewSwimlane: "Swimlanes",
```

German:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  tasksViewBoard: \"Board\",\r\n";
if (!s.includes(anchor)) throw new Error("anchor not found — check the exact DE string and CRLF");
s = s.replace(anchor, anchor + "  tasksViewSwimlane: \"Swimlanes\",\r\n");
fs.writeFileSync(p, s, "utf8");
'
```

If the anchor throws, run `grep -n "tasksViewBoard" src/app/i18n.de.ts` and use the real line as the anchor.

- [ ] **Step 5: Prove no site was missed**

Run: `grep -rn '"table" | "board"' src/app/ | grep -v swimlane`
Expected: no output. The type alone will not find these — several are runtime string comparisons.

Run: `npx vitest run src/app/project-appearance-prefs.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-types.ts src/app/project-appearance-prefs.ts src/app/project-appearance-prefs.test.ts src/app/use-settings.ts src/app/tasks-section.tsx src/app/chat-tool-defs.ts src/app/use-chat-dispatcher.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(tasks): widen tasksViewMode with a swimlane mode

Every validator and runtime comparison widened in lockstep — the appearance
pref validator silently drops an unrecognized value, so a missed site would
lose a per-project override on reload with no error.
EOF
```

At this point the third segment renders but still shows the table (the render branch lands in Task 20). That is intentional — the mode is persisted and validated first.

---

### Task 17: Pure swimlane grouping engine

**Files:**
- Modify: `src/app/task-kanban.ts`
- Test: `src/app/task-kanban.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { groupByStatusAndPerson, UNASSIGNED_LANE } from "./task-kanban";
import type { Resource, Task } from "./types";

const task = (over: Partial<Task>): Task => ({
  id: 1, taskName: "T", assignee: "", assigneeEmail: "",
  dueDate: "2026-03-01", lastUpdateDate: "2026-02-01",
  priority: "Medium", status: "To Do", blockers: "", description: "",
  ...over,
});

const resources = new Map<number, Resource>([
  [1, { id: 1, firstName: "Anna", lastName: "Jordan" } as Resource],
  [2, { id: 2, firstName: "Bo", lastName: "Klein" } as Resource],
]);

describe("groupByStatusAndPerson", () => {
  test("lanes sort by display name with Unassigned last", () => {
    const out = groupByStatusAndPerson(
      [task({ id: 1, resourceId: 2 }), task({ id: 2 }), task({ id: 3, resourceId: 1 })],
      resources,
      [],
    );
    expect(out.lanes.map((l) => l.label)).toEqual(["Anna Jordan", "Bo Klein", ""]);
    expect(out.lanes.at(-1)!.key).toBe(UNASSIGNED_LANE);
  });

  test("a linked lane uses the resource's LIVE name, not the cached assignee string", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1, assignee: "Old Name" })], resources, []);
    expect(out.lanes[0].label).toBe("Anna Jordan");
  });

  test("a free-string assignee gets its own lane keyed by the string", () => {
    const out = groupByStatusAndPerson([task({ assignee: "Contractor X" })], resources, []);
    expect(out.lanes[0].key).toBe("name:Contractor X");
    expect(out.lanes[0].resourceId).toBeNull();
  });

  test("extra lane ids appear even with no tasks", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1 })], resources, [2]);
    expect(out.lanes.map((l) => l.label)).toEqual(["Anna Jordan", "Bo Klein", ""]);
    expect(out.cells["res:2"]["To Do"]).toEqual([]);
  });

  test("an extra lane id already present is not duplicated", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1 })], resources, [1]);
    expect(out.lanes.filter((l) => l.key === "res:1")).toHaveLength(1);
  });

  test("every lane has a bucket for every status", () => {
    const out = groupByStatusAndPerson([task({ resourceId: 1, status: "Done" })], resources, []);
    expect(Object.keys(out.cells["res:1"]).sort()).toEqual([...TASK_STATUSES].sort());
  });
});
```

(Import `TASK_STATUSES` from `./types` at the top of the test.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/task-kanban.test.ts`
Expected: FAIL — `groupByStatusAndPerson` is not exported.

- [ ] **Step 3: Implement**

Append to `src/app/task-kanban.ts`:

```ts
import { effectiveAssignee } from "./resource-foundation";
import type { Resource } from "./types";

/** Lane key for tasks with neither a resource link nor an assignee string. */
export const UNASSIGNED_LANE = "unassigned";

export interface KanbanLane {
  /** Stable key: `res:<id>` when linked, `name:<string>` for a free-string
   *  assignee, or UNASSIGNED_LANE. Also the drop-target payload. */
  key: string;
  /** Display name; "" for the Unassigned lane (the caller supplies its label,
   *  which is translated — this module stays i18n-free). */
  label: string;
  /** Set only for a linked lane; the drop handler writes it to the task. */
  resourceId: number | null;
}

export interface SwimlaneGrouping {
  lanes: KanbanLane[];
  cells: Record<string, Record<TaskStatus, Task[]>>;
}

function laneOf(task: Task, resourcesById: ReadonlyMap<number, Resource>): KanbanLane {
  if (task.resourceId != null && resourcesById.has(task.resourceId)) {
    return {
      key: `res:${task.resourceId}`,
      label: effectiveAssignee(task, resourcesById),
      resourceId: task.resourceId,
    };
  }
  const name = task.assignee.trim();
  if (name) return { key: `name:${name}`, label: name, resourceId: null };
  return { key: UNASSIGNED_LANE, label: "", resourceId: null };
}

function emptyCells(): Record<TaskStatus, Task[]> {
  const out = {} as Record<TaskStatus, Task[]>;
  for (const s of TASK_STATUSES) out[s] = [];
  return out;
}

/**
 * Group tasks into a 2-D status × person grid.
 *
 * Lanes are derived from the tasks themselves (so search/filter/hide-externals
 * narrow them for free), plus any `extraLaneIds` the user has explicitly pulled
 * in to make an empty lane droppable. A linked lane always shows the resource's
 * LIVE name — the stored `assignee` string is a stale-able cache.
 *
 * Ordering: by display name, Unassigned last. Input order is preserved inside
 * each cell.
 */
export function groupByStatusAndPerson(
  tasks: readonly Task[],
  resourcesById: ReadonlyMap<number, Resource>,
  extraLaneIds: readonly number[],
): SwimlaneGrouping {
  const lanes = new Map<string, KanbanLane>();
  const cells: Record<string, Record<TaskStatus, Task[]>> = {};

  const ensure = (lane: KanbanLane) => {
    if (!lanes.has(lane.key)) {
      lanes.set(lane.key, lane);
      cells[lane.key] = emptyCells();
    }
    return lane.key;
  };

  for (const task of tasks) {
    const key = ensure(laneOf(task, resourcesById));
    cells[key][task.status].push(task);
  }

  for (const id of extraLaneIds) {
    const r = resourcesById.get(id);
    if (!r) continue;
    ensure({ key: `res:${id}`, label: effectiveAssignee({ assignee: "", resourceId: id }, resourcesById), resourceId: id });
  }

  ensure({ key: UNASSIGNED_LANE, label: "", resourceId: null });

  const ordered = [...lanes.values()].sort((a, b) => {
    if (a.key === UNASSIGNED_LANE) return 1;
    if (b.key === UNASSIGNED_LANE) return -1;
    return a.label.localeCompare(b.label);
  });

  return { lanes: ordered, cells };
}
```

Extend the existing top-of-file import to `import { TASK_STATUSES, type Task, type TaskStatus } from "./types";` (it already imports the first three).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/task-kanban.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-kanban.ts src/app/task-kanban.test.ts
git commit -F - <<'EOF'
feat(kanban): add pure groupByStatusAndPerson grouping

Lanes derive from the tasks (so filters narrow them for free) plus explicit
extra lane ids; a linked lane shows the resource's live name rather than the
stale-able cached assignee string. Unassigned sorts last.
EOF
```

---

### Task 18: The drop handler

One write, one undo entry: a drop can change person and status together, so two separate handlers would produce two undo entries and two renders.

**Files:**
- Modify: `src/app/use-task-row-handlers.ts` (beside `onStatusChange`, line 226)
- Test: `src/app/use-task-row-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("a swimlane drop writes assignment and status in one update", () => {
  // arrange the hook with one task { id: 1, status: "To Do", resourceId: undefined }
  act(() => result.current.onSwimlaneDrop(1, { key: "res:7", label: "Anna Jordan", resourceId: 7 }, "In Progress"));
  expect(setTasks).toHaveBeenCalledTimes(1);
  const next = applyUpdater(setTasks, tasks); // the file's existing updater helper
  expect(next[0]).toMatchObject({ resourceId: 7, assignee: "Anna Jordan", status: "In Progress" });
});

test("dropping into Unassigned clears both the link and the name", () => {
  act(() => result.current.onSwimlaneDrop(1, { key: "unassigned", label: "", resourceId: null }, "To Do"));
  const next = applyUpdater(setTasks, tasks);
  expect(next[0].resourceId).toBeUndefined();
  expect(next[0].assignee).toBe("");
});

test("dropping into Done sets completedDate (status invariant holds)", () => {
  act(() => result.current.onSwimlaneDrop(1, { key: "unassigned", label: "", resourceId: null }, "Done"));
  const next = applyUpdater(setTasks, tasks);
  expect(next[0].completedDate).toBeTruthy();
});

test("a Jira-synced task is not written at all", () => {
  // task carries jiraKey: "LOP-9"
  act(() => result.current.onSwimlaneDrop(1, { key: "res:7", label: "A", resourceId: 7 }, "Done"));
  const next = applyUpdater(setTasks, tasks);
  expect(next[0]).toEqual(tasks[0]);
});

test("a no-op drop (same lane, same status) records no undo entry", () => {
  act(() => result.current.onSwimlaneDrop(1, { key: "unassigned", label: "", resourceId: null }, "To Do"));
  expect(captureFieldEdit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/use-task-row-handlers.test.ts -t "swimlane"`
Expected: FAIL — `onSwimlaneDrop is not a function`.

- [ ] **Step 3: Implement**

In `use-task-row-handlers.ts`, directly after `onStatusChange` (which ends around line 252), add:

```ts
  /** Swimlane cell drop: the cell is (person, status), so ONE write covers both.
   *  Jira-synced tasks are read-only. A drop that changes nothing writes nothing
   *  and records no undo entry. */
  const onSwimlaneDrop = useCallback(
    (id: number, lane: KanbanLane, next: TaskStatus) => {
      const prevRow = tasksRef.current.find((row) => row.id === id);
      if (!prevRow || prevRow.jiraKey) return;

      const nextAssignee = lane.resourceId != null ? lane.label : lane.key.startsWith("name:") ? lane.label : "";
      const nextResourceId = lane.resourceId ?? undefined;
      const sameLane = (prevRow.resourceId ?? undefined) === nextResourceId && prevRow.assignee === nextAssignee;
      if (sameLane && prevRow.status === next) return;

      const stamp = new Date().toISOString();
      const after = applyStatusChange(
        { ...prevRow, assignee: nextAssignee, resourceId: nextResourceId },
        next,
        today,
      );
      setTasks((prev) => prev.map((row) => (row.id === id ? { ...after, localModifiedAt: stamp } : row)));
      captureFieldEdit?.({
        setter: setTasks,
        kind: "task.updated",
        id,
        before: {
          assignee: prevRow.assignee,
          resourceId: prevRow.resourceId,
          status: prevRow.status,
          completedDate: prevRow.completedDate,
        },
        after: {
          assignee: after.assignee,
          resourceId: after.resourceId,
          status: after.status,
          completedDate: after.completedDate,
        },
        stampField: "localModifiedAt",
        name: prevRow.taskName,
      });
    },
    [today, setTasks, tasksRef, captureFieldEdit],
  );
```

Add `onSwimlaneDrop` to the hook's returned object and to its return type. Import the lane type: `import { type KanbanLane } from "./task-kanban";`.

Clearing the assignee for the Unassigned lane writes `""` and `undefined` — the same shape the ResourcePicker ✕ produces, so "cleared assignment" means one thing everywhere.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/use-task-row-handlers.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-task-row-handlers.ts src/app/use-task-row-handlers.test.ts
git commit -F - <<'EOF'
feat(kanban): add onSwimlaneDrop — assignment and status in one write

A swimlane cell is (person, status), so a drop can change both; one
functional update keeps it to a single render and a single undo entry.
Routed through applyStatusChange so the status/completedDate invariant
holds, and Jira-synced tasks are refused.
EOF
```

---

### Task 19: The swimlane surface

A sibling of the board, not a branch inside it: different grid, different drop payload, different headers. It renders outside `RowContextProvider`, so everything arrives as props — a `useTaskRowContext()` call here would throw.

**Files:**
- Create: `src/app/task-kanban-swimlanes.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/task-kanban-swimlanes.test.tsx`

- [ ] **Step 1: Add the i18n keys**

`i18n.ts`:

```ts
  swimlaneUnassigned: "Unassigned",
  swimlaneAddLane: "Add person lane",
  swimlaneRemoveLane: "Remove lane",
  swimlaneCell: "{0} – {1}",
```

German (positional placeholders are 0-based and must be preserved verbatim):

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  tasksViewSwimlane: \"Swimlanes\",\r\n";
if (!s.includes(anchor)) throw new Error("anchor not found — run Task 16 first");
const add = [
  "  swimlaneUnassigned: \"Nicht zugewiesen\",",
  "  swimlaneAddLane: \"Personenspur hinzufügen\",",
  "  swimlaneRemoveLane: \"Spur entfernen\",",
  "  swimlaneCell: \"{0} – {1}\",",
].join("\r\n") + "\r\n";
s = s.replace(anchor, anchor + add);
fs.writeFileSync(p, s, "utf8");
'
grep -n "swimlaneAddLane" src/app/i18n.de.ts
```

Expected: the line prints with a real `ü` in "hinzufügen". The `ü` escape is written by node into a real UTF-8 byte — the `i18n-encoding` test bans ASCII substitutes like "hinzufuegen", and a literal umlaut typed through the Edit tool would corrupt the file.

- [ ] **Step 2: Write the failing test**

Create `src/app/task-kanban-swimlanes.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { TaskKanbanSwimlanes } from "./task-kanban-swimlanes";
import type { Resource, Task } from "./types";

const task = (over: Partial<Task>): Task => ({
  id: 1, taskName: "T", assignee: "", assigneeEmail: "",
  dueDate: "2026-03-01", lastUpdateDate: "2026-02-01",
  priority: "Medium", status: "To Do", blockers: "", description: "",
  ...over,
});

const resources = new Map<number, Resource>([
  [1, { id: 1, firstName: "Anna", lastName: "Jordan" } as Resource],
]);

describe("TaskKanbanSwimlanes", () => {
  const base = {
    lang: "en-US" as const,
    tasks: [task({ id: 1, resourceId: 1, taskName: "Alpha" })],
    resourcesById: resources,
    extraLaneIds: [] as number[],
    onSwimlaneDrop: vi.fn(),
    onStatusChange: vi.fn(),
    onEdit: vi.fn(),
    onRemoveLane: vi.fn(),
  };

  test("renders a lane per person plus Unassigned", () => {
    render(<TaskKanbanSwimlanes {...base} />);
    expect(screen.getByRole("region", { name: "Anna Jordan" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Unassigned" })).toBeInTheDocument();
  });

  test("each cell carries a person-and-status accessible name", () => {
    render(<TaskKanbanSwimlanes {...base} />);
    expect(screen.getByLabelText("Anna Jordan – To Do")).toBeInTheDocument();
  });

  test("dropping a card calls onSwimlaneDrop with the lane and status", async () => {
    render(<TaskKanbanSwimlanes {...base} />);
    const cell = screen.getByLabelText("Unassigned – In Progress");
    const dataTransfer = { getData: () => "1", setData: vi.fn() };
    await userEvent.pointer({ target: cell }); // no-op; drop fired directly below
    cell.dispatchEvent(Object.assign(new Event("drop", { bubbles: true }), { dataTransfer, preventDefault() {} }));
    expect(base.onSwimlaneDrop).toHaveBeenCalledWith(1, expect.objectContaining({ key: "unassigned" }), "In Progress");
  });

  test("a Jira-synced card is not draggable", () => {
    render(<TaskKanbanSwimlanes {...base} tasks={[task({ id: 2, jiraKey: "LOP-2" })]} />);
    expect(screen.getByTestId("swimlane-card-2")).toHaveAttribute("draggable", "false");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/app/task-kanban-swimlanes.test.tsx`
Expected: FAIL — cannot resolve `./task-kanban-swimlanes`.

- [ ] **Step 4: Implement**

Create `src/app/task-kanban-swimlanes.tsx`:

```tsx
"use client";
// src/app/task-kanban-swimlanes.tsx — 2-D status × person Kanban surface.
//
// A SIBLING of task-kanban-board.tsx rather than a mode of it: the grid, the
// drop payload and the headers all differ, and merging them would produce a
// props union with half the props dead in either mode. Renders OUTSIDE
// RowContextProvider, so everything arrives as props — a useTaskRowContext()
// call here would throw.
import { useMemo } from "react";
import { type Lang, t } from "./i18n";
import { TASK_STATUSES, type ChangeItem, type RaidItem, type Resource, type Task, type TaskStatus } from "./types";
import { statusLabelKey } from "./task-status-ui";
import { type KanbanLane, UNASSIGNED_LANE, groupByStatusAndPerson } from "./task-kanban";
import { isJiraSynced } from "./jira-status-map";
import { isReadOnlyIssue } from "./jira-projects";
import type { JiraExtraProject } from "./settings-types";
import { TaskKanbanCard } from "./task-kanban-card";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import { IconButton } from "./button";

interface TaskKanbanSwimlanesProps {
  lang: Lang;
  tasks: readonly Task[];
  resourcesById: ReadonlyMap<number, Resource>;
  /** Resource ids the user pulled in to make an empty lane droppable. */
  extraLaneIds: readonly number[];
  today?: string;
  holidaySet?: Set<string>;
  jiraProjectKey?: string;
  jiraExtraProjects?: readonly JiraExtraProject[];
  raidByTask?: Map<number, RaidItem[]>;
  changeByTask?: Map<number, ChangeItem[]>;
  onSwimlaneDrop: (id: number, lane: KanbanLane, next: TaskStatus) => void;
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onRemoveLane: (resourceId: number) => void;
  onJumpToRaid?: (taskId: number) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  flashId?: number | null;
  onAiEdit?: (task: Task) => void;
  aiEditEnabled?: (task: Task) => boolean;
}

const EMPTY_HOLIDAYS: Set<string> = new Set();
const EMPTY_EXTRA_PROJECTS: readonly JiraExtraProject[] = [];
const NOOP_JUMP_TO_RAID: (taskId: number) => void = () => {};

export function TaskKanbanSwimlanes({
  lang,
  tasks,
  resourcesById,
  extraLaneIds,
  today = "",
  holidaySet = EMPTY_HOLIDAYS,
  jiraProjectKey = "",
  jiraExtraProjects = EMPTY_EXTRA_PROJECTS,
  raidByTask,
  changeByTask,
  onSwimlaneDrop,
  onStatusChange,
  onEdit,
  onRemoveLane,
  onJumpToRaid = NOOP_JUMP_TO_RAID,
  containerRef,
  flashId = null,
  onAiEdit,
  aiEditEnabled,
}: TaskKanbanSwimlanesProps) {
  const { lanes, cells } = useMemo(
    () => groupByStatusAndPerson(tasks, resourcesById, extraLaneIds),
    [tasks, resourcesById, extraLaneIds],
  );
  const laneLabel = (lane: KanbanLane) =>
    lane.key === UNASSIGNED_LANE ? t(lang, "swimlaneUnassigned") : lane.label;

  return (
    <div ref={containerRef} className="min-h-0 flex-1 overflow-auto pb-2 pr-2">
      <div className="min-w-max">
        {/* status header row */}
        <div className="sticky top-0 z-10 flex gap-3 bg-surface pb-2">
          <div className="w-40 shrink-0" />
          {TASK_STATUSES.map((status) => (
            <div key={status} className="w-64 shrink-0 px-3 py-2 text-sm font-medium text-foreground">
              {t(lang, statusLabelKey(status))}
            </div>
          ))}
        </div>

        {lanes.map((lane) => (
          <section key={lane.key} aria-label={laneLabel(lane)} className="flex gap-3 border-t border-line py-2">
            <div className="sticky left-0 z-10 flex w-40 shrink-0 items-start justify-between gap-1 bg-surface px-2 py-1 text-sm font-medium text-foreground">
              <span className="truncate">{laneLabel(lane)}</span>
              {lane.resourceId != null && TASK_STATUSES.every((s) => cells[lane.key][s].length === 0) && (
                <IconButton
                  aria-label={`${t(lang, "swimlaneRemoveLane")} – ${laneLabel(lane)}`}
                  title={t(lang, "swimlaneRemoveLane")}
                  onClick={() => onRemoveLane(lane.resourceId!)}
                >
                  ✕
                </IconButton>
              )}
            </div>

            {TASK_STATUSES.map((status) => (
              <div
                key={status}
                aria-label={t(lang, "swimlaneCell", laneLabel(lane), t(lang, statusLabelKey(status)))}
                data-testid={`swimlane-cell-${lane.key}-${status}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const raw = e.dataTransfer.getData("text/plain");
                  if (raw) onSwimlaneDrop(Number(raw), lane, status);
                }}
                className="flex w-64 shrink-0 flex-col gap-2 rounded-lg border border-line bg-surface p-2"
              >
                {cells[lane.key][status].map((task) => {
                  const synced = isJiraSynced(task);
                  return (
                    <article
                      key={task.id}
                      data-testid={`swimlane-card-${task.id}`}
                      data-deeplink-row={task.id}
                      draggable={!synced}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(task.id))}
                      className={["group rounded-lg border border-line bg-surface-muted p-2 text-sm", flashOutlineClass(flashId === task.id)]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <TaskKanbanCard
                        lang={lang}
                        task={task}
                        today={today}
                        holidaySet={holidaySet}
                        resourcesById={resourcesById}
                        raidRefs={raidByTask?.get(task.id)}
                        changeRefs={changeByTask?.get(task.id)}
                        onStatusChange={onStatusChange}
                        onEdit={onEdit}
                        onJumpToRaid={onJumpToRaid}
                        readOnlyProject={!!task.jiraKey && isReadOnlyIssue(task.jiraKey, { projectKey: jiraProjectKey, extraProjects: jiraExtraProjects })}
                        onAiEdit={onAiEdit}
                        aiEditEnabled={aiEditEnabled}
                      />
                    </article>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
```

If `IconButton` is not exported from `./button` in this tree, run `grep -rn "export function IconButton" src/app/` and import from wherever it lives.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/app/task-kanban-swimlanes.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-kanban-swimlanes.tsx src/app/task-kanban-swimlanes.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(kanban): add the status x person swimlane surface

Sibling of the board rather than a mode of it. Every lane is a labelled
region and every cell carries a person-and-status accessible name; the
remove-lane control is row-unique. Jira-synced cards are not draggable.
EOF
```

---

### Task 20: Lane picker + wiring the render branch

**Files:**
- Create: `src/app/task-swimlane-toolbar.tsx`
- Modify: `src/app/tasks-section.tsx` (state, toolbar mount, render branch)
- Modify: `src/app/task-manager.tsx` (thread `onSwimlaneDrop`)
- Test: `src/app/task-swimlane-toolbar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/task-swimlane-toolbar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TaskSwimlaneToolbar } from "./task-swimlane-toolbar";
import type { Resource } from "./types";

const resources = [
  { id: 1, firstName: "Anna", lastName: "Jordan" },
  { id: 2, firstName: "Bo", lastName: "Klein" },
] as Resource[];

test("offers only resources that are not already lanes, and adds one", async () => {
  const onAddLane = vi.fn();
  render(
    <TaskSwimlaneToolbar lang="en-US" resources={resources} laneResourceIds={[1]} onAddLane={onAddLane} />,
  );
  const select = screen.getByRole("combobox", { name: "Add person lane" });
  expect(screen.queryByRole("option", { name: "Anna Jordan" })).toBeNull();
  await userEvent.selectOptions(select, "2");
  expect(onAddLane).toHaveBeenCalledWith(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/task-swimlane-toolbar.test.tsx`
Expected: FAIL — cannot resolve `./task-swimlane-toolbar`.

- [ ] **Step 3: Implement the toolbar**

Create `src/app/task-swimlane-toolbar.tsx`:

```tsx
"use client";
// src/app/task-swimlane-toolbar.tsx — the swimlane view's add-lane control.
// Extracted from tasks-section.tsx to keep that file under the size ratchet.
import { type Lang, t } from "./i18n";
import { Select } from "./form-controls";
import { resourceDisplayName } from "./resource-foundation";
import type { Resource } from "./types";

export function TaskSwimlaneToolbar({
  lang,
  resources,
  laneResourceIds,
  onAddLane,
}: {
  lang: Lang;
  resources: readonly Resource[];
  /** Resource ids that already have a lane — excluded from the options. */
  laneResourceIds: readonly number[];
  onAddLane: (resourceId: number) => void;
}) {
  const taken = new Set(laneResourceIds);
  const options = resources.filter((r) => !taken.has(r.id));
  return (
    <Select
      size="xs"
      value=""
      aria-label={t(lang, "swimlaneAddLane")}
      title={t(lang, "swimlaneAddLane")}
      onChange={(e) => {
        const id = Number(e.target.value);
        if (id) onAddLane(id);
      }}
    >
      <option value="">{t(lang, "swimlaneAddLane")}</option>
      {options.map((r) => (
        <option key={r.id} value={r.id}>{resourceDisplayName(r)}</option>
      ))}
    </Select>
  );
}
```

- [ ] **Step 4: Wire it into the pane**

In `tasks-section.tsx`:

State, beside the other pane-local state (session-only by design — a lane the user pulled in is a momentary act, not a preference):

```ts
  // Extra swimlane rows the user pulled in so an empty person is droppable.
  // Session-only: not persisted, cleared on unmount.
  const [extraLaneIds, setExtraLaneIds] = useState<readonly number[]>([]);
  const addLane = useCallback(
    (id: number) => setExtraLaneIds((prev) => (prev.includes(id) ? prev : [...prev, id])),
    [],
  );
  const removeLane = useCallback(
    (id: number) => setExtraLaneIds((prev) => prev.filter((x) => x !== id)),
    [],
  );
```

Toolbar, immediately after the `SegmentedControl`:

```tsx
        {tasksViewMode === "swimlane" && (
          <TaskSwimlaneToolbar
            lang={lang}
            resources={resources}
            laneResourceIds={extraLaneIds}
            onAddLane={addLane}
          />
        )}
```

Render branch — replace the `tasksViewMode === "board" ? (…) : (…)` head at line 809 so swimlane gets its own arm. Feed it `healthFilteredTasks`, the same list the board uses (search/people-filtered but NOT hide-finished filtered, so the Done and Cancelled columns stay populated):

```tsx
      {tasksViewMode === "swimlane" ? (
        <TaskKanbanSwimlanes
          lang={lang}
          tasks={healthFilteredTasks}
          resourcesById={resourcesById}
          extraLaneIds={extraLaneIds}
          today={today}
          holidaySet={holidaySet}
          raidByTask={raidByTask}
          changeByTask={changeByTask}
          onSwimlaneDrop={onSwimlaneDrop}
          onStatusChange={onStatusChange}
          onEdit={onEdit}
          onRemoveLane={removeLane}
          onJumpToRaid={onJumpToRaid}
          jiraProjectKey={jiraProjectKey}
          jiraExtraProjects={jiraExtraProjects}
          containerRef={containerRef}
          flashId={flashId}
          onAiEdit={onAiEdit}
          aiEditEnabled={aiEditEnabled}
        />
      ) : tasksViewMode === "board" ? (
```

Add `onSwimlaneDrop` to the `TasksSectionProps` interface (beside `onStatusChange`) and to the destructured parameter list, and import `TaskKanbanSwimlanes` and `TaskSwimlaneToolbar`.

- [ ] **Step 5: Thread the handler from task-manager**

`task-manager.tsx`: `onSwimlaneDrop` comes out of `useTaskRowHandlers` alongside `onStatusChange` (line 1427 destructures it). Add it there and pass it to `<TasksSection>` at line ~2301:

```tsx
        onSwimlaneDrop={onSwimlaneDrop}
```

- [ ] **Step 6: Run tests + gates**

```bash
npx vitest run src/app/task-swimlane-toolbar.test.tsx src/app/tasks-section.test.tsx
npx tsc --noEmit
npm run lint
npm run size:check
npm run dup:check
```

Expected: all green. `dup:check` compares the two board components — if it flags the card `<article>` block, that is a genuine duplicate: extract the shared card wrapper into `task-kanban-card.tsx` rather than adding a suppression.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-swimlane-toolbar.tsx src/app/task-swimlane-toolbar.test.tsx src/app/tasks-section.tsx src/app/task-manager.tsx
git commit -F - <<'EOF'
feat(tasks): wire the swimlane view mode and its add-lane picker

The picker's extra lanes are session state, not a preference — pulling a
person in to drop work on them is a momentary act. Toolbar extracted to its
own file to keep tasks-section under the size ratchet.
EOF
```

---

### Task 21: Keyboard assign path on the card

Drag is a mouse-only affordance, so the swimlane view needs a keyboard equivalent for reassignment.

**Files:**
- Modify: `src/app/task-kanban-card.tsx`
- Modify: `src/app/task-kanban-swimlanes.tsx` (pass the new props)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/task-kanban-card.test.tsx`

- [ ] **Step 1: Add the i18n key**

`i18n.ts`:

```ts
  assignPersonLabel: "Assign – {0}",
```

German:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  swimlaneRemoveLane: \"Spur entfernen\",\r\n";
if (!s.includes(anchor)) throw new Error("anchor not found — run Task 19 first");
s = s.replace(anchor, anchor + "  assignPersonLabel: \"Zuweisen – {0}\",\r\n");
fs.writeFileSync(p, s, "utf8");
'
```

- [ ] **Step 2: Write the failing test**

```tsx
test("the person select assigns without a drag, and is row-unique", async () => {
  const onAssign = vi.fn();
  render(
    <TaskKanbanCard {...base} task={task({ id: 7, taskName: "Alpha" })}
      assignableResources={[{ id: 3, firstName: "Cy", lastName: "Meyer" } as Resource]}
      onAssign={onAssign} />,
  );
  const select = screen.getByRole("combobox", { name: "Assign – Alpha" });
  await userEvent.selectOptions(select, "3");
  expect(onAssign).toHaveBeenCalledWith(7, 3);
});

test("a Jira-synced card renders no person select", () => {
  render(<TaskKanbanCard {...base} task={task({ id: 8, jiraKey: "LOP-8" })}
    assignableResources={[{ id: 3, firstName: "Cy", lastName: "Meyer" } as Resource]}
    onAssign={vi.fn()} />);
  expect(screen.queryByRole("combobox", { name: /^Assign/ })).toBeNull();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/app/task-kanban-card.test.tsx -t "person select"`
Expected: FAIL.

- [ ] **Step 4: Implement**

Add two optional props to `TaskKanbanCardProps` (optional keeps every existing board call site and test unchanged):

```ts
  /** Swimlane keyboard assign path. Both must be passed to render the control;
   *  the board (1-D) passes neither. */
  assignableResources?: readonly Resource[];
  onAssign?: (taskId: number, resourceId: number | null) => void;
```

Render, at the foot of the card body:

```tsx
      {onAssign && assignableResources && !task.jiraKey && (
        <Select
          size="xs"
          value={task.resourceId ?? ""}
          aria-label={t(lang, "assignPersonLabel", task.taskName)}
          onChange={(e) => onAssign(task.id, e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t(lang, "swimlaneUnassigned")}</option>
          {assignableResources.map((r) => (
            <option key={r.id} value={r.id}>{resourceDisplayName(r)}</option>
          ))}
        </Select>
      )}
```

The label interpolates the task name because Open Points-adjacent lists need row-unique accessible names — N identical "Assign" controls is a WCAG 2.4.6 failure that an axe run with a single seeded row will not catch.

- [ ] **Step 5: Pass them from the swimlane surface**

`task-kanban-swimlanes.tsx`: add `assignableResources: readonly Resource[]` and `onAssign: (taskId: number, resourceId: number | null) => void` to its props and forward both to `TaskKanbanCard`. In `tasks-section.tsx`, pass `assignableResources={resources}` and an `onAssign` that reuses the drop handler with the task's current status:

```ts
  const onAssignFromCard = useCallback(
    (taskId: number, resourceId: number | null) => {
      const current = healthFilteredTasks.find((t) => t.id === taskId);
      if (!current) return;
      const r = resourceId != null ? resourcesById.get(resourceId) : undefined;
      onSwimlaneDrop(
        taskId,
        r
          ? { key: `res:${r.id}`, label: resourceDisplayName(r), resourceId: r.id }
          : { key: UNASSIGNED_LANE, label: "", resourceId: null },
        current.status,
      );
    },
    [healthFilteredTasks, resourcesById, onSwimlaneDrop],
  );
```

One handler for both paths means keyboard and mouse can never diverge in what they write.

`tasks-section.tsx` needs two more imports for this snippet: `import { UNASSIGNED_LANE } from "./task-kanban";` and `resourceDisplayName` from `./resource-foundation` (add it to that file's existing import if one is already there).

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/app/task-kanban-card.test.tsx src/app/task-kanban-swimlanes.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-kanban-card.tsx src/app/task-kanban-swimlanes.tsx src/app/tasks-section.tsx src/app/task-kanban-card.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(kanban): add the keyboard assign path to swimlane cards

Drag is mouse-only, so each card gets a person select with a row-unique
accessible name. It routes through the same handler as the drop, so the two
paths cannot diverge in what they write.
EOF
```

---

### Task 22: Slice 3 verification

- [ ] **Step 1: Full gates**

```bash
npm run test:run
npx tsc --noEmit
npm run lint
npm run dup:check
npm run size:check
```

- [ ] **Step 2: axe on a fresh isolated port**

```bash
PORT=3100 npm run dev
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"
```

Expected: PASS. The swimlane view is not in `A11Y_VIEWS` (the gate scans the table), so this only proves the toolbar additions are clean.

- [ ] **Step 3: Eye-verify the swimlane view (it is not axe-gated)**

At `http://localhost:3100/#open-points`, switch to Swimlanes and confirm:
- one lane per person with work, Unassigned last
- dragging a card to another person's cell reassigns **and** sets that column's status
- dragging into a Done cell fills the completed date (open the task to check)
- add-lane picker creates an empty droppable lane; its ✕ removes it
- a Jira-synced card cannot be dragged and shows no person select
- tabbing reaches every status select and person select
- hide-externals still applies (external-owned lanes disappear)
- narrow the window to ~375px: the grid scrolls horizontally, the page itself does not

```bash
PORT=3100 npm run stop
```

---

# RELEASE

### Task 23: Version, changelog, highlights

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: wherever `APP_HIGHLIGHT_KEYS` lives (`grep -rn "APP_HIGHLIGHT_KEYS" src/`)

- [ ] **Step 1: Pick an unused codename**

```bash
grep -n "0\.19" CHANGELOG.md | head -20
```

Choose a science-fiction author surname not already present (the milestone convention). Verify: `grep -i "<name>" CHANGELOG.md` returns nothing.

- [ ] **Step 2: Bump the version**

`src/app/version.ts`: `APP_VERSION = "0.199.0"` and the milestone codename.

- [ ] **Step 3: Add the highlight strings**

`i18n.ts`:

```ts
  versionHighlight0199: "Created date column, hide externals, and Kanban person swimlanes",
```

German (adjust the anchor to the last existing `versionHighlight*` line in the DE file — check with `grep -n "versionHighlight" src/app/i18n.de.ts | tail -1`):

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const m = s.match(/^  versionHighlight[^\r\n]*\r\n/gm);
if (!m) throw new Error("no versionHighlight lines found");
const anchor = m[m.length - 1];
s = s.replace(anchor, anchor + "  versionHighlight0199: \"Spalte Erstellt, Externe ausblenden und Kanban-Personenspuren\",\r\n");
fs.writeFileSync(p, s, "utf8");
'
```

Append `"versionHighlight0199"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 4: CHANGELOG entry**

Add at the top of `CHANGELOG.md`, matching the existing entry format:

```markdown
## 0.199.0 "<Codename>" — Open Points & Kanban

### Added
- **Created date column** — tasks now record when they were created; the column is sortable and off by default (enable it in the column config). Existing tasks are backfilled from their last-update date.
- **Hide externals** — an Open Points toggle that hides tasks owned by external resources and removes their values from the assignee, group and label filters.
- **Kanban person swimlanes** — a third Open Points view mode: status columns crossed with person rows. Drag a card into someone's lane to reassign and set its status in one move; a per-card person select is the keyboard equivalent. Jira-synced tasks stay read-only.
- The AI assistant can toggle hide-externals and switch to the swimlane view via `update_settings`.

### Changed
- Task storage gained a `createdDate` column across CSV, Markdown and both Turso schemas; existing Turso databases self-heal on next save.
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run test:run`
Expected: exit 0, all green (a version test may pin `APP_VERSION` — update it if it fails for that reason).

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
chore(release): 0.199.0 "<Codename>" — Open Points & Kanban
EOF
```

---

### Task 24: Review and hand off

- [ ] **Step 1: Superpowers code review**

Use the `superpowers:requesting-code-review` skill against the branch diff. Address CRITICAL and HIGH findings before pushing.

- [ ] **Step 2: Full local gate run**

```bash
npm run test:run && npx tsc --noEmit && npm run lint && npm run dup:check && npm run size:check && npm run build
```

Expected: all green.

- [ ] **Step 3: Stop**

Do not push, open an MR, or merge. Report the branch state and wait for an explicit release instruction — pushing and merging happen only on the user's explicit say-so, and a merge only after the pipeline is green.

---

## Notes for the implementer

- **Never regenerate the golden fixtures to make a red test green.** They are only regenerated in Task 4, and only after the diff has been inspected and shows exactly one new column.
- **Every save handler in this codebase is a functional setter** (`setTasks(prev => …)`). A handler that reads its array from the closure silently loses all but one write when called N times in a tick.
- **Exhaustive-deps is fatal.** An `obj.member` expression in a dependency array is rejected — hoist it to a scalar local first.
- **`set-state-in-effect` is banned.** Nothing in this plan needs it; if you reach for it, you have taken a wrong turn.
- **jsdom has no layout engine.** Any assertion about pixels, scroll positions or element rects reads 0. Test structure and handlers, not geometry.
