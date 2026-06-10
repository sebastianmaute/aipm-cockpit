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
import type { PipelineResultLike, SqlStmt } from "./turso-schema";

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
    expect(ddl).toMatch(/project_id TEXT/);
    expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${PROJECTS_TABLE} `);
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
    for (const s of stmts.filter((x) => x.sql.startsWith("DELETE"))) {
      expect(s.sql).toContain("WHERE project_id = ?");
      expect(s.args?.[s.args.length - 1]).toEqual({ type: "text", value: "p1" });
    }
    const taskInsert = stmts.find((s) => s.sql.startsWith("INSERT INTO tasks"));
    expect(taskInsert).toBeDefined();
    expect(taskInsert!.sql).toContain("project_id");
    expect(taskInsert!.args?.[taskInsert!.args.length - 1]).toEqual({ type: "text", value: "p1" });
  });

  it("round-trips a workspace through statements -> simulated rows -> rowsToWorkspace", () => {
    const ws = { ...emptyWorkspace(), plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const } };
    const results = simulateSelect(tenantWorkspaceToStatements(ws, "p1"));
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
function parseInsertCols(sql: string): string[] {
  const m = sql.match(/\(([^)]+)\)\s+VALUES/i);
  if (!m) return [];
  return m[1].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
}

function simulateSelect(stmts: SqlStmt[]): PipelineResultLike[] {
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
