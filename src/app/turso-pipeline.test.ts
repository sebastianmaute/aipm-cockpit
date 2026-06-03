import { afterEach, describe, expect, it, vi } from "vitest";
import { runTursoPipeline } from "./turso-pipeline";
import { StorageNotReadyError } from "./storage";
import type { TursoConfig } from "./turso-config";

const cfg: TursoConfig = { httpUrl: "https://db.example.com", authToken: "tok" };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function stubFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("runTursoPipeline", () => {
  it("throws StorageNotReadyError when config is null", async () => {
    await expect(runTursoPipeline(null, [{ sql: "SELECT 1" }])).rejects.toBeInstanceOf(StorageNotReadyError);
  });

  it("maps a network failure to a 'storage-unreachable' StorageNotReadyError", async () => {
    stubFetch(() => { throw new Error("ECONNREFUSED"); });
    await expect(runTursoPipeline(cfg, [{ sql: "SELECT 1" }]))
      .rejects.toMatchObject({ hint: "storage-unreachable" });
  });

  it("maps HTTP 401 to a StorageNotReadyError", async () => {
    stubFetch(() => new Response("no", { status: 401 }));
    await expect(runTursoPipeline(cfg, [{ sql: "SELECT 1" }])).rejects.toBeInstanceOf(StorageNotReadyError);
  });

  it("throws when a result row reports an error", async () => {
    stubFetch(() => new Response(JSON.stringify({ results: [{ type: "error", error: { message: "boom" } }] }), { status: 200 }));
    await expect(runTursoPipeline(cfg, [{ sql: "SELECT 1" }])).rejects.toThrow(/boom/);
  });

  it("returns results on success and sends the Bearer token", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(() => new Response(JSON.stringify({ results: [{ type: "ok" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await runTursoPipeline(cfg, [{ sql: "SELECT 1" }]);
    expect(out).toEqual([{ type: "ok" }]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("omits the Authorization header when no token is configured", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runTursoPipeline({ httpUrl: "http://localhost:8080", authToken: "" }, [{ sql: "SELECT 1" }]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
