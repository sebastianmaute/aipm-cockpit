import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// spy:true keeps the real module (so the backend's LOAD_TIMEOUT_MS import stays
// the real constant) while wrapping runTursoPipeline in a stubable spy. An
// importOriginal factory would NOT work here: it caches the real module, so the
// backend would bypass the mock (vitest 4 module-runner behavior).
vi.mock("./turso-pipeline", { spy: true });
import { LOAD_TIMEOUT_MS, runTursoPipeline } from "./turso-pipeline";
import { TursoBackend } from "./turso-backend";
import { tenantSchemaDdl, upsertProjectStatement } from "./turso-tenant-schema";
import { TABLE_NAMES, type SqlStmt } from "./turso-schema";
import { tenantTableColumns } from "./turso-migrate";
import type { ProjectMeta } from "./types";

const cfg = { httpUrl: "https://x.turso.io", authToken: "t" };

/** §4 — a backend that knows its revision (0: nothing stored yet), as after a load; a never-loaded one refuses to save. */
const loaded = (backend: TursoBackend): TursoBackend => { backend.adoptRevision("0"); return backend; };
const REVISION_UPDATE = "UPDATE meta SET value = CAST(coalesce(nullif(value, ''), '0') AS INTEGER) + 1 WHERE key = 'revision' AND project_id = ?";
const REVISION_INSERT = "INSERT INTO meta (key, value, project_id) SELECT 'revision', '1', ? WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'revision' AND project_id = ?)";

function okEmpty() {
  return { type: "ok" as const, response: { type: "execute", result: { cols: [], rows: [] } } };
}

/** Is this a column-ensure PRAGMA pipeline (every statement a PRAGMA table_info)? */
function isPragmaPipeline(stmts: readonly SqlStmt[]): boolean {
  return stmts.length > 0 && stmts.every((s) => s.sql.startsWith("PRAGMA table_info"));
}

/** PRAGMA table_info results reporting every tenant table's full column set, so
 *  the column-ensure migration emits zero ALTERs (no second round-trip). */
function upToDateTenantPragmaResults() {
  return tenantTableColumns().map((spec) => ({
    type: "ok" as const,
    response: {
      type: "execute",
      result: {
        cols: ["cid", "name", "type", "notnull", "dflt_value", "pk"].map((name) => ({ name })),
        rows: spec.columns.map((name, i) => [
          { value: String(i) }, { value: name }, { value: "TEXT" },
          { value: "0" }, { value: "" }, { value: "0" },
        ]),
      },
    },
  }));
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
    // PRAGMA pipelines (the column-ensure migration) get up-to-date results so
    // no ALTER round-trip is emitted; all other pipelines resolve to [].
    vi.mocked(runTursoPipeline).mockImplementation(async (_cfg, stmts) =>
      isPragmaPipeline(stmts) ? upToDateTenantPragmaResults() : [],
    );
  });

  /** Indices in mock.calls of the NON-PRAGMA (save/load) pipelines, in order —
   *  lets assertions ignore the once-per-instance column-ensure PRAGMA call. */
  const savePipelineCalls = () =>
    vi.mocked(runTursoPipeline).mock.calls.filter((c) => !isPragmaPipeline(c[1]));

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
    const { emptyWorkspace } = await import("./storage");
    await loaded(new TursoBackend(cfg, "p1")).save(emptyWorkspace());
    // The overwrite pipeline (after the column-ensure PRAGMA) uses the default.
    expect(savePipelineCalls()[0][2]).toBeUndefined();
  });

  it("save runs the scoped DELETE+INSERT transaction", async () => {
    const { emptyWorkspace } = await import("./storage");
    await loaded(new TursoBackend(cfg, "p1")).save(emptyWorkspace());
    const stmts = savePipelineCalls()[0][1];
    expect(stmts[0].sql).toBe("BEGIN");
    expect(stmts.some((s) => s.sql.startsWith("DELETE FROM tasks WHERE project_id"))).toBe(true);
  });

  it("§4 — the save guards and re-stamps THIS project's revision row", async () => {
    const { emptyWorkspace } = await import("./storage");
    const backend = new TursoBackend(cfg, "p1");
    backend.adoptRevision("4");
    await backend.save(emptyWorkspace());
    const stmts = savePipelineCalls()[0][1];
    const guard = stmts[1 + tenantSchemaDdl().length];
    expect(guard.sql).toContain("turso-revision-conflict:");
    expect(guard.sql).toContain("AND project_id = ?");
    expect(guard.args?.map((a) => a.value)).toEqual(["4", "p1"]);
    expect(stmts.filter((s) => s.sql === REVISION_UPDATE).map((s) => s.args?.map((a) => a.value))).toEqual([["p1"]]);
    expect(stmts.filter((s) => s.sql === REVISION_INSERT).map((s) => s.args?.map((a) => a.value))).toEqual([["p1", "p1"]]);
    expect(backend.revision()).toBe("5");
  });

  it("§4 — load reads the revision from this project's meta rows", async () => {
    const ddlCount = tenantSchemaDdl().length;
    const metaIndex = TABLE_NAMES.indexOf("meta");
    const metaRows = { type: "ok" as const, response: { type: "execute", result: {
      cols: [{ name: "key" }, { name: "value" }, { name: "project_id" }],
      rows: [[{ value: "revision" }, { value: "12" }, { value: "p1" }]],
    } } };
    vi.mocked(runTursoPipeline).mockResolvedValueOnce([
      ...Array.from({ length: ddlCount }, okEmpty),
      ...TABLE_NAMES.map((_t, i) => (i === metaIndex ? metaRows : okEmpty())),
      projectsRow("p1", meta()),
    ]);
    const backend = new TursoBackend(cfg, "p1");
    await backend.load();
    expect(backend.revision()).toBe("12");
  });

  describe("dirty-table saves", () => {
    const minimalTask = { id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" };

    it("first save is full; second save with only tasks changed emits scoped DELETE+INSERT for tasks only", async () => {
      const { emptyWorkspace } = await import("./storage");
      const backend = loaded(new TursoBackend(cfg, "p1"));
      const ws = emptyWorkspace();
      await backend.save(ws);
      const full = savePipelineCalls()[0][1];
      // first save (no baseline) = full rewrite: one scoped DELETE per table
      expect(full.filter((s) => s.sql.startsWith("DELETE FROM"))).toHaveLength(TABLE_NAMES.length);

      const ws2 = { ...ws, tasks: [minimalTask as never] };
      await backend.save(ws2);
      const sqls = savePipelineCalls()[1][1].map((s) => s.sql);
      expect(sqls[0]).toBe("BEGIN");
      expect(sqls[sqls.length - 1]).toBe("COMMIT");
      expect(sqls.filter((s) => s.startsWith("CREATE TABLE IF NOT EXISTS"))).toHaveLength(tenantSchemaDdl().length);
      expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toEqual(["DELETE FROM tasks WHERE project_id = ?"]);
      const inserts = sqls.filter((s) => s.startsWith("INSERT INTO") && s !== REVISION_INSERT);
      expect(inserts).toHaveLength(1);
      expect(inserts[0].startsWith("INSERT INTO tasks")).toBe(true);
      // BEGIN + DDL + guard + DELETE tasks + 1 task INSERT + revision UPDATE/INSERT + COMMIT
      expect(sqls).toHaveLength(1 + tenantSchemaDdl().length + 1 + 1 + 1 + 2 + 1);
    });

    it("zero-change save skips the pipeline; a failed save keeps its tables dirty for the next save", async () => {
      const { emptyWorkspace } = await import("./storage");
      const backend = loaded(new TursoBackend(cfg, "p1"));
      const ws = emptyWorkspace();
      await backend.save(ws);
      // First save: column-ensure PRAGMA + the overwrite.
      expect(runTursoPipeline).toHaveBeenCalledTimes(2);
      expect(savePipelineCalls()).toHaveLength(1);

      // New wrapper object, same per-table references — no pipeline call.
      await expect(backend.save({ ...ws })).resolves.toBeUndefined();
      expect(runTursoPipeline).toHaveBeenCalledTimes(2);

      const ws2 = { ...ws, tasks: [minimalTask as never] };
      // Migration is memoized, so this rejection hits the overwrite pipeline.
      vi.mocked(runTursoPipeline).mockRejectedValueOnce(new Error("boom"));
      await expect(backend.save(ws2)).rejects.toThrow("boom");

      await backend.save(ws2); // retry succeeds via the base stub
      const stmts = savePipelineCalls().at(-1)![1];
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
      // Each instance runs its own column-ensure PRAGMA first (per-instance memo);
      // those resolve immediately so the gate only governs the overwrite pipelines.
      let overwrites = 0;
      vi.mocked(runTursoPipeline).mockImplementation(async (_cfg, stmts) => {
        if (isPragmaPipeline(stmts)) return upToDateTenantPragmaResults();
        overwrites += 1;
        if (overwrites === 1) { order.push("tabA-start"); await gate; order.push("tabA-end"); return []; }
        order.push("tabB");
        return [];
      });
      const { emptyWorkspace } = await import("./storage");
      // Two backend instances = two tabs pointing at the same DB + project.
      const tabA = loaded(new TursoBackend(cfg, "p1")).save(emptyWorkspace());
      const tabB = loaded(new TursoBackend(cfg, "p1")).save(emptyWorkspace());
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Tab A (holding the lock) has run its column-ensure PRAGMA and started the
      // gated overwrite; tab B is queued behind the lock — not interleaved.
      expect(runTursoPipeline).toHaveBeenCalledTimes(2);
      release();
      await Promise.all([tabA, tabB]);
      expect(order).toEqual(["tabA-start", "tabA-end", "tabB"]);
      expect(names).toEqual([
        "aipm-turso-write:https://x.turso.io:p1",
        "aipm-turso-write:https://x.turso.io:p1",
      ]);
    });
  });
});
