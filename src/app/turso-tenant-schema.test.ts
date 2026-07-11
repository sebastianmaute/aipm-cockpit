// src/app/turso-tenant-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  tenantSchemaDdl, tenantSelectStatements, tenantWorkspaceToStatements,
  listProjectsStatement, listArchivedProjectsStatement, upsertProjectStatement,
  archiveProjectStatement, restoreProjectStatement, hardDeleteProjectStatements,
  rowsToProjectList, PROJECTS_TABLE, selectProjectStatement,
} from "./turso-tenant-schema";
import { TABLE_NAMES, rowsToWorkspace } from "./turso-schema";
import { emptyWorkspace, PROJECT_CSV_COLUMNS, buildProjectFromObj } from "./storage";
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

  it("entity tables use a composite (id, project_id) PK, not a colliding single id PK", () => {
    const ddl = tenantSchemaDdl().join("\n");
    expect(ddl).toContain("PRIMARY KEY (id, project_id)");
    expect(ddl).not.toContain("id INTEGER PRIMARY KEY");
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
        status: "To Do" as const, priority: "Medium" as const, blockers: "", notes: "",
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

  it("dirty-table filter: DDL always, scoped DELETE+INSERT only for dirty tables", () => {
    const ws = { ...emptyWorkspace(),
      tasks: [{ id: 1, taskName: "T1", assignee: "", assigneeEmail: "",
        dueDate: "2026-06-01", lastUpdateDate: "2026-01-01",
        status: "To Do" as const, priority: "Medium" as const, blockers: "", notes: "" } as never] };
    const stmts = tenantWorkspaceToStatements(ws, "p1", new Set(["tasks"]));
    const sqls = stmts.map((s) => s.sql);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
    expect(sqls.filter((s) => s.startsWith("CREATE TABLE IF NOT EXISTS"))).toHaveLength(tenantSchemaDdl().length);
    expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toEqual(["DELETE FROM tasks WHERE project_id = ?"]);
    expect(sqls.some((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
    expect(sqls.some((s) => s.startsWith("INSERT INTO plan"))).toBe(false);
    expect(sqls.some((s) => s.startsWith("INSERT INTO meta"))).toBe(false);
    // BEGIN + DDL + DELETE tasks + 1 task INSERT + COMMIT
    expect(sqls).toHaveLength(1 + tenantSchemaDdl().length + 1 + 1 + 1);
  });

  it("dirty-table filter omitted: full scoped overwrite (one DELETE per table)", () => {
    const sqls = tenantWorkspaceToStatements(emptyWorkspace(), "p1").map((s) => s.sql);
    expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toHaveLength(TABLE_NAMES.length);
    expect(sqls.some((s) => s.startsWith("INSERT INTO plan"))).toBe(true);
  });

  it("round-trips a workspace through statements -> simulated rows -> rowsToWorkspace", () => {
    const ws = { ...emptyWorkspace(), plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const } };
    const results = simulateSelect(tenantWorkspaceToStatements(ws, "p1"));
    const decoded = rowsToWorkspace(results);
    expect(decoded.plan.startDate).toBe("2026-01-01");
    expect(decoded.plan.currency).toBe("EUR");
  });

  it("round-trips plan.budgetFollowsPlan === true through the tenant path", () => {
    const ws = { ...emptyWorkspace(), plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const, budgetFollowsPlan: true } };
    const results = simulateSelect(tenantWorkspaceToStatements(ws, "p1"));
    const decoded = rowsToWorkspace(results);
    expect(decoded.plan.budgetFollowsPlan).toBe(true);
  });

  it("round-trips per-project field_visibility and features through the tenant path", () => {
    const ws = {
      ...emptyWorkspace(),
      fieldVisibility: { task: { fields: ["taskName"] } },
      features: ["raid"] as const,
    };
    const results = simulateSelect(tenantWorkspaceToStatements(ws, "p1"));
    const decoded = rowsToWorkspace(results);
    expect(decoded.fieldVisibility?.task.fields).toEqual(["taskName"]);
    expect(decoded.features).toEqual(["raid"]);
  });

  it("round-trips the steering committee through the tenant path", () => {
    const ws = {
      ...emptyWorkspace(),
      steeringCommittee: {
        name: "Board",
        memberResourceIds: [1, 2],
        meetings: [{ id: 1, date: "2026-07-10", title: "July" }],
        infoSchedules: [{ id: 1, label: "Pack", leadDays: 3 }],
      },
    };
    const results = simulateSelect(tenantWorkspaceToStatements(ws, "p1"));
    const decoded = rowsToWorkspace(results);
    expect(decoded.steeringCommittee?.name).toBe("Board");
    expect(decoded.steeringCommittee?.meetings[0].title).toBe("July");
    expect(decoded.steeringCommittee?.infoSchedules[0].leadDays).toBe(3);
  });

  it("persists an empty features array (not dropped) through the tenant path", () => {
    const ws = { ...emptyWorkspace(), features: [] as const };
    const results = simulateSelect(tenantWorkspaceToStatements(ws, "p1"));
    const decoded = rowsToWorkspace(results);
    expect(decoded.features).toEqual([]);
  });

  it("scopes field_visibility + features meta rows by project_id (no cross-leak)", () => {
    const ws1 = { ...emptyWorkspace(), features: ["raid"] as const, fieldVisibility: { task: { fields: ["taskName"] } } };
    const ws2 = { ...emptyWorkspace(), features: ["budget"] as const };
    const all = [...tenantWorkspaceToStatements(ws1, "p1"), ...tenantWorkspaceToStatements(ws2, "p2")];
    const decoded1 = rowsToWorkspace(simulateScopedSelect(all, tenantSelectStatements("p1")));
    const decoded2 = rowsToWorkspace(simulateScopedSelect(all, tenantSelectStatements("p2")));
    expect(decoded1.features).toEqual(["raid"]);
    expect(decoded1.fieldVisibility?.task.fields).toEqual(["taskName"]);
    expect(decoded2.features).toEqual(["budget"]);
    expect(decoded2.fieldVisibility).toBeUndefined();
  });

  it("two projects in one DB stay isolated on scoped load", () => {
    const ws1 = { ...emptyWorkspace(), plan: { startDate: "2026-01-01", endDate: "2026-06-30", granularity: "month" as const, currency: "EUR" as const } };
    const ws2 = { ...emptyWorkspace(), plan: { startDate: "2027-01-01", endDate: "2027-06-30", granularity: "week" as const, currency: "USD" as const } };
    const all = [...tenantWorkspaceToStatements(ws1, "p1"), ...tenantWorkspaceToStatements(ws2, "p2")];
    const decoded1 = rowsToWorkspace(simulateScopedSelect(all, tenantSelectStatements("p1")));
    const decoded2 = rowsToWorkspace(simulateScopedSelect(all, tenantSelectStatements("p2")));
    expect(decoded1.plan.startDate).toBe("2026-01-01");
    expect(decoded1.plan.currency).toBe("EUR");
    expect(decoded2.plan.startDate).toBe("2027-01-01");
    expect(decoded2.plan.currency).toBe("USD");
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

  it("selectProjectStatement scopes by id", () => {
    const s = selectProjectStatement("p1");
    expect(s.sql).toContain(`FROM ${PROJECTS_TABLE} WHERE id = ?`);
    expect(s.args?.[0]).toEqual({ type: "text", value: "p1" });
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

  it("rowsToProjectList keeps a project with empty required arrays that the STRICT decoder would reject", () => {
    // meta() already has empty keyStakeholdersInternal/External, regulatory, and
    // identityTypes — the three arrays that the strict sanitizer rejects when empty.
    const m = meta();
    const up = upsertProjectStatement(m, "p1", false);
    const colNames = parseInsertCols(up.sql);
    const argVals = up.args!.map((a) => String(a.value ?? ""));

    // Build the plain Record<string,string> that the decoder receives.
    const rowObj: Record<string, string> = {};
    colNames.forEach((c, i) => { rowObj[c] = argVals[i]; });

    // The strict path (buildProjectFromObj) must reject this row because the
    // required arrays are empty — that is the whole point of the lenient branch.
    expect(buildProjectFromObj(rowObj)).toBeNull();

    // The lenient path (via rowsToProjectList) must keep it.
    const cols = colNames.map((name) => ({ name }));
    const rows = [up.args!.map((a) => ({ value: a.value ?? "" }))];
    const list = rowsToProjectList({ type: "ok", response: { type: "execute", result: { cols, rows } } });
    expect(list).toHaveLength(1);
    expect(list[0].meta.name).toBe(m.name);
  });
});

// --- test helpers ---------------------------------------------------------
function parseInsertCols(sql: string): string[] {
  const m = sql.match(/\(([^)]+)\)\s+VALUES/i);
  if (!m) return [];
  return m[1].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
}

/** Replay INSERTs from possibly-many projects, then answer a project-scoped
 *  SELECT set by returning only the rows whose trailing project_id arg matches
 *  that SELECT's project_id arg. Mirrors real WHERE project_id = ? semantics. */
function simulateScopedSelect(insertStmts: SqlStmt[], selectStmts: SqlStmt[]): PipelineResultLike[] {
  const byTable = new Map<string, { cols: { name: string }[]; rows: { values: { value: unknown }[]; projectId: unknown }[] }>();
  for (const s of insertStmts) {
    const m = s.sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i);
    if (!m || !s.args) continue;
    const table = m[1];
    const cols = m[2].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const entry = byTable.get(table) ?? { cols: cols.map((name) => ({ name })), rows: [] };
    entry.rows.push({ values: s.args.map((a) => ({ value: a.value ?? "" })), projectId: s.args[s.args.length - 1].value });
    byTable.set(table, entry);
  }
  return selectStmts.map((sel) => {
    const m = sel.sql.match(/FROM (\w+)/i);
    const table = m ? m[1] : "";
    const pid = sel.args?.[0]?.value;
    const entry = byTable.get(table);
    const rows = entry ? entry.rows.filter((r) => r.projectId === pid).map((r) => r.values) : [];
    return { type: "ok" as const, response: { type: "execute", result: { cols: entry?.cols ?? [], rows } } };
  });
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
