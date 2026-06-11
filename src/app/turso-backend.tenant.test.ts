import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// spy:true keeps the real module (so the backend's LOAD_TIMEOUT_MS import stays
// the real constant) while wrapping runTursoPipeline in a stubable spy. An
// importOriginal factory would NOT work here: it caches the real module, so the
// backend would bypass the mock (vitest 4 module-runner behavior).
vi.mock("./turso-pipeline", { spy: true });
import { LOAD_TIMEOUT_MS, runTursoPipeline } from "./turso-pipeline";
import { TursoBackend } from "./turso-backend";
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

describe("TursoBackend (tenant mode)", () => {
  // mockClear + a base stub (NOT mockReset: on spy-mode mocks that restores the
  // real implementation, which throws/hits the network when invoked).
  beforeEach(() => {
    vi.mocked(runTursoPipeline).mockClear();
    vi.mocked(runTursoPipeline).mockImplementation(async () => []);
  });

  it("kind is turso; isReady reflects config", async () => {
    expect(new TursoBackend(cfg, "p1").kind).toBe("turso");
    expect(await new TursoBackend(cfg, "p1").isReady()).toBe(true);
    expect(await new TursoBackend(null, "p1").isReady()).toBe(false);
  });

  it("load runs DDL + scoped selects, returns empty workspace + populates ws.project from the projects row", async () => {
    const ddlCount = tenantSchemaDdl().length;
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, okEmpty),
      ...TABLE_NAMES.map(okEmpty),          // all workspace tables empty
      projectsRow("p1", meta()),            // the projects row
    ]);
    const ws = await new TursoBackend(cfg, "p1").load();
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
    await new TursoBackend(cfg, "p1").save(emptyWorkspace());
    expect(vi.mocked(runTursoPipeline).mock.calls[0][2]).toBeUndefined();
  });

  it("save runs the scoped DELETE+INSERT transaction", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([]);
    const { emptyWorkspace } = await import("./storage");
    await new TursoBackend(cfg, "p1").save(emptyWorkspace());
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[0].sql).toBe("BEGIN");
    expect(stmts.some((s) => s.sql.startsWith("DELETE FROM tasks WHERE project_id"))).toBe(true);
  });

  describe("dirty-table saves", () => {
    const minimalTask = { id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" };

    it("first save is full; second save with only tasks changed emits scoped DELETE+INSERT for tasks only", async () => {
      const { emptyWorkspace } = await import("./storage");
      const backend = new TursoBackend(cfg, "p1");
      const ws = emptyWorkspace();
      await backend.save(ws);
      const full = vi.mocked(runTursoPipeline).mock.calls[0][1];
      // first save (no baseline) = full rewrite: one scoped DELETE per table
      expect(full.filter((s) => s.sql.startsWith("DELETE FROM"))).toHaveLength(TABLE_NAMES.length);

      const ws2 = { ...ws, tasks: [minimalTask as never] };
      await backend.save(ws2);
      const sqls = vi.mocked(runTursoPipeline).mock.calls[1][1].map((s) => s.sql);
      expect(sqls[0]).toBe("BEGIN");
      expect(sqls[sqls.length - 1]).toBe("COMMIT");
      expect(sqls.filter((s) => s.startsWith("CREATE TABLE IF NOT EXISTS"))).toHaveLength(tenantSchemaDdl().length);
      expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toEqual(["DELETE FROM tasks WHERE project_id = ?"]);
      const inserts = sqls.filter((s) => s.startsWith("INSERT INTO"));
      expect(inserts).toHaveLength(1);
      expect(inserts[0].startsWith("INSERT INTO tasks")).toBe(true);
      // BEGIN + DDL + DELETE tasks + 1 task INSERT + COMMIT
      expect(sqls).toHaveLength(1 + tenantSchemaDdl().length + 1 + 1 + 1);
    });

    it("zero-change save skips the pipeline; a failed save keeps its tables dirty for the next save", async () => {
      const { emptyWorkspace } = await import("./storage");
      const backend = new TursoBackend(cfg, "p1");
      const ws = emptyWorkspace();
      await backend.save(ws);
      expect(runTursoPipeline).toHaveBeenCalledTimes(1);

      // New wrapper object, same per-table references — no pipeline call.
      await expect(backend.save({ ...ws })).resolves.toBeUndefined();
      expect(runTursoPipeline).toHaveBeenCalledTimes(1);

      const ws2 = { ...ws, tasks: [minimalTask as never] };
      vi.mocked(runTursoPipeline).mockRejectedValueOnce(new Error("boom"));
      await expect(backend.save(ws2)).rejects.toThrow("boom");

      await backend.save(ws2); // retry succeeds via the base stub
      const stmts = vi.mocked(runTursoPipeline).mock.calls[2][1];
      expect(stmts.some((s) => s.sql === "DELETE FROM tasks WHERE project_id = ?")).toBe(true);
      expect(stmts.some((s) => s.sql.startsWith("INSERT INTO tasks"))).toBe(true);
    });
  });

  describe("cross-tab write lock", () => {
    afterEach(() => {
      Reflect.deleteProperty(navigator, "locks");
    });

    it("two tabs' saves serialize through a queued lock, scoped to the tenant project", async () => {
      // A faithful little Web Locks stand-in: requests for the (single) lock
      // name queue behind one another, like two tabs contending in a browser.
      const names: string[] = [];
      let tail: Promise<unknown> = Promise.resolve();
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: {
          request: (name: string, _options: unknown, cb: () => Promise<unknown>) => {
            names.push(name);
            const run = tail.then(() => cb());
            tail = run.catch(() => undefined);
            return run;
          },
        },
      });
      const order: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      vi.mocked(runTursoPipeline)
        .mockImplementationOnce(async () => { order.push("tabA-start"); await gate; order.push("tabA-end"); return []; })
        .mockImplementationOnce(async () => { order.push("tabB"); return []; });
      const { emptyWorkspace } = await import("./storage");
      // Two backend instances = two tabs pointing at the same DB + project.
      const tabA = new TursoBackend(cfg, "p1").save(emptyWorkspace());
      const tabB = new TursoBackend(cfg, "p1").save(emptyWorkspace());
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Tab B is queued behind tab A's in-flight pipeline — not interleaved.
      expect(runTursoPipeline).toHaveBeenCalledTimes(1);
      release();
      await Promise.all([tabA, tabB]);
      expect(order).toEqual(["tabA-start", "tabA-end", "tabB"]);
      expect(names).toEqual([
        "lop-turso-write:https://x.turso.io:p1",
        "lop-turso-write:https://x.turso.io:p1",
      ]);
    });
  });
});
