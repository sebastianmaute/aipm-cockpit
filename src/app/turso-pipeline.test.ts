import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PIPELINE_TIMEOUT_MS, runTursoPipeline } from "./turso-pipeline";
import { StorageNotReadyError } from "./storage";
import type { TursoConfig } from "./turso-config";

const cfg: TursoConfig = { httpUrl: "https://db.example.com", authToken: "tok" };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function stubFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

/** A fetch stub that never resolves but rejects with an AbortError when its signal aborts. */
function stubHangingFetch() {
  const fetchMock = vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const errorResults = { results: [{ type: "error", error: { message: "boom" } }] };
const beginBatch = [{ sql: "BEGIN" }, { sql: "INSERT INTO tasks VALUES (1)" }, { sql: "COMMIT" }];

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

describe("runTursoPipeline timeout", () => {
  it("aborts a hung fetch after the default timeout and classifies it as storage-unreachable", async () => {
    vi.useFakeTimers();
    const fetchMock = stubHangingFetch();
    const pending = runTursoPipeline(cfg, [{ sql: "SELECT 1" }]);
    const expectation = expect(pending).rejects.toMatchObject({ hint: "storage-unreachable" });
    await vi.advanceTimersByTimeAsync(DEFAULT_PIPELINE_TIMEOUT_MS - 1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    await expectation;
  });

  it("honors an explicit timeoutMs", async () => {
    vi.useFakeTimers();
    stubHangingFetch();
    const pending = runTursoPipeline(cfg, [{ sql: "SELECT 1" }], 100);
    const expectation = expect(pending).rejects.toMatchObject({ hint: "storage-unreachable" });
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });

  it("clears the abort timer once the fetch resolves", async () => {
    vi.useFakeTimers();
    stubFetch(() => new Response(JSON.stringify({ results: [{ type: "ok" }] }), { status: 200 }));
    await runTursoPipeline(cfg, [{ sql: "SELECT 1" }]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("runTursoPipeline rollback on statement error", () => {
  it("posts a single best-effort ROLLBACK when a BEGIN batch reports a statement error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes(errorResults))
      .mockResolvedValueOnce(jsonRes({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runTursoPipeline(cfg, beginBatch)).rejects.toThrow(/boom/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body.requests).toEqual([{ type: "execute", stmt: { sql: "ROLLBACK" } }]);
    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
  });

  it("does not send ROLLBACK for non-transactional pipelines", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(errorResults));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runTursoPipeline(cfg, [{ sql: "SELECT 1" }])).rejects.toThrow(/boom/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("swallows a failing ROLLBACK, still throws the original error, and does not recurse", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes(errorResults))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runTursoPipeline(cfg, beginBatch)).rejects.toThrow(/boom/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("swallows a ROLLBACK whose own response reports a statement error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(errorResults));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runTursoPipeline(cfg, beginBatch)).rejects.toThrow(/boom/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
