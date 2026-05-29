import { describe, it, expect } from "vitest";
import { SCHEMA_DDL, TABLE_NAMES, selectStatements, workspaceToStatements } from "./turso-schema";
import { emptyWorkspace } from "./storage";

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
