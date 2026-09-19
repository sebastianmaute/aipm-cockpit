// The shared bounded fetch behind every backend LOAD (§548: the load hold must always lift). It owns the
// two rules Turso's pipeline learned the hard way: abort after `timeoutMs`, and read the BODY inside the
// armed window (a server that sends headers and then stalls the body used to hang forever).
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchTimeoutError, LOAD_TIMEOUT_MS, fetchTextWithTimeout } from "./fetch-with-timeout";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** A fetch that never resolves but rejects with an AbortError when its signal aborts. */
function stubHangingFetch() {
  const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Headers resolve at once; the body stalls until the signal aborts, then errors like a real stream. */
function stubStalledBodyFetch() {
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => {
    const body = new ReadableStream({
      start(ctrl) {
        init?.signal?.addEventListener("abort", () => ctrl.error(new DOMException("The operation was aborted.", "AbortError")));
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }));
}

describe("fetchTextWithTimeout", () => {
  it("pins the shared load bound at 10 s", () => {
    expect(LOAD_TIMEOUT_MS).toBe(10_000);
  });

  it("returns status, ok and the body text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("hello", { status: 201 })));
    await expect(fetchTextWithTimeout("https://x.test/a", { method: "GET" }, 1000)).resolves.toEqual({ status: 201, ok: true, text: "hello" });
  });

  it("aborts a hung fetch at timeoutMs, not before, with a FetchTimeoutError", async () => {
    vi.useFakeTimers();
    const fetchMock = stubHangingFetch();
    const pending = fetchTextWithTimeout("https://x.test/a", { method: "GET" }, 500);
    const expectation = expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(499);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expectation;
  });

  it("bounds the BODY read too: headers that arrive and a body that stalls still time out", async () => {
    vi.useFakeTimers();
    stubStalledBodyFetch();
    const pending = fetchTextWithTimeout("https://x.test/a", { method: "GET" }, 500);
    const expectation = expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(500);
    await expectation;
  });

  it("passes a non-timeout failure through unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await expect(fetchTextWithTimeout("https://x.test/a", { method: "GET" }, 1000)).rejects.toThrow(TypeError);
  });

  it("clears its timer once the body is read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    await fetchTextWithTimeout("https://x.test/a", { method: "GET" }, 1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
