# Multi-Project / Portfolio — Phase 2: Turso Multi-Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one shared Turso (libSQL) database hold many projects (multi-tenant), with a global File/Turso portfolio-mode switch, per-project transactional save (last-write-wins), soft delete (archive) + restore, and hard delete behind a type-to-confirm dialog.

**Architecture:** A `project_id TEXT` column is added to every workspace + snapshot table, plus a new `projects` table holding `ProjectMeta` per project (the source of truth for the Turso project list). New pure modules build project-scoped DDL/SELECT/DELETE/INSERT statements that reuse Phase 1's existing column registries and encoders. A `TursoTenantBackend` implements the per-project `StorageBackend`; a `turso-portfolio` module does list/create/archive/restore/hard-delete; a `portfolio-mode` module owns the global mode flag. The existing single-tenant `TursoBackend` is left intact.

**Tech Stack:** Next.js 16.2.6, React 19.2.4, TypeScript, Vitest 4.1.8. Turso HTTP `/v2/pipeline` API via the shared `runTursoPipeline`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-10-multi-project-portfolio-phase2-turso-design.md`

---

## Conventions for the implementer

- **Tests:** Vitest. Run a single file with `npx vitest run src/app/<file>.test.ts`. Run all: `npm test`. Vitest 4 mock gotchas: constructor mocks must be `function`/`class` (not arrow); use `vi.fn<Sig>()` for typed props.
- **Lint/type:** `npx tsc --noEmit` and `npx eslint . --max-warnings=0` must stay clean. EN/DE i18n parity is tsc-enforced.
- **Commits:** `git commit -F - <<'EOF' … EOF` via the Bash tool (NOT PowerShell here-strings). No `Co-Authored-By` trailer (disabled globally). Conventional-commit subjects.
- **Branch:** Work on `feat-multi-project-phase2-turso` (create from `main`). Early in the work, fold in the deferred `feat-toast-first-migration` branch (Task 14).
- **Immutability:** never mutate inputs; return new objects. Pure modules must not call `Date.now`/`Math.random`/`crypto.randomUUID` (only the UI/hook layer may use `crypto.randomUUID`).
- **No `console.log`** in production code.
- **i18n.de.ts** editing corrupts ASCII quotes into curly quotes — prefer adding keys via a careful Edit and then grep-verify, or Write the whole block. After editing, run `npx tsc --noEmit` (parity) and visually confirm no `“`/`”` crept into delimiter positions.

---

## File structure

**New source modules:**
- `src/app/portfolio-mode.ts` — global `"file" | "turso"` flag + last-selected Turso project id (localStorage, guarded).
- `src/app/turso-tenant-schema.ts` — project-scoped DDL + SELECT/DELETE/INSERT builders + `projects`-table builders + decoders. Reuses `turso-schema.ts` primitives.
- `src/app/turso-tenant-backend.ts` — `TursoTenantBackend(config, projectId)` implementing `StorageBackend`.
- `src/app/turso-portfolio.ts` — list / create / updateMeta / archive / restore / hardDelete over the shared pipeline.
- `src/app/type-to-confirm-dialog.tsx` — reusable destructive confirm (type the exact name to enable submit).

**Modified source modules:**
- `src/app/turso-schema.ts` — export a few internal primitives for reuse (no behavior change).
- `src/app/snapshot-schema.ts` — add `project_id` to both snapshot tables; thread `projectId` through all builders.
- `src/app/snapshot-store.ts` — accept `projectId` on every call.
- `src/app/use-snapshots.ts` — accept + thread `projectId`.
- `src/app/use-storage-backend.ts` — Turso-mode switch/create/archive/restore/hard-delete flows + mode-aware list.
- `src/app/task-manager.tsx` — mode-aware project list (file registry vs Turso list), wire new handlers, empty-state, switcher.
- `src/app/projects-panel.tsx` — archived view, archive/restore/hard-delete actions, Turso-mode awareness.
- `src/app/project-switcher.tsx` / `src/app/project-empty-state.tsx` / `src/app/create-project-form.tsx` — Turso-mode variants (hide file-format selector / load-from-file).
- A Settings storage/integrations section component — portfolio-mode toggle.
- `src/app/i18n.ts` / `src/app/i18n.de.ts` — new keys (EN/DE).
- `src/app/version.ts` / `package.json` — v0.59.0.
- `scripts/generate-sample-workspace.ts` — multi-tenant sample DB.

---

## Task 1: `portfolio-mode.ts` — global mode + current-project cache

**Files:**
- Create: `src/app/portfolio-mode.ts`
- Test: `src/app/portfolio-mode.test.ts`

Mirrors `projects-registry.ts` IO style: `typeof window` guard + try/catch around every localStorage access; tolerant of corruption; default `"file"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/portfolio-mode.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadPortfolioMode, savePortfolioMode,
  loadCurrentTursoProjectId, saveCurrentTursoProjectId,
} from "./portfolio-mode";

describe("portfolio-mode", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to 'file' when nothing is stored", () => {
    expect(loadPortfolioMode()).toBe("file");
  });

  it("round-trips a saved mode", () => {
    savePortfolioMode("turso");
    expect(loadPortfolioMode()).toBe("turso");
  });

  it("coerces an unknown stored value to 'file'", () => {
    window.localStorage.setItem("lop-app:portfolio-mode", "nonsense");
    expect(loadPortfolioMode()).toBe("file");
  });

  it("current turso project id defaults to null and round-trips", () => {
    expect(loadCurrentTursoProjectId()).toBeNull();
    saveCurrentTursoProjectId("p1");
    expect(loadCurrentTursoProjectId()).toBe("p1");
    saveCurrentTursoProjectId(null);
    expect(loadCurrentTursoProjectId()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/portfolio-mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/portfolio-mode.ts
//
// Global portfolio storage mode + the last-selected Turso project id.
// File mode uses the Phase 1 localStorage ProjectsRegistry; Turso mode treats
// the shared DB's `projects` table as the source of truth and only caches which
// project was last selected. IO is guarded like projects-registry.ts /
// contacts.ts (typeof-window guard + try/catch).

export type PortfolioMode = "file" | "turso";

const MODE_KEY = "lop-app:portfolio-mode";
const CURRENT_TURSO_PROJECT_KEY = "lop-app:turso-current-project";

export function loadPortfolioMode(): PortfolioMode {
  if (typeof window === "undefined") return "file";
  try {
    return window.localStorage.getItem(MODE_KEY) === "turso" ? "turso" : "file";
  } catch {
    return "file";
  }
}

export function savePortfolioMode(mode: PortfolioMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Quota / disabled storage — silently drop.
  }
}

export function loadCurrentTursoProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(CURRENT_TURSO_PROJECT_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveCurrentTursoProjectId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(CURRENT_TURSO_PROJECT_KEY, id);
    else window.localStorage.removeItem(CURRENT_TURSO_PROJECT_KEY);
  } catch {
    // Quota / disabled storage — silently drop.
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/app/portfolio-mode.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/portfolio-mode.ts src/app/portfolio-mode.test.ts
git commit -F - <<'EOF'
feat: portfolio-mode module (global file/turso flag + current-project cache)
EOF
```

---

## Task 2: Export reuse primitives from `turso-schema.ts`

**Files:**
- Modify: `src/app/turso-schema.ts`

The tenant schema (Task 3) reuses the single-tenant building blocks instead of duplicating per-field mappings. This task only adds `export` keywords + nothing else — no behavior change.

- [ ] **Step 1: Add exports**

In `src/app/turso-schema.ts`, change these existing declarations to be exported (keep their bodies unchanged):

```ts
// was: interface EntitySpec<T> { … }
export interface EntitySpec<T> {
  table: string;
  wsKey: keyof Workspace;
  columns: readonly string[];
  get: (ws: Workspace) => T[];
  toRow: (e: T, col: string) => string;
  fromObj: (obj: Record<string, string>) => T | null;
}
```

```ts
// was: const ENTITY_SPECS: EntitySpec<unknown>[] = [ … ]
export const ENTITY_SPECS: EntitySpec<unknown>[] = [ /* unchanged */ ] as unknown as EntitySpec<unknown>[];
```

```ts
// was: const PLAN_COLUMNS = [...] / const FX_COLUMNS = [...]
export const PLAN_COLUMNS = ["startDate", "endDate", "granularity", "currency"] as const;
export const FX_COLUMNS = ["base", "date", "fetchedAt", "rates"] as const;
```

```ts
// was: function colDdl(...) / function rowObjects(...)
export function colDdl(columns: readonly string[]): string { /* unchanged */ }
export function rowObjects(res: PipelineResultLike | undefined): Record<string, string>[] { /* unchanged */ }
```

- [ ] **Step 2: Verify nothing broke**

Run: `npx vitest run src/app/turso-schema.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/turso-schema.ts
git commit -F - <<'EOF'
refactor: export turso-schema primitives for tenant-scoped reuse (no behavior change)
EOF
```

---

## Task 3: `turso-tenant-schema.ts` — project-scoped statements

**Files:**
- Create: `src/app/turso-tenant-schema.ts`
- Test: `src/app/turso-tenant-schema.test.ts`

This is the core. It builds DDL where every workspace table gains a `project_id TEXT` column, a `projects` table holding `ProjectMeta` (+ `id`, `archived`), and scoped SELECT/DELETE/INSERT statements. Decoding reuses the existing `rowsToWorkspace` (its `fromObj` builders ignore the extra `project_id` column) and Phase 1's `buildProjectFromObj` for the `projects` row.

Key design points the implementer MUST honor:
- `meta`, `plan`, `fx_rates` lose their single-tenant fixed PK (`key`/`id=1`) and become **scoped, unkeyed** tables discriminated by `project_id` — multiple projects each keep their own row(s). Scoped SELECT returns only the current project's rows, so `rowsToWorkspace`'s "first row" / "find key==='project_status'" logic still works.
- `tenantSelectStatements(projectId)` must return results in the SAME order as `TABLE_NAMES` so the existing `rowsToWorkspace(results)` decodes correctly.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/turso-tenant-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  tenantSchemaDdl, tenantSelectStatements, tenantWorkspaceToStatements,
  listProjectsStatement, listArchivedProjectsStatement, upsertProjectStatement,
  archiveProjectStatement, restoreProjectStatement, hardDeleteProjectStatements,
  rowsToProjectList, PROJECTS_TABLE,
} from "./turso-tenant-schema";
import { TABLE_NAMES, rowsToWorkspace } from "./turso-schema";
import { emptyWorkspace, PROJECT_CSV_COLUMNS } from "./storage";
import type { ProjectMeta } from "./types";

function meta(): ProjectMeta {
  return {
    name: "Apollo", code: "APL-1", projectManager: "PM",
    keyStakeholdersInternal: [], keyStakeholdersExternal: [],
    customer: "Acme", naceSection: "C", identityTypes: [], products: "P",
    deployment: "Cloud", startDate: "2026-01-01", endDate: "2026-12-31",
    profitCenter: "PC-1", contactPersons: [], regulatory: [],
  };
}

describe("turso-tenant-schema", () => {
  it("DDL adds project_id to every workspace table and creates a projects table", () => {
    const ddl = tenantSchemaDdl().join("\n");
    for (const t of TABLE_NAMES) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${t} `);
    }
    // every non-projects table carries project_id
    expect(ddl).toMatch(/project_id TEXT/);
    expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${PROJECTS_TABLE} `);
    // projects table includes id + archived + the meta columns
    expect(ddl).toContain("id TEXT PRIMARY KEY");
    expect(ddl).toContain('"archived" TEXT');
    for (const c of PROJECT_CSV_COLUMNS) expect(ddl).toContain(`"${c}" TEXT`);
  });

  it("select statements are project-scoped and ordered like TABLE_NAMES", () => {
    const stmts = tenantSelectStatements("p1");
    expect(stmts).toHaveLength(TABLE_NAMES.length);
    stmts.forEach((s, i) => {
      expect(s.sql).toContain(`FROM ${TABLE_NAMES[i]}`);
      expect(s.sql).toContain("WHERE project_id = ?");
      expect(s.args?.[0]).toEqual({ type: "text", value: "p1" });
    });
  });

  it("workspaceToStatements deletes+inserts only the given project_id", () => {
    const ws = { ...emptyWorkspace(),
      tasks: [{ id: 1, taskName: "T1", assignee: "", assigneeEmail: "",
        startDate: "2026-01-01", dueDate: "2026-06-01", lastUpdateDate: "2026-01-01",
        priority: "Medium" as const, blockers: "", notes: "",
        completedDate: undefined, inquiriesSent: 0, group: undefined, labels: [],
        dependencies: [], jiraKey: undefined, jiraIssueType: undefined,
        lastSyncedAt: undefined, localModifiedAt: undefined, healthOverride: undefined,
        resourceId: undefined, originalEstimateMinutes: undefined, timeSpentMinutes: undefined }] };
    const stmts = tenantWorkspaceToStatements(ws, "p1");
    const sql = stmts.map((s) => s.sql);
    expect(sql[0]).toBe("BEGIN");
    expect(sql[sql.length - 1]).toBe("COMMIT");
    // every DELETE is scoped
    for (const s of stmts.filter((x) => x.sql.startsWith("DELETE"))) {
      expect(s.sql).toContain("WHERE project_id = ?");
      expect(s.args?.[s.args.length - 1]).toEqual({ type: "text", value: "p1" });
    }
    // a task INSERT exists and ends with the project_id arg
    const taskInsert = stmts.find((s) => s.sql.startsWith("INSERT INTO tasks"));
    expect(taskInsert).toBeDefined();
    expect(taskInsert!.sql).toContain("project_id");
    expect(taskInsert!.args?.[taskInsert!.args.length - 1]).toEqual({ type: "text", value: "p1" });
  });

  it("round-trips a workspace through statements -> simulated rows -> rowsToWorkspace", () => {
    const ws = { ...emptyWorkspace(), plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const } };
    // Build the per-table SELECT result shape from the INSERTs we generated.
    // (Helper below simulates the pipeline by replaying inserts into row arrays.)
    const results = simulateSelect(tenantWorkspaceToStatements(ws, "p1"), "p1");
    const decoded = rowsToWorkspace(results);
    expect(decoded.plan.startDate).toBe("2026-01-01");
    expect(decoded.plan.currency).toBe("EUR");
  });

  it("listProjectsStatement filters archived='0'; archived variant filters '1'", () => {
    expect(listProjectsStatement().sql).toContain("WHERE \"archived\" = '0'");
    expect(listArchivedProjectsStatement().sql).toContain("WHERE \"archived\" = '1'");
    expect(listProjectsStatement().sql).toContain(`FROM ${PROJECTS_TABLE}`);
  });

  it("upsert/archive/restore statements target the projects table by id", () => {
    const up = upsertProjectStatement(meta(), "p1", false);
    expect(up.sql).toContain(`INTO ${PROJECTS_TABLE}`);
    expect(up.sql).toContain("id");
    expect(up.args?.[0]).toEqual({ type: "text", value: "p1" });
    expect(archiveProjectStatement("p1").sql).toContain("\"archived\" = '1'");
    expect(restoreProjectStatement("p1").sql).toContain("\"archived\" = '0'");
    expect(archiveProjectStatement("p1").args?.[0]).toEqual({ type: "text", value: "p1" });
  });

  it("hardDelete removes the project's rows from every table incl. projects", () => {
    const stmts = hardDeleteProjectStatements("p1");
    const sql = stmts.map((s) => s.sql);
    expect(sql[0]).toBe("BEGIN");
    expect(sql[sql.length - 1]).toBe("COMMIT");
    for (const t of TABLE_NAMES) {
      expect(sql.some((s) => s.includes(`DELETE FROM ${t} WHERE project_id = ?`))).toBe(true);
    }
    expect(sql.some((s) => s.includes(`DELETE FROM ${PROJECTS_TABLE} WHERE id = ?`))).toBe(true);
  });

  it("rowsToProjectList decodes id + archived + meta from a projects SELECT", () => {
    const m = meta();
    const up = upsertProjectStatement(m, "p1", false);
    // Build a fake SELECT result whose cols/rows mirror the upsert columns/args.
    const cols = parseInsertCols(up.sql).map((name) => ({ name }));
    const rows = [up.args!.map((a) => ({ value: a.value ?? "" }))];
    const list = rowsToProjectList({ type: "ok", response: { type: "execute", result: { cols, rows } } });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("p1");
    expect(list[0].archived).toBe(false);
    expect(list[0].meta.name).toBe(m.name);
    expect(list[0].meta.customer).toBe(m.customer);
  });
});

// --- test helpers ---------------------------------------------------------
import type { PipelineResultLike, SqlStmt } from "./turso-schema";

function parseInsertCols(sql: string): string[] {
  const m = sql.match(/\(([^)]+)\)\s+VALUES/i);
  if (!m) return [];
  return m[1].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
}

/** Replay the INSERTs in `stmts` into per-table SELECT results, in TABLE_NAMES order. */
function simulateSelect(stmts: SqlStmt[], _projectId: string): PipelineResultLike[] {
  const byTable = new Map<string, { cols: { name: string }[]; rows: { value: unknown }[][] }>();
  for (const s of stmts) {
    const m = s.sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i);
    if (!m || !s.args) continue;
    const table = m[1];
    const cols = m[2].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const entry = byTable.get(table) ?? { cols: cols.map((name) => ({ name })), rows: [] };
    entry.rows.push(s.args.map((a) => ({ value: a.value ?? "" })));
    byTable.set(table, entry);
  }
  return TABLE_NAMES.map((t) => ({
    type: "ok" as const,
    response: { type: "execute", result: byTable.get(t) ?? { cols: [], rows: [] } },
  }));
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/turso-tenant-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/turso-tenant-schema.ts
//
// Project-scoped (multi-tenant) relational mapping. Every workspace table gains
// a `project_id TEXT` column; a `projects` table holds one ProjectMeta row per
// project (the source of truth for the Turso project list). Built generically
// from the SAME column registries + encoders the single-tenant turso-schema uses
// (reuses ENTITY_SPECS/PLAN_COLUMNS/FX_COLUMNS/colDdl), plus Phase 1's
// PROJECT_CSV_COLUMNS / projectFieldToString / buildProjectFromObj for the
// projects table. Decoding reuses rowsToWorkspace (its fromObj builders ignore
// the extra project_id column) and buildProjectFromObj.
//
// meta / plan / fx_rates drop the single-tenant fixed PK and are scoped by
// project_id (multiple projects each keep their own row(s)). Because every
// SELECT is `WHERE project_id = ?`, the existing rowsToWorkspace first-row /
// find-status logic still works.

import {
  ENTITY_SPECS, PLAN_COLUMNS, FX_COLUMNS, colDdl, rowObjects, TABLE_NAMES,
  type SqlStmt, type PipelineResultLike,
} from "./turso-schema";
import {
  PROJECT_CSV_COLUMNS, projectFieldToString, buildProjectFromObj, type Workspace,
} from "./storage";
import type { ProjectMeta } from "./types";

export const PROJECTS_TABLE = "projects";
const SCHEMA_VERSION = "10";

const text = (value: string): { type: "text"; value: string } => ({ type: "text", value });

export interface ProjectListEntry {
  id: string;
  meta: ProjectMeta;
  archived: boolean;
}

// --- DDL ------------------------------------------------------------------

/** Full multi-tenant DDL: every workspace table + project_id, plus the projects
 *  table. plan/fx_rates/meta are unkeyed + scoped by project_id. */
export function tenantSchemaDdl(): string[] {
  const out: string[] = [];
  for (const s of ENTITY_SPECS) {
    out.push(`CREATE TABLE IF NOT EXISTS ${s.table} (${colDdl(s.columns)}, project_id TEXT)`);
  }
  out.push(`CREATE TABLE IF NOT EXISTS plan (${PLAN_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")}, project_id TEXT)`);
  out.push(`CREATE TABLE IF NOT EXISTS fx_rates (${FX_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")}, project_id TEXT)`);
  out.push(`CREATE TABLE IF NOT EXISTS meta (key TEXT, value TEXT, project_id TEXT)`);
  out.push(
    `CREATE TABLE IF NOT EXISTS ${PROJECTS_TABLE} (id TEXT PRIMARY KEY, "archived" TEXT, ` +
      PROJECT_CSV_COLUMNS.map((c) => `"${c}" TEXT`).join(", ") +
      `)`,
  );
  return out;
}

// --- SELECT (load) --------------------------------------------------------

/** One scoped SELECT per TABLE_NAMES entry, in TABLE_NAMES order, so the
 *  existing rowsToWorkspace(results) decodes the output unchanged. */
export function tenantSelectStatements(projectId: string): SqlStmt[] {
  return TABLE_NAMES.map((t) => ({
    sql: `SELECT * FROM ${t} WHERE project_id = ?`,
    args: [text(projectId)],
  }));
}

// --- INSERT helpers -------------------------------------------------------

function tenantInsert(table: string, columns: readonly string[], values: string[], projectId: string): SqlStmt {
  const cols = [...columns, "project_id"];
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  const args = [
    ...columns.map((c, i) => (c === "id" ? { type: "integer" as const, value: values[i] } : text(values[i]))),
    text(projectId),
  ];
  return { sql: `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`, args };
}

// --- DELETE+INSERT (save) -------------------------------------------------

/** Overwrite ONLY this project's rows, transactionally. Other projects' rows
 *  are never touched (last-write-wins, per project). */
export function tenantWorkspaceToStatements(ws: Workspace, projectId: string): SqlStmt[] {
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  for (const ddl of tenantSchemaDdl()) out.push({ sql: ddl });
  // Scoped deletes for the workspace tables (NOT the projects table — that row
  // is managed by upsert/archive/hardDelete, not by a workspace save).
  for (const name of TABLE_NAMES) {
    out.push({ sql: `DELETE FROM ${name} WHERE project_id = ?`, args: [text(projectId)] });
  }
  for (const s of ENTITY_SPECS) {
    for (const e of s.get(ws)) {
      out.push(tenantInsert(s.table, s.columns, s.columns.map((c) => s.toRow(e, c)), projectId));
    }
  }
  const p = ws.plan;
  out.push(tenantInsert("plan", PLAN_COLUMNS, [p.startDate, p.endDate, p.granularity, p.currency], projectId));
  if (ws.fxRates) {
    const fx = ws.fxRates;
    const rates = Object.entries(fx.rates).map(([k, v]) => `${k}=${v}`).join("|");
    out.push(tenantInsert("fx_rates", FX_COLUMNS, [fx.base, fx.date, fx.fetchedAt, rates], projectId));
  }
  out.push(tenantInsert("meta", ["key", "value"], ["schema_version", SCHEMA_VERSION], projectId));
  out.push(tenantInsert("meta", ["key", "value"], ["project_status", JSON.stringify(ws.status ?? {})], projectId));
  out.push({ sql: "COMMIT" });
  return out;
}

// --- projects table CRUD --------------------------------------------------

export function listProjectsStatement(): SqlStmt {
  return { sql: `SELECT * FROM ${PROJECTS_TABLE} WHERE "archived" = '0'` };
}

export function listArchivedProjectsStatement(): SqlStmt {
  return { sql: `SELECT * FROM ${PROJECTS_TABLE} WHERE "archived" = '1'` };
}

export function upsertProjectStatement(meta: ProjectMeta, id: string, archived: boolean): SqlStmt {
  const cols = ["id", "archived", ...PROJECT_CSV_COLUMNS];
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  const args = [
    text(id),
    text(archived ? "1" : "0"),
    ...PROJECT_CSV_COLUMNS.map((c) => text(projectFieldToString(meta, c))),
  ];
  return { sql: `INSERT OR REPLACE INTO ${PROJECTS_TABLE} (${colList}) VALUES (${placeholders})`, args };
}

export function archiveProjectStatement(id: string): SqlStmt {
  return { sql: `UPDATE ${PROJECTS_TABLE} SET "archived" = '1' WHERE id = ?`, args: [text(id)] };
}

export function restoreProjectStatement(id: string): SqlStmt {
  return { sql: `UPDATE ${PROJECTS_TABLE} SET "archived" = '0' WHERE id = ?`, args: [text(id)] };
}

export function hardDeleteProjectStatements(id: string): SqlStmt[] {
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  for (const name of TABLE_NAMES) {
    out.push({ sql: `DELETE FROM ${name} WHERE project_id = ?`, args: [text(id)] });
  }
  out.push({ sql: `DELETE FROM ${PROJECTS_TABLE} WHERE id = ?`, args: [text(id)] });
  out.push({ sql: "COMMIT" });
  return out;
}

// --- decode projects ------------------------------------------------------

export function rowsToProjectList(res: PipelineResultLike | undefined): ProjectListEntry[] {
  return rowObjects(res)
    .map((o): ProjectListEntry | null => {
      const id = o.id ?? "";
      if (!id) return null;
      const meta = buildProjectFromObj(o);
      if (!meta) return null;
      return { id, meta, archived: o.archived === "1" };
    })
    .filter((x): x is ProjectListEntry => x !== null);
}
```

> NOTE for the implementer: verify `PROJECT_CSV_COLUMNS`, `projectFieldToString`, and `buildProjectFromObj` are exported from `storage.ts` (Phase 1 added them). If `buildProjectFromObj` requires the `name` field to be non-empty to return a value, the projects-row decode relies on that — which is correct (a project always has a name). If it instead returns a partial, adapt `rowsToProjectList` accordingly.

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/app/turso-tenant-schema.test.ts && npx tsc --noEmit`
Expected: PASS (all tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/turso-tenant-schema.ts src/app/turso-tenant-schema.test.ts
git commit -F - <<'EOF'
feat: turso-tenant-schema — project-scoped DDL/select/save + projects table
EOF
```

---

## Task 4: Snapshot scoping by `project_id`

**Files:**
- Modify: `src/app/snapshot-schema.ts`
- Test: `src/app/snapshot-schema.test.ts` (extend)

Add `project_id` to both snapshot tables and thread a `projectId` param through every builder. CRITICAL: `setBaselineStatements` must scope BOTH updates by `project_id`, or setting one project's baseline clears every project's baseline. Snapshot tables stay OUT of `TABLE_NAMES`.

- [ ] **Step 1: Write the failing tests (append to `snapshot-schema.test.ts`)**

```ts
import {
  SNAPSHOT_DDL, snapshotSelectStatements, appendStatements,
  setBaselineStatements, deleteStatements,
} from "./snapshot-schema";
import type { SnapshotRecord } from "./snapshot";

function rec(): SnapshotRecord {
  return {
    id: "s1", capturedAt: "2026-01-01T00:00:00.000Z", bucket: "2026-W01",
    cadence: "weekly", trigger: "manual", isBaseline: false,
    remainingHours: 1, remainingCost: 2, pctComplete: 3,
    forecastEndDate: "2026-06-01", planEndDate: "2026-06-01", spi: 1, cpi: 1,
    overallRag: "G", scheduleRag: "G", budgetRag: "G", scopeRag: "G",
    currency: "EUR", milestones: [], series: [{ period: "P1", plannedHours: 1, actualHours: 1, plannedCost: 1, actualCost: 1 }],
  };
}

describe("snapshot-schema project scoping", () => {
  it("DDL declares project_id on both snapshot tables", () => {
    const ddl = SNAPSHOT_DDL.join("\n");
    expect((ddl.match(/project_id TEXT/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("select statements scope by project_id", () => {
    const stmts = snapshotSelectStatements("p1");
    for (const s of stmts) {
      expect(s.sql).toContain("WHERE project_id = ?");
      expect(s.args?.[0]).toEqual({ type: "text", value: "p1" });
    }
  });

  it("append carries project_id on the snapshot row and every series row", () => {
    const stmts = appendStatements(rec(), "p1");
    for (const s of stmts.filter((x) => x.sql.startsWith("INSERT"))) {
      expect(s.sql).toContain("project_id");
      expect(s.args?.[s.args.length - 1]).toEqual({ type: "text", value: "p1" });
    }
  });

  it("setBaseline scopes BOTH updates by project_id (no cross-project clobber)", () => {
    const stmts = setBaselineStatements("s1", "p1");
    expect(stmts).toHaveLength(2);
    for (const s of stmts) expect(s.sql).toContain("WHERE project_id = ?");
    // the clear-all must include project_id (the dangerous one)
    expect(stmts[0].sql).toMatch(/SET is_baseline='0' WHERE project_id = \?/);
  });

  it("delete scopes by project_id", () => {
    const stmts = deleteStatements("s1", "p1");
    for (const s of stmts) expect(s.sql).toContain("project_id = ?");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/snapshot-schema.test.ts`
Expected: FAIL — signatures don't take `projectId`; DDL lacks `project_id`.

- [ ] **Step 3: Implement the changes in `snapshot-schema.ts`**

Update the DDL (add `project_id TEXT` to both tables):

```ts
export const SNAPSHOT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS snapshot (
    id TEXT PRIMARY KEY, captured_at TEXT, bucket TEXT, cadence TEXT, trigger TEXT,
    is_baseline TEXT, remaining_hours TEXT, remaining_cost TEXT, pct_complete TEXT,
    forecast_end_date TEXT, plan_end_date TEXT, spi TEXT, cpi TEXT,
    overall_rag TEXT, schedule_rag TEXT, budget_rag TEXT, scope_rag TEXT,
    currency TEXT, milestones_json TEXT, project_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS snapshot_series (
    snapshot_id TEXT, seq TEXT, period TEXT,
    planned_hours TEXT, actual_hours TEXT, planned_cost TEXT, actual_cost TEXT, project_id TEXT
  )`,
];
```

Update `SNAPSHOT_COLS` and `SERIES_COLS` to append `project_id`:

```ts
const SNAPSHOT_COLS = [
  "id", "captured_at", "bucket", "cadence", "trigger", "is_baseline",
  "remaining_hours", "remaining_cost", "pct_complete", "forecast_end_date",
  "plan_end_date", "spi", "cpi", "overall_rag", "schedule_rag", "budget_rag",
  "scope_rag", "currency", "milestones_json", "project_id",
] as const;

const SERIES_COLS = [
  "snapshot_id", "seq", "period", "planned_hours", "actual_hours", "planned_cost", "actual_cost", "project_id",
] as const;
```

Update the builders to accept + emit `projectId`:

```ts
export function snapshotSelectStatements(projectId: string): SqlStmt[] {
  return [
    { sql: "SELECT * FROM snapshot WHERE project_id = ? ORDER BY captured_at", args: [text(projectId)] },
    { sql: "SELECT * FROM snapshot_series WHERE project_id = ?", args: [text(projectId)] },
  ];
}

export function appendStatements(rec: SnapshotRecord, projectId: string): SqlStmt[] {
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  out.push(insert("snapshot", SNAPSHOT_COLS, [
    text(rec.id), text(rec.capturedAt), text(rec.bucket), text(rec.cadence), text(rec.trigger),
    text(rec.isBaseline ? "1" : "0"),
    numText(rec.remainingHours), numText(rec.remainingCost), numText(rec.pctComplete),
    text(rec.forecastEndDate), text(rec.planEndDate), numText(rec.spi), numText(rec.cpi),
    text(rec.overallRag), text(rec.scheduleRag), text(rec.budgetRag), text(rec.scopeRag),
    text(rec.currency), text(JSON.stringify(rec.milestones)), text(projectId),
  ]));
  rec.series.forEach((p, i) => {
    out.push(insert("snapshot_series", SERIES_COLS, [
      text(rec.id), text(String(i)), text(p.period),
      numText(p.plannedHours), numText(p.actualHours), numText(p.plannedCost), numText(p.actualCost),
      text(projectId),
    ]));
  });
  out.push({ sql: "COMMIT" });
  return out;
}

export function setBaselineStatements(id: string, projectId: string): SqlStmt[] {
  return [
    { sql: "UPDATE snapshot SET is_baseline='0' WHERE project_id = ?", args: [text(projectId)] },
    { sql: "UPDATE snapshot SET is_baseline='1' WHERE id = ? AND project_id = ?", args: [text(id), text(projectId)] },
  ];
}

export function deleteStatements(id: string, projectId: string): SqlStmt[] {
  return [
    { sql: "DELETE FROM snapshot_series WHERE snapshot_id = ? AND project_id = ?", args: [text(id), text(projectId)] },
    { sql: "DELETE FROM snapshot WHERE id = ? AND project_id = ?", args: [text(id), text(projectId)] },
  ];
}
```

(`rowsToSnapshots` is unchanged — it ignores the extra `project_id` column.)

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/app/snapshot-schema.test.ts`
Expected: PASS. (Type errors in `snapshot-store.ts` callers are expected and fixed in Task 5.)

- [ ] **Step 5: Commit** (defer until Task 5 so the build stays green, OR commit now and fix callers immediately in Task 5)

```bash
git add src/app/snapshot-schema.ts src/app/snapshot-schema.test.ts
git commit -F - <<'EOF'
feat: scope snapshot tables by project_id (fixes cross-project baseline clobber)
EOF
```

---

## Task 5: Thread `projectId` through `snapshot-store.ts` and `use-snapshots.ts`

**Files:**
- Modify: `src/app/snapshot-store.ts`
- Modify: `src/app/use-snapshots.ts`
- Test: `src/app/snapshot-store.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append to `snapshot-store.test.ts`)**

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { loadSnapshots, appendSnapshot, setBaseline, deleteSnapshot } from "./snapshot-store";

const cfg = { httpUrl: "https://x.turso.io", authToken: "t" };

describe("snapshot-store passes projectId to scoped statements", () => {
  beforeEach(() => vi.mocked(runTursoPipeline).mockClear());

  it("loadSnapshots issues project-scoped selects", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      { type: "ok" }, { type: "ok" }, // DDL
      { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } },
      { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } },
    ]);
    await loadSnapshots(cfg, "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts.some((s) => s.sql.includes("WHERE project_id = ?"))).toBe(true);
  });

  it("setBaseline forwards projectId", async () => {
    await setBaseline(cfg, "s1", "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts.some((s) => s.sql.includes("is_baseline='0' WHERE project_id = ?"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/snapshot-store.test.ts`
Expected: FAIL — store fns don't accept `projectId`.

- [ ] **Step 3: Implement `snapshot-store.ts`**

```ts
export async function loadSnapshots(config: TursoConfig | null, projectId: string): Promise<SnapshotRecord[]> {
  const stmts: SqlStmt[] = [...ddl(), ...snapshotSelectStatements(projectId)];
  const results = await runTursoPipeline(config, stmts);
  const base = SNAPSHOT_DDL.length;
  return rowsToSnapshots(results[base], results[base + 1]);
}

export async function appendSnapshot(config: TursoConfig | null, rec: SnapshotRecord, projectId: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...appendStatements(rec, projectId)]);
}

export async function setBaseline(config: TursoConfig | null, id: string, projectId: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...setBaselineStatements(id, projectId)]);
}

export async function deleteSnapshot(config: TursoConfig | null, id: string, projectId: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteStatements(id, projectId)]);
}
```

- [ ] **Step 4: Implement `use-snapshots.ts`**

Add `projectId: string` to `UseSnapshotsArgs`, keep it in a ref (it can change on project switch), and pass it to every store call:

```ts
export interface UseSnapshotsArgs {
  active: boolean;
  cadence: SnapshotCadence;
  tursoConfig: TursoConfig | null;
  /** Active project id (Turso multi-tenant scoping). */
  projectId: string;
  today: Date;
  buildContext: () => Omit<BuildSnapshotInput, "capturedAt" | "cadence" | "trigger">;
  onError?: (err: unknown) => void;
}
```

In the hook body, add a ref and effect alongside the existing `cfgRef`:

```ts
  const pidRef = useRef(args.projectId);
  useEffect(() => { pidRef.current = args.projectId; }, [args.projectId]);
```

Then change the four call sites:
- load effect: `const history = await loadSnapshots(cfgRef.current, pidRef.current);` and `await storeAppend(cfgRef.current, rec, pidRef.current);`
- `captureNow`: `await storeAppend(cfgRef.current, rec, pidRef.current);`
- `setBaseline`: `await storeSetBaseline(cfgRef.current, id, pidRef.current);`
- `deleteSnapshot`: `await storeDelete(cfgRef.current, id, pidRef.current);`

Also add `args.projectId` to the load effect's dependency array (so switching project reloads that project's snapshots): change `}, [active, cadence, currentBucket]);` to `}, [active, cadence, currentBucket, args.projectId]);`.

The caller in `task-manager.tsx` must pass `projectId`. In file mode there is no Turso project; pass the current registry id or `""`. Find the existing `useSnapshots({ ... })` call and add `projectId: <current project id or "">`. (The hook only runs store calls when `active` is true, i.e. Turso mode, so `""` in file mode is inert. Use the Turso current-project id when in Turso mode.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/app/snapshot-store.test.ts src/app/use-snapshots.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors. Fix any `use-snapshots.test.ts` calls that now need a `projectId` arg by adding `projectId: "p1"` to their args object.

- [ ] **Step 6: Commit**

```bash
git add src/app/snapshot-store.ts src/app/use-snapshots.ts src/app/snapshot-store.test.ts src/app/use-snapshots.test.ts src/app/task-manager.tsx
git commit -F - <<'EOF'
feat: thread project_id through snapshot store + use-snapshots
EOF
```

---

## Task 6: `turso-tenant-backend.ts` — per-project StorageBackend

**Files:**
- Create: `src/app/turso-tenant-backend.ts`
- Test: `src/app/turso-tenant-backend.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/turso-tenant-backend.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn() }));
import { runTursoPipeline } from "./turso-pipeline";
import { TursoTenantBackend } from "./turso-tenant-backend";
import { tenantSchemaDdl } from "./turso-tenant-schema";
import { TABLE_NAMES } from "./turso-schema";

const cfg = { httpUrl: "https://x.turso.io", authToken: "t" };

function okEmpty() {
  return { type: "ok" as const, response: { type: "execute", result: { cols: [], rows: [] } } };
}

describe("TursoTenantBackend", () => {
  beforeEach(() => vi.mocked(runTursoPipeline).mockReset());

  it("kind is turso", () => {
    expect(new TursoTenantBackend(cfg, "p1").kind).toBe("turso");
  });

  it("isReady reflects config presence", async () => {
    expect(await new TursoTenantBackend(cfg, "p1").isReady()).toBe(true);
    expect(await new TursoTenantBackend(null, "p1").isReady()).toBe(false);
  });

  it("load runs DDL + scoped selects and returns an empty workspace on no rows", async () => {
    const ddlCount = tenantSchemaDdl().length;
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, okEmpty),
      ...TABLE_NAMES.map(okEmpty),
    ]);
    const ws = await new TursoTenantBackend(cfg, "p1").load();
    expect(ws.tasks).toEqual([]);
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts.some((s) => s.sql.includes("WHERE project_id = ?"))).toBe(true);
  });

  it("save runs the scoped DELETE+INSERT transaction", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([]);
    const { emptyWorkspace } = await import("./storage");
    await new TursoTenantBackend(cfg, "p1").save(emptyWorkspace());
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[0].sql).toBe("BEGIN");
    expect(stmts.some((s) => s.sql.startsWith("DELETE FROM tasks WHERE project_id"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/turso-tenant-backend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/turso-tenant-backend.ts
//
// Per-project Turso (libSQL) StorageBackend. Reads/writes only the slice of the
// shared DB tagged with `projectId`. Reuses the shared pipeline transport (so
// the existing tursoErrorKind classification + storage banner keep working) and
// the project-scoped statement builders. The dynamic import of turso-schema /
// turso-tenant-schema inside load()/save() mirrors TursoBackend's pattern of
// breaking the storage -> backend -> schema -> storage module cycle.

import {
  emptyWorkspace,
  type StorageBackend,
  type Workspace,
} from "./storage";
import { runTursoPipeline } from "./turso-pipeline";
import type { TursoConfig } from "./turso-config";

export class TursoTenantBackend implements StorageBackend {
  readonly kind = "turso" as const;

  constructor(private config: TursoConfig | null, private projectId: string) {}

  async isReady(): Promise<boolean> {
    return this.config !== null;
  }

  async describe(): Promise<string | null> {
    if (!this.config) return null;
    try {
      return `Turso: ${new URL(this.config.httpUrl).host}`;
    } catch {
      return "Turso";
    }
  }

  async load(): Promise<Workspace> {
    const { TABLE_NAMES, rowsToWorkspace } = await import("./turso-schema");
    const { tenantSchemaDdl, tenantSelectStatements } = await import("./turso-tenant-schema");
    const ddl = tenantSchemaDdl();
    const stmts = [...ddl.map((sql) => ({ sql })), ...tenantSelectStatements(this.projectId)];
    const results = await runTursoPipeline(this.config, stmts);
    const relational = results.slice(ddl.length, ddl.length + TABLE_NAMES.length);
    const isEmpty = relational.every((r) => (r?.response?.result?.rows?.length ?? 0) === 0);
    if (isEmpty) return emptyWorkspace();
    return rowsToWorkspace(relational);
  }

  async save(workspace: Workspace): Promise<void> {
    const { tenantWorkspaceToStatements } = await import("./turso-tenant-schema");
    await runTursoPipeline(this.config, tenantWorkspaceToStatements(workspace, this.projectId));
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/app/turso-tenant-backend.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/turso-tenant-backend.ts src/app/turso-tenant-backend.test.ts
git commit -F - <<'EOF'
feat: TursoTenantBackend — per-project StorageBackend over the shared DB
EOF
```

---

## Task 7: `turso-portfolio.ts` — portfolio-level Turso ops

**Files:**
- Create: `src/app/turso-portfolio.ts`
- Test: `src/app/turso-portfolio.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/turso-portfolio.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn() }));
import { runTursoPipeline } from "./turso-pipeline";
import {
  listProjects, listArchivedProjects, createProject, updateProjectMeta,
  archiveProject, restoreProject, hardDeleteProject,
} from "./turso-portfolio";
import { upsertProjectStatement } from "./turso-tenant-schema";
import type { ProjectMeta } from "./types";

const cfg = { httpUrl: "https://x.turso.io", authToken: "t" };

function meta(): ProjectMeta {
  return {
    name: "Apollo", code: "APL-1", projectManager: "PM",
    keyStakeholdersInternal: [], keyStakeholdersExternal: [],
    customer: "Acme", naceSection: "C", identityTypes: [], products: "P",
    deployment: "Cloud", startDate: "2026-01-01", endDate: "2026-12-31",
    profitCenter: "PC-1", contactPersons: [], regulatory: [],
  };
}

function projectsResult(id: string, m: ProjectMeta, archived: boolean) {
  const up = upsertProjectStatement(m, id, archived);
  const cols = up.sql.match(/\(([^)]+)\) VALUES/)![1].split(",").map((c) => ({ name: c.trim().replace(/"/g, "") }));
  return { type: "ok" as const, response: { type: "execute", result: { cols, rows: [up.args!.map((a) => ({ value: a.value }))] } } };
}

describe("turso-portfolio", () => {
  beforeEach(() => vi.mocked(runTursoPipeline).mockReset());

  it("listProjects returns decoded non-archived entries", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      { type: "ok" }, // DDL (one statement batch result; exact count not asserted here)
      projectsResult("p1", meta(), false),
    ]);
    const list = await listProjects(cfg);
    expect(list.at(-1)?.id).toBe("p1"); // last result is the SELECT
    expect(list.at(-1)?.meta.name).toBe("Apollo");
  });

  it("createProject emits an upsert with archived=0", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([]);
    await createProject(cfg, meta(), "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    const up = stmts.find((s) => s.sql.includes("INTO projects"));
    expect(up).toBeDefined();
    expect(up!.args?.[1]).toEqual({ type: "text", value: "0" });
  });

  it("archive/restore/hardDelete emit the right statements", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([]);
    await archiveProject(cfg, "p1");
    expect(vi.mocked(runTursoPipeline).mock.calls.at(-1)![1].some((s) => s.sql.includes("'1' WHERE id = ?"))).toBe(true);
    await restoreProject(cfg, "p1");
    expect(vi.mocked(runTursoPipeline).mock.calls.at(-1)![1].some((s) => s.sql.includes("'0' WHERE id = ?"))).toBe(true);
    await hardDeleteProject(cfg, "p1");
    expect(vi.mocked(runTursoPipeline).mock.calls.at(-1)![1].some((s) => s.sql.includes("DELETE FROM projects WHERE id = ?"))).toBe(true);
  });
});
```

> NOTE: `listProjects` returns only the decoded entries (not a mix). The test's `.at(-1)` is just a convenience because the mock's last result is the SELECT; the real `listProjects` decodes the SELECT result specifically (see impl). Adjust the assertion to `expect(list[0]...)` once you confirm the impl returns the decoded list directly.

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/turso-portfolio.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/turso-portfolio.ts
//
// Portfolio-level operations over a shared multi-tenant Turso DB: the project
// list (source of truth) + create/update-meta/archive/restore/hard-delete.
// Every call ensures the schema exists (tenantSchemaDdl, CREATE IF NOT EXISTS)
// so a brand-new DB initializes on first use. Errors propagate from
// runTursoPipeline so the caller's tursoErrorKind classification drives the
// storage banner.

import { runTursoPipeline } from "./turso-pipeline";
import {
  tenantSchemaDdl, listProjectsStatement, listArchivedProjectsStatement,
  upsertProjectStatement, archiveProjectStatement, restoreProjectStatement,
  hardDeleteProjectStatements, rowsToProjectList, type ProjectListEntry,
} from "./turso-tenant-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { ProjectMeta } from "./types";

const ddl = (): SqlStmt[] => tenantSchemaDdl().map((sql) => ({ sql }));

async function listWith(config: TursoConfig | null, select: SqlStmt): Promise<ProjectListEntry[]> {
  const stmts = [...ddl(), select];
  const results = await runTursoPipeline(config, stmts);
  return rowsToProjectList(results[results.length - 1]);
}

export function listProjects(config: TursoConfig | null): Promise<ProjectListEntry[]> {
  return listWith(config, listProjectsStatement());
}

export function listArchivedProjects(config: TursoConfig | null): Promise<ProjectListEntry[]> {
  return listWith(config, listArchivedProjectsStatement());
}

export async function createProject(config: TursoConfig | null, meta: ProjectMeta, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), upsertProjectStatement(meta, id, false)]);
}

export async function updateProjectMeta(config: TursoConfig | null, meta: ProjectMeta, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), upsertProjectStatement(meta, id, false)]);
}

export async function archiveProject(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), archiveProjectStatement(id)]);
}

export async function restoreProject(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), restoreProjectStatement(id)]);
}

export async function hardDeleteProject(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...hardDeleteProjectStatements(id)]);
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/app/turso-portfolio.test.ts && npx tsc --noEmit`
Expected: PASS (adjust the list-decode assertion per the NOTE), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/turso-portfolio.ts src/app/turso-portfolio.test.ts
git commit -F - <<'EOF'
feat: turso-portfolio — list/create/archive/restore/hard-delete over shared DB
EOF
```

---

## Task 8: `type-to-confirm-dialog.tsx` — destructive confirm

**Files:**
- Create: `src/app/type-to-confirm-dialog.tsx`
- Test: `src/app/type-to-confirm-dialog.test.tsx`

Reuses the shared `Modal` + `ModalHeader`. Submit is disabled until the typed value EXACTLY equals the required name. Styled destructive with `AIPM-pink` (palette-safe).

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/type-to-confirm-dialog.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";

const base = {
  lang: "en-US" as const,
  title: "Delete permanently",
  message: "This cannot be undone.",
  confirmValue: "Apollo",
  confirmLabel: "Delete",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe("TypeToConfirmDialog", () => {
  it("disables confirm until the typed value matches exactly", () => {
    render(<TypeToConfirmDialog {...base} />);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Apoll" } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Apollo" } });
    expect(btn).not.toBeDisabled();
  });

  it("calls onConfirm only when matched and clicked", () => {
    const onConfirm = vi.fn();
    render(<TypeToConfirmDialog {...base} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Apollo" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel from the Cancel button", () => {
    const onCancel = vi.fn();
    render(<TypeToConfirmDialog {...base} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/type-to-confirm-dialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/app/type-to-confirm-dialog.tsx
"use client";

// Reusable destructive-confirmation dialog. The confirm button stays disabled
// until the user types the required value (e.g. the project's exact name) into
// the input. Used for permanent (hard) project deletion. Palette-safe: the
// destructive action uses AIPM-pink.

import { useState } from "react";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";

export interface TypeToConfirmDialogProps {
  lang: Lang;
  title: string;
  message: string;
  /** The exact string the user must type to enable the confirm button. */
  confirmValue: string;
  /** Label for the destructive confirm button. */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TypeToConfirmDialog({
  lang, title, message, confirmValue, confirmLabel, onConfirm, onCancel,
}: TypeToConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const matched = typed === confirmValue;
  const TITLE_ID = "type-to-confirm-title";

  return (
    <Modal open onClose={onCancel} ariaLabelledby={TITLE_ID} align="center" backdropClassName="bg-AIPM-dark-blue/50" zIndex={60}>
      <div
        data-modal-panel
        className="relative flex w-[460px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader lang={lang} title={title} titleId={TITLE_ID} onClose={onCancel} />
        <div className="flex flex-col gap-4 p-6">
          <p className="text-sm text-foreground">{message}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t(lang, "typeToConfirmPrompt", confirmValue)}
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label={t(lang, "typeToConfirmPrompt", confirmValue)}
              autoComplete="off"
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              {t(lang, "cancel")}
            </button>
            <button
              type="button"
              disabled={!matched}
              onClick={onConfirm}
              className="rounded-md border border-AIPM-pink/50 bg-AIPM-pink px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-pink/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
```

> NOTE: Confirm the `Modal` prop names (`ariaLabelledby`, `align`, `backdropClassName`, `zIndex`) match the existing component (they are used by `project-empty-state.tsx`). The `t(lang, "cancel")` key already exists (used elsewhere). `typeToConfirmPrompt` is added in Task 11.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/app/type-to-confirm-dialog.test.tsx && npx tsc --noEmit`
Expected: PASS. (`typeToConfirmPrompt` key missing → tsc error; either land Task 11 first or temporarily inline an English string and replace it in Task 11. Preferred: do Task 11's key additions before this typecheck.)

- [ ] **Step 5: Commit**

```bash
git add src/app/type-to-confirm-dialog.tsx src/app/type-to-confirm-dialog.test.tsx
git commit -F - <<'EOF'
feat: TypeToConfirmDialog — type-the-name destructive confirmation
EOF
```

---

## Task 9: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

Add the new keys to BOTH bundles (tsc enforces parity). Place them near the existing `projects*` keys.

- [ ] **Step 1: Add to `i18n.ts` (English)**

```ts
  portfolioModeLabel: "Portfolio storage",
  portfolioModeFile: "Local files",
  portfolioModeTurso: "Turso database (multi-project)",
  portfolioModeHelp: "Choose where your portfolio of projects lives. Local files keep one file per project; Turso stores all projects in one shared database.",
  projectsArchived: "Archived projects",
  projectsShowArchived: "Show archived",
  projectsHideArchived: "Hide archived",
  projectsArchive: "Archive",
  projectsRestore: "Restore",
  projectsDeletePermanently: "Delete permanently",
  projectsArchiveConfirm: "Archive this project? You can restore it later from the archived list.",
  projectsHardDeleteTitle: "Delete project permanently",
  projectsHardDeleteMessage: "This permanently removes the project and ALL its data (tasks, RAID, milestones, snapshots) from the database. This cannot be undone.",
  typeToConfirmPrompt: "Type {0} to confirm",
  projectArchivedToast: "Project archived",
  projectRestoredToast: "Project restored",
  projectHardDeletedToast: "Project permanently deleted",
  projectsTursoUnreachable: "Can't reach the Turso database. Check the URL and token in Settings.",
```

- [ ] **Step 2: Add the SAME keys to `i18n.de.ts` (German)** — careful with literal UTF-8; do NOT let curly quotes replace ASCII `"`:

```ts
  portfolioModeLabel: "Portfolio-Speicher",
  portfolioModeFile: "Lokale Dateien",
  portfolioModeTurso: "Turso-Datenbank (Multi-Projekt)",
  portfolioModeHelp: "Legen Sie fest, wo Ihr Projektportfolio gespeichert wird. Lokale Dateien speichern eine Datei pro Projekt; Turso speichert alle Projekte in einer gemeinsamen Datenbank.",
  projectsArchived: "Archivierte Projekte",
  projectsShowArchived: "Archiv anzeigen",
  projectsHideArchived: "Archiv ausblenden",
  projectsArchive: "Archivieren",
  projectsRestore: "Wiederherstellen",
  projectsDeletePermanently: "Endgültig löschen",
  projectsArchiveConfirm: "Dieses Projekt archivieren? Sie können es später aus der Archivliste wiederherstellen.",
  projectsHardDeleteTitle: "Projekt endgültig löschen",
  projectsHardDeleteMessage: "Damit werden das Projekt und ALLE zugehörigen Daten (Aufgaben, RAID, Meilensteine, Snapshots) dauerhaft aus der Datenbank entfernt. Dies kann nicht rückgängig gemacht werden.",
  typeToConfirmPrompt: "Geben Sie {0} zur Bestätigung ein",
  projectArchivedToast: "Projekt archiviert",
  projectRestoredToast: "Projekt wiederhergestellt",
  projectHardDeletedToast: "Projekt endgültig gelöscht",
  projectsTursoUnreachable: "Turso-Datenbank nicht erreichbar. Prüfen Sie URL und Token in den Einstellungen.",
```

- [ ] **Step 3: Verify parity + no quote corruption**

Run: `npx tsc --noEmit`
Expected: no errors (parity holds).
Run: `npx vitest run src/app/i18n` (the DE encoding guard test, if present) — expected PASS.
Manually verify `i18n.de.ts` has no `“`/`”` in delimiter positions for the new lines.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: i18n keys for portfolio mode, archive/restore, hard-delete confirm (EN/DE)
EOF
```

---

## Task 10: Turso-mode flows in `use-storage-backend.ts`

**Files:**
- Modify: `src/app/use-storage-backend.ts`
- Test: `src/app/use-storage-backend.test.tsx` (extend)

Add portfolio-mode awareness + Turso project flows. The hook already has the helper/closure patterns to follow (`currentWorkspace()`, `backendFor`, suppress refs, `applyWorkspace`). Add Turso variants that DO NOT touch the file registry.

Add new returned handlers:
- `switchToTursoProject(id)` — flush current (best-effort) → build `TursoTenantBackend(tursoConfig, id)` → load → apply → `saveCurrentTursoProjectId(id)`.
- `createTursoProject(meta)` — generate id → `turso-portfolio.createProject` → set as current → apply empty workspace+meta.
- `archiveTursoProject(id)` / `restoreTursoProject(id)` — call portfolio ops; re-point current if archiving the active one.
- `hardDeleteTursoProject(id)` — call portfolio op; re-point current if it was active.

- [ ] **Step 1: Write the failing test (extend `use-storage-backend.test.tsx`)**

Add a focused test that mocks `turso-portfolio` + `turso-tenant-backend` and asserts the create flow selects the new id. Mirror the existing tests' harness (they render a host component that calls the hook). Minimal shape:

```tsx
import { vi } from "vitest";
vi.mock("./turso-portfolio", () => ({
  createProject: vi.fn(async () => undefined),
  listProjects: vi.fn(async () => []),
  archiveProject: vi.fn(async () => undefined),
  restoreProject: vi.fn(async () => undefined),
  hardDeleteProject: vi.fn(async () => undefined),
}));
// ...render the hook host, switch settings to a turso config, call
// createTursoProject(meta), then assert saveCurrentTursoProjectId was called
// with the generated id (spy on ./portfolio-mode) and createProject was invoked.
```

> The implementer should follow the existing test file's host-component pattern (look at how `switchToProject`/`createProject` are exercised) and assert: `createProject` (portfolio) called once; `applyWorkspace` resulted in `project === meta`; `saveCurrentTursoProjectId` called with a non-empty id.

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`
Expected: FAIL — new handlers don't exist.

- [ ] **Step 3: Implement** — add near the existing project flows:

```ts
import {
  loadPortfolioMode, saveCurrentTursoProjectId, loadCurrentTursoProjectId,
} from "./portfolio-mode";
import { TursoTenantBackend } from "./turso-tenant-backend";
import {
  createProject as portfolioCreate, archiveProject as portfolioArchive,
  restoreProject as portfolioRestore, hardDeleteProject as portfolioHardDelete,
} from "./turso-portfolio";
```

Helper to resolve the live Turso config (reuse the existing resolution used by `backendFor`):

```ts
  function tursoConfigNow() {
    return getTursoConfig(
      settingsRef.current.integrations?.turso?.databaseUrl,
      settingsRef.current.integrations?.turso?.authToken,
    );
  }
```

Switch:

```ts
  async function switchToTursoProject(id: string): Promise<void> {
    if (args.isPopout) return;
    const cfg = tursoConfigNow();
    if (!cfg) { args.showToast("error", t(langRef.current, "projectsTursoUnreachable")); return; }
    if (loadCurrentTursoProjectId() === id) return;
    try {
      try { await backend.save(currentWorkspace()); } catch { /* best-effort flush */ }
      const targetBackend = new TursoTenantBackend(cfg, id);
      const loaded = await targetBackend.load();
      applyWorkspace(loaded);
      suppressNextLoadRef.current = true;
      suppressNextSaveRef.current = true;
      saveCurrentTursoProjectId(id);
      // The active StorageConfig stays kind:"turso"; the backend memo keys on the
      // config object, so to repoint the active backend at the new projectId,
      // bump the config identity (see NOTE below).
      args.setStorageConfig({ ...settingsRef.current.storageConfig });
      args.showToast("info", t(langRef.current, "projectSwitchedToast", loaded.project?.name ?? id));
    } catch (err) { reportProjectError(err); }
  }
```

> CRITICAL NOTE for the implementer — backend identity in Turso mode: the memoized `backend` is built by `createBackend(storageConfig, …)`, which for `kind:"turso"` constructs the single-tenant `TursoBackend`. For Turso multi-tenant, the ACTIVE backend used by the load/save effects must be a `TursoTenantBackend` bound to the current project id. Two clean options — pick ONE and apply it consistently:
> 1. **Preferred:** extend `createBackend` so that when `kind:"turso"` AND portfolio mode is `"turso"`, it returns `new TursoTenantBackend(tursoConfig, loadCurrentTursoProjectId() ?? "")`. Then the existing memo + load/save effects work unchanged, and switching project = change the current-project id + bump the memo dependency. Add `loadCurrentTursoProjectId()` (or a piece of state mirroring it) to the `backend` useMemo dependency array so a switch rebuilds the backend.
> 2. Maintain a separate `activeBackendRef` for Turso mode. (More code; not recommended.)
>
> Go with option 1: thread a `tursoProjectId` value (React state, initialized from `loadCurrentTursoProjectId()`) into the `backend` useMemo deps and into `createBackend`'s Turso branch. `switchToTursoProject`/`createTursoProject` then `setTursoProjectId(id)` instead of bumping the config object, and the load effect naturally reloads.

Create:

```ts
  async function createTursoProject(meta: ProjectMeta): Promise<void> {
    if (args.isPopout) return;
    const cfg = tursoConfigNow();
    if (!cfg) { args.showToast("error", t(langRef.current, "projectsTursoUnreachable")); return; }
    try { await backend.save(currentWorkspace()); } catch { /* best-effort flush */ }
    const id = crypto.randomUUID();
    try {
      await portfolioCreate(cfg, meta, id);
      saveCurrentTursoProjectId(id);
      applyWorkspace({ ...emptyWorkspace(), project: meta });
      suppressNextSaveRef.current = true;
      // repoint active backend at the new project (see CRITICAL NOTE)
      setTursoProjectId(id);
      args.showToast("info", t(langRef.current, "projectCreatedToast", meta.name));
    } catch (err) { reportProjectError(err); }
  }
```

Archive / restore / hard-delete:

```ts
  async function archiveTursoProject(id: string): Promise<void> {
    if (args.isPopout) return;
    const cfg = tursoConfigNow();
    if (!cfg) { args.showToast("error", t(langRef.current, "projectsTursoUnreachable")); return; }
    try {
      await portfolioArchive(cfg, id);
      args.showToast("info", t(langRef.current, "projectArchivedToast"));
    } catch (err) { reportProjectError(err); }
  }

  async function restoreTursoProject(id: string): Promise<void> {
    if (args.isPopout) return;
    const cfg = tursoConfigNow();
    if (!cfg) { args.showToast("error", t(langRef.current, "projectsTursoUnreachable")); return; }
    try {
      await portfolioRestore(cfg, id);
      args.showToast("info", t(langRef.current, "projectRestoredToast"));
    } catch (err) { reportProjectError(err); }
  }

  async function hardDeleteTursoProject(id: string): Promise<void> {
    if (args.isPopout) return;
    const cfg = tursoConfigNow();
    if (!cfg) { args.showToast("error", t(langRef.current, "projectsTursoUnreachable")); return; }
    try {
      await portfolioHardDelete(cfg, id);
      args.showToast("info", t(langRef.current, "projectHardDeletedToast"));
    } catch (err) { reportProjectError(err); }
  }
```

Add all five to the hook's return object. (Archiving/hard-deleting the ACTIVE project: the Projects panel (Task 12) re-fetches the list after the op and, if the active project vanished, calls `switchToTursoProject(firstSurvivor)` or shows the empty-state — keep the re-point logic in task-manager, not buried here, mirroring Phase 1's delete handling.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/app/use-storage-backend.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx src/app/storage.ts
git commit -F - <<'EOF'
feat: Turso multi-tenant project flows (switch/create/archive/restore/hard-delete)
EOF
```

---

## Task 11: `createBackend` Turso-tenant branch

**Files:**
- Modify: `src/app/storage.ts` (the `createBackend` factory)
- Test: `src/app/storage.test.ts` (extend)

Per the CRITICAL NOTE in Task 10, when `kind:"turso"` and portfolio mode is Turso, `createBackend` must return a `TursoTenantBackend` bound to the current project id.

- [ ] **Step 1: Write the failing test**

```ts
import { createBackend } from "./storage";

it("createBackend returns a tenant backend for turso when a projectId is supplied", () => {
  const b = createBackend({ kind: "turso" }, {
    tursoConfig: { httpUrl: "https://x.turso.io", authToken: "t" },
    tursoProjectId: "p1",
  });
  expect(b.kind).toBe("turso");
  // structural check: tenant backend has a private projectId; assert via load shape instead
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/app/storage.test.ts`
Expected: FAIL — `tursoProjectId` option not accepted / single-tenant returned.

- [ ] **Step 3: Implement**

In `createBackend`'s options type add `tursoProjectId?: string | null`. In the `case "turso"` branch (or equivalent), when `tursoProjectId` is a non-empty string, return `new TursoTenantBackend(tursoConfig, tursoProjectId)`; otherwise keep returning the single-tenant `TursoBackend(tursoConfig)` (so any non-portfolio path is unchanged). Import `TursoTenantBackend` lazily/normally as the file's existing backend imports do (watch the module cycle — if `TursoBackend` is imported dynamically, mirror that for the tenant backend).

Then update `use-storage-backend.ts` to pass `tursoProjectId: portfolioMode === "turso" ? tursoProjectId : null` in BOTH `createBackend` calls (the memo + `backendFor`), where `tursoProjectId` is the new React state seeded from `loadCurrentTursoProjectId()`, and add it to the memo dependency array.

- [ ] **Step 4: Run tests + typecheck + full suite**

Run: `npx vitest run src/app/storage.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/storage.ts src/app/storage.test.ts src/app/use-storage-backend.ts
git commit -F - <<'EOF'
feat: createBackend returns TursoTenantBackend when a turso projectId is active
EOF
```

---

## Task 12: Projects panel — archived view + archive/restore/hard-delete

**Files:**
- Modify: `src/app/projects-panel.tsx`
- Test: `src/app/projects-panel.test.tsx` (create or extend)

Add Turso-mode capabilities to the panel while keeping file-mode behavior intact. The panel becomes mode-aware via new optional props; when `mode === "turso"` it shows archive/restore/hard-delete + a "Show archived" toggle and hides "Load from file".

- [ ] **Step 1: Extend `ProjectsPanelProps`**

```ts
export interface ProjectsPanelProps {
  // ...existing...
  mode: "file" | "turso";
  /** Turso-mode only: archived projects to reveal under "Show archived". */
  archivedProjects?: ProjectRegistryEntry[];
  /** Turso-mode actions. */
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onHardDelete?: (id: string) => void;
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// src/app/projects-panel.test.tsx (add)
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectsPanel } from "./projects-panel";

const baseProps = {
  projects: [{ id: "p1", name: "Apollo", code: "APL", storageConfig: { kind: "turso" } as const }],
  currentProjectId: "p1",
  stakeholderNames: [], addressBook: [], lang: "en-US" as const,
  onSwitch: () => {}, onCreate: () => {}, onUpdateCurrent: () => {},
  onDelete: () => {}, onExportCurrent: () => {}, onLoadFromFile: () => {},
};

it("turso mode: default delete archives, and Show archived reveals restore + permanent delete", () => {
  const onArchive = vi.fn(); const onHardDelete = vi.fn(); const onRestore = vi.fn();
  render(<ProjectsPanel {...baseProps} mode="turso"
    archivedProjects={[{ id: "p9", name: "Old", code: "OLD", storageConfig: { kind: "turso" } as const }]}
    onArchive={onArchive} onRestore={onRestore} onHardDelete={onHardDelete} />);
  // the current row's destructive button is "Archive" in turso mode
  fireEvent.click(screen.getByRole("button", { name: /archive/i }));
  expect(onArchive).toHaveBeenCalledWith("p1");
  // reveal archived
  fireEvent.click(screen.getByRole("button", { name: /show archived/i }));
  expect(screen.getByText("Old")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /restore/i }));
  expect(onRestore).toHaveBeenCalledWith("p9");
  // permanent delete opens the type-to-confirm dialog
  fireEvent.click(screen.getByRole("button", { name: /delete permanently/i }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Old" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onHardDelete).toHaveBeenCalledWith("p9");
});

it("file mode keeps the existing Delete + Load from file behavior", () => {
  render(<ProjectsPanel {...baseProps} mode="file" />);
  expect(screen.getByRole("button", { name: /load from file/i })).toBeInTheDocument();
});
```

- [ ] **Step 2b: Run to confirm failure**

Run: `npx vitest run src/app/projects-panel.test.tsx`
Expected: FAIL — props/behavior not implemented.

- [ ] **Step 3: Implement**

- Hide the "Load from file" header button when `mode === "turso"`.
- In the current row's action cluster: when `mode === "turso"`, replace the Delete button label/handler with **Archive** (`onArchive(p.id)`, guarded by `window.confirm(t(lang,"projectsArchiveConfirm"))`); keep Edit + Export.
- Add a `showArchived` local state + a header toggle button (`projectsShowArchived` / `projectsHideArchived`) visible only in `mode === "turso"`.
- When `showArchived`, render an "Archived projects" subsection listing `archivedProjects` with **Restore** (`onRestore(p.id)`) and **Delete permanently** buttons.
- "Delete permanently" sets local state `{ hardDeleteTarget: entry }`; render `TypeToConfirmDialog` with `confirmValue={target.name}`, `title={t(lang,"projectsHardDeleteTitle")}`, `message={t(lang,"projectsHardDeleteMessage")}`, `confirmLabel={t(lang,"projectsDeletePermanently")}` → on confirm call `onHardDelete(target.id)` and clear the target.
- Keep all existing file-mode JSX paths unchanged behind `mode === "file"`.

Import: `import { TypeToConfirmDialog } from "./type-to-confirm-dialog";`

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/app/projects-panel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/projects-panel.tsx src/app/projects-panel.test.tsx
git commit -F - <<'EOF'
feat: projects panel archived view + archive/restore/hard-delete (Turso mode)
EOF
```

---

## Task 13: Mode-aware UI wiring (task-manager, switcher, empty-state, create-form, settings)

**Files:**
- Modify: `src/app/task-manager.tsx`
- Modify: `src/app/project-switcher.tsx`
- Modify: `src/app/project-empty-state.tsx`
- Modify: `src/app/create-project-form.tsx`
- Modify: a Settings storage/integrations section component (locate via grep — see below)
- Test: extend the relevant component tests

This is the integration task. Read each file before editing; follow its existing patterns.

- [ ] **Step 1: create-project-form — hide format selector in Turso mode**

Add an optional prop `hideFormat?: boolean`. When true, skip rendering the `<label>…<select>` block and force `format` to `"json"` (it is ignored by the Turso create path). Default false (file mode unchanged). Update both `CreateProjectForm` consumers to pass `hideFormat={mode === "turso"}`.

- [ ] **Step 2: project-empty-state — Turso variant**

Add an optional prop `mode?: "file" | "turso"` (default `"file"`). When `"turso"`, hide the "Load from file" button (show only "Create project") and pass `hideFormat` to `CreateProjectForm`. Keep file mode unchanged.

- [ ] **Step 3: project-switcher — Turso variant**

Add optional `mode?: "file" | "turso"` (default `"file"`). When `"turso"`, hide the "Load from file" dropdown item (Turso has no file load). Keep everything else.

- [ ] **Step 4: task-manager — mode-aware list + handlers**

Read `task-manager.tsx` for the existing Phase 1 wiring (`registry` state, `onRegistryChange`, `handleNewProject`, `handleDeleteProject`, `handleExportCurrentProject`, the `useSnapshots` call, and where `ProjectSwitcher`/`ProjectsPanel`/`ProjectEmptyState` are rendered). Then:

- Add `const [portfolioMode] = useState<PortfolioMode>(loadPortfolioMode());` (import from `./portfolio-mode`). The mode only changes via Settings + reload (mirrors the Phase-1 `feature-modules` Save→reload convention), so reading once at mount is correct.
- Add Turso project-list state: `const [tursoProjects, setTursoProjects] = useState<ProjectListEntry[]>([]);` and `const [tursoArchived, setTursoArchived] = useState<ProjectListEntry[]>([]);` and `const [tursoCurrentId, setTursoCurrentId] = useState<string | null>(loadCurrentTursoProjectId());`.
- Add a refresh function `refreshTursoProjects()` that, when `portfolioMode === "turso"` and a config exists, calls `listProjects(cfg)` + `listArchivedProjects(cfg)` and sets state; route errors through the same `reportStorageOutcome` used for the storage banner. Call it on mount (effect, when in Turso mode) and after each Turso mutation.
- Derive the rendered list + current id + empty-state gate from the mode:
  - file mode → existing `registry.projects` / `registry.currentProjectId`.
  - turso mode → `tursoProjects` (mapped to the `ProjectRegistryEntry` shape the panel/switcher expect: `{ id, name: meta.name, code: meta.code, storageConfig: { kind: "turso" } }`) / `tursoCurrentId`.
- Empty-state gate (turso): `hydrated && portfolioMode === "turso" && tursoProjects.length === 0` (popout-exempt, same as Phase 1).
- Wire the panel/switcher/empty-state callbacks to the Turso handlers from `useStorageBackend` when in Turso mode (`switchToTursoProject`, `createTursoProject`, `archiveTursoProject`, `restoreTursoProject`, `hardDeleteTursoProject`, `updateProjectMeta` via a thin handler) and to the existing file handlers otherwise. After any Turso mutation handler resolves, call `refreshTursoProjects()`; if the active project was archived/hard-deleted, re-point: `switchToTursoProject(firstSurvivor.id)` or leave the empty-state to render.
- Pass `mode={portfolioMode}` + `archivedProjects` + `onArchive/onRestore/onHardDelete` to `ProjectsPanel`; pass `mode` to `ProjectSwitcher` and `ProjectEmptyState`.
- For `useSnapshots`, pass `projectId: portfolioMode === "turso" ? (tursoCurrentId ?? "") : ""`.

- [ ] **Step 5: Settings — portfolio-mode toggle**

Locate the Turso settings UI:

Run: `grep -rn "databaseUrl\|storageTurso\|integrations?.turso" src/app/settings-sections`

In the section that renders the Turso URL/token inputs (likely `settings-sections/integrations-section.tsx` or `storage-section.tsx`), add a `portfolioModeLabel` select bound to `loadPortfolioMode()` / `savePortfolioMode()`. On change, save the mode and trigger the same explicit reload the app uses for feature-modules (call the existing reload helper or `window.location.reload()`), because the mode is read once at mount. Show `portfolioModeHelp` as helper text.

- [ ] **Step 6: Run the focused tests + typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run src/app/project-switcher.test.tsx src/app/project-empty-state.test.tsx src/app/create-project-form.test.tsx src/app/task-manager`
Then: `npm test`
Expected: all green. Fix any test that constructs these components without the new props (add `mode="file"` defaults).

- [ ] **Step 7: Commit**

```bash
git add src/app/task-manager.tsx src/app/project-switcher.tsx src/app/project-empty-state.tsx src/app/create-project-form.tsx src/app/settings-sections
git commit -F - <<'EOF'
feat: mode-aware portfolio UI (Turso list, switcher, empty-state, settings toggle)
EOF
```

---

## Task 14: Fold in `feat-toast-first-migration`

**Files:** (merge — no new code)

Per the deferral decision, fold the unrelated notification-defaults branch into this phase.

- [ ] **Step 1: Merge**

```bash
git merge --no-ff feat-toast-first-migration -m "merge: fold in deferred toast-first migration (notification defaults)"
```

- [ ] **Step 2: Resolve any conflicts** (none expected — it touches `use-settings.ts` / `task-manager.tsx` / i18n; if `task-manager.tsx` conflicts, keep BOTH the Phase-2 portfolio wiring and the toast-first migration block).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: all green.

---

## Task 15: Version bump + sample DB regeneration

**Files:**
- Modify: `src/app/version.ts`
- Modify: `package.json`
- Modify: `scripts/generate-sample-workspace.ts`
- Modify: `src/app/i18n.ts` / `src/app/i18n.de.ts` (one new highlight key)

- [ ] **Step 1: Bump version**

In `version.ts`: set `APP_VERSION = "0.59.0"`, a new `APP_MILESTONE` (next sci-fi author codename, alphabetical-ish successor — choose one, e.g. `"Wells"` is taken; pick an unused author such as `"Watts"`), update `APP_BUILD_DATE = "2026-06-10"`, prepend a release-notes comment block describing Phase 2, and append a new highlight key `"versionHighlightTursoMultiProject"` to `APP_HIGHLIGHT_KEYS`. Add that key's EN + DE strings to the i18n bundles.

- [ ] **Step 2: Bump `package.json`** `"version": "0.59.0"`.

- [ ] **Step 3: Regenerate the sample Turso DB**

Update `scripts/generate-sample-workspace.ts` so the generated `sample-workspace.sqlite3` uses the multi-tenant schema: create the `projects` row (one project derived from the sample `ProjectMeta`, or a synthesized one if the sample lacks it) and stamp every workspace row with that `project_id`. Reuse `tenantSchemaDdl()` + the tenant insert shape (or equivalent raw SQL via `node:sqlite`). Keep `sample-workspace.json` and `sample-workspace.md` as-is (do NOT re-emit the markdown — it is the curated source of truth). Run the script per its existing npm/`tsx` invocation (check `package.json` scripts) and verify the file regenerates without error.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: green. (`scripts/` is excluded from tsconfig; run the generator with its existing runner.)

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts package.json scripts/generate-sample-workspace.ts src/app/i18n.ts src/app/i18n.de.ts sample-workspace.sqlite3
git commit -F - <<'EOF'
chore: release 0.59.0 — Turso multi-tenancy; regenerate multi-tenant sample DB
EOF
```

---

## Task 16: Full verification + final review

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npx eslint . --max-warnings=0 && npm test`
Expected: type-clean, lint-clean (`--max-warnings=0`), all tests green.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Final holistic review**

Dispatch a final code-reviewer over the whole branch diff (`git diff main...HEAD`). Confirm: no CRITICAL/HIGH; dual-use byte-safety untouched (this phase adds NEW tenant statements and does not change `workspaceToStatements`/CSV/MD no-config paths); snapshot guard test still green; EN/DE parity; no `console.log`; palette compliance in the new dialog/panel.

- [ ] **Step 4: Finish the branch** via `superpowers:finishing-a-development-branch`.

---

## Self-review (author)

**Spec coverage:**
- DB-authoritative list → Task 3 (`projects` table + `rowsToProjectList`), Task 7 (`listProjects`), Task 13 (task-manager reads it). ✓
- Global File/Turso mode → Task 1 (`portfolio-mode`), Task 13 (settings toggle + mount read + reload). ✓
- `project_id` on every table + per-project transactional save (last-write-wins) → Task 3. ✓
- New `turso-tenant-schema` / `turso-tenant-backend` / `turso-portfolio`; single-tenant `TursoBackend` intact → Tasks 3/6/7 (+ Task 11 createBackend branch). ✓
- Snapshot scoping incl. baseline-clobber fix → Task 4 + Task 5. ✓
- Soft delete (archive/restore) + hard delete with type-to-confirm → Task 8 (dialog), Task 10 (flows), Task 12 (panel). ✓
- No migration; sample DB regen; toast-first fold-in → Tasks 14/15 + documented in Task 3. ✓
- Testing surface → each task has TDD; Task 16 gate. ✓

**Placeholder scan:** No TBD/TODO. The one judgment call left open (backend identity in Turso mode) is resolved with an explicit "go with option 1" directive + exact mechanism. The codename is "choose an unused author (e.g. Watts)" — concrete instruction, not a placeholder.

**Type consistency:** `ProjectListEntry { id, meta, archived }` used consistently across Tasks 3/7/13. `tenantSelectStatements(projectId)` / `tenantWorkspaceToStatements(ws, projectId)` / snapshot builders all take `projectId: string`. Store fns take `(config, …, projectId)`. `createBackend` option `tursoProjectId?: string | null` consistent across Tasks 10/11. Handler names (`switchToTursoProject`, `createTursoProject`, `archiveTursoProject`, `restoreTursoProject`, `hardDeleteTursoProject`) consistent across Tasks 10/13.
