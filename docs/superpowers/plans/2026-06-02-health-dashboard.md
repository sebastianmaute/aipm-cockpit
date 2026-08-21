# Project-Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consolidated project-health dashboard view (RAG + sub-status, PM narrative, % complete + task health, budget burn, top RAID, upcoming/overdue, recent activity) that works as both a live cockpit and a printable status report.

**Architecture:** A new persisted `Workspace.status` (`ProjectStatus`) singleton holds RAG overrides + narrative, round-tripping through JSON/CSV/MD/Turso (Turso via the existing `meta` key/value table). Pure aggregation lives in `dashboard.ts` (`computeDashboard`), unit-tested to the 70% gate. Presentation lives in `dashboard-panel.tsx` + `dashboard-sections/*`, reusing `ReportCard`/`Section`/`Tile`/`healthDot` and the `.print-root` print path. A new `"dashboard"` nav view mounts in `workspace-section.tsx`.

**Tech Stack:** Next.js 16, React, TypeScript, Vitest 4 (`npm test` watch / `npm run test:run` single / `npm run test:coverage`).

**Design source:** `docs/superpowers/specs/2026-06-02-health-dashboard-design.md`.

**Conventions to honor (from repo memory):**
- Commits via the Bash tool use a here-doc: `git commit -F - <<'EOF' … EOF`. NO `Co-Authored-By` (attribution disabled globally).
- `i18n.de.ts` MUST use straight ASCII double-quote (`"`) delimiters — the Edit tool can curl them; grep after editing.
- Do NOT edit `eslint.config.mjs` (hook-blocked). Use PowerShell `Remove-Item`, never `rm -rf`.
- Branch: `feat-health-dashboard`. Merge to main locally + push only when the user asks.

---

## Pre-flight (do once before Task 1)

- [ ] Create and switch to the feature branch:

```bash
git checkout -b feat-health-dashboard
```

- [ ] Baseline green:

```bash
npm run test:run
```
Expected: all tests pass (≈1591+). If not, stop and report.

---

## Task 1: `ProjectStatus` type + `Workspace.status` + defaults

**Files:**
- Modify: `src/app/types.ts` (add `ProjectStatus` type)
- Modify: `src/app/storage.ts` (Workspace type ~53-69; `emptyWorkspace` ~74-82; `migrateWorkspaceV6` ~110-116)
- Test: `src/app/storage-serialization.test.ts` (add a migration/empty test)

`ProjectStatus` uses the inline `"R" | "A" | "G"` literal (matching `Task.healthOverride`) to avoid a `types.ts → health.ts` circular import.

- [ ] **Step 1: Write the failing test.** Append to `src/app/storage-serialization.test.ts`:

```typescript
describe("ProjectStatus defaults", () => {
  test("emptyWorkspace seeds an empty status object", () => {
    expect(emptyWorkspace().status).toEqual({});
  });

  test("migrateWorkspaceV6 backfills a missing status to {}", () => {
    const ws = { ...emptyWorkspace() };
    delete (ws as { status?: unknown }).status;
    expect(migrateWorkspaceV6(ws as typeof ws & { status?: never }).status).toEqual({});
  });
});
```

Ensure the imports at the top of the test file include `emptyWorkspace` and `migrateWorkspaceV6` from `./storage` (add them if missing).

- [ ] **Step 2: Run it — expect FAIL.**

Run: `npm run test:run -- storage-serialization`
Expected: FAIL (`status` is `undefined`, not `{}`).

- [ ] **Step 3: Add the `ProjectStatus` type.** In `src/app/types.ts`, add (near `RaidItem`/`Task`):

```typescript
/** Project-level status overrides + PM narrative for the health dashboard.
 *  RAG fields use the same "R" | "A" | "G" literal as Task.healthOverride to
 *  avoid a circular import with health.ts. Absent override = use the computed
 *  value. */
export type ProjectStatus = {
  ragOverride?: "R" | "A" | "G";
  scheduleOverride?: "R" | "A" | "G";
  budgetOverride?: "R" | "A" | "G";
  scopeOverride?: "R" | "A" | "G";
  narrative?: string;
  narrativeUpdatedAt?: string; // ISO 8601
};
```

- [ ] **Step 4: Wire it into `storage.ts`.** Add `ProjectStatus` to the existing `./types` import list. Then:

In the `Workspace` type (after `fxRates?`):
```typescript
  /** Project-level RAG overrides + PM narrative for the dashboard. Optional so
   *  older saved files still type-check; every load path defaults to {}. */
  status?: ProjectStatus;
```

In `emptyWorkspace()` return object (after `fxRates: null,`):
```typescript
    status: {},
```

Replace the body of `migrateWorkspaceV6` with:
```typescript
export function migrateWorkspaceV6(ws: Workspace): Workspace {
  const base = migrateWorkspaceV5(ws);
  const budgets = Array.isArray(base.budgets) ? base.budgets : [];
  const fxRates = base.fxRates ?? null;
  const status = base.status && typeof base.status === "object" ? base.status : {};
  if (budgets === base.budgets && fxRates === base.fxRates && status === base.status) {
    return base;
  }
  return { ...base, budgets, fxRates, status };
}
```

- [ ] **Step 5: Run it — expect PASS.**

Run: `npm run test:run -- storage-serialization`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/app/types.ts src/app/storage.ts src/app/storage-serialization.test.ts
git commit -F - <<'EOF'
feat: add ProjectStatus to Workspace with empty-default migration

Foundation for the project-health dashboard: a persisted singleton holding
RAG overrides + PM narrative. emptyWorkspace seeds {}, migrateWorkspaceV6
backfills missing status to {}.
EOF
```

---

## Task 2: JSON round-trip for `status`

**Files:**
- Modify: `src/app/storage.ts` (`workspaceToJson` ~867-878; `jsonToWorkspace` ~883-906)
- Test: `src/app/storage-serialization.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
test("JSON round-trip preserves project status", () => {
  const ws = {
    ...emptyWorkspace(),
    status: { ragOverride: "A" as const, narrative: "On track, one risk to watch.", narrativeUpdatedAt: "2026-06-02T10:00:00.000Z" },
  };
  const back = jsonToWorkspace(workspaceToJson(ws));
  expect(back.status).toEqual(ws.status);
});
```

Ensure `workspaceToJson` and `jsonToWorkspace` are imported in the test file.

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- storage-serialization`
Expected: FAIL (`back.status` is `{}`, not the input).

- [ ] **Step 3: Implement.** In `workspaceToJson`, add `status` to the serialized object (after `fxRates: ws.fxRates ?? null,`):
```typescript
      status: ws.status ?? {},
```

In `jsonToWorkspace`, add to the `raw` object (after `fxRates: sanitizeFxRates(p.fxRates),`):
```typescript
      status: sanitizeProjectStatus(p.status),
```

Add this sanitizer near the other `sanitize*` helpers in `storage.ts` (or inline above `jsonToWorkspace`):
```typescript
/** Defensive: accept only known RAG/narrative fields from untrusted JSON. */
export function sanitizeProjectStatus(raw: unknown): ProjectStatus {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const rag = (v: unknown): "R" | "A" | "G" | undefined =>
    v === "R" || v === "A" || v === "G" ? v : undefined;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const out: ProjectStatus = {};
  if (rag(r.ragOverride)) out.ragOverride = rag(r.ragOverride);
  if (rag(r.scheduleOverride)) out.scheduleOverride = rag(r.scheduleOverride);
  if (rag(r.budgetOverride)) out.budgetOverride = rag(r.budgetOverride);
  if (rag(r.scopeOverride)) out.scopeOverride = rag(r.scopeOverride);
  if (str(r.narrative)) out.narrative = str(r.narrative);
  if (str(r.narrativeUpdatedAt)) out.narrativeUpdatedAt = str(r.narrativeUpdatedAt);
  return out;
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- storage-serialization`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/storage.ts src/app/storage-serialization.test.ts
git commit -F - <<'EOF'
feat: round-trip ProjectStatus through the JSON envelope

Adds sanitizeProjectStatus (whitelists RAG + narrative fields) and threads
status through workspaceToJson / jsonToWorkspace.
EOF
```

---

## Task 3: CSV round-trip for `status`

**Files:**
- Modify: `src/app/storage.ts` (CSV section consts ~485-493 / ~861-864; `workspaceToCsv` ~912-931; `splitCsvSections` ~997-1062; `csvToWorkspace` ~1220-1236)
- Test: `src/app/storage-serialization.test.ts`

Status serializes as a `# PROJECT STATUS` section of `field,value` rows (one row per set field). Reuses the existing `parseCsv` (handles quoting).

- [ ] **Step 1: Write the failing test.**

```typescript
test("CSV round-trip preserves project status", () => {
  const ws = {
    ...emptyWorkspace(),
    status: { ragOverride: "R" as const, scopeOverride: "A" as const, narrative: "Scope creep, see note: \"phase 2\".", narrativeUpdatedAt: "2026-06-02T10:00:00.000Z" },
  };
  const back = csvToWorkspace(workspaceToCsv(ws));
  expect(back.status).toEqual(ws.status);
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- storage-serialization`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add the section marker next to the other consts (near line 864):
```typescript
const CSV_SECTION_STATUS = "# PROJECT STATUS";
```

Add the encoder/decoder near `workspaceToCsv` (the `parseCsv` helper already exists below):
```typescript
const STATUS_FIELDS: readonly (keyof ProjectStatus)[] = [
  "ragOverride", "scheduleOverride", "budgetOverride", "scopeOverride",
  "narrative", "narrativeUpdatedAt",
];

function csvEscapeCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function statusToCsv(status: ProjectStatus): string {
  const rows: string[] = ["field,value"];
  for (const f of STATUS_FIELDS) {
    const v = status[f];
    if (v != null && v !== "") rows.push(`${f},${csvEscapeCell(String(v))}`);
  }
  return rows.join("\r\n");
}

export function csvToStatus(text: string): ProjectStatus {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] && !r[0].startsWith("#"));
  const map: Record<string, string> = {};
  for (const [k, v] of rows) {
    if (k === "field") continue; // header row
    map[k] = v;
  }
  return sanitizeProjectStatus(map);
}
```

In `workspaceToCsv`, before the final `parts.push("", planToCsvLine(ws.plan));`, add:
```typescript
  if (ws.status && Object.keys(ws.status).length > 0) {
    parts.push("", CSV_SECTION_STATUS, statusToCsv(ws.status));
  }
```

In `splitCsvSections`: extend the `mode` union with `"status"`, add a `statusLines: string[] = [];`, add the marker check alongside the others:
```typescript
    if (trimmed.startsWith(CSV_SECTION_STATUS)) { mode = "status"; continue; }
```
add the dispatch line alongside the others:
```typescript
    else if (mode === "status") statusLines.push(line);
```
and add `statusText: statusLines.join("\r\n"),` to the returned object (and `statusText: string;` to its return-type annotation).

In `csvToWorkspace`, add to the assembled `ws` object (after `fxRates: ...,`):
```typescript
    status: s.statusText.trim() ? csvToStatus(s.statusText) : {},
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- storage-serialization`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/storage.ts src/app/storage-serialization.test.ts
git commit -F - <<'EOF'
feat: round-trip ProjectStatus through the CSV backend

New "# PROJECT STATUS" field,value section; statusToCsv / csvToStatus reuse
the existing CSV parser + sanitizeProjectStatus.
EOF
```

---

## Task 4: Markdown round-trip for `status`

**Files:**
- Modify: `src/app/storage.ts` (`workspaceToMarkdown` ~1449-1462; `splitMarkdownSections`; `markdownToWorkspace` ~1855-1871)
- Test: `src/app/storage-serialization.test.ts`

Mirror the budgets MD pattern. First **read** `splitMarkdownSections` and `markdownToBudgets`/`budgetsToMarkdown` to see the exact section-header convention used (e.g. `## Budgets`), then replicate it for `## Project Status`.

- [ ] **Step 1: Write the failing test.**

```typescript
test("Markdown round-trip preserves project status", () => {
  const ws = {
    ...emptyWorkspace(),
    status: { budgetOverride: "A" as const, narrative: "Budget tightening.", narrativeUpdatedAt: "2026-06-02T10:00:00.000Z" },
  };
  const back = markdownToWorkspace(workspaceToMarkdown(ws));
  expect(back.status).toEqual(ws.status);
});
```

Ensure `workspaceToMarkdown` and `markdownToWorkspace` are imported in the test file.

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- storage-serialization`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add the MD encoder/decoder near `workspaceToMarkdown`:
```typescript
export function statusToMarkdown(status: ProjectStatus): string {
  const lines = ["## Project Status", ""];
  for (const f of STATUS_FIELDS) {
    const v = status[f];
    if (v != null && v !== "") lines.push(`- ${f}: ${String(v)}`);
  }
  return lines.join("\n") + "\n";
}

export function markdownToStatus(md: string): ProjectStatus {
  const map: Record<string, string> = {};
  for (const line of md.split(/\r?\n/)) {
    const m = /^- (\w+):\s?(.*)$/.exec(line.trim());
    if (m) map[m[1]] = m[2];
  }
  return sanitizeProjectStatus(map);
}
```

In `workspaceToMarkdown`, before `out += "\n" + planToMarkdown(ws.plan);`, add:
```typescript
  if (ws.status && Object.keys(ws.status).length > 0) out += "\n" + statusToMarkdown(ws.status);
```

In `splitMarkdownSections`, add a `## Project Status` section capture mirroring the `budgetsMd` handling, returning `statusMd`. In `markdownToWorkspace`, add to the assembled `ws` object:
```typescript
    status: s.statusMd && s.statusMd.trim() ? markdownToStatus(s.statusMd) : {},
```
(If `splitMarkdownSections`'s return type is an explicit interface, add `statusMd: string;` to it.)

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- storage-serialization`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/storage.ts src/app/storage-serialization.test.ts
git commit -F - <<'EOF'
feat: round-trip ProjectStatus through the Markdown backend

Adds a "## Project Status" section mirroring the budgets MD handling.
EOF
```

---

## Task 5: Turso round-trip for `status` (via the `meta` table)

**Files:**
- Modify: `src/app/turso-schema.ts` (`rowsToWorkspace` ~92-113; `workspaceToStatements` ~127-146)
- Test: `src/app/turso-schema.test.ts` (create if absent) OR append to an existing turso test

Turso already has a `meta (key TEXT PRIMARY KEY, value TEXT)` table (used for `schema_version`). Store the whole `status` object as JSON under key `project_status` — no DDL change needed.

- [ ] **Step 1: Write the failing test.** Create/append `src/app/turso-schema.test.ts`:

```typescript
import { describe, test, expect } from "vitest";
import { workspaceToStatements } from "./turso-schema";
import { emptyWorkspace } from "./storage";

describe("Turso project_status", () => {
  test("workspaceToStatements writes status as a project_status meta row", () => {
    const ws = { ...emptyWorkspace(), status: { ragOverride: "R" as const, narrative: "x" } };
    const stmts = workspaceToStatements(ws);
    const metaInsert = stmts.find(
      (s) => s.sql.includes("INSERT INTO meta") && s.args?.length === 2 && s.args[0].value === "project_status",
    );
    expect(metaInsert).toBeDefined();
    expect(JSON.parse(metaInsert!.args![1].value!)).toEqual(ws.status);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- turso-schema`
Expected: FAIL (no `project_status` meta insert).

- [ ] **Step 3: Implement.** In `workspaceToStatements`, before the `COMMIT` push, add:
```typescript
  out.push({
    sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
    args: [
      { type: "text", value: "project_status" },
      { type: "text", value: JSON.stringify(ws.status ?? {}) },
    ],
  });
```
Note the existing `schema_version` insert uses a literal key in SQL; this one parameterizes both columns so the test can match `args[0].value === "project_status"`.

In `rowsToWorkspace`, before `return migrateWorkspaceV6(ws);`, add:
```typescript
  const metaRows = rowObjects(byTable.get("meta"));
  const statusRow = metaRows.find((r) => r.key === "project_status");
  if (statusRow?.value) {
    try {
      ws.status = JSON.parse(statusRow.value);
    } catch {
      // malformed — leave the emptyWorkspace() default
    }
  }
```
Add `import { sanitizeProjectStatus } from "./storage";` and wrap: `ws.status = sanitizeProjectStatus(JSON.parse(statusRow.value));` for defensive parsing.

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- turso-schema`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/turso-schema.ts src/app/turso-schema.test.ts
git commit -F - <<'EOF'
feat: persist ProjectStatus to Turso via the meta table

Stores status as JSON under the project_status meta key; rowsToWorkspace
restores it through sanitizeProjectStatus.
EOF
```

---

## Task 6: Context + load/save wiring for `status`

**Files:**
- Modify: `src/app/workspace-context.tsx` (`WorkspaceValue` ~29-61; provider state ~66-76; `value` object ~196-223)
- Modify: `src/app/use-storage-backend.ts` (load ~119-131; save assembly ~174, ~208, ~289)

No new unit test (integration wiring); correctness is guarded by `tsc` and the round-trip tests above. Run the full suite at the end.

- [ ] **Step 1: Add to context.** In `workspace-context.tsx`, add `ProjectStatus` to the `./types` import. In `WorkspaceValue` (after `fxRates` / `setFxRates`):
```typescript
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
```
In `WorkspaceProvider`, add state (after the `fxRates` state):
```typescript
  const [status, setStatus] = useState<ProjectStatus>({});
```
In the `value` object (after `fxRates, setFxRates,`):
```typescript
    status, setStatus,
```

- [ ] **Step 2: Wire load.** In `use-storage-backend.ts`, the loader (~119-131) destructures setters — add `setStatus` to that set, and after `setFxRates(workspace.fxRates ?? null);` add:
```typescript
        setStatus(workspace.status ?? {});
```
Ensure `setStatus` is obtained from `useWorkspace()` (or however the other setters are sourced in this hook) at the top of the hook.

- [ ] **Step 3: Wire save.** In `use-storage-backend.ts`, every `backend.save({ tasks, raid, ..., budgets, fxRates })` / `target.save({...})` call (lines ~174, ~208, ~289) — add `, status` to the object literal:
```typescript
{ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status }
```
Add `status` to the dependency arrays of the relevant `useEffect`/`useCallback` that perform the save (mirror where `budgets`/`fxRates` appear in deps).

- [ ] **Step 4: Type-check.**

Run: `npx tsc --noEmit; echo "tsc exit: $?"`
Expected: `tsc exit: 0`.

- [ ] **Step 5: Commit.**

```bash
git add src/app/workspace-context.tsx src/app/use-storage-backend.ts
git commit -F - <<'EOF'
feat: expose ProjectStatus on the workspace context + persist on load/save

WorkspaceProvider holds status/setStatus; use-storage-backend loads
workspace.status and includes it in every save payload.
EOF
```

---

## Task 7: `dashboard.ts` — progress aggregation

**Files:**
- Create: `src/app/dashboard.ts`
- Test: `src/app/dashboard.test.ts`

This task creates `dashboard.ts` with its shared types + the first helper. Later tasks add helpers to the same file.

- [ ] **Step 1: Write the failing test.** Create `src/app/dashboard.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeDashboardProgress } from "./dashboard";
import type { Task } from "./types";

function task(o: Partial<Task> = {}): Task {
  return {
    id: 1, taskName: "T", assignee: "A", assigneeEmail: "a@x.io",
    dueDate: "2026-06-10", lastUpdateDate: "2026-06-01", priority: "Medium",
    blockers: "", notes: "", ...o,
  };
}

describe("computeDashboardProgress", () => {
  const today = "2026-06-02";
  const holidays = new Set<string>();

  it("returns 0% and zero counts for an empty workspace", () => {
    const p = computeDashboardProgress([], today, holidays);
    expect(p).toEqual({ total: 0, completed: 0, percent: 0, counts: { R: 0, A: 0, G: 0 } });
  });

  it("computes percent from completedDate and R/A/G counts from health", () => {
    const tasks = [
      task({ id: 1, completedDate: "2026-06-01" }),               // G (completed)
      task({ id: 2, dueDate: "2026-05-01" }),                     // R (overdue)
      task({ id: 3, dueDate: "2026-06-02" }),                     // A (due today)
      task({ id: 4, dueDate: "2026-12-01" }),                     // G (on track)
    ];
    const p = computeDashboardProgress(tasks, today, holidays);
    expect(p.total).toBe(4);
    expect(p.completed).toBe(1);
    expect(p.percent).toBe(25);
    expect(p.counts).toEqual({ R: 1, A: 1, G: 2 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- dashboard`
Expected: FAIL (`dashboard.ts` does not exist).

- [ ] **Step 3: Implement.** Create `src/app/dashboard.ts`:

```typescript
// Pure aggregation for the project-health dashboard. No React, no I/O — the
// single testable unit behind dashboard-panel.tsx.

import { computeGroupHealth, type Health } from "./health";
import { computeBudgetReport, type CciValue, type ProjectReport } from "./budget-report";
import { isTerminalStatus, riskSeverityFromMatrix } from "./raid";
import { workdaysUntil } from "./due-dates";
import type {
  Absence, BudgetBucket, ProjectStatus, RaidItem, RaidSeverity,
  Resource, ResourcePlan, Role, Task,
} from "./types";
import type { ActivityEntry } from "./activity-log";

export type SubStatus = Health | null;

export const DASHBOARD_DEFAULTS = {
  dueSoonWorkdays: 3,
  topRaid: 5,
  recentActivity: 8,
  budgetAmberRatio: 0.9,
} as const;

export type DashboardProgress = {
  total: number;
  completed: number;
  percent: number;
  counts: Record<Health, number>;
};

/** % complete (completedDate-based) + R/A/G health counts. */
export function computeDashboardProgress(
  tasks: readonly Task[],
  todayISO: string,
  holidaySet: ReadonlySet<string>,
): DashboardProgress {
  const counts = computeGroupHealth(tasks, todayISO, holidaySet).counts;
  const total = tasks.length;
  const completed = tasks.filter((t) => !!t.completedDate).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, percent, counts };
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- dashboard`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: dashboard.ts scaffold + progress aggregation

computeDashboardProgress: % complete from completedDate, R/A/G counts from
computeGroupHealth.
EOF
```

---

## Task 8: `dashboard.ts` — schedule sub-status

**Files:**
- Modify: `src/app/dashboard.ts`
- Test: `src/app/dashboard.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `dashboard.test.ts` (reuse the `task`/`today`/`holidays` helpers):

```typescript
import { computeScheduleStatus } from "./dashboard";

describe("computeScheduleStatus", () => {
  const today = "2026-06-02";
  const holidays = new Set<string>();

  it("is Green when nothing is overdue or due soon", () => {
    expect(computeScheduleStatus([task({ dueDate: "2026-12-01" })], today, holidays)).toBe("G");
  });

  it("is Amber when a task is due within the work-day window", () => {
    expect(computeScheduleStatus([task({ dueDate: "2026-06-03" })], today, holidays)).toBe("A");
  });

  it("is Red when any task is overdue", () => {
    expect(computeScheduleStatus([task({ dueDate: "2026-05-01" }), task({ dueDate: "2026-12-01" })], today, holidays)).toBe("R");
  });

  it("ignores completed tasks", () => {
    expect(computeScheduleStatus([task({ dueDate: "2026-05-01", completedDate: "2026-05-02" })], today, holidays)).toBe("G");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- dashboard`
Expected: FAIL (`computeScheduleStatus` not exported).

- [ ] **Step 3: Implement.** Add to `dashboard.ts`:

```typescript
/** Date-driven schedule RAG: Red if any task is overdue, Amber if any is due
 *  within `dueSoonWorkdays` working days, else Green. Completed tasks ignored. */
export function computeScheduleStatus(
  tasks: readonly Task[],
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  dueSoonWorkdays: number = DASHBOARD_DEFAULTS.dueSoonWorkdays,
): Health {
  const hs = holidaySet instanceof Set ? holidaySet : new Set<string>(holidaySet);
  let overdue = 0;
  let dueSoon = 0;
  for (const t of tasks) {
    if (t.completedDate || !t.dueDate) continue;
    if (t.dueDate < todayISO) { overdue++; continue; }
    if (workdaysUntil(t.dueDate, todayISO, hs) <= dueSoonWorkdays) dueSoon++;
  }
  return overdue > 0 ? "R" : dueSoon > 0 ? "A" : "G";
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- dashboard`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: dashboard schedule sub-status (overdue/due-soon RAG)
EOF
```

---

## Task 9: `dashboard.ts` — budget sub-status

**Files:**
- Modify: `src/app/dashboard.ts`
- Test: `src/app/dashboard.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
import { computeBudgetStatus } from "./dashboard";
import type { ProjectReport } from "./budget-report";

function project(budgetValue: number, consumedValue: number): ProjectReport {
  return {
    budgetHours: 0, plannedHours: 0, actualHours: 0,
    budgetValue, consumedValue, revenue: 0, cost: 0,
    winLossHours: 0, winLossValue: 0,
    contributionMargin: { amount: 0, percent: null },
    costPerformance: { amount: 0, percent: null },
    consumption: { amount: 0, percent: null },
  };
}

describe("computeBudgetStatus", () => {
  it("is null when there is no budget", () => {
    expect(computeBudgetStatus(null)).toBeNull();
    expect(computeBudgetStatus(project(0, 0))).toBeNull();
  });
  it("is Green below the amber ratio", () => {
    expect(computeBudgetStatus(project(100, 50))).toBe("G");
  });
  it("is Amber at or above 90% consumption", () => {
    expect(computeBudgetStatus(project(100, 90))).toBe("A");
  });
  it("is Red when over budget", () => {
    expect(computeBudgetStatus(project(100, 101))).toBe("R");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- dashboard`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add to `dashboard.ts`:

```typescript
/** Budget RAG from the project budget report: Red if over budget, Amber at or
 *  above `amberRatio` consumption, else Green. null when no budget is set. */
export function computeBudgetStatus(
  project: ProjectReport | null,
  amberRatio: number = DASHBOARD_DEFAULTS.budgetAmberRatio,
): SubStatus {
  if (!project || project.budgetValue <= 0) return null;
  if (project.consumedValue > project.budgetValue) return "R";
  if (project.consumedValue / project.budgetValue >= amberRatio) return "A";
  return "G";
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- dashboard`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: dashboard budget sub-status (90% amber, over-budget red)
EOF
```

---

## Task 10: `dashboard.ts` — top RAID selection

**Files:**
- Modify: `src/app/dashboard.ts`
- Test: `src/app/dashboard.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
import { selectTopRaid } from "./dashboard";
import type { RaidItem } from "./types";

function raid(o: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 1, category: "R", title: "risk", status: "Open",
    linkedTaskIds: [], raisedDate: "2026-01-01", causedByRaidIds: [], ...o,
  };
}

describe("selectTopRaid", () => {
  it("drops terminal-status items", () => {
    const items = [raid({ id: 1, status: "Closed" }), raid({ id: 2, status: "Open", severity: "High" })];
    expect(selectTopRaid(items).map((r) => r.id)).toEqual([2]);
  });

  it("sorts by severity (Critical first), derives risk severity from matrix", () => {
    const items = [
      raid({ id: 1, severity: "Low" }),
      raid({ id: 2, severity: "Critical" }),
      raid({ id: 3, category: "R", probability: 5, impact: 5 }), // matrix => Critical
    ];
    const ids = selectTopRaid(items).map((r) => r.id);
    expect(ids[0] === 2 || ids[0] === 3).toBe(true);
    expect(ids[ids.length - 1]).toBe(1);
  });

  it("caps at the limit", () => {
    const items = Array.from({ length: 8 }, (_, i) => raid({ id: i + 1, severity: "High" }));
    expect(selectTopRaid(items, 5)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- dashboard`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add to `dashboard.ts`:

```typescript
const SEVERITY_RANK: Record<RaidSeverity, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

function effectiveSeverity(item: RaidItem): RaidSeverity | undefined {
  if (item.severity) return item.severity;
  if (item.category === "R" && item.probability && item.impact) {
    return riskSeverityFromMatrix(item.probability, item.impact);
  }
  return undefined;
}

/** Open RAID items, sorted by severity (Critical→Low, unknown last), tie-broken
 *  by raisedDate then id, capped at `limit`. */
export function selectTopRaid(
  raid: readonly RaidItem[],
  limit: number = DASHBOARD_DEFAULTS.topRaid,
): RaidItem[] {
  return raid
    .filter((r) => !isTerminalStatus(r.status, r.category))
    .map((r) => {
      const sev = effectiveSeverity(r);
      return { r, rank: sev ? SEVERITY_RANK[sev] : 0 };
    })
    .sort((a, b) => b.rank - a.rank || a.r.raisedDate.localeCompare(b.r.raisedDate) || a.r.id - b.r.id)
    .slice(0, limit)
    .map((x) => x.r);
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- dashboard`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: dashboard top-RAID selection (open, severity-ranked, capped)
EOF
```

---

## Task 11: `dashboard.ts` — upcoming/overdue partition + recent activity

**Files:**
- Modify: `src/app/dashboard.ts`
- Test: `src/app/dashboard.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
import { partitionUpcoming, recentActivity } from "./dashboard";
import type { ActivityEntry } from "./activity-log";

describe("partitionUpcoming", () => {
  const today = "2026-06-02";
  const holidays = new Set<string>();

  it("splits overdue vs due-soon, ignores completed and far-future, sorts by dueDate", () => {
    const tasks = [
      task({ id: 1, dueDate: "2026-05-20" }),                       // overdue
      task({ id: 2, dueDate: "2026-05-10" }),                       // overdue (earlier)
      task({ id: 3, dueDate: "2026-06-03" }),                       // due soon
      task({ id: 4, dueDate: "2026-12-01" }),                       // far future -> neither
      task({ id: 5, dueDate: "2026-05-01", completedDate: "2026-05-02" }), // completed -> neither
    ];
    const { overdue, dueSoon } = partitionUpcoming(tasks, today, holidays);
    expect(overdue.map((t) => t.id)).toEqual([2, 1]);
    expect(dueSoon.map((t) => t.id)).toEqual([3]);
  });
});

describe("recentActivity", () => {
  it("returns the last N entries, newest first", () => {
    const entries: ActivityEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, timestamp: `2026-06-0${(i % 9) + 1}T00:00:00.000Z`, kind: "task.created", args: [],
    }));
    const out = recentActivity(entries, 3);
    expect(out.map((e) => e.id)).toEqual([10, 9, 8]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- dashboard`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add to `dashboard.ts`:

```typescript
/** Non-completed tasks split into overdue (dueDate < today) and due-soon
 *  (within `dueSoonWorkdays`), each sorted by dueDate then id. */
export function partitionUpcoming(
  tasks: readonly Task[],
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  dueSoonWorkdays: number = DASHBOARD_DEFAULTS.dueSoonWorkdays,
): { overdue: Task[]; dueSoon: Task[] } {
  const hs = holidaySet instanceof Set ? holidaySet : new Set<string>(holidaySet);
  const overdue: Task[] = [];
  const dueSoon: Task[] = [];
  for (const t of tasks) {
    if (t.completedDate || !t.dueDate) continue;
    if (t.dueDate < todayISO) overdue.push(t);
    else if (workdaysUntil(t.dueDate, todayISO, hs) <= dueSoonWorkdays) dueSoon.push(t);
  }
  const byDue = (a: Task, b: Task) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id;
  overdue.sort(byDue);
  dueSoon.sort(byDue);
  return { overdue, dueSoon };
}

/** Last `limit` activity entries, newest first. */
export function recentActivity(
  entries: readonly ActivityEntry[],
  limit: number = DASHBOARD_DEFAULTS.recentActivity,
): ActivityEntry[] {
  return entries.slice(-limit).reverse();
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- dashboard`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: dashboard upcoming/overdue partition + recent-activity slice
EOF
```

---

## Task 12: `dashboard.ts` — `computeDashboard` assembly

**Files:**
- Modify: `src/app/dashboard.ts`
- Test: `src/app/dashboard.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
import { computeDashboard, type DashboardInput } from "./dashboard";

function baseInput(over: Partial<DashboardInput> = {}): DashboardInput {
  return {
    tasks: [], raid: [], budgets: [], plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
    roles: [], resources: [], absences: [], workdayHours: 8,
    holidaySet: new Set<string>(), status: {}, activity: [], today: "2026-06-02",
    ...over,
  };
}

describe("computeDashboard", () => {
  it("returns neutral values for an empty workspace (no crash, no budget)", () => {
    const m = computeDashboard(baseInput());
    expect(m.overall.effective).toBe("G");
    expect(m.burn).toBeNull();
    expect(m.budget.effective).toBeNull();
    expect(m.progress.percent).toBe(0);
    expect(m.scope.effective).toBeNull();
    expect(m.narrative.text).toBe("");
  });

  it("applies the overall RAG override and reports the computed value + flag", () => {
    const tasks = [task({ dueDate: "2026-05-01" })]; // computed R
    const m = computeDashboard(baseInput({ tasks, status: { ragOverride: "G" } }));
    expect(m.overall.computed).toBe("R");
    expect(m.overall.effective).toBe("G");
    expect(m.overall.overridden).toBe(true);
  });

  it("surfaces the narrative + scope override", () => {
    const m = computeDashboard(baseInput({ status: { scopeOverride: "A", narrative: "hi", narrativeUpdatedAt: "2026-06-02T00:00:00.000Z" } }));
    expect(m.scope.effective).toBe("A");
    expect(m.narrative).toEqual({ text: "hi", updatedAt: "2026-06-02T00:00:00.000Z" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- dashboard`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add to `dashboard.ts`:

```typescript
export type DashboardBurn = {
  budgetValue: number;
  consumedValue: number;
  budgetHours: number;
  actualHours: number;
  cost: number;
  costPerformance: CciValue;
  consumption: CciValue;
};

export type DashboardModel = {
  overall: { computed: Health; effective: Health; overridden: boolean };
  schedule: { computed: Health; effective: Health; overridden: boolean };
  budget: { computed: SubStatus; effective: SubStatus; overridden: boolean };
  scope: { effective: SubStatus };
  progress: DashboardProgress;
  burn: DashboardBurn | null;
  topRaid: RaidItem[];
  overdue: Task[];
  dueSoon: Task[];
  recentActivity: ActivityEntry[];
  narrative: { text: string; updatedAt?: string };
};

export interface DashboardInput {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  budgets: readonly BudgetBucket[];
  plan: ResourcePlan;
  roles: readonly Role[];
  resources: readonly Resource[];
  absences: readonly Absence[];
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  status: ProjectStatus;
  activity: readonly ActivityEntry[];
  today: string;
}

export interface DashboardOptions {
  dueSoonWorkdays?: number;
  topRaid?: number;
  recentActivity?: number;
  budgetAmberRatio?: number;
}

export function computeDashboard(input: DashboardInput, opts: DashboardOptions = {}): DashboardModel {
  const dueSoonWorkdays = opts.dueSoonWorkdays ?? DASHBOARD_DEFAULTS.dueSoonWorkdays;
  const topRaidN = opts.topRaid ?? DASHBOARD_DEFAULTS.topRaid;
  const recentN = opts.recentActivity ?? DASHBOARD_DEFAULTS.recentActivity;
  const amberRatio = opts.budgetAmberRatio ?? DASHBOARD_DEFAULTS.budgetAmberRatio;
  const { status, today, holidaySet } = input;

  const overallComputed = computeGroupHealth(input.tasks, today, holidaySet).color;
  const scheduleComputed = computeScheduleStatus(input.tasks, today, holidaySet, dueSoonWorkdays);

  const project: ProjectReport | null = input.budgets.length > 0
    ? computeBudgetReport(input.budgets, input.plan, input.roles, input.resources, input.workdayHours, holidaySet, input.absences).project
    : null;
  const budgetComputed = computeBudgetStatus(project, amberRatio);
  const burn: DashboardBurn | null = project
    ? {
        budgetValue: project.budgetValue, consumedValue: project.consumedValue,
        budgetHours: project.budgetHours, actualHours: project.actualHours,
        cost: project.cost, costPerformance: project.costPerformance, consumption: project.consumption,
      }
    : null;

  const { overdue, dueSoon } = partitionUpcoming(input.tasks, today, holidaySet, dueSoonWorkdays);

  return {
    overall: { computed: overallComputed, effective: status.ragOverride ?? overallComputed, overridden: !!status.ragOverride },
    schedule: { computed: scheduleComputed, effective: status.scheduleOverride ?? scheduleComputed, overridden: !!status.scheduleOverride },
    budget: { computed: budgetComputed, effective: status.budgetOverride ?? budgetComputed, overridden: !!status.budgetOverride },
    scope: { effective: status.scopeOverride ?? null },
    progress: computeDashboardProgress(input.tasks, today, holidaySet),
    burn,
    topRaid: selectTopRaid(input.raid, topRaidN),
    overdue,
    dueSoon,
    recentActivity: recentActivity(input.activity, recentN),
    narrative: { text: status.narrative ?? "", updatedAt: status.narrativeUpdatedAt },
  };
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- dashboard`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: computeDashboard assembles the full DashboardModel

Overall/schedule/budget computed-with-override, scope manual, progress, burn,
top RAID, upcoming/overdue, recent activity, narrative.
EOF
```

---

## Task 13: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (the `enUS` object)
- Modify: `src/app/i18n.de.ts` (the `de` dictionary)

- [ ] **Step 1: Add EN keys.** In `i18n.ts`, add to the `enUS` object (placement near other `tab*`/`nav*` keys is fine; `TranslationKey = keyof typeof enUS` picks them up automatically):

```typescript
  navDashboard: "Dashboard",
  dashboardReportDate: "As of {0}",
  dashboardOverall: "Overall",
  dashboardSubSchedule: "Schedule",
  dashboardSubBudget: "Budget",
  dashboardSubScope: "Scope",
  dashboardStatusSummary: "Status summary",
  dashboardNarrativePlaceholder: "Summarize the current status, what changed, and what needs attention.",
  dashboardNarrativeUpdated: "Updated {0}",
  dashboardProgress: "Progress",
  dashboardPercentComplete: "{0}% complete",
  dashboardCompletedOf: "{0} of {1} complete",
  dashboardBudgetBurn: "Budget burn",
  dashboardNoBudget: "No budget configured",
  dashboardTopRaid: "Top open RAID",
  dashboardUpcoming: "Upcoming & overdue",
  dashboardOverdue: "Overdue",
  dashboardDueSoon: "Due soon",
  dashboardRecentActivity: "Recent activity",
  dashboardEmpty: "No tasks yet.",
  dashboardOverride: "Override",
  dashboardUseComputed: "Use computed",
  dashboardComputedHint: "Computed: {0}",
  dashboardScopeUnset: "Not set",
```

- [ ] **Step 2: Add DE keys.** In `i18n.de.ts`, add the SAME keys with German values. **Use only straight ASCII `"` quotes** (the Edit tool can turn them into curly quotes — verify in Step 3):

```typescript
  navDashboard: "Dashboard",
  dashboardReportDate: "Stand {0}",
  dashboardOverall: "Gesamt",
  dashboardSubSchedule: "Zeitplan",
  dashboardSubBudget: "Budget",
  dashboardSubScope: "Umfang",
  dashboardStatusSummary: "Statuszusammenfassung",
  dashboardNarrativePlaceholder: "Aktuellen Status, Aenderungen und offene Punkte zusammenfassen.",
  dashboardNarrativeUpdated: "Aktualisiert {0}",
  dashboardProgress: "Fortschritt",
  dashboardPercentComplete: "{0}% abgeschlossen",
  dashboardCompletedOf: "{0} von {1} abgeschlossen",
  dashboardBudgetBurn: "Budgetverbrauch",
  dashboardNoBudget: "Kein Budget konfiguriert",
  dashboardTopRaid: "Wichtigste offene RAID",
  dashboardUpcoming: "Anstehend & ueberfaellig",
  dashboardOverdue: "Ueberfaellig",
  dashboardDueSoon: "Bald faellig",
  dashboardRecentActivity: "Letzte Aktivitaet",
  dashboardEmpty: "Noch keine Aufgaben.",
  dashboardOverride: "Ueberschreiben",
  dashboardUseComputed: "Berechneten Wert verwenden",
  dashboardComputedHint: "Berechnet: {0}",
  dashboardScopeUnset: "Nicht gesetzt",
```
(Umlauts written as `ae`/`ue` to keep the source pure-ASCII and dodge the curly-quote/encoding pitfall; if the file already uses real umlauts elsewhere, match that convention instead — but keep the `"` delimiters straight either way.)

- [ ] **Step 3: Verify straight quotes + key parity.**

Run: `npx tsc --noEmit; echo "tsc exit: $?"`
Expected: `tsc exit: 0` (a missing/extra DE key fails the `Record<TranslationKey, string>` type).

Also confirm no curly quotes were introduced:
Run (PowerShell): `Select-String -Path src/app/i18n.de.ts -Pattern '[“”]' | Select-Object -First 5`
Expected: no matches.

- [ ] **Step 4: Commit.**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: i18n keys for the health dashboard (EN + DE)
EOF
```

---

## Task 14: Register the `dashboard` nav view

**Files:**
- Modify: `src/app/nav-config.ts` (`AppView` ~6-23; `NAV_GROUPS` Overview group ~36-39; `LABEL_KEYS` ~70-87)

- [ ] **Step 1: Add the view id.** In the `AppView` union, add `"dashboard"` (e.g. right after `"open-points"`):
```typescript
  | "open-points"
  | "dashboard"
```

- [ ] **Step 2: Add to the Overview group as the first item.** Change the Overview group items to:
```typescript
    items: [{ view: "dashboard" }, { view: "open-points" }, { view: "chat" }],
```

- [ ] **Step 3: Add the label key.** In `LABEL_KEYS`, add:
```typescript
  dashboard: "navDashboard",
```
(`LABEL_KEYS` is `Record<Exclude<AppView, "edit">, TranslationKey>`, so tsc will demand this entry once the union changes.)

- [ ] **Step 4: Type-check.**

Run: `npx tsc --noEmit; echo "tsc exit: $?"`
Expected: `tsc exit: 0`. (`slugToView`/`viewToSlug`/`allNavViews` handle the new view automatically.)

- [ ] **Step 5: Commit.**

```bash
git add src/app/nav-config.ts
git commit -F - <<'EOF'
feat: register the dashboard nav view (first in Overview)
EOF
```

---

## Task 15: Dashboard section components

**Files:**
- Create: `src/app/dashboard-sections/health-pill.tsx`
- Create: `src/app/dashboard-sections/registers-band.tsx`

Small presentational pieces reused by the panel. `.tsx` — excluded from the coverage gate. A `HealthPill` renders a RAG dot + label using the existing `healthDot` map; `RegistersBand` renders the Top-RAID and Upcoming/overdue lists.

- [ ] **Step 1: Create `health-pill.tsx`.**

```typescript
import { healthColorName, healthDot, type Health } from "../health";
import { type Lang } from "../i18n";

export function HealthPill({ value, label, lang }: { value: Health | null; label: string; lang: Lang }) {
  const dot = value ? healthDot[value] : "bg-slate-300";
  const name = value ? healthColorName(value, lang) : "—";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
      <span className="font-medium">{label}</span>
      <span className="text-foreground-muted">{name}</span>
    </span>
  );
}
```

- [ ] **Step 2: Create `registers-band.tsx`.**

```typescript
import { Section } from "../report-table";
import { type Lang, t } from "../i18n";
import type { RaidItem, Task } from "../types";

export function RegistersBand({
  lang, topRaid, overdue, dueSoon, onOpenRaid, onOpenTask,
}: {
  lang: Lang;
  topRaid: RaidItem[];
  overdue: Task[];
  dueSoon: Task[];
  onOpenRaid?: (id: number) => void;
  onOpenTask?: (id: number) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title={t(lang, "dashboardTopRaid")}>
        {topRaid.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t(lang, "dashboardEmpty")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {topRaid.map((r) => (
              <li key={r.id}>
                <button type="button" className="text-left hover:underline" onClick={() => onOpenRaid?.(r.id)}>
                  <span className="font-medium">{r.category}</span> · {r.title}
                  {r.severity ? <span className="text-foreground-muted"> ({r.severity})</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t(lang, "dashboardUpcoming")}>
        <p className="mb-1 text-xs font-semibold uppercase text-foreground-muted">{t(lang, "dashboardOverdue")}</p>
        <ul className="mb-3 space-y-1 text-sm">
          {overdue.map((tk) => (
            <li key={tk.id}>
              <button type="button" className="text-left hover:underline" onClick={() => onOpenTask?.(tk.id)}>
                {tk.dueDate} · {tk.taskName}
              </button>
            </li>
          ))}
          {overdue.length === 0 ? <li className="text-foreground-muted">—</li> : null}
        </ul>
        <p className="mb-1 text-xs font-semibold uppercase text-foreground-muted">{t(lang, "dashboardDueSoon")}</p>
        <ul className="space-y-1 text-sm">
          {dueSoon.map((tk) => (
            <li key={tk.id}>
              <button type="button" className="text-left hover:underline" onClick={() => onOpenTask?.(tk.id)}>
                {tk.dueDate} · {tk.taskName}
              </button>
            </li>
          ))}
          {dueSoon.length === 0 ? <li className="text-foreground-muted">—</li> : null}
        </ul>
      </Section>
    </div>
  );
}
```

Note: confirm the Tailwind tokens `text-foreground-muted` exist in this repo (grep an existing panel); if the repo uses a different muted token (e.g. `text-foreground/60`), match it.

- [ ] **Step 3: Type-check.**

Run: `npx tsc --noEmit; echo "tsc exit: $?"`
Expected: `tsc exit: 0`.

- [ ] **Step 4: Commit.**

```bash
git add src/app/dashboard-sections/
git commit -F - <<'EOF'
feat: dashboard section components (health pill + registers band)
EOF
```

---

## Task 16: `DashboardPanel`

**Files:**
- Create: `src/app/dashboard-panel.tsx`
- Test: `src/app/dashboard-panel.test.tsx` (smoke)

Reads `status`/`setStatus` from `useWorkspace()`; receives the rest as props (mirroring `ReportsPanel`); loads activity via `loadActivityLog()`. Renders Layout C inside `ReportCard`.

- [ ] **Step 1: Write the smoke test.** Create `src/app/dashboard-panel.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { DashboardPanel } from "./dashboard-panel";
import { WorkspaceProvider } from "./workspace-context";
import { FiltersProvider } from "./filters-context";

vi.mock("./activity-log", async (orig) => ({ ...(await orig<typeof import("./activity-log")>()), loadActivityLog: () => [] }));

function renderPanel() {
  return render(
    <FiltersProvider>
      <WorkspaceProvider>
        <DashboardPanel
          lang="en-US" tasks={[]} raid={[]} budgets={[]}
          plan={{ startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" }}
          roles={[]} resources={[]} absences={[]} holidaySet={new Set()} workdayHours={8} today="2026-06-02"
        />
      </WorkspaceProvider>
    </FiltersProvider>,
  );
}

describe("DashboardPanel", () => {
  it("renders an empty workspace without crashing", () => {
    const { container } = renderPanel();
    expect(container).toBeTruthy();
  });
});
```

(Confirm `FiltersProvider`'s import path/name — `WorkspaceProvider` depends on `useFilters`. If the provider differs, wrap with whatever `WorkspaceProvider` requires.)

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm run test:run -- dashboard-panel`
Expected: FAIL (`dashboard-panel.tsx` does not exist).

- [ ] **Step 3: Implement.** Create `src/app/dashboard-panel.tsx`:

```typescript
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReportCard, Section, Tile } from "./report-table";
import { computeDashboard } from "./dashboard";
import { HealthPill } from "./dashboard-sections/health-pill";
import { RegistersBand } from "./dashboard-sections/registers-band";
import { useWorkspace } from "./workspace-context";
import { loadActivityLog, type ActivityEntry } from "./activity-log";
import { activityMessage } from "./activity-log"; // if a formatter exists; otherwise render kind+timestamp
import { type Lang, t } from "./i18n";
import { healthColorName } from "./health";
import type { Absence, BudgetBucket, RaidItem, ResourcePlan, Resource, Role, Task } from "./types";

interface DashboardPanelProps {
  lang: Lang;
  tasks: Task[];
  raid: RaidItem[];
  budgets: BudgetBucket[];
  plan: ResourcePlan;
  roles: Role[];
  resources: Resource[];
  absences: Absence[];
  holidaySet: ReadonlySet<string>;
  workdayHours: number;
  today: string;
}

export function DashboardPanel(props: DashboardPanelProps) {
  const { lang, today } = props;
  const { status, setStatus } = useWorkspace();
  const sizeRef = useRef<HTMLDivElement | null>(null);

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  useEffect(() => { setActivity(loadActivityLog()); }, []);

  const model = useMemo(
    () => computeDashboard({
      tasks: props.tasks, raid: props.raid, budgets: props.budgets, plan: props.plan,
      roles: props.roles, resources: props.resources, absences: props.absences,
      workdayHours: props.workdayHours, holidaySet: props.holidaySet,
      status, activity, today,
    }),
    [props.tasks, props.raid, props.budgets, props.plan, props.roles, props.resources, props.absences, props.workdayHours, props.holidaySet, status, activity, today],
  );

  const onNarrative = (text: string) =>
    setStatus((s) => ({ ...s, narrative: text, narrativeUpdatedAt: new Date().toISOString() }));

  return (
    <ReportCard lang={lang} sizeRef={sizeRef} onResetSize={() => undefined} title={t(lang, "navDashboard")}>
      <div className="space-y-4">
        {/* Header band */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-4">
          <div className="text-2xl font-bold">{healthColorName(model.overall.effective, lang)}</div>
          <HealthPill value={model.schedule.effective} label={t(lang, "dashboardSubSchedule")} lang={lang} />
          <HealthPill value={model.budget.effective} label={t(lang, "dashboardSubBudget")} lang={lang} />
          <HealthPill value={model.scope.effective} label={t(lang, "dashboardSubScope")} lang={lang} />
          <span className="ml-auto text-sm text-foreground-muted">{t(lang, "dashboardReportDate", today)}</span>
        </div>

        {/* Narrative band */}
        <Section title={t(lang, "dashboardStatusSummary")}>
          <textarea
            className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm"
            placeholder={t(lang, "dashboardNarrativePlaceholder")}
            value={model.narrative.text}
            onChange={(e) => onNarrative(e.target.value)}
          />
          {model.narrative.updatedAt ? (
            <p className="mt-1 text-xs text-foreground-muted">{t(lang, "dashboardNarrativeUpdated", model.narrative.updatedAt.slice(0, 10))}</p>
          ) : null}
        </Section>

        {/* Progress / Budget band */}
        <div className="grid gap-4 md:grid-cols-2">
          <Section title={t(lang, "dashboardProgress")}>
            <div className="flex flex-wrap gap-2">
              <Tile label={t(lang, "dashboardPercentComplete", String(model.progress.percent))} value={t(lang, "dashboardCompletedOf", String(model.progress.completed), String(model.progress.total))} />
              <Tile label="R / A / G" value={`${model.progress.counts.R} / ${model.progress.counts.A} / ${model.progress.counts.G}`} />
            </div>
          </Section>
          <Section title={t(lang, "dashboardBudgetBurn")}>
            {model.burn ? (
              <div className="flex flex-wrap gap-2">
                <Tile label={t(lang, "dashboardSubBudget")} value={`${Math.round(model.burn.consumedValue)} / ${Math.round(model.burn.budgetValue)}`} />
                <Tile label="h" value={`${Math.round(model.burn.actualHours)} / ${Math.round(model.burn.budgetHours)}`} />
              </div>
            ) : (
              <p className="text-sm text-foreground-muted">{t(lang, "dashboardNoBudget")}</p>
            )}
          </Section>
        </div>

        {/* Registers band */}
        <RegistersBand lang={lang} topRaid={model.topRaid} overdue={model.overdue} dueSoon={model.dueSoon} />

        {/* Activity band */}
        <Section title={t(lang, "dashboardRecentActivity")}>
          {model.recentActivity.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t(lang, "dashboardEmpty")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {model.recentActivity.map((e) => (
                <li key={e.id} className="text-foreground-muted">
                  {e.timestamp.slice(0, 10)} · {e.kind}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </ReportCard>
  );
}
```

Notes for the implementer:
- Remove the `activityMessage` import if no such formatter exists — the list renders `kind` + date, which is sufficient for v1. (If the Activity view has a shared message formatter, prefer reusing it.)
- Confirm `ReportCard`'s required props against `report-table.tsx` (it needs `lang`, `sizeRef`, `onResetSize`, optional `title`); pass a real resize handler if the panel adopts `useResizable`, otherwise the no-op `onResetSize` is acceptable for v1.
- Match muted-text and border tokens (`text-foreground-muted`, `border-line`, `bg-surface`) to whatever the sibling panels actually use — grep `budget-report-panel.tsx`.
- RAG override controls (clicking a pill to override) are deferred to a follow-up; v1 ships the narrative editor as the writable control and shows computed RAG. (The data model already supports overrides; wiring the buttons is additive.)

- [ ] **Step 4: Run — expect PASS.**

Run: `npm run test:run -- dashboard-panel`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -F - <<'EOF'
feat: DashboardPanel renders Layout C (hybrid bands) with editable narrative
EOF
```

---

## Task 17: Mount the panel in `workspace-section.tsx`

**Files:**
- Modify: `src/app/workspace-section.tsx` (tab type/union; panel mount region; import)

- [ ] **Step 1: Import the panel.** Add near the other panel imports:
```typescript
import { DashboardPanel } from "./dashboard-panel";
```

- [ ] **Step 2: Ensure the tab union accepts `"dashboard"`.** If `activeTab` is typed as `AppView`, no change is needed. If `workspace-section.tsx` uses a narrower local tab union (search for `"reports"` in a `type ... =` near the top), add `"dashboard"` to it the same way `"reports"` appears.

- [ ] **Step 3: Add the mount block.** Mirror the `reports` mount (~350-375). Add, alongside the other `{activeTab === ... && ...}` blocks:
```typescript
        {activeTab === "dashboard" && (
          <div id="panel-dashboard" role="tabpanel" className={panelScrollClass}>
            <DashboardPanel
              lang={lang}
              tasks={tasks}
              raid={raid}
              budgets={budgets}
              plan={plan}
              roles={roles}
              resources={resources}
              absences={absences}
              holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours}
              today={today}
            />
          </div>
        )}
```
(All of `tasks`, `raid`, `budgets`, `plan`, `roles`, `resources`, `absences`, `holidaySet`, `settings`, `lang`, `today` are already in scope here — they are passed to `ReportsPanel`/`BudgetReportPanel` in the same file.)

- [ ] **Step 4: Type-check + full suite.**

Run: `npx tsc --noEmit; echo "tsc exit: $?"`
Expected: `tsc exit: 0`.

Run: `npm run test:run`
Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/app/workspace-section.tsx
git commit -F - <<'EOF'
feat: mount DashboardPanel on the "dashboard" view
EOF
```

---

## Task 18: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite.**

Run: `npm run test:run`
Expected: all pass (≈1591 + new tests).

- [ ] **Step 2: Coverage gate.**

Run: `npm run test:coverage`
Expected: thresholds (70%) still met; `dashboard.ts` well covered.

- [ ] **Step 3: Types + lint.**

Run: `npx tsc --noEmit; echo "tsc exit: $?"`
Expected: `tsc exit: 0`.

Run: `npm run lint`
Expected: clean (do NOT edit `eslint.config.mjs`; fix code instead).

- [ ] **Step 4: Manual smoke (optional but recommended).** `npm run dev`, open the app, confirm the **Dashboard** appears first in the Overview nav group, renders the bands, the narrative persists across a reload, and Print produces a clean page.

- [ ] **Step 5: Restore dev churn.** If `sample-workspace.md` (or similar dev data) changed during manual testing, restore it:
```bash
git checkout -- sample-workspace.md
```

- [ ] **Step 6: Final commit (if any verification fixes were needed).**

```bash
git add -A
git commit -F - <<'EOF'
chore: health dashboard verification fixes
EOF
```

---

## Self-review (plan author)

**Spec coverage:** Layout C → Tasks 15-17. `Workspace.status` persistence (JSON/CSV/MD/Turso) → Tasks 1-5. Context/load-save → Task 6. Computed-with-override + sub-statuses + Scope manual → Tasks 8/9/12. % complete + health → Task 7. Budget burn → Tasks 9/12/16. Top RAID → Task 10. Upcoming/overdue → Task 11. Recent activity (+ local-only caveat) → Tasks 11/16. Nav view (first in Overview, landing unchanged) → Task 14. Print via ReportCard → Task 16. i18n EN+DE straight-quotes → Task 13. Tests → every task + Task 18.

**Deviations from spec (intentional, low-risk):**
- "Due soon" uses the ≤3 **working-day** window (consistent with `health.ts`/reports) rather than the calendar lead-days alert setting — single consistent definition, no new settings dependency. Parameterized (`dueSoonWorkdays`) so it can change later.
- No `SCHEMA_VERSION` bump / new migrate function: `status` defaulting folded into `migrateWorkspaceV6` (matches how budgets/fxRates default there) — fewer call-site edits, zero risk to other callers.
- RAG **override click controls** deferred; v1 ships the narrative editor as the writable control and displays computed RAG. Data model fully supports overrides, so adding the buttons later is additive.

**Placeholder scan:** none — every code step has complete code; the two "mirror the sibling" spots (MD `splitMarkdownSections`, Task 4; tab-union membership, Task 17) name the exact sibling to copy and are guarded by a failing test / tsc.

**Type consistency:** `ProjectStatus` (literal RAG), `DashboardModel`/`SubStatus`/`DashboardInput`/`DashboardBurn`, `computeDashboard(input, opts)`, and `sanitizeProjectStatus` are used identically across tasks. `ProjectReport` fields used in `burn` (`budgetValue`/`consumedValue`/`budgetHours`/`actualHours`/`cost`/`costPerformance`/`consumption`) match the verified type (no `budgetCost` on `ProjectReport`).
