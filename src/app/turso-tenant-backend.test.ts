import { vi, describe, it, expect, beforeEach } from "vitest";
// spy:true keeps the real module (so the backend's LOAD_TIMEOUT_MS import stays
// the real constant) while wrapping runTursoPipeline in a stubable spy. An
// importOriginal factory would NOT work here: it caches the real module, so the
// backend would bypass the mock (vitest 4 module-runner behavior).
vi.mock("./turso-pipeline", { spy: true });
import { LOAD_TIMEOUT_MS, runTursoPipeline } from "./turso-pipeline";
import { TursoTenantBackend } from "./turso-tenant-backend";
import { tenantSchemaDdl, upsertProjectStatement } from "./turso-tenant-schema";
import { TABLE_NAMES } from "./turso-schema";
import type { ProjectMeta } from "./types";

const cfg = { httpUrl: "https://x.turso.io", authToken: "t" };

function okEmpty() {
  return { type: "ok" as const, response: { type: "execute", result: { cols: [], rows: [] } } };
}
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
function projectsRow(id: string, m: ProjectMeta) {
  const up = upsertProjectStatement(m, id, false);
  const cols = up.sql.match(/\(([^)]+)\) VALUES/)![1].split(",").map((c) => ({ name: c.trim().replace(/"/g, "") }));
  return { type: "ok" as const, response: { type: "execute", result: { cols, rows: [up.args!.map((a) => ({ value: a.value ?? "" }))] } } };
}

describe("TursoTenantBackend", () => {
  // mockClear + a base stub (NOT mockReset: on spy-mode mocks that restores the
  // real implementation, which throws/hits the network when invoked).
  beforeEach(() => {
    vi.mocked(runTursoPipeline).mockClear();
    vi.mocked(runTursoPipeline).mockImplementation(async () => []);
  });

  it("kind is turso; isReady reflects config", async () => {
    expect(new TursoTenantBackend(cfg, "p1").kind).toBe("turso");
    expect(await new TursoTenantBackend(cfg, "p1").isReady()).toBe(true);
    expect(await new TursoTenantBackend(null, "p1").isReady()).toBe(false);
  });

  it("load runs DDL + scoped selects, returns empty workspace + populates ws.project from the projects row", async () => {
    const ddlCount = tenantSchemaDdl().length;
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, okEmpty),
      ...TABLE_NAMES.map(okEmpty),          // all workspace tables empty
      projectsRow("p1", meta()),            // the projects row
    ]);
    const ws = await new TursoTenantBackend(cfg, "p1").load();
    expect(ws.tasks).toEqual([]);
    expect(ws.project?.name).toBe("Apollo");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts.some((s) => s.sql.includes("WHERE project_id = ?"))).toBe(true);
    expect(stmts.some((s) => s.sql.includes("FROM projects WHERE id = ?"))).toBe(true);
    // load() blocks UI hydration: it must request the shorter shared load timeout.
    expect(vi.mocked(runTursoPipeline).mock.calls[0][2]).toBe(LOAD_TIMEOUT_MS);
  });

  it("save uses the default pipeline timeout (no explicit timeoutMs)", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([]);
    const { emptyWorkspace } = await import("./storage");
    await new TursoTenantBackend(cfg, "p1").save(emptyWorkspace());
    expect(vi.mocked(runTursoPipeline).mock.calls[0][2]).toBeUndefined();
  });

  it("save runs the scoped DELETE+INSERT transaction", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([]);
    const { emptyWorkspace } = await import("./storage");
    await new TursoTenantBackend(cfg, "p1").save(emptyWorkspace());
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[0].sql).toBe("BEGIN");
    expect(stmts.some((s) => s.sql.startsWith("DELETE FROM tasks WHERE project_id"))).toBe(true);
  });
});
