import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TursoBackend } from "./turso-backend";
import { StorageNotReadyError, emptyWorkspace, workspaceToJson } from "./storage";
import type { TursoConfig } from "./turso-config";
import { SCHEMA_DDL, TABLE_NAMES } from "./turso-schema";

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
});
