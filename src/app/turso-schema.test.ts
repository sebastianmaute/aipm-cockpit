import { describe, it, test, expect } from "vitest";
import { SCHEMA_DDL, TABLE_NAMES, selectStatements, workspaceToStatements, rowsToWorkspace, type PipelineResultLike } from "./turso-schema";
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
