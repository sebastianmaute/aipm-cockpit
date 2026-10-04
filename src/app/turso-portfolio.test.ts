// src/app/turso-portfolio.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn() }));
import { runTursoPipeline } from "./turso-pipeline";
import {
  listProjects, listArchivedProjects, createProject, updateProjectMeta,
  archiveProject, restoreProject, hardDeleteProject, readPortfolioActivityLogs, activityLogsStatement,
} from "./turso-portfolio";
import * as diagnostics from "./diagnostics";
import { upsertProjectStatement } from "./turso-tenant-schema";
import { PROJECT_SCOPED_SIDE_TABLES } from "./project-side-tables";
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

/** A projects-table SELECT result mirroring upsertProjectStatement's columns. */
function projectsResult(id: string, m: ProjectMeta, archived = false) {
  const up = upsertProjectStatement(m, id, archived);
  const cols = up.sql.match(/\(([^)]+)\) VALUES/)![1].split(",").map((c) => ({ name: c.trim().replace(/"/g, "") }));
  return { type: "ok" as const, response: { type: "execute", result: { cols, rows: [up.args!.map((a) => ({ value: a.value }))] } } };
}

describe("turso-portfolio", () => {
  beforeEach(() => vi.mocked(runTursoPipeline).mockReset());

  it("listProjects decodes the projects SELECT (last result) into entries", async () => {
    const ddlCount = (await import("./turso-tenant-schema")).tenantSchemaDdl().length;
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, () => ({ type: "ok" as const })),
      projectsResult("p1", meta()),
    ]);
    const list = await listProjects(cfg);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("p1");
    expect(list[0].meta.name).toBe("Apollo");
  });

  it("createProject emits an upsert with archived='0'", async () => {
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
    // hardDeleteProject now issues a SECOND runTursoPipeline call (the
    // side-table sweep below), so the tenant-delete statements are no longer
    // the LAST call — take the first call made after this point, not .at(-1).
    const callsBeforeDelete = vi.mocked(runTursoPipeline).mock.calls.length;
    await hardDeleteProject(cfg, "p1");
    const deleteCalls = vi.mocked(runTursoPipeline).mock.calls.slice(callsBeforeDelete);
    expect(deleteCalls[0][1].some((s) => s.sql.includes("DELETE FROM projects WHERE id = ?"))).toBe(true);
  });

  it("hardDeleteProject sends its deletes as ONE transaction: BEGIN first, COMMIT last, the DDL inside (§637)", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([]);
    await hardDeleteProject(cfg, "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[0].sql).toBe("BEGIN");
    expect(stmts.at(-1)!.sql).toBe("COMMIT");
    expect(stmts.filter((s) => /^\s*BEGIN\b/i.test(s.sql))).toHaveLength(1);
    expect(stmts.some((s) => s.sql.startsWith("CREATE TABLE IF NOT EXISTS"))).toBe(true);
  });

  it("hardDeleteProject also cleans the project's asset bytes, scoped to that project id", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([]);
    await hardDeleteProject(cfg, "p1");
    const calls = vi.mocked(runTursoPipeline).mock.calls;
    const assetStmt = calls
      .flatMap((c) => c[1])
      .find((s) => s.sql.includes("DELETE FROM document_asset_data WHERE project_id = ?"));
    expect(assetStmt).toBeDefined();
    expect(assetStmt!.args).toEqual([{ type: "text", value: "p1" }]);
  });

  it("hardDeleteProject still completes (and still removes the project row) when the side-table sweep fails", async () => {
    // First runTursoPipeline call = the tenant hard-delete transaction; second =
    // the side-table sweep's own pipeline call, which rejects here.
    vi.mocked(runTursoPipeline)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("asset cleanup boom"));
    await expect(hardDeleteProject(cfg, "p1")).resolves.toBeUndefined();
    const firstCallStmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(firstCallStmts.some((s) => s.sql.includes("DELETE FROM projects WHERE id = ?"))).toBe(true);
    expect(vi.mocked(runTursoPipeline)).toHaveBeenCalledTimes(2);
  });

  it("hardDeleteProject sweeps every project-scoped side table in ONE second pipeline (§204)", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([]);
    await hardDeleteProject(cfg, "p1");
    const calls = vi.mocked(runTursoPipeline).mock.calls;
    expect(calls).toHaveLength(2);
    const sweep = calls[1][1].filter((s) => s.sql.startsWith("DELETE"));
    expect(sweep.map((s) => s.sql)).toEqual(PROJECT_SCOPED_SIDE_TABLES.map((e) => `DELETE FROM ${e.table} WHERE project_id = ?`));
    for (const s of sweep) expect(s.args).toEqual([{ type: "text", value: "p1" }]);
  });

  it("updateProjectMeta emits an upsert with archived='0'", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([]);
    await updateProjectMeta(cfg, meta(), "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    const up = stmts.find((s) => s.sql.includes("INTO projects"));
    expect(up).toBeDefined();
    expect(up!.args?.[1]).toEqual({ type: "text", value: "0" });
  });

  it("listArchivedProjects uses the archived='1' select", async () => {
    const ddlCount = (await import("./turso-tenant-schema")).tenantSchemaDdl().length;
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, () => ({ type: "ok" as const })),
      projectsResult("p9", meta()),
    ]);
    const list = await listArchivedProjects(cfg);
    expect(list).toHaveLength(1);
    const stmts = vi.mocked(runTursoPipeline).mock.calls.at(-1)![1];
    expect(stmts.some((s) => s.sql.includes("\"archived\" = '1'"))).toBe(true);
  });
});

// open-followups §510 — the portfolio read behind the internal activity-log download.
describe("readPortfolioActivityLogs (§510)", () => {
  beforeEach(() => vi.mocked(runTursoPipeline).mockReset());

  const logEntry = { id: "d-1-1", timestamp: "2026-10-03T08:00:00.000Z", kind: "task.updated", args: [7, "Kickoff"], actor: "user", changes: [{ field: "status", from: "To Do", to: "Done" }] };
  const logsResult = (rows: [string, string][]) => ({
    type: "ok" as const,
    response: { type: "execute", result: { cols: [{ name: "project_id" }, { name: "value" }], rows: rows.map(([id, v]) => [{ value: id }, { value: v }]) } },
  });

  it("lists every project, archived ones flagged, each with its own decoded log — and only projects that exist", async () => {
    const ddlCount = (await import("./turso-tenant-schema")).tenantSchemaDdl().length;
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, () => ({ type: "ok" as const })),
      projectsResult("p1", meta()),
      projectsResult("p2", { ...meta(), name: "Zeus" }, true),
      logsResult([["p1", JSON.stringify([logEntry])], ["gone", JSON.stringify([logEntry])]]),
    ]);
    const out = await readPortfolioActivityLogs(cfg);
    expect(out.map((p) => [p.id, p.name, p.archived, p.log.length])).toEqual([["p1", "Apollo", false, 1], ["p2", "Zeus", true, 0]]);
    expect(out[0].log[0]).toMatchObject({ id: "d-1-1", changes: [{ field: "status", from: "To Do", to: "Done" }] });
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts.at(-1)).toEqual(activityLogsStatement());
    expect(stmts.some((s) => /^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql))).toBe(false); // changes no data
  });

  it("lists a project whose stored log does not decode as empty, and logs it, rather than failing the download", async () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    const ddlCount = (await import("./turso-tenant-schema")).tenantSchemaDdl().length;
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, () => ({ type: "ok" as const })),
      projectsResult("p1", meta()),
      { type: "ok" as const, response: { type: "execute", result: { cols: [], rows: [] } } },
      logsResult([["p1", "{not json"]]),
    ]);
    const out = await readPortfolioActivityLogs(cfg);
    expect(out.map((p) => [p.id, p.log.length])).toEqual([["p1", 0]]);
    expect(spy).toHaveBeenCalledWith("warn", "storage.activityAuditLogUnreadable", expect.objectContaining({ projectId: "p1" }));
    spy.mockRestore();
  });

  it("lists a SQL NULL log as empty without a warning, and a non-array log as empty with one", async () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    const ddlCount = (await import("./turso-tenant-schema")).tenantSchemaDdl().length;
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, () => ({ type: "ok" as const })),
      projectsResult("p1", meta()),
      projectsResult("p2", { ...meta(), name: "Zeus" }),
      logsResult([["p1", ""], ["p2", "{\"not\":\"an array\"}"]]),
    ]);
    const out = await readPortfolioActivityLogs(cfg);
    expect(out.map((p) => [p.id, p.log.length])).toEqual([["p1", 0], ["p2", 0]]);
    expect(spy.mock.calls.filter((c) => c[1] === "storage.activityAuditLogUnreadable").map((c) => (c[2] as { projectId: string }).projectId)).toEqual(["p2"]);
    spy.mockRestore();
  });
});
