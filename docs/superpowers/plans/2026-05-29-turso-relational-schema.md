# Turso Relational Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Turso backend's single-JSON-blob row with a relational (hybrid) schema — one table per top-level `Workspace` entity, columns mirroring the existing CSV column sets, nested fields kept as encoded TEXT columns.

**Architecture:** A new pure module `turso-schema.ts` drives everything from a small **`TableSpec` registry**: each entity contributes its column array, a `toRow` (value-per-column) function, and a `fromRow` sanitizer — all of which already exist in `storage.ts`/`sanitize.ts` for the CSV path and are simply **exported and reused**. DDL, INSERT, SELECT and assembly are generic loops over the registry, so no per-field mapping is duplicated. `TursoBackend.save/load` delegate to the schema module over the existing `/v2/pipeline` transport (incl. 0.25.1 loopback/no-token/no-`close`).

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Vitest. libSQL HTTP `/v2/pipeline`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-29-turso-relational-schema-design.md`

**Branch:** `feat/0.26.0-turso-relational` (already created & checked out).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/app/storage.ts` | **Export** the CSV column constants + per-field encoders + raid/task row-builders + V6 migration so the Turso schema can reuse them | Modify |
| `src/app/turso-schema.ts` | Pure: `TableSpec` registry, `SCHEMA_DDL`, `TABLE_NAMES`, `selectStatements`, `workspaceToStatements`, `rowsToWorkspace` | Create |
| `src/app/turso-schema.test.ts` | Round-trip + statement-shape tests | Create |
| `src/app/turso-backend.ts` | Rewrite `load`/`save` to delegate to the schema module; old-blob auto-import | Modify |
| `src/app/turso-backend.test.ts` | Extend: relational save/load shape, old-blob import | Modify |
| `src/app/storage-exports.test.ts` | Guard that the reused building blocks are exported | Create |
| `src/app/version.ts`, `i18n.ts`, `i18n.de.ts`, `CHANGELOG.md` | Release 0.26.0 | Modify |

**Verified facts (do not re-derive):**
- `Workspace` (`storage.ts:52`): `{ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets?, fxRates? }`. `emptyWorkspace()` (`storage.ts:73`), `jsonToWorkspace` (`storage.ts:873`) exported. `SCHEMA_VERSION = 6` (`storage.ts:70`). The V6 migration function is applied on load — grep its name (`migrateWorkspace`/`migrateWorkspaceV6`); export it if not already.
- CSV column constants in `storage.ts` (currently **module-private**): `CSV_COLUMNS` (tasks), `RAID_CSV_COLUMNS`, `ABSENCES_CSV_COLUMNS`, `SHIFTS_CSV_COLUMNS`, `RESOURCES_CSV_COLUMNS`, `ROLES_CSV_COLUMNS`, `REF_CSV_COLUMNS` (disciplines & grades; `["id","name","localModifiedAt"]`), `BUDGETS_CSV_COLUMNS`. Entity tables key on `id` (first column for id-bearing entities).
- Per-field encoders (module-private): `fieldToString(t: Task, c)`, `raidFieldToString(r, c)`, `absenceFieldToString(a, c)`, `shiftFieldToString(s, c)`, `resourceFieldToString(r, c)`, `budgetFieldToString(b, c)` (signatures: `(entity, column) => string`). Roles & refs serialize via `String((r as Record)[c] ?? "")`.
- Decode: `csvRowsToObjects(csv)` builds `Record<colName,string>` then maps through the full-record sanitizer. Sanitizers (exported from `sanitize.ts`): `sanitizeResource`, `sanitizeRole`, `sanitizeBudgetBucket`, `sanitizeDiscipline`, `sanitizeGrade`, `sanitizeAbsence`, `sanitizeShift`, `sanitizeFxRates`, `sanitizePlan`. RAID rows → `buildRaidItemFromObj(obj)` (module-private in `storage.ts`). Tasks → the row-builder inside `csvToTasks` (extract+export as `buildTaskFromObj`). fx TEXT column decodes via `decodeRatesMap` (private) → `sanitizeFxRates({base,date,fetchedAt,rates})`; plan via `sanitizePlan({startDate,endDate,granularity,currency}, today)`.
- `turso-backend.ts` `runPipeline(stmts)` posts `{ requests: stmts.map(execute) }` (no `close`), conditional `Authorization`, validates `{results}` shape, throws on `results[].type==="error"`, 401→`StorageNotReadyError`, and **returns the `results` array**. Result cells are `{ type, value }`; columns in `result.cols` (`{name}`).

---

## Task 1: Export shared CSV building blocks from `storage.ts`

**Files:** Modify `src/app/storage.ts`; Test `src/app/storage-exports.test.ts` (new).

Make the column arrays + per-field encoders + row-builders + V6 migration reusable by `turso-schema.ts` **without duplicating** them and **without changing CSV behavior**.

- [ ] **Step 1: Add `export`** to: `CSV_COLUMNS`, `RAID_CSV_COLUMNS`, `ABSENCES_CSV_COLUMNS`, `SHIFTS_CSV_COLUMNS`, `RESOURCES_CSV_COLUMNS`, `ROLES_CSV_COLUMNS`, `REF_CSV_COLUMNS`, `BUDGETS_CSV_COLUMNS`, `fieldToString`, `raidFieldToString`, `absenceFieldToString`, `shiftFieldToString`, `resourceFieldToString`, `budgetFieldToString`, `buildRaidItemFromObj`, `decodeRatesMap`, and the V6 migration function. (Pure export additions — no logic change.)
- [ ] **Step 2: Extract + export `buildTaskFromObj`.** Grep `function csvToTasks`. If it parses rows inline, extract the per-row logic into `export function buildTaskFromObj(obj: Record<string, string>): Task | null` and call it from `csvToTasks` (CSV behavior unchanged). If a builder already exists, just `export` it.
- [ ] **Step 3: Guard test** (`storage-exports.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import {
  CSV_COLUMNS, RAID_CSV_COLUMNS, RESOURCES_CSV_COLUMNS, BUDGETS_CSV_COLUMNS,
  ROLES_CSV_COLUMNS, REF_CSV_COLUMNS, ABSENCES_CSV_COLUMNS, SHIFTS_CSV_COLUMNS,
  resourceFieldToString, buildTaskFromObj, buildRaidItemFromObj,
} from "./storage";

describe("storage CSV building blocks are exported", () => {
  it("exposes non-empty column arrays", () => {
    for (const cols of [CSV_COLUMNS, RAID_CSV_COLUMNS, RESOURCES_CSV_COLUMNS, BUDGETS_CSV_COLUMNS, ROLES_CSV_COLUMNS, REF_CSV_COLUMNS, ABSENCES_CSV_COLUMNS, SHIFTS_CSV_COLUMNS]) {
      expect(Array.isArray(cols) && cols.length > 0).toBe(true);
    }
    expect(REF_CSV_COLUMNS).toEqual(["id", "name", "localModifiedAt"]);
  });
  it("resourceFieldToString encodes utilization via the period-map encoder", () => {
    const r = { id: 1, firstName: "A", lastName: "B", roleId: null, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } };
    expect(resourceFieldToString(r as never, "utilization")).toBe("2026-02=100");
  });
  it("row builders accept Record<string,string> and round-trip ids", () => {
    expect(buildTaskFromObj({ id: "1", taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" })?.id).toBe(1);
    expect(buildRaidItemFromObj({ id: "1", category: "R", title: "X", status: "open", raisedDate: "2026-06-01" })?.id).toBe(1);
  });
});
```
(Run it; adjust the minimal objects to satisfy the real validators — field names must match what the sanitizers/builders read.)
- [ ] **Step 4: Run** `npx vitest run src/app/storage-exports.test.ts src/app/storage-serialization.test.ts` → both pass (CSV round-trip unchanged). `npx tsc --noEmit && npm run lint` → 0.
- [ ] **Step 5: Commit** `git add src/app/storage.ts src/app/storage-exports.test.ts && git commit -m "refactor(storage): export CSV column specs + row builders for reuse"`

---

## Task 2: `turso-schema.ts` — registry + DDL + SELECTs

**Files:** Create `src/app/turso-schema.ts`; Test `src/app/turso-schema.test.ts`.

- [ ] **Step 1: Failing test** (`turso-schema.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { SCHEMA_DDL, TABLE_NAMES, selectStatements } from "./turso-schema";

describe("turso-schema DDL", () => {
  it("creates a table per entity + plan, fx_rates, meta", () => {
    const joined = SCHEMA_DDL.join("\n");
    for (const t of ["tasks", "raid", "absences", "shifts", "resources", "roles", "disciplines", "grades", "budget_buckets", "plan", "fx_rates", "meta"]) {
      expect(joined).toContain(`CREATE TABLE IF NOT EXISTS ${t} `);
    }
    expect(joined).toContain("id INTEGER PRIMARY KEY");
  });
  it("selectStatements is one SELECT per table in TABLE_NAMES order", () => {
    expect(selectStatements().map((s) => s.sql)).toEqual(TABLE_NAMES.map((t) => `SELECT * FROM ${t}`));
  });
});
```
- [ ] **Step 2: Run → FAIL** (module missing).
- [ ] **Step 3: Implement** (`turso-schema.ts`):
```ts
// src/app/turso-schema.ts
//
// Pure relational mapping for the Turso backend. DDL/INSERT/SELECT are
// generated generically from a registry whose column sets + encoders +
// sanitizers are the SAME ones the CSV backend uses (exported from
// storage.ts / sanitize.ts) — so no per-field mapping is duplicated.

import {
  CSV_COLUMNS, RAID_CSV_COLUMNS, ABSENCES_CSV_COLUMNS, SHIFTS_CSV_COLUMNS,
  RESOURCES_CSV_COLUMNS, ROLES_CSV_COLUMNS, REF_CSV_COLUMNS, BUDGETS_CSV_COLUMNS,
  fieldToString, raidFieldToString, absenceFieldToString, shiftFieldToString,
  resourceFieldToString, budgetFieldToString, buildTaskFromObj, buildRaidItemFromObj,
  decodeRatesMap, emptyWorkspace, migrateWorkspace, type Workspace,
} from "./storage"; // NOTE: use the real V6-migration export name from Task 1
import {
  sanitizeResource, sanitizeRole, sanitizeBudgetBucket, sanitizeDiscipline,
  sanitizeGrade, sanitizeAbsence, sanitizeShift, sanitizeFxRates, sanitizePlan,
} from "./sanitize";
import type {
  Task, RaidItem, Absence, Shift, Resource, Role, Discipline, Grade, BudgetBucket,
} from "./types";

export interface SqlArg { type: "text" | "integer" | "null"; value?: string }
export interface SqlStmt { sql: string; args?: SqlArg[] }
export interface PipelineResultLike {
  type: "ok" | "error";
  response?: { type: string; result?: { cols?: { name?: string }[]; rows?: { value?: unknown }[][] } };
}

interface EntitySpec<T> {
  table: string;
  wsKey: keyof Workspace;
  columns: readonly string[];
  get: (ws: Workspace) => T[];
  toRow: (e: T, col: string) => string;
  fromObj: (obj: Record<string, string>) => T | null;
}
function spec<T>(s: EntitySpec<T>): EntitySpec<T> { return s; }
const refToRow = (r: { id: number; name: string; localModifiedAt?: string }, c: string) =>
  String((r as Record<string, unknown>)[c] ?? "");

export const ENTITY_SPECS: EntitySpec<unknown>[] = [
  spec<Task>({ table: "tasks", wsKey: "tasks", columns: CSV_COLUMNS, get: (w) => w.tasks, toRow: fieldToString, fromObj: buildTaskFromObj }),
  spec<RaidItem>({ table: "raid", wsKey: "raid", columns: RAID_CSV_COLUMNS, get: (w) => w.raid, toRow: raidFieldToString, fromObj: buildRaidItemFromObj }),
  spec<Absence>({ table: "absences", wsKey: "absences", columns: ABSENCES_CSV_COLUMNS, get: (w) => w.absences, toRow: absenceFieldToString, fromObj: sanitizeAbsence }),
  spec<Shift>({ table: "shifts", wsKey: "shifts", columns: SHIFTS_CSV_COLUMNS, get: (w) => w.shifts, toRow: shiftFieldToString, fromObj: sanitizeShift }),
  spec<Resource>({ table: "resources", wsKey: "resources", columns: RESOURCES_CSV_COLUMNS, get: (w) => w.resources, toRow: resourceFieldToString, fromObj: sanitizeResource }),
  spec<Role>({ table: "roles", wsKey: "roles", columns: ROLES_CSV_COLUMNS, get: (w) => w.roles, toRow: refToRow as never, fromObj: sanitizeRole }),
  spec<Discipline>({ table: "disciplines", wsKey: "disciplines", columns: REF_CSV_COLUMNS, get: (w) => w.disciplines, toRow: refToRow as never, fromObj: sanitizeDiscipline }),
  spec<Grade>({ table: "grades", wsKey: "grades", columns: REF_CSV_COLUMNS, get: (w) => w.grades, toRow: refToRow as never, fromObj: sanitizeGrade }),
  spec<BudgetBucket>({ table: "budget_buckets", wsKey: "budgets", columns: BUDGETS_CSV_COLUMNS, get: (w) => w.budgets ?? [], toRow: budgetFieldToString, fromObj: sanitizeBudgetBucket }),
] as unknown as EntitySpec<unknown>[];

const PLAN_COLUMNS = ["startDate", "endDate", "granularity", "currency"] as const;
const FX_COLUMNS = ["base", "date", "fetchedAt", "rates"] as const;

function colDdl(columns: readonly string[]): string {
  return columns.map((c) => (c === "id" ? "id INTEGER PRIMARY KEY" : `"${c}" TEXT`)).join(", ");
}

export const SCHEMA_DDL: string[] = [
  ...ENTITY_SPECS.map((s) => `CREATE TABLE IF NOT EXISTS ${s.table} (${colDdl(s.columns)})`),
  `CREATE TABLE IF NOT EXISTS plan (id INTEGER PRIMARY KEY, ${PLAN_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")})`,
  `CREATE TABLE IF NOT EXISTS fx_rates (id INTEGER PRIMARY KEY, ${FX_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")})`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
];

export const TABLE_NAMES: readonly string[] = [...ENTITY_SPECS.map((s) => s.table), "plan", "fx_rates", "meta"];

export function selectStatements(): SqlStmt[] {
  return TABLE_NAMES.map((t) => ({ sql: `SELECT * FROM ${t}` }));
}
```
- [ ] **Step 4: Run → PASS.** `npx tsc --noEmit && npm run lint` → 0. (Reconcile the V6-migration import name with Task 1; tighten any `as never`/`as unknown` casts the reviewer flags — the registry is intentionally type-erased over the union, which is acceptable for a generic driver but keep casts minimal.)
- [ ] **Step 5: Commit** `git add src/app/turso-schema.ts src/app/turso-schema.test.ts && git commit -m "feat(turso): relational schema DDL + selects (registry)"`

---

## Task 3: `workspaceToStatements` (transactional overwrite)

**Files:** Modify `src/app/turso-schema.ts`; Test `src/app/turso-schema.test.ts`.

- [ ] **Step 1: Failing test:**
```ts
import { workspaceToStatements } from "./turso-schema";
import { emptyWorkspace } from "./storage";

it("wraps writes in BEGIN/COMMIT with DELETE + INSERT + meta", () => {
  const ws = emptyWorkspace();
  ws.tasks = [{ id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" } as never];
  const sqls = workspaceToStatements(ws).map((s) => s.sql);
  expect(sqls[0]).toBe("BEGIN");
  expect(sqls[sqls.length - 1]).toBe("COMMIT");
  expect(sqls.some((s) => s.startsWith("CREATE TABLE IF NOT EXISTS tasks"))).toBe(true);
  expect(sqls).toContain("DELETE FROM tasks");
  expect(sqls.some((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
  expect(sqls.some((s) => s.startsWith("INSERT INTO meta"))).toBe(true);
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (append to `turso-schema.ts`):
```ts
const SCHEMA_VERSION = "6";

function insertStmt(table: string, columns: readonly string[], values: string[]): SqlStmt {
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
    args: columns.map((c, i) => (c === "id" ? { type: "integer", value: values[i] } : { type: "text", value: values[i] })),
  };
}

export function workspaceToStatements(ws: Workspace): SqlStmt[] {
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  for (const ddl of SCHEMA_DDL) out.push({ sql: ddl });
  for (const name of TABLE_NAMES) out.push({ sql: `DELETE FROM ${name}` });
  for (const s of ENTITY_SPECS) {
    for (const e of s.get(ws)) {
      out.push(insertStmt(s.table, s.columns, s.columns.map((c) => s.toRow(e, c))));
    }
  }
  const p = ws.plan;
  out.push(insertStmt("plan", ["id", ...PLAN_COLUMNS], ["1", p.startDate, p.endDate, p.granularity, p.currency]));
  if (ws.fxRates) {
    const fx = ws.fxRates;
    const rates = Object.entries(fx.rates).map(([k, v]) => `${k}=${v}`).join("|");
    out.push(insertStmt("fx_rates", ["id", ...FX_COLUMNS], ["1", fx.base, fx.date, fx.fetchedAt, rates]));
  }
  out.push({ sql: `INSERT INTO meta (key, value) VALUES ('schema_version', ?)`, args: [{ type: "text", value: SCHEMA_VERSION }] });
  out.push({ sql: "COMMIT" });
  return out;
}
```
- [ ] **Step 4: Run → PASS.** tsc + lint 0.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(turso): workspaceToStatements transactional overwrite"`

---

## Task 4: `rowsToWorkspace` (assemble + sanitize + migrate)

**Files:** Modify `src/app/turso-schema.ts`; Test `src/app/turso-schema.test.ts`.

- [ ] **Step 1: Failing round-trip test** (the core correctness check). Add a helper that turns the INSERTs from `workspaceToStatements` into the SELECT `PipelineResultLike`s `rowsToWorkspace` consumes (results indexed by `TABLE_NAMES` order):
```ts
import { rowsToWorkspace, selectStatements, workspaceToStatements, TABLE_NAMES, type PipelineResultLike } from "./turso-schema";
import { emptyWorkspace } from "./storage";

function resultsFromStatements(stmts): PipelineResultLike[] {
  // Collect inserted rows per table.
  const byTable: Record<string, { cols: string[]; rows: { value: string }[][] }> = {};
  for (const s of stmts) {
    const m = /^INSERT INTO (\w+) \(([^)]+)\) VALUES/.exec(s.sql ?? "");
    if (!m) continue;
    const table = m[1];
    const cols = m[2].split(", ").map((c) => c.replace(/"/g, ""));
    (byTable[table] ??= { cols, rows: [] }).rows.push((s.args ?? []).map((a) => ({ value: a.value ?? "" })));
  }
  return TABLE_NAMES.map((t) => ({
    type: "ok",
    response: { type: "execute", result: { cols: (byTable[t]?.cols ?? []).map((name) => ({ name })), rows: byTable[t]?.rows ?? [] } },
  }));
}

it("round-trips a non-trivial workspace", () => {
  const ws = emptyWorkspace();
  ws.tasks = [{ id: 1, taskName: "T", assignee: "Al", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "", labels: ["x"], dependencies: [] } as never];
  ws.resources = [{ id: 5, firstName: "Al", lastName: "B", roleId: null, utilizationMode: "percent", utilization: { "2026-02": 100 } } as never];
  const out = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));
  expect(out.tasks[0]?.id).toBe(1);
  expect(out.tasks[0]?.labels).toEqual(["x"]);
  expect(out.resources[0]?.utilization).toEqual({ "2026-02": 100 });
});

it("empty results → emptyWorkspace", () => {
  const empties: PipelineResultLike[] = selectStatements().map(() => ({ type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } }));
  const out = rowsToWorkspace(empties);
  expect(out.tasks).toEqual([]);
  expect(out.resources).toEqual([]);
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (append to `turso-schema.ts`):
```ts
function rowObjects(res: PipelineResultLike | undefined): Record<string, string>[] {
  const names = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const rows = res?.response?.result?.rows ?? [];
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    names.forEach((n, i) => {
      const cell = row[i];
      obj[n] = cell == null || cell.value == null ? "" : String(cell.value);
    });
    return obj;
  });
}

export function rowsToWorkspace(results: PipelineResultLike[]): Workspace {
  const byTable = new Map<string, PipelineResultLike>();
  TABLE_NAMES.forEach((t, i) => byTable.set(t, results[i]));

  const ws = emptyWorkspace();
  for (const s of ENTITY_SPECS) {
    const items = rowObjects(byTable.get(s.table))
      .map((o) => s.fromObj(o))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    (ws[s.wsKey] as unknown) = items;
  }
  const planRow = rowObjects(byTable.get("plan"))[0];
  if (planRow) ws.plan = sanitizePlan(planRow, new Date().toISOString().slice(0, 10));
  const fxRow = rowObjects(byTable.get("fx_rates"))[0];
  if (fxRow) {
    ws.fxRates = sanitizeFxRates({ base: fxRow.base, date: fxRow.date, fetchedAt: fxRow.fetchedAt, rates: decodeRatesMap(fxRow.rates ?? "") });
  }
  return migrateWorkspace(ws); // real V6-migration export name
}
```
- [ ] **Step 4: Run → PASS.** If a deep-equal fails it's sanitizer normalization — build the fixture from already-sanitized values so the test is identity-after-sanitize. tsc + lint 0.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(turso): rowsToWorkspace assembler (reuses sanitizers + V6 migration)"`

---

## Task 5: Rewrite `TursoBackend.load`/`save` + old-blob import

**Files:** Modify `src/app/turso-backend.ts`; Test `src/app/turso-backend.test.ts`.

- [ ] **Step 1: Update backend tests.** Replace the old blob save test body; keep auth/error/loopback tests. Add helpers + tests:
```ts
import { workspaceToJson, emptyWorkspace } from "./storage";
import { TABLE_NAMES } from "./turso-schema";

const okExec = (cols: string[] = [], rows: { value: string }[][] = []) =>
  ({ type: "ok", response: { type: "execute", result: { cols: cols.map((name) => ({ name })), rows } } });

it("save issues a BEGIN…COMMIT relational overwrite pipeline", async () => {
  fetchSpy.mockResolvedValueOnce(jsonRes({ results: [okExec()] /* count irrelevant: no error elements */ }));
  const ws = emptyWorkspace();
  ws.tasks = [{ id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" } as never];
  await new TursoBackend(CONFIG).save(ws);
  const sqls = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string).requests.map((r) => r.stmt?.sql);
  expect(sqls[0]).toBe("BEGIN");
  expect(sqls).toContain("DELETE FROM tasks");
  expect(sqls.some((s) => s?.startsWith("INSERT INTO tasks"))).toBe(true);
  expect(sqls[sqls.length - 1]).toBe("COMMIT");
});

// load(): results are [ ...SCHEMA_DDL ok, old-blob DDL ok, ...TABLE_NAMES selects, blob-probe ].
// Build the result array with that exact layout. ddlCount = SCHEMA_DDL.length + 1.
it("load assembles a workspace from relational SELECT results", async () => {
  const ddl = require("./turso-schema").SCHEMA_DDL.length + 1;
  const selects = TABLE_NAMES.map((t) => (t === "tasks"
    ? okExec(["id","taskName","assignee","assigneeEmail","dueDate","lastUpdateDate","priority","blockers","notes"], [[{value:"1"},{value:"T"},{value:""},{value:""},{value:"2026-06-01"},{value:"2026-06-01"},{value:"Medium"},{value:""},{value:""}]])
    : okExec()));
  fetchSpy.mockResolvedValueOnce(jsonRes({ results: [...Array(ddl).fill(okExec()), ...selects, okExec()] }));
  const ws = await new TursoBackend(CONFIG).load();
  expect(ws.tasks).toHaveLength(1);
});

it("imports an old single-blob workspace when relational tables are empty", async () => {
  const ddl = require("./turso-schema").SCHEMA_DDL.length + 1;
  const w = emptyWorkspace(); w.tasks = [{ id: 9, taskName: "Old", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" } as never];
  const blob = workspaceToJson(w);
  const selects = TABLE_NAMES.map(() => okExec());
  const blobProbe = okExec(["data"], [[{ value: blob }]]);
  fetchSpy.mockResolvedValueOnce(jsonRes({ results: [...Array(ddl).fill(okExec()), ...selects, blobProbe] }));
  const ws = await new TursoBackend(CONFIG).load();
  expect(ws.tasks).toHaveLength(1);
  expect(ws.tasks[0].taskName).toBe("Old");
});
```
(Adjust the tasks column header list to the real `CSV_COLUMNS` order — import `CSV_COLUMNS` and build the row generically rather than hand-listing, to avoid drift.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Rewrite `load`/`save`.** Replace ONLY the two methods (keep `kind`/ctor/`isReady`/`describe`/`runPipeline`/errors). Update imports:
```ts
import { StorageNotReadyError, emptyWorkspace, jsonToWorkspace, type StorageBackend, type Workspace } from "./storage";
import { SCHEMA_DDL, TABLE_NAMES, selectStatements, workspaceToStatements, rowsToWorkspace } from "./turso-schema";

const OLD_BLOB_DDL = "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)";
const OLD_BLOB_SELECT = "SELECT data FROM workspace WHERE id = 1";
```
```ts
  async save(workspace: Workspace): Promise<void> {
    await this.runPipeline(workspaceToStatements(workspace));
  }

  async load(): Promise<Workspace> {
    const stmts = [
      ...SCHEMA_DDL.map((sql) => ({ sql })),
      { sql: OLD_BLOB_DDL },
      ...selectStatements(),
      { sql: OLD_BLOB_SELECT },
    ];
    const results = await this.runPipeline(stmts);
    const ddlCount = SCHEMA_DDL.length + 1;        // schema DDL + old-blob DDL
    const selectCount = TABLE_NAMES.length;
    const relational = results.slice(ddlCount, ddlCount + selectCount);
    const blobResult = results[ddlCount + selectCount];
    const isEmpty = relational.every((r) => (r?.response?.result?.rows?.length ?? 0) === 0);
    if (isEmpty) {
      const blob = blobResult?.response?.result?.rows?.[0]?.[0]?.value;
      if (typeof blob === "string" && blob.length > 0) return jsonToWorkspace(blob);
      return emptyWorkspace();
    }
    return rowsToWorkspace(relational);
  }
```
(`runPipeline`'s returned `PipelineResult[]` must be structurally usable as `PipelineResultLike[]` — both expose `response.result.cols/rows`. If `turso-backend`'s internal `PipelineResult` lacks `cols`, add `cols?: { name?: string }[]` to it so `rowsToWorkspace(relational)` type-checks; or import & reuse `PipelineResultLike` from `turso-schema`.)
- [ ] **Step 4: Run → PASS.** Full suite `npx vitest run`. `npx tsc --noEmit && npm run lint` → 0.
- [ ] **Step 5: Commit** `git add src/app/turso-backend.ts src/app/turso-backend.test.ts && git commit -m "feat(turso): relational load/save + one-time old-blob import"`

---

## Task 6: Live verification against local `tursodb`

Verification only (no code unless a gap is found). Run via PowerShell (background server) + curl.

- [ ] **Step 1:** `./tursodb.exe verify.db --sync-server 127.0.0.1:8090` (background).
- [ ] **Step 2: Save** — POST the body of `workspaceToStatements(<fixture: 1 task w/ labels+deps, 1 resource w/ utilization, 1 budget bucket w/ allocation, plan, fxRates>)` shaped as `{requests: stmts.map(s => ({type:"execute", stmt:{sql:s.sql, args:s.args}}))}` to `http://127.0.0.1:8090/v2/pipeline`. Expect HTTP 200, every `results[].type==="ok"`. **Confirm `BEGIN`/`COMMIT` are accepted.** If the engine rejects `BEGIN`/`COMMIT`, drop them from `workspaceToStatements` (DELETE+INSERT without an explicit transaction is acceptable for this single-writer app) and note the change — update the Task 3 test accordingly.
- [ ] **Step 3: Tables** — POST `SELECT name FROM sqlite_master WHERE type='table'`; expect `tasks, raid, absences, shifts, resources, roles, disciplines, grades, budget_buckets, plan, fx_rates, meta`.
- [ ] **Step 4: Load** — POST `selectStatements()` + blob probe; eyeball that `tasks`/`resources`/`budget_buckets` rows carry the encoded TEXT columns (labels `x`, utilization `2026-02=100`, allocations `...`). Optionally run a throwaway node/vitest that feeds the live results through `rowsToWorkspace` and asserts round-trip.
- [ ] **Step 5:** `Stop-Process -Name tursodb -Force`; `Remove-Item verify.db*`. Record: transaction accepted? tables present? round-trip OK? Commit only if a fix was needed.

---

## Task 7: Release 0.26.0

**Files:** `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`.

- [ ] **Step 1: i18n** (BOTH files; verify ASCII `"` delimiters in `i18n.de.ts` after editing):
```ts
// EN
versionHighlightTursoRelational: "Turso storage now uses a proper relational schema (one table per entity) instead of a single JSON blob — your workspace is queryable in SQL. Existing single-blob databases are imported automatically.",
// DE
versionHighlightTursoRelational: "Der Turso-Speicher nutzt jetzt ein echtes relationales Schema (eine Tabelle pro Entität) statt eines einzelnen JSON-Blobs – Ihr Workspace ist in SQL abfragbar. Bestehende Einzel-Blob-Datenbanken werden automatisch importiert.",
```
- [ ] **Step 2: version.ts** — top comment (0.26.0 relational Turso schema; old blob auto-imported), `APP_VERSION = "0.26.0"`, keep `APP_BUILD_DATE`, append `"versionHighlightTursoRelational"` as the LAST `APP_HIGHLIGHT_KEYS` entry.
- [ ] **Step 3: CHANGELOG** — `## [0.26.0] — 2026-05-29` (match heading style): **Changed** — Turso backend now stores the workspace in a relational (hybrid) schema — one table per entity (tasks, raid, absences, shifts, resources, roles, disciplines, grades, budget_buckets, plan, fx_rates) with nested fields as encoded TEXT columns — instead of a single JSON blob; existing single-blob Turso databases import automatically on first load.
- [ ] **Step 4: Gates** — `npx vitest run && npx tsc --noEmit && npm run lint` → green / 0 / 0.
- [ ] **Step 5: Commit** `git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md && git commit -m "release: 0.26.0 — relational Turso schema"`

---

## Final Review Checklist
- [ ] DDL/INSERT/SELECT generated from the shared `*_CSV_COLUMNS` (no duplicated column lists); encode = exported `*FieldToString`, decode = exported sanitizers/builders; V6 migration applied on load.
- [ ] `save` = transactional full-overwrite (or documented non-transactional fallback if the engine rejects BEGIN/COMMIT); `load` assembles + migrates; empty DB → `emptyWorkspace()`; old 0.25.x blob imported once.
- [ ] Transport unchanged (loopback/no-token/no-`close`/Bearer-header-only/401 mapping); token never in URL.
- [ ] Live-verified against local `tursodb`.
- [ ] CSV/JSON/Markdown/browser/SharePoint backends untouched; full suite green; tsc 0; lint 0; `eslint.config.mjs` untouched; `i18n.de.ts` delimiters ASCII.

## Self-Review (plan vs spec)
- **Coverage:** shared-helper exports → T1; registry+DDL+selects → T2; transactional overwrite → T3; assemble/sanitize/migrate → T4; backend rewrite + old-blob import → T5; live verify → T6; release → T7.
- **Placeholders:** per-entity column lists are intentionally consumed at runtime from the exported `*_CSV_COLUMNS` (single source of truth) — concrete, not vague. Test fixtures use minimal valid objects (run-and-fix to match the real sanitizers), matching how the existing CSV tests are written. The V6-migration import name is flagged to reconcile in T1/T2/T4.
- **Type consistency:** `SqlStmt`/`SqlArg`/`PipelineResultLike` defined T2, used T3–T5; `ENTITY_SPECS`/`TABLE_NAMES`/`SCHEMA_DDL`/`selectStatements`/`workspaceToStatements`/`rowsToWorkspace` stable across tasks; backend delegates to exactly those; the backend's internal result type must be aligned with `PipelineResultLike` (flagged T5 Step 3).
