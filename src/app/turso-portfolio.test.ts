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

/** A projects-table SELECT result mirroring upsertProjectStatement's columns. */
function projectsResult(id: string, m: ProjectMeta) {
  const up = upsertProjectStatement(m, id, false);
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
    await hardDeleteProject(cfg, "p1");
    expect(vi.mocked(runTursoPipeline).mock.calls.at(-1)![1].some((s) => s.sql.includes("DELETE FROM projects WHERE id = ?"))).toBe(true);
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
