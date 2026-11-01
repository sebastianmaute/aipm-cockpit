// src/app/turso-portfolio.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn() }));
import { runTursoPipeline } from "./turso-pipeline";
import {
  listProjectRefs, listProjects, listArchivedProjects, createProject, updateProjectMeta,
  archiveProject, restoreProject, hardDeleteProject, readPortfolioActivityLogs, activityLogsStatement,
} from "./turso-portfolio";
import * as diagnostics from "./diagnostics";
import { upsertProjectStatement } from "./turso-tenant-schema";
import { PROJECT_SCOPED_SIDE_TABLES, sideTableColumns } from "./project-side-tables";
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
    expect(sweep.map((s) => s.sql)).toEqual(
      PROJECT_SCOPED_SIDE_TABLES.map((e) => `DELETE FROM ${e.table} WHERE ${sideTableColumns(e).map((c) => `${c} = ?`).join(" OR ")}`),
    );
    sweep.forEach((s, i) => expect(s.args).toEqual(sideTableColumns(PROJECT_SCOPED_SIDE_TABLES[i]).map(() => ({ type: "text", value: "p1" }))));
    expect(sweep.find((s) => s.sql.startsWith("DELETE FROM person_links"))?.sql).toBe("DELETE FROM person_links WHERE project_a = ? OR project_b = ?");
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
    expect(out[0]).not.toHaveProperty("logUnreadable");
    expect(out[0]).not.toHaveProperty("entriesDropped");
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
    expect(out[0].logUnreadable).toBe(true); // flagged: an empty list must not read as "no activity"
    expect(spy).toHaveBeenCalledWith("warn", "storage.activityAuditLogUnreadable", { projectId: "p1", error: "SyntaxError" }); // the name, never the message: it quotes stored data
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
    expect(out.map((p) => [p.id, p.log.length, p.logUnreadable ?? false])).toEqual([["p1", 0, false], ["p2", 0, true]]);
    expect(spy.mock.calls.filter((c) => c[1] === "storage.activityAuditLogUnreadable").map((c) => (c[2] as { projectId: string }).projectId)).toEqual(["p2"]);
    spy.mockRestore();
  });

  it("counts stored entries the sanitizer dropped, so a short log says why", async () => {
    const ddlCount = (await import("./turso-tenant-schema")).tenantSchemaDdl().length;
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, () => ({ type: "ok" as const })),
      projectsResult("p1", meta()),
      { type: "ok" as const, response: { type: "execute", result: { cols: [], rows: [] } } },
      logsResult([["p1", JSON.stringify([logEntry, { nonsense: true }])]]),
    ]);
    const [p1] = await readPortfolioActivityLogs(cfg);
    expect(p1.log).toHaveLength(1);
    expect(p1.entriesDropped).toBe(1);
  });
});

describe("listProjectRefs (§772 review wave 2)", () => {
  beforeEach(() => vi.mocked(runTursoPipeline).mockReset());

  it("reads both lists in ONE pipeline and keeps a project whose meta no longer decodes", async () => {
    const ddlCount = (await import("./turso-tenant-schema")).tenantSchemaDdl().length;
    const broken = { type: "ok" as const, response: { type: "execute", result: { cols: [{ name: "id" }, { name: "archived" }], rows: [[{ value: "p3" }, { value: "0" }]] } } };
    const active = projectsResult("p1", meta());
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, () => ({ type: "ok" as const })),
      { ...active, response: { ...active.response, result: { ...active.response.result, rows: [...active.response.result.rows, broken.response.result.rows[0]] } } },
      projectsResult("p2", meta(), true),
    ]);
    const refs = await listProjectRefs(cfg);
    expect(vi.mocked(runTursoPipeline)).toHaveBeenCalledTimes(1);
    expect(refs.active.map((p) => p.id)).toEqual(["p1", "p3"]); // p3 has no decodable meta and is still listed
    expect(refs.active.find((p) => p.id === "p3")?.name).toBe("");
    expect(refs.active.find((p) => p.id === "p1")?.name).toBe("Apollo");
    expect(refs.archived.map((p) => p.id)).toEqual(["p2"]);
  });
});
