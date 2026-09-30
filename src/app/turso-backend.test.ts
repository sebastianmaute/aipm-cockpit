import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TursoBackend, TursoLockTimeoutError, tursoWriteLockName } from "./turso-backend";
import { StorageNotReadyError, emptyWorkspace, workspaceToJson } from "./storage";
import type { TursoConfig } from "./turso-config";
import { REVISION_CONFLICT_MARKER, SCHEMA_DDL, TABLE_NAMES } from "./turso-schema";
import { SaveConflictError } from "./storage-error";
import { singleTenantTableColumns } from "./turso-migrate";
import { LOAD_TIMEOUT_MS } from "./turso-pipeline";
import * as diagnostics from "./diagnostics";
import { failedBatchBody, okPipelineBody, pipelineSqls } from "../test/turso-wire";

const CONFIG: TursoConfig = { httpUrl: "https://db.turso.io", authToken: "tok" };

/** §4 — a backend that knows its revision (0: nothing stored yet), as after a load; a never-loaded one refuses to save. */
const loaded = (backend: TursoBackend): TursoBackend => { backend.adoptRevision("0"); return backend; };
/** §4 — every save stamps the revision row: the guard after the DDL, then this UPDATE + seeding INSERT before COMMIT. */
const REVISION_UPDATE = "UPDATE meta SET value = CAST(coalesce(nullif(value, ''), '0') AS INTEGER) + 1 WHERE key = 'revision'";
const REVISION_INSERT = "INSERT INTO meta (key, value) SELECT 'revision', '1' WHERE NOT EXISTS (SELECT 1 FROM meta WHERE key = 'revision')";

/** ★★★ BOTH `json` AND `text` ARE REQUIRED, and the cast is why nothing says so.
 *  A real `Response` carries both; this object literal is asserted `as unknown as
 *  Response`, so tsc cannot tell us a member is missing. `runTursoPipeline` reads
 *  the body as TEXT inside its armed timeout window (`postPipeline` returns
 *  `{status, ok, text}`, never a `Response`) — so a `json`-only double makes
 *  `res.text` undefined, the TypeError is swallowed by `runTursoPipeline`'s own
 *  catch, and EVERY pipeline-reaching test in this file fails as
 *  `storage-unreachable` rather than as a missing mock member.
 *  ★ Modelling both is deliberate: this helper's job is to stand in for a real
 *  response, NOT to pin which accessor the transport happens to call, so it stays
 *  green if that choice ever changes. What pins the choice is
 *  `turso-pipeline.test.ts`'s stalled-body test.
 *  ★ `snapshot-store.test.ts` sidesteps all of this by constructing a REAL
 *  `Response`, which is the better pattern where the body is a plain string. */
function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A PRAGMA table_info result reporting exactly `columns` (cid,name,type,...). */
function pragmaRes(columns: readonly string[]) {
  return {
    type: "ok",
    response: {
      type: "execute",
      result: {
        cols: ["cid", "name", "type", "notnull", "dflt_value", "pk"].map((name) => ({ name })),
        rows: columns.map((name, i) => [
          { value: String(i) }, { value: name }, { value: "TEXT" },
          { value: "0" }, { value: "" }, { value: "0" },
        ]),
      },
    },
  };
}

/** The PRAGMA pipeline response the column-ensure migration expects: one result
 *  per entity table, each reporting that table's full (up-to-date) column set so
 *  buildColumnEnsureAlters emits ZERO ALTERs (no second migration round-trip). */
function upToDatePragma() {
  return jsonRes({ results: singleTenantTableColumns().map((s) => pragmaRes(s.columns)) });
}

describe("TursoBackend", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const okExec = (cols: string[] = [], rows: { value: string }[][] = []) =>
    ({ type: "ok", response: { type: "execute", result: { cols: cols.map((name) => ({ name })), rows } } });
  const minimalTask = { id: 1, taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" };

  /** Build a full set of mock results for a load() call (ddls + selects + blob probe). */
  function makeLoadResults(selectOverrides: Partial<Record<string, ReturnType<typeof okExec>>> = {}, blobResult = okExec()) {
    const ddlCount = SCHEMA_DDL.length + 1;
    const ddls = Array(ddlCount).fill(okExec());
    const selects = TABLE_NAMES.map((t) => selectOverrides[t] ?? okExec());
    return [...ddls, ...selects, blobResult];
  }

  it("isReady reflects config presence", async () => {
    expect(await new TursoBackend(null).isReady()).toBe(false);
    expect(await new TursoBackend(CONFIG).isReady()).toBe(true);
  });

  it("save issues a BEGIN…COMMIT relational overwrite pipeline", async () => {
    fetchSpy.mockResolvedValueOnce(upToDatePragma());
    fetchSpy.mockImplementationOnce((_url: unknown, init?: RequestInit) => jsonRes(okPipelineBody(init)));
    const ws = emptyWorkspace();
    ws.tasks = [minimalTask as never];
    await loaded(new TursoBackend(CONFIG)).save(ws);
    const sqls = pipelineSqls(fetchSpy.mock.calls[1][1] as RequestInit);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls).toContain("DELETE FROM tasks");
    // §637 — the save goes out as ONE batch request, never as separate execute requests.
    const requests = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string).requests;
    expect(requests).toHaveLength(1);
    expect(requests[0].type).toBe("batch");
    expect(sqls.some((s: string) => s?.startsWith("INSERT INTO tasks"))).toBe(true);
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
  });

  it("load assembles a workspace from relational SELECT results", async () => {
    const taskCols = ["id", "taskName", "assignee", "assigneeEmail", "dueDate", "lastUpdateDate", "priority", "blockers", "notes"];
    const taskRow = [{ value: "1" }, { value: "T" }, { value: "" }, { value: "" }, { value: "2026-06-01" }, { value: "2026-06-01" }, { value: "Medium" }, { value: "" }, { value: "" }];
    const results = makeLoadResults({ tasks: okExec(taskCols, [taskRow]) });
    fetchSpy.mockResolvedValueOnce(jsonRes({ results }));
    const ws = await new TursoBackend(CONFIG).load();
    expect(ws.tasks).toHaveLength(1);
    expect(ws.tasks[0].id).toBe(1);
  });

  it("imports an old single-blob workspace when relational tables are empty", async () => {
    const w = emptyWorkspace();
    w.tasks = [{ ...minimalTask, id: 9, taskName: "Old" } as never];
    const blob = workspaceToJson(w);
    const blobProbe = okExec(["data"], [[{ value: blob }]]);
    const results = makeLoadResults({}, blobProbe);
    fetchSpy.mockResolvedValueOnce(jsonRes({ results }));
    const ws = await new TursoBackend(CONFIG).load();
    expect(ws.tasks).toHaveLength(1);
    expect(ws.tasks[0].taskName).toBe("Old");
  });

  it("returns emptyWorkspace when relational tables AND old blob are empty", async () => {
    const results = makeLoadResults();
    fetchSpy.mockResolvedValueOnce(jsonRes({ results }));
    const ws = await new TursoBackend(CONFIG).load();
    expect(ws.tasks).toEqual([]);
  });

  it("publishes the slices whose meta blob could not be decoded", async () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    try {
      const badMeta = okExec(["key", "value"], [[{ value: "documents" }, { value: "{not json" }]]);
      const results = makeLoadResults({ meta: badMeta });
      fetchSpy.mockResolvedValueOnce(jsonRes({ results }));
      const backend = new TursoBackend(CONFIG);
      await backend.load();
      expect(backend.lastDecodeFailures).toEqual(["documents"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("resets the published decode failures on a clean load", async () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    try {
      const badMeta = okExec(["key", "value"], [[{ value: "documents" }, { value: "{not json" }]]);
      fetchSpy.mockResolvedValueOnce(jsonRes({ results: makeLoadResults({ meta: badMeta }) }));
      const backend = new TursoBackend(CONFIG);
      await backend.load();
      expect(backend.lastDecodeFailures).toEqual(["documents"]);

      fetchSpy.mockResolvedValueOnce(jsonRes({ results: makeLoadResults() }));
      await backend.load();
      expect(backend.lastDecodeFailures).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("omits the Authorization header for a token-less loopback config", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: makeLoadResults() }));
    await new TursoBackend({ httpUrl: "http://127.0.0.1:8080", authToken: "" }).load();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8080/v2/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("sends the Authorization header when a token is configured", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: makeLoadResults() }));
    await new TursoBackend(CONFIG).load();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("maps 401 to StorageNotReadyError", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({}, 401));
    await expect(new TursoBackend(CONFIG).load()).rejects.toBeInstanceOf(StorageNotReadyError);
  });

  it("throws on a libSQL error result", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [{ type: "error", error: { message: "boom" } }] }));
    await expect(new TursoBackend(CONFIG).load()).rejects.toThrow(/boom/);
  });

  it("throws StorageNotReadyError when not configured", async () => {
    await expect(new TursoBackend(null).load()).rejects.toBeInstanceOf(StorageNotReadyError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("load sends schema DDL statements before SELECT statements", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: makeLoadResults() }));
    await new TursoBackend(CONFIG).load();
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const sqls: string[] = body.requests.map((r: { stmt?: { sql: string } }) => r.stmt?.sql ?? "");
    expect(sqls[0]).toContain("CREATE TABLE IF NOT EXISTS");
    expect(sqls.some((s) => s.startsWith("SELECT * FROM tasks"))).toBe(true);
  });

  it("load aborts a hung endpoint after the load timeout and surfaces storage-unreachable", async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    const pending = new TursoBackend(CONFIG).load();
    const expectation = expect(pending).rejects.toMatchObject({ hint: "storage-unreachable" });
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    await expectation;
  });

  it("maps a fetch network rejection to StorageNotReadyError('storage-unreachable')", async () => {
    const backend = loaded(new TursoBackend({ httpUrl: "http://127.0.0.1:8080", authToken: "" }));
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(backend.save(emptyWorkspace())).rejects.toMatchObject({ hint: "storage-unreachable" });
  });

  describe("dirty-table saves", () => {
    const okSave = (_url: unknown, init?: RequestInit) => jsonRes(okPipelineBody(init));
    /** SQL of every statement in the pipeline body of fetch call N. */
    const bodySqls = (call: number): string[] =>
      pipelineSqls(fetchSpy.mock.calls[call][1] as RequestInit);

    it("first save (no baseline) is a full rewrite", async () => {
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementation(okSave);
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await loaded(new TursoBackend(CONFIG)).save(ws);
      const sqls = bodySqls(1); // call 0 is the column-ensure PRAGMA pipeline
      // BEGIN + DDL + guard + one DELETE per table + 1 task INSERT + plan + 2 meta rows + revision UPDATE/INSERT + COMMIT
      expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toHaveLength(TABLE_NAMES.length);
      expect(sqls).toHaveLength(1 + SCHEMA_DDL.length + 1 + TABLE_NAMES.length + 1 + 1 + 2 + 2 + 1);
    });

    it("second save with only a new tasks array emits DDL + DELETE/INSERT for tasks only", async () => {
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementation(okSave);
      const backend = loaded(new TursoBackend(CONFIG));
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await backend.save(ws);
      const ws2 = { ...ws, tasks: [ws.tasks[0], { ...minimalTask, id: 2 } as never] };
      await backend.save(ws2);
      // call 0 PRAGMA, call 1 first save, call 2 second save (migration memoized).
      const sqls = bodySqls(2);
      expect(sqls[0]).toBe("BEGIN");
      expect(sqls[sqls.length - 1]).toBe("COMMIT");
      expect(sqls.filter((s) => s.startsWith("CREATE TABLE IF NOT EXISTS"))).toHaveLength(SCHEMA_DDL.length);
      expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toEqual(["DELETE FROM tasks"]);
      const inserts = sqls.filter((s) => s.startsWith("INSERT INTO") && s !== REVISION_INSERT);
      expect(inserts).toHaveLength(2);
      expect(inserts.every((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
      // BEGIN + DDL + guard + DELETE tasks + 2 task INSERTs + revision UPDATE/INSERT + COMMIT
      expect(sqls).toHaveLength(1 + SCHEMA_DDL.length + 1 + 1 + 2 + 2 + 1);
    });

    it("a save with zero changes performs no pipeline call but still resolves", async () => {
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementation(okSave);
      const backend = loaded(new TursoBackend(CONFIG));
      const ws = emptyWorkspace();
      await backend.save(ws);
      // First save: column-ensure PRAGMA pipeline + the overwrite pipeline.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // New wrapper object, same per-table references — nothing dirty: no round-trip.
      await expect(backend.save({ ...ws })).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("a failed save does not advance the baseline — the next save retries the dirty tables", async () => {
      fetchSpy.mockResolvedValueOnce(upToDatePragma()); // call 0: column-ensure PRAGMA
      fetchSpy.mockImplementationOnce(okSave); // call 1: first save's overwrite
      const backend = loaded(new TursoBackend(CONFIG));
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await backend.save(ws);
      const ws2 = { ...ws, tasks: [{ ...minimalTask, taskName: "edited" } as never] };
      fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch")); // call 2: failed save (migration memoized)
      await expect(backend.save(ws2)).rejects.toMatchObject({ hint: "storage-unreachable" });
      fetchSpy.mockImplementationOnce(okSave); // call 3: retry
      await backend.save(ws2);
      const sqls = bodySqls(3);
      expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toEqual(["DELETE FROM tasks"]);
      expect(sqls.some((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
    });

    it("a save whose batch step fails is rejected and does not advance the baseline (§637)", async () => {
      fetchSpy.mockResolvedValueOnce(upToDatePragma()); // call 0: column-ensure PRAGMA
      fetchSpy.mockImplementationOnce(okSave); // call 1: first save's overwrite
      const backend = loaded(new TursoBackend(CONFIG));
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await backend.save(ws);
      const ws2 = { ...ws, tasks: [{ ...minimalTask, taskName: "edited" } as never] };
      fetchSpy.mockImplementationOnce((_url: unknown, init?: RequestInit) =>
        jsonRes(failedBatchBody(init, 2, "datatype mismatch"))); // call 2: a statement step fails
      await expect(backend.save(ws2)).rejects.toThrow("Turso error: datatype mismatch");
      fetchSpy.mockImplementationOnce(okSave); // call 3: retry
      await backend.save(ws2);
      expect(bodySqls(3).filter((s) => s.startsWith("DELETE FROM"))).toEqual(["DELETE FROM tasks"]);
    });
  });

  describe("cross-tab write lock", () => {
    const okSave = (_url: unknown, init?: RequestInit) => jsonRes(okPipelineBody(init));
    /** Install a navigator.locks mock (jsdom does not implement the Web Locks API). */
    const defineLocks = (
      request: (
        name: string,
        options: { mode?: string; signal?: AbortSignal },
        cb: () => Promise<unknown>,
      ) => Promise<unknown>,
    ) => {
      Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    };
    afterEach(() => {
      Reflect.deleteProperty(navigator, "locks");
    });

    it("save acquires the per-DB exclusive lock with a bounded wait; a no-change save skips it", async () => {
      const seen: { name: string; mode?: string; boundedWait: boolean }[] = [];
      defineLocks(async (name, options, cb) => {
        seen.push({ name, mode: options.mode, boundedWait: options.signal instanceof AbortSignal });
        return cb();
      });
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementation(okSave);
      const backend = loaded(new TursoBackend(CONFIG));
      const ws = emptyWorkspace();
      await backend.save(ws);
      // One lock acquisition wraps both the column-ensure PRAGMA and the overwrite.
      expect(seen).toEqual([
        { name: "aipm-turso-write:https://db.turso.io:single", mode: "exclusive", boundedWait: true },
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // Zero-change save: no pipeline round-trip, so no lock acquisition either.
      await backend.save({ ...ws });
      expect(seen).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("falls back to a direct save when navigator.locks is unavailable (jsdom default)", async () => {
      expect((navigator as { locks?: unknown }).locks).toBeUndefined();
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementation(okSave);
      await expect(loaded(new TursoBackend(CONFIG)).save(emptyWorkspace())).resolves.toBeUndefined();
      // column-ensure PRAGMA + overwrite, both without a lock.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("a lock-wait abort rejects with TursoLockTimeoutError, writes nothing, and keeps the baseline", async () => {
      defineLocks(async () => {
        throw new DOMException("the lock wait timed out", "TimeoutError");
      });
      const backend = loaded(new TursoBackend(CONFIG));
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await expect(backend.save(ws)).rejects.toBeInstanceOf(TursoLockTimeoutError);
      // The lock wait aborts before the locked critical section, so neither the
      // column-ensure PRAGMA nor the overwrite ever runs.
      expect(fetchSpy).not.toHaveBeenCalled();
      // Baseline did not advance: the retry is still a full first save.
      defineLocks(async (_name, _options, cb) => cb());
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementation(okSave);
      await backend.save(ws);
      // call 0: column-ensure PRAGMA, call 1: the overwrite.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const sqls = pipelineSqls(fetchSpy.mock.calls[1][1] as RequestInit);
      expect(sqls).toContain("DELETE FROM tasks");
    });

    it("an error thrown inside the locked save passes through unchanged", async () => {
      defineLocks(async (_name, _options, cb) => cb());
      fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(loaded(new TursoBackend(CONFIG)).save(emptyWorkspace()))
        .rejects.toMatchObject({ hint: "storage-unreachable" });
    });

    it("scopes the lock name by DB URL and project id", () => {
      expect(tursoWriteLockName("https://db.turso.io", undefined)).toBe("aipm-turso-write:https://db.turso.io:single");
      expect(tursoWriteLockName("https://db.turso.io", "p1")).toBe("aipm-turso-write:https://db.turso.io:p1");
      expect(tursoWriteLockName("https://db.turso.io", "p1"))
        .not.toBe(tursoWriteLockName("https://db.turso.io", "p2"));
      expect(tursoWriteLockName("https://other.turso.io", "p1"))
        .not.toBe(tursoWriteLockName("https://db.turso.io", "p1"));
    });
  });

  describe("column-ensure migration on save", () => {
    const okSave = (_url: unknown, init?: RequestInit) => jsonRes(okPipelineBody(init));
    /** SQL of every statement in the pipeline body of fetch call N. */
    const bodySqls = (call: number): string[] =>
      pipelineSqls(fetchSpy.mock.calls[call][1] as RequestInit);

    /** Single-tenant PRAGMA responses where `milestones` is missing outlookEventId. */
    function pragmaMissingOutlookEventId() {
      return jsonRes({
        results: singleTenantTableColumns().map((s) =>
          pragmaRes(s.table === "milestones" ? s.columns.filter((c) => c !== "outlookEventId") : s.columns),
        ),
      });
    }

    it("ALTERs in the missing column before the INSERTs when an existing DB lacks it", async () => {
      fetchSpy.mockResolvedValueOnce(pragmaMissingOutlookEventId()); // call 0: PRAGMA read
      fetchSpy.mockImplementationOnce(okSave); // call 1: ALTER pipeline
      fetchSpy.mockImplementationOnce(okSave); // call 2: overwrite
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await loaded(new TursoBackend(CONFIG)).save(ws);

      // call 0 is PRAGMA table_info, one per entity table.
      expect(bodySqls(0).every((s) => s.startsWith("PRAGMA table_info"))).toBe(true);
      // call 1 issues exactly the one missing ALTER, wrapped in a transaction.
      expect(bodySqls(1)).toEqual(["BEGIN", 'ALTER TABLE "milestones" ADD COLUMN "outlookEventId" TEXT', "COMMIT"]);
      // The ALTER pipeline (call 1) precedes the INSERT overwrite (call 2).
      expect(bodySqls(2).some((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("issues NO ALTER (and no second migration round-trip) when the DB is up to date", async () => {
      fetchSpy.mockResolvedValueOnce(upToDatePragma()); // call 0: PRAGMA read — all columns present
      fetchSpy.mockImplementationOnce(okSave); // call 1: overwrite (no ALTER pipeline)
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await loaded(new TursoBackend(CONFIG)).save(ws);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(bodySqls(0).every((s) => s.startsWith("PRAGMA table_info"))).toBe(true);
      expect(bodySqls(1).some((s) => s.startsWith("INSERT INTO"))).toBe(true);
      expect(bodySqls(1).some((s) => s.startsWith("ALTER TABLE"))).toBe(false);
    });

    it("runs the column-ensure PRAGMA only once per backend instance", async () => {
      fetchSpy.mockResolvedValueOnce(upToDatePragma()); // call 0: PRAGMA (first save only)
      fetchSpy.mockImplementation(okSave);
      const backend = loaded(new TursoBackend(CONFIG));
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await backend.save(ws);
      const ws2 = { ...ws, tasks: [{ ...minimalTask, taskName: "edited" } as never] };
      await backend.save(ws2);
      const pragmaCalls = fetchSpy.mock.calls.filter((_c, i) =>
        bodySqls(i).every((s) => s.startsWith("PRAGMA table_info")),
      );
      expect(pragmaCalls).toHaveLength(1);
    });

    it("tenant-mode save ensures project_id is present and ALTERs the missing spec column", async () => {
      const { tenantTableColumns } = await import("./turso-migrate");
      const tenantPragma = jsonRes({
        results: tenantTableColumns().map((s) =>
          pragmaRes(s.table === "milestones" ? s.columns.filter((c) => c !== "outlookEventId") : s.columns),
        ),
      });
      fetchSpy.mockResolvedValueOnce(tenantPragma); // call 0: PRAGMA
      fetchSpy.mockImplementationOnce(okSave); // call 1: ALTER
      fetchSpy.mockImplementationOnce(okSave); // call 2: overwrite
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await loaded(new TursoBackend(CONFIG, "proj-1")).save(ws);
      expect(bodySqls(1)).toEqual(["BEGIN", 'ALTER TABLE "milestones" ADD COLUMN "outlookEventId" TEXT', "COMMIT"]);
      // The overwrite is project-scoped.
      expect(bodySqls(2).some((s) => s.includes("WHERE project_id = ?"))).toBe(true);
    });

    it("a failed migration does not stick — the next save retries the PRAGMA", async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch")); // call 0: PRAGMA rejects
      const backend = loaded(new TursoBackend(CONFIG));
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await expect(backend.save(ws)).rejects.toMatchObject({ hint: "storage-unreachable" });
      fetchSpy.mockResolvedValueOnce(upToDatePragma()); // call 1: retry PRAGMA
      fetchSpy.mockImplementationOnce(okSave); // call 2: overwrite
      await backend.save(ws);
      expect(bodySqls(1).every((s) => s.startsWith("PRAGMA table_info"))).toBe(true);
      expect(bodySqls(2).some((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
    });
  });

  // §4 — the revision checked INSIDE the save's batch (turso-schema's `withRevision`).
  describe("§4 revision", () => {
    const okSave = (_url: unknown, init?: RequestInit) => jsonRes(okPipelineBody(init));
    /** A statement list with its args, as sent (a batch's own trailing ROLLBACK left out). */
    const sent = (call: number): { sql: string; args?: { value?: string }[] }[] => {
      const requests = JSON.parse((fetchSpy.mock.calls[call][1] as RequestInit).body as string).requests;
      return requests.flatMap((r: { type: string; stmt?: unknown; batch?: { steps: { stmt: unknown }[] } }) =>
        r.type === "batch" ? (r.batch?.steps ?? []).slice(0, -1).map((s) => s.stmt) : [r.stmt]);
    };
    const argsOf = (call: number, match: (sql: string) => boolean) =>
      sent(call).filter((s) => match(s.sql)).map((s) => (s.args ?? []).map((a) => a.value));
    const isGuard = (sql: string) => sql.includes(REVISION_CONFLICT_MARKER);
    const guardIndex = 1 + SCHEMA_DDL.length;
    /** Answers the backend's one-off revision read (DDL + SELECT) with `value` in the last result. */
    const revisionRead = (value: string | null) => (_url: unknown, init?: RequestInit) => {
      const body = okPipelineBody(init);
      if (value !== null) body.results[body.results.length - 1] = okExec(["value"], [[{ value }]]);
      return jsonRes(body);
    };
    /** An all-ok answer to a save whose blind stamp reads back `value` (the step before COMMIT). */
    const okSaveReadingBack = (value: string) => (_url: unknown, init?: RequestInit) => {
      const body = okPipelineBody(init) as { results: { response: { result: { step_results: unknown[] } } }[] };
      const steps = pipelineSqls(init);
      body.results[0].response.result.step_results[steps.length - 2] = { cols: [{ name: "value" }], rows: [[{ value }]] };
      return jsonRes(body);
    };
    const metaWithRevision = (value: string) =>
      okExec(["key", "value"], [[{ value: "revision" }, { value }]]);
    async function loadedAt(value: string, config: TursoConfig = CONFIG): Promise<TursoBackend> {
      fetchSpy.mockResolvedValueOnce(jsonRes({ results: makeLoadResults({ meta: metaWithRevision(value) }) }));
      const backend = new TursoBackend(config);
      await backend.load();
      return backend;
    }
    const withTask = () => ({ ...emptyWorkspace(), tasks: [minimalTask as never] });

    it("load adopts the stored revision; a missing row reads as 0; a failed load leaves it unknown", async () => {
      const backend = await loadedAt("3");
      expect(backend.revision()).toBe("3");
      fetchSpy.mockResolvedValueOnce(jsonRes({ results: makeLoadResults() }));
      await backend.load();
      expect(backend.revision()).toBe("0");
      fetchSpy.mockResolvedValueOnce(jsonRes({ results: [{ type: "error", error: { message: "boom" } }] }));
      await expect(backend.load()).rejects.toThrow(/boom/);
      expect(backend.revision()).toBeNull();
    });

    it("a save guards on the loaded revision right after the DDL and stamps the next one", async () => {
      const backend = await loadedAt("3");
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementationOnce(okSave);
      await backend.save(withTask());
      const stmts = sent(2);
      expect(stmts.findIndex((s) => isGuard(s.sql))).toBe(guardIndex);
      expect(argsOf(2, isGuard)).toEqual([["3"]]);
      // The stamp is computed by the database (stored + 1); a guarded save reads nothing back.
      expect(stmts.slice(-3, -1).map((s) => s.sql)).toEqual([REVISION_UPDATE, REVISION_INSERT]);
      expect(backend.revision()).toBe("4");
    });

    it("a never-loaded instance refuses to save, names the stored revision, and sends no write", async () => {
      fetchSpy.mockImplementation(revisionRead("5"));
      const err = await new TursoBackend(CONFIG).save(withTask()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SaveConflictError);
      expect((err as SaveConflictError).currentRevision).toBe("5");
      expect(fetchSpy.mock.calls.every((_c, i) => !pipelineSqls(fetchSpy.mock.calls[i][1] as RequestInit).includes("BEGIN"))).toBe(true);
    });

    it("the guard's failure is a SaveConflictError naming the stored revision — recognised by its STEP, not its text", async () => {
      const SECRET = { httpUrl: "https://db.turso.io", authToken: "sekrit-token-4711" };
      const backend = await loadedAt("3", SECRET);
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      // ★ No marker in the server's wording: a libSQL that phrases the error its own way is still a conflict.
      fetchSpy.mockImplementationOnce((_url: unknown, init?: RequestInit) =>
        jsonRes(failedBatchBody(init, guardIndex, "SQLite error: some wording of its own")));
      fetchSpy.mockImplementationOnce(revisionRead("4"));
      const err = await backend.save(withTask()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SaveConflictError);
      expect((err as SaveConflictError).currentRevision).toBe("4");
      expect(backend.revision()).toBe("3");
      const text = `${String(err)} ${JSON.stringify(err)} ${(err as Error).stack ?? ""}`;
      expect(text).not.toContain("sekrit-token-4711");
      // Nothing adopted: the next save still guards on 3, and is still a full rewrite (the baseline did not move).
      fetchSpy.mockImplementationOnce(okSave);
      await backend.save(withTask());
      expect(argsOf(4, isGuard)).toEqual([["3"]]);
      expect(pipelineSqls(fetchSpy.mock.calls[4][1] as RequestInit).filter((s) => s.startsWith("DELETE FROM")))
        .toHaveLength(TABLE_NAMES.length);
    });

    it("a failing body statement is NOT a conflict, even when its text carries the marker", async () => {
      const backend = await loadedAt("3");
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementationOnce((_url: unknown, init?: RequestInit) => {
        const insertAt = pipelineSqls(init).findIndex((sql) => sql.startsWith("INSERT INTO tasks"));
        return jsonRes(failedBatchBody(init, insertAt, `datatype mismatch near '${REVISION_CONFLICT_MARKER}3'`));
      });
      const err = await backend.save(withTask()).catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(SaveConflictError);
      expect((err as Error).message).toBe(`Turso error: datatype mismatch near '${REVISION_CONFLICT_MARKER}3'`);
      expect(fetchSpy).toHaveBeenCalledTimes(3); // no stored-revision read: not treated as a refusal
      expect(backend.revision()).toBe("3");
    });

    it("a refusal whose stored revision cannot be read carries null", async () => {
      const backend = await loadedAt("3");
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementationOnce((_url: unknown, init?: RequestInit) =>
        jsonRes(failedBatchBody(init, guardIndex, `bad JSON path: '${REVISION_CONFLICT_MARKER}4'`)));
      fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const err = await backend.save(withTask()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SaveConflictError);
      expect((err as SaveConflictError).currentRevision).toBeNull();
    });

    it("forceNextSave() omits the guard, rewrites every table, and stamps past the stored revision", async () => {
      const backend = await loadedAt("3");
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementationOnce(okSave);
      const ws = withTask();
      await backend.save(ws); // call 2: stamps 4, and sets the dirty baseline
      backend.forceNextSave();
      // call 3: one round-trip — no pre-read; the database stamps stored + 1 and the batch reads it back.
      fetchSpy.mockImplementationOnce(okSaveReadingBack("10"));
      await backend.save({ ...ws }); // nothing dirty — a forced save rewrites anyway
      const sqls = pipelineSqls(fetchSpy.mock.calls[3][1] as RequestInit);
      expect(sqls.some(isGuard)).toBe(false);
      expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toHaveLength(TABLE_NAMES.length);
      expect(sqls.slice(-4, -1)).toEqual([REVISION_UPDATE, REVISION_INSERT, "SELECT value FROM meta WHERE key = 'revision'"]);
      expect(backend.revision()).toBe("10");
      // One-shot: the next save guards again, on the revision the forced write produced.
      fetchSpy.mockImplementationOnce(okSave);
      await backend.save({ ...ws, tasks: [] });
      expect(argsOf(4, isGuard)).toEqual([["10"]]);
    });

    it("a forced save whose read-back comes back empty leaves the revision unknown rather than guessed", async () => {
      const backend = await loadedAt("3");
      backend.forceNextSave();
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementationOnce(okSave);
      await backend.save(withTask());
      expect(backend.revision()).toBeNull();
    });

    it("a forced save that fails stays forced for the retry", async () => {
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementationOnce((_url: unknown, init?: RequestInit) => jsonRes(failedBatchBody(init, 3, "datatype mismatch")));
      const backend = new TursoBackend(CONFIG);
      backend.forceNextSave();
      await expect(backend.save(withTask())).rejects.toThrow("Turso error: datatype mismatch");
      expect(backend.revision()).toBeNull();
      fetchSpy.mockImplementationOnce(okSaveReadingBack("3"));
      await backend.save(withTask());
      expect(pipelineSqls(fetchSpy.mock.calls[2][1] as RequestInit).some(isGuard)).toBe(false);
      expect(backend.revision()).toBe("3");
    });

    it("forceNextSave(expected) rewrites every table only while storage is at `expected`", async () => {
      const backend = await loadedAt("3");
      backend.forceNextSave("7");
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementationOnce(okSave);
      await backend.save(withTask());
      expect(argsOf(2, isGuard)).toEqual([["7"]]);
      expect(pipelineSqls(fetchSpy.mock.calls[2][1] as RequestInit).filter((s) => s.startsWith("DELETE FROM")))
        .toHaveLength(TABLE_NAMES.length);
      expect(backend.revision()).toBe("8");
    });

    it("forceNextSave(expected) against a newer version conflicts, and is consumed by that attempt", async () => {
      const backend = await loadedAt("3");
      backend.forceNextSave("7");
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementationOnce((_url: unknown, init?: RequestInit) =>
        jsonRes(failedBatchBody(init, guardIndex, `bad JSON path: '${REVISION_CONFLICT_MARKER}9'`)));
      fetchSpy.mockImplementationOnce(revisionRead("9"));
      const err = await backend.save(withTask()).catch((e: unknown) => e);
      expect((err as SaveConflictError).currentRevision).toBe("9");
      expect(backend.revision()).toBe("3");
      // Consumed: the next save guards on the instance's own revision again.
      fetchSpy.mockImplementationOnce(okSave);
      await backend.save(withTask());
      expect(argsOf(4, isGuard)).toEqual([["3"]]);
    });

    it("adoptRevision gives a never-loaded instance a revision to guard on, and drops a pending force", async () => {
      const backend = new TursoBackend(CONFIG);
      backend.forceNextSave();
      backend.adoptRevision("6");
      fetchSpy.mockResolvedValueOnce(upToDatePragma());
      fetchSpy.mockImplementationOnce(okSave);
      await backend.save(withTask());
      expect(argsOf(1, isGuard)).toEqual([["6"]]);
      expect(backend.revision()).toBe("7");
    });
  });
});
