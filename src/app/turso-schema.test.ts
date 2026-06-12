import { describe, it, test, expect } from "vitest";
import { SCHEMA_DDL, TABLE_NAMES, selectStatements, workspaceToStatements, rowsToWorkspace, dirtyWorkspaceTables, type PipelineResultLike } from "./turso-schema";
import { emptyWorkspace } from "./storage";

function resultsFromStatements(stmts: { sql: string; args?: { value?: string }[] }[]): PipelineResultLike[] {
  const byTable: Record<string, { cols: string[]; rows: { value: string }[][] }> = {};
  for (const s of stmts) {
    const m = /^INSERT INTO (\w+) \(([^)]+)\) VALUES/.exec(s.sql);
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

describe("rowsToWorkspace", () => {
  it("round-trips a non-trivial workspace (statements → results → workspace)", () => {
    const ws = emptyWorkspace();
    ws.tasks = [{ id: 1, taskName: "T", assignee: "Al", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "", labels: ["x"], dependencies: [] } as never];
    ws.resources = [{ id: 5, firstName: "Al", lastName: "B", roleId: null, utilizationMode: "percent", utilization: { "2026-02": 100 } } as never];
    ws.raid = [{ id: 2, category: "R", title: "Risk", status: "Open", raisedDate: "2026-06-01", linkedTaskIds: [], severity: "Low", probability: "Low", impact: "Low" } as never];
    ws.fxRates = { base: "EUR", date: "2026-05-29", fetchedAt: "2026-05-29T00:00:00.000Z", rates: { EUR: 1, USD: 1.08 } } as never;
    const out = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].id).toBe(1);
    expect(out.tasks[0].labels).toEqual(["x"]);
    expect(out.resources[0].utilization).toEqual({ "2026-02": 100 });
    expect(out.raid).toHaveLength(1);
    expect(out.raid[0].id).toBe(2);
    expect(out.fxRates?.base).toBe("EUR");
    expect(out.fxRates?.rates.USD).toBeCloseTo(1.08);
    expect(out.plan).toBeTruthy();
  });

  it("empty results → emptyWorkspace", () => {
    const empties: PipelineResultLike[] = selectStatements().map(() => ({ type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } }));
    const out = rowsToWorkspace(empties);
    expect(out.tasks).toEqual([]);
    expect(out.resources).toEqual([]);
  });
});

describe("workspaceToStatements", () => {
  it("wraps writes in BEGIN/COMMIT with DELETE + INSERT + meta", () => {
    const ws = emptyWorkspace();
    ws.tasks = [{ id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" } as never];
    const sqls = workspaceToStatements(ws).map((s) => s.sql);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
    expect(sqls.some((s) => s.startsWith("CREATE TABLE IF NOT EXISTS tasks"))).toBe(true);
    expect(sqls).toContain("DELETE FROM tasks");
    expect(sqls.some((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
    expect(sqls.some((s) => s.startsWith("INSERT INTO plan"))).toBe(true);
    expect(sqls.some((s) => s.startsWith("INSERT INTO meta"))).toBe(true);
  });

  it("INSERT arg count matches the column count and id is an integer arg", () => {
    const ws = emptyWorkspace();
    ws.tasks = [{ id: 7, taskName: "X", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Low", blockers: "", notes: "" } as never];
    const stmt = workspaceToStatements(ws).find((s) => s.sql.startsWith("INSERT INTO tasks"))!;
    const colCount = (stmt.sql.match(/\?/g) ?? []).length;
    expect(stmt.args?.length).toBe(colCount);
    const idArg = stmt.args?.[0];
    expect(idArg).toEqual({ type: "integer", value: "7" });
  });
});

describe("dirtyWorkspaceTables", () => {
  it("returns an empty set when every section keeps its reference", () => {
    const ws = emptyWorkspace();
    expect(dirtyWorkspaceTables(ws, { ...ws }).size).toBe(0);
  });

  it("flags a replaced entity array with its table name", () => {
    const ws = emptyWorkspace();
    const next = { ...ws, tasks: [...ws.tasks] };
    expect([...dirtyWorkspaceTables(ws, next)]).toEqual(["tasks"]);
  });

  it("maps budgets to the budget_buckets table", () => {
    const ws = { ...emptyWorkspace(), budgets: [] };
    const next = { ...ws, budgets: [] }; // new array reference, same (empty) content
    expect([...dirtyWorkspaceTables(ws, next)]).toEqual(["budget_buckets"]);
  });

  it("maps the singletons: plan → plan, fxRates → fx_rates, status → meta", () => {
    const ws = emptyWorkspace();
    const next = {
      ...ws,
      plan: { ...ws.plan },
      fxRates: { base: "EUR", date: "2026-06-01", fetchedAt: "2026-06-01T00:00:00.000Z", rates: { EUR: 1 } } as never,
      status: { ...(ws.status ?? {}) },
    };
    const dirty = dirtyWorkspaceTables(ws, next);
    expect(dirty.has("plan")).toBe(true);
    expect(dirty.has("fx_rates")).toBe(true);
    expect(dirty.has("meta")).toBe(true);
    expect(dirty.size).toBe(3);
  });
});

describe("workspaceToStatements with a dirty-table filter", () => {
  const task = { id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" };
  const raidItem = { id: 2, category: "R", title: "Risk", status: "Open", raisedDate: "2026-06-01", linkedTaskIds: [], severity: "Low", probability: "Low", impact: "Low" };

  it("emits DDL always but DELETE+INSERT only for dirty tables", () => {
    const ws = emptyWorkspace();
    ws.tasks = [task as never];
    ws.raid = [raidItem as never];
    const sqls = workspaceToStatements(ws, new Set(["tasks"])).map((s) => s.sql);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
    expect(sqls.filter((s) => s.startsWith("CREATE TABLE IF NOT EXISTS"))).toHaveLength(SCHEMA_DDL.length);
    expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toEqual(["DELETE FROM tasks"]);
    expect(sqls.some((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
    expect(sqls.some((s) => s.startsWith("INSERT INTO raid"))).toBe(false);
    expect(sqls.some((s) => s.startsWith("INSERT INTO plan"))).toBe(false);
    expect(sqls.some((s) => s.startsWith("INSERT INTO meta"))).toBe(false);
    // BEGIN + DDL + DELETE tasks + 1 task INSERT + COMMIT
    expect(sqls).toHaveLength(1 + SCHEMA_DDL.length + 1 + 1 + 1);
  });

  it("an empty filter yields a DDL-only transaction (no DELETE/INSERT)", () => {
    const sqls = workspaceToStatements(emptyWorkspace(), new Set()).map((s) => s.sql);
    expect(sqls.some((s) => s.startsWith("DELETE FROM"))).toBe(false);
    expect(sqls.some((s) => s.startsWith("INSERT INTO"))).toBe(false);
    expect(sqls).toHaveLength(1 + SCHEMA_DDL.length + 1);
  });

  it("omitting the filter keeps the full-overwrite behavior", () => {
    const sqls = workspaceToStatements(emptyWorkspace()).map((s) => s.sql);
    expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toHaveLength(TABLE_NAMES.length);
    expect(sqls.some((s) => s.startsWith("INSERT INTO plan"))).toBe(true);
    expect(sqls.some((s) => s.startsWith("INSERT INTO meta"))).toBe(true);
  });
});

describe("milestones round-trip", () => {
  test("full round-trip restores milestones", () => {
    const ws = { ...emptyWorkspace(), milestones: [{ id: 1, name: "Go-live", date: "2026-08-01", linkedTaskIds: [2, 3] }] };
    const back = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));
    expect(back.milestones).toEqual(ws.milestones);
  });
});

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

  test("full round-trip restores project status via rowsToWorkspace", () => {
    const ws = {
      ...emptyWorkspace(),
      status: {
        ragOverride: "A" as const,
        scheduleOverride: "R" as const,
        narrative: "watch the risk",
        narrativeUpdatedAt: "2026-06-02T10:00:00.000Z",
      },
    };
    const back = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));
    expect(back.status).toEqual(ws.status);
  });
});

describe("changes turso table", () => {
  it("registers a 'changes' table", () => {
    expect(TABLE_NAMES).toContain("changes");
  });
  it("emits CREATE TABLE for changes", () => {
    expect(SCHEMA_DDL.some((d) => /CREATE TABLE IF NOT EXISTS changes \(/.test(d))).toBe(true);
  });
});

describe("stakeholders turso table", () => {
  it("registers a 'stakeholders' table in TABLE_NAMES", () => {
    expect(TABLE_NAMES).toContain("stakeholders");
  });

  it("excludes project_versions from TABLE_NAMES so a workspace save cannot clear history", () => {
    // Version history is an append-only side table; if it ever enters TABLE_NAMES
    // the per-save DELETE FROM sweep would wipe it (same rule as snapshot tables).
    expect(TABLE_NAMES).not.toContain("project_versions");
  });

  it("full round-trip restores stakeholders", () => {
    const sample = {
      id: 1, name: "Sponsor Sam", organization: "Acme", title: "VP",
      email: "sam@acme.test", category: "Sponsor", influence: "High",
      interest: "Medium", notes: "key approver", resourceId: 4,
      raci: { "10": "A", "12": "C" }, localModifiedAt: "2026-06-04T00:00:00.000Z",
    };
    const ws = { ...emptyWorkspace(), stakeholders: [sample as never] };
    const back = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));
    expect(back.stakeholders).toHaveLength(1);
    expect(back.stakeholders![0].id).toBe(1);
    expect(back.stakeholders![0].name).toBe("Sponsor Sam");
    expect(back.stakeholders![0].raci).toEqual({ "10": "A", "12": "C" });
    expect(back.stakeholders![0].resourceId).toBe(4);
  });
});

describe("turso fieldVisibility (meta KV)", () => {
  it("marks meta dirty when fieldVisibility changes by reference", () => {
    const a = emptyWorkspace();
    const b = { ...a, fieldVisibility: { task: { fields: ["taskName"] } } };
    expect(dirtyWorkspaceTables(a, b).has("meta")).toBe(true);
  });

  it("full round-trip restores fieldVisibility via rowsToWorkspace", () => {
    const ws = {
      ...emptyWorkspace(),
      fieldVisibility: { task: { fields: ["taskName", "assignee"] } },
    };
    const back = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));
    expect(back.fieldVisibility?.task.fields).toEqual(["taskName", "assignee"]);
  });
});

describe("turso features (meta KV)", () => {
  it("marks meta dirty when features changes by reference", () => {
    const a = emptyWorkspace();
    const b = { ...a, features: ["raid"] as const };
    expect(dirtyWorkspaceTables(a, b).has("meta")).toBe(true);
  });

  it("round-trips features incl. explicit empty via meta KV", () => {
    const ws1 = { ...emptyWorkspace(), features: ["raid"] as const };
    const back1 = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws1)));
    expect(back1.features).toEqual(["raid"]);

    const ws2 = { ...emptyWorkspace(), features: [] as const };
    const back2 = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws2)));
    expect(back2.features).toEqual([]); // explicit empty preserved
  });
});
