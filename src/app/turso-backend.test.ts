import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TursoBackend } from "./turso-backend";
import { StorageNotReadyError, emptyWorkspace, workspaceToJson } from "./storage";
import type { TursoConfig } from "./turso-config";
import { SCHEMA_DDL, TABLE_NAMES } from "./turso-schema";
import { LOAD_TIMEOUT_MS } from "./turso-pipeline";

const CONFIG: TursoConfig = { httpUrl: "https://db.turso.io", authToken: "tok" };

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
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
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [okExec()] }));
    const ws = emptyWorkspace();
    ws.tasks = [minimalTask as never];
    await new TursoBackend(CONFIG).save(ws);
    const sqls = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string).requests.map((r: { stmt?: { sql: string } }) => r.stmt?.sql);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls).toContain("DELETE FROM tasks");
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
    const backend = new TursoBackend({ httpUrl: "http://127.0.0.1:8080", authToken: "" });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(backend.save(emptyWorkspace())).rejects.toMatchObject({ hint: "storage-unreachable" });
  });

  describe("dirty-table saves", () => {
    const okSave = () => jsonRes({ results: [okExec()] });
    /** SQL of every statement in the pipeline body of fetch call N. */
    const bodySqls = (call: number): string[] =>
      JSON.parse((fetchSpy.mock.calls[call][1] as RequestInit).body as string)
        .requests.map((r: { stmt?: { sql: string } }) => r.stmt?.sql)
        .filter((s: string | undefined): s is string => s !== undefined);

    it("first save (no baseline) is a full rewrite", async () => {
      fetchSpy.mockResolvedValue(okSave());
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await new TursoBackend(CONFIG).save(ws);
      const sqls = bodySqls(0);
      // BEGIN + DDL + one DELETE per table + 1 task INSERT + plan + 2 meta rows + COMMIT
      expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toHaveLength(TABLE_NAMES.length);
      expect(sqls).toHaveLength(1 + SCHEMA_DDL.length + TABLE_NAMES.length + 1 + 1 + 2 + 1);
    });

    it("second save with only a new tasks array emits DDL + DELETE/INSERT for tasks only", async () => {
      fetchSpy.mockResolvedValue(okSave());
      const backend = new TursoBackend(CONFIG);
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await backend.save(ws);
      const ws2 = { ...ws, tasks: [ws.tasks[0], { ...minimalTask, id: 2 } as never] };
      await backend.save(ws2);
      const sqls = bodySqls(1);
      expect(sqls[0]).toBe("BEGIN");
      expect(sqls[sqls.length - 1]).toBe("COMMIT");
      expect(sqls.filter((s) => s.startsWith("CREATE TABLE IF NOT EXISTS"))).toHaveLength(SCHEMA_DDL.length);
      expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toEqual(["DELETE FROM tasks"]);
      const inserts = sqls.filter((s) => s.startsWith("INSERT INTO"));
      expect(inserts).toHaveLength(2);
      expect(inserts.every((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
      // BEGIN + DDL + DELETE tasks + 2 task INSERTs + COMMIT
      expect(sqls).toHaveLength(1 + SCHEMA_DDL.length + 1 + 2 + 1);
    });

    it("a save with zero changes performs no pipeline call but still resolves", async () => {
      fetchSpy.mockResolvedValue(okSave());
      const backend = new TursoBackend(CONFIG);
      const ws = emptyWorkspace();
      await backend.save(ws);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // New wrapper object, same per-table references — nothing dirty.
      await expect(backend.save({ ...ws })).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("a failed save does not advance the baseline — the next save retries the dirty tables", async () => {
      fetchSpy.mockResolvedValueOnce(okSave());
      const backend = new TursoBackend(CONFIG);
      const ws = emptyWorkspace();
      ws.tasks = [minimalTask as never];
      await backend.save(ws);
      const ws2 = { ...ws, tasks: [{ ...minimalTask, taskName: "edited" } as never] };
      fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(backend.save(ws2)).rejects.toMatchObject({ hint: "storage-unreachable" });
      fetchSpy.mockResolvedValueOnce(okSave());
      await backend.save(ws2);
      const sqls = bodySqls(2);
      expect(sqls.filter((s) => s.startsWith("DELETE FROM"))).toEqual(["DELETE FROM tasks"]);
      expect(sqls.some((s) => s.startsWith("INSERT INTO tasks"))).toBe(true);
    });
  });
});
