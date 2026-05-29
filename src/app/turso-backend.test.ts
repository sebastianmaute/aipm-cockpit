import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TursoBackend } from "./turso-backend";
import { StorageNotReadyError, emptyWorkspace, jsonToWorkspace, workspaceToJson } from "./storage";
import type { TursoConfig } from "./turso-config";

const CONFIG: TursoConfig = { httpUrl: "https://db.turso.io", authToken: "tok" };

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
function execOk(rows: unknown[][]): unknown {
  return { type: "ok", response: { type: "execute", result: { cols: [], rows } } };
}
const closeOk = { type: "ok", response: { type: "close" } };

describe("TursoBackend", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isReady reflects config presence", async () => {
    expect(await new TursoBackend(null).isReady()).toBe(false);
    expect(await new TursoBackend(CONFIG).isReady()).toBe(true);
  });

  it("load on an empty DB returns emptyWorkspace", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [execOk([]), execOk([]), closeOk] }));
    const ws = await new TursoBackend(CONFIG).load();
    expect(ws).toEqual(emptyWorkspace());
  });

  it("load round-trips a stored blob", async () => {
    const stored = workspaceToJson(emptyWorkspace());
    fetchSpy.mockResolvedValueOnce(
      jsonRes({ results: [execOk([]), execOk([[{ type: "text", value: stored }]]), closeOk] }),
    );
    const ws = await new TursoBackend(CONFIG).load();
    expect(ws).toEqual(jsonToWorkspace(stored));
  });

  it("save posts the table DDL + upsert with the JSON arg, Bearer header, /v2/pipeline URL", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [execOk([]), execOk([]), closeOk] }));
    const ws = emptyWorkspace();
    await new TursoBackend(CONFIG).save(ws);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://db.turso.io/v2/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string);
    const sqls = body.requests.filter((r: { type: string }) => r.type === "execute").map((r: { stmt: { sql: string } }) => r.stmt.sql);
    expect(sqls.some((s: string) => s.includes("CREATE TABLE IF NOT EXISTS workspace"))).toBe(true);
    expect(sqls.some((s: string) => s.includes("INSERT INTO workspace"))).toBe(true);
    const upsert = body.requests.find((r: { type: string; stmt?: { sql: string } }) => r.stmt?.sql?.includes("INSERT INTO workspace"));
    expect(upsert.stmt.args).toEqual([{ type: "text", value: workspaceToJson(ws) }]);
    // No trailing "close" frame — newer engines (local tursodb) reject it.
    expect(body.requests.every((r: { type: string }) => r.type === "execute")).toBe(true);
  });

  it("omits the Authorization header for a token-less loopback config", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [execOk([]), execOk([])] }));
    await new TursoBackend({ httpUrl: "http://127.0.0.1:8080", authToken: "" }).load();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8080/v2/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("sends the Authorization header when a token is configured", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [execOk([]), execOk([])] }));
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

  it("load sends CREATE TABLE as the first statement", async () => {
    fetchSpy.mockResolvedValueOnce(jsonRes({ results: [execOk([]), execOk([]), closeOk] }));
    await new TursoBackend(CONFIG).load();
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.requests[0].stmt.sql).toContain("CREATE TABLE IF NOT EXISTS workspace");
    expect(body.requests[1].stmt.sql).toContain("SELECT data FROM workspace");
  });
});
