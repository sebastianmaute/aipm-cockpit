// Day keys in allocation actualHours must survive all six write paths, and
// budgetHours must keep refusing them. A key the codec rejects is dropped
// silently on save, so this is the guard for the whole dated-actuals change.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DatabaseSync } from "node:sqlite";
import { csvToWorkspace, markdownToWorkspace, workspaceToCsv, workspaceToMarkdown } from "./storage";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";
import { ENTITY_SPECS, SCHEMA_DDL, workspaceToStatements, type SqlStmt } from "./turso-schema";
import { tenantSchemaDdl, tenantWorkspaceToStatements } from "./turso-tenant-schema";
import { BrowserBackend } from "./browser-backend";
import type { BudgetBucket } from "./types";

const DETAILED_ACTUAL = { "2026-01": 2, "2026-01-05": 3, "2026-02-02": 1.5 };
const BLENDED_ACTUAL = { "2026-01-06": 4 };

function wsWithDayKeys(): Workspace {
  const detailed = {
    id: 1, name: "Detailed", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    allocations: [{ roleId: 3, resourceIds: [5], budgetHours: { "2026-01": 40, "2026-01-05": 9 }, actualHours: DETAILED_ACTUAL }],
  } as unknown as BudgetBucket;
  const blended = {
    id: 2, name: "Blended", type: "tm", currency: "EUR", planningMode: "blended",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open", allocations: [],
    disciplineAllocations: [{ disciplineId: 4, resourceIds: [], budgetHours: { "2026-01": 8 }, actualHours: BLENDED_ACTUAL }],
  } as unknown as BudgetBucket;
  return { ...emptyWorkspace(), budgets: [detailed, blended] };
}

function expectDayKeysKept(budgets: readonly BudgetBucket[] | undefined): void {
  const byId = new Map((budgets ?? []).map((b) => [b.id, b]));
  expect(byId.get(1)?.allocations[0].actualHours).toEqual(DETAILED_ACTUAL);
  expect(byId.get(2)?.disciplineAllocations?.[0].actualHours).toEqual(BLENDED_ACTUAL);
}

function bindArg(arg: { type: string; value?: string }): string | bigint | null {
  if (arg.type === "null" || arg.value === undefined) return null;
  if (arg.type === "integer" && /^-?\d+$/.test(arg.value)) return BigInt(arg.value);
  return arg.value;
}

function runStatements(db: DatabaseSync, statements: readonly SqlStmt[]): void {
  for (const s of statements) {
    if (!s.args || s.args.length === 0) db.exec(s.sql);
    else db.prepare(s.sql).run(...s.args.map(bindArg));
  }
}

function budgetsFromRows(rows: readonly Record<string, unknown>[]): BudgetBucket[] {
  const spec = ENTITY_SPECS.find((s) => s.table === "budget_buckets");
  if (!spec) throw new Error("budget_buckets spec missing");
  const stringRow = (r: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? "" : String(v)]));
  return rows.map((r) => spec.fromObj(stringRow(r)) as BudgetBucket).filter((b) => b !== null);
}

describe("allocation actualHours day keys survive every backend", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("JSON", () => {
    expectDayKeysKept(jsonToWorkspace(workspaceToJson(wsWithDayKeys())).budgets);
  });

  it("CSV", () => {
    expectDayKeysKept(csvToWorkspace(workspaceToCsv(wsWithDayKeys())).budgets);
  });

  it("Markdown", () => {
    expectDayKeysKept(markdownToWorkspace(workspaceToMarkdown(wsWithDayKeys())).budgets);
  });

  it("Turso single-tenant", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const ddl of SCHEMA_DDL) db.exec(ddl);
      runStatements(db, workspaceToStatements(wsWithDayKeys()));
      expectDayKeysKept(budgetsFromRows(db.prepare("SELECT * FROM budget_buckets").all()));
    } finally {
      db.close();
    }
  });

  it("Turso multi-tenant", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const ddl of tenantSchemaDdl()) db.exec(ddl);
      runStatements(db, tenantWorkspaceToStatements(wsWithDayKeys(), "proj-dated-1"));
      const rows = db.prepare("SELECT * FROM budget_buckets WHERE project_id = ?").all("proj-dated-1");
      expectDayKeysKept(budgetsFromRows(rows));
    } finally {
      db.close();
    }
  });

  it("IndexedDB", async () => {
    await new BrowserBackend().save(wsWithDayKeys());
    expectDayKeysKept((await new BrowserBackend().load()).budgets);
  });
});

describe("budgetHours stays period-only", () => {
  it("drops a day key from budgetHours on the CSV and JSON load paths", () => {
    const csv = csvToWorkspace(workspaceToCsv(wsWithDayKeys())).budgets?.find((b) => b.id === 1);
    const json = jsonToWorkspace(workspaceToJson(wsWithDayKeys())).budgets?.find((b) => b.id === 1);
    expect(csv?.allocations[0].budgetHours).toEqual({ "2026-01": 40 });
    expect(json?.allocations[0].budgetHours).toEqual({ "2026-01": 40 });
  });
});
