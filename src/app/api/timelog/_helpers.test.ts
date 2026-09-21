import { describe, it, expect, vi, afterEach } from "vitest";
import { parseTimelogRequest, callTimelog, type TimelogCreds } from "./_helpers";
import { MAX_REQUESTS } from "../jira/_rate-limit";

const creds: TimelogCreds = { host: "app2.timelog.com", tenant: "Acme", token: "tok" };
function req(body: unknown): Request {
  return new Request("http://localhost/api/timelog", { method: "POST", body: JSON.stringify(body) });
}
function reqIp(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/timelog", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
afterEach(() => vi.restoreAllMocks());

describe("timelog proxy SSRF guard", () => {
  it("rejects a non-timelog.com host", async () => {
    const r = await callTimelog({ ...creds, host: "evil.com" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("rejects a lookalike host (timelog.com.attacker.com)", async () => {
    const r = await callTimelog({ ...creds, host: "app2.timelog.com.attacker.com" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("rejects a private-IP host", async () => {
    const r = await callTimelog({ ...creds, host: "10.0.0.1" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("accepts app1.timelog.com and builds the tenant base path with Bearer auth", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await callTimelog({ ...creds, host: "app1.timelog.com", tenant: "acme" }, "/v1/user", { method: "GET" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app1.timelog.com/acme/api/v1/user",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok" }) }),
    );
  });
  it("parseTimelogRequest returns missing-credentials when fields absent", async () => {
    const out = await parseTimelogRequest(req({ path: "/v1/user" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
  it("parseTimelogRequest rejects a path not starting with /v1/", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/evil" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
  it("parseTimelogRequest accepts a valid /v1/ path + creds", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/v1/time-tracking-item/get-by-date", query: { startDate: "2026-06-01" } }));
    expect("error" in out).toBe(false);
  });
  it("parseTimelogRequest accepts a /v2/ path (per-project time-registrations)", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/v2/projects/123/time-registrations" }));
    expect("error" in out).toBe(false);
  });
  it("parseTimelogRequest rejects a /v3/ path (only v1 + v2 allowed)", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/v3/user" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
  it("rejects a host with a port (app2.timelog.com:8080)", async () => {
    const r = await callTimelog({ ...creds, host: "app2.timelog.com:8080" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("rejects a host with userinfo (evil.com@app2.timelog.com)", async () => {
    const r = await callTimelog({ ...creds, host: "evil.com@app2.timelog.com" }, "/v1/user", { method: "GET" });
    expect(r.status).toBe(400);
  });
  it("parseTimelogRequest rejects a path with traversal (/v1/../../etc)", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/v1/../../etc" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
  it("parseTimelogRequest rejects a path with CRLF injection", async () => {
    const out = await parseTimelogRequest(req({ ...creds, path: "/v1/x\r\nX: y" }));
    expect("error" in out && (out.error as Response).status).toBe(400);
  });
  it("refuses an upstream 3xx rather than following it to an unvalidated host", async () => {
    // normalizeHost allowlisted the INITIAL host only. A redirect is a second
    // hop nothing checked — an unauthenticated hop to wherever the upstream
    // points.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const r = await callTimelog(creds, "/v1/user", { method: "GET" });
    expect(r.status).toBe(502);
    await expect(r.json()).resolves.toEqual({ error: "upstream-redirect" });
    // LOAD-BEARING: a followed redirect could ALSO end in a 502 (the second hop
    // refusing us), so the status alone passes against the unfixed code. Only
    // the call count proves we stopped at the first hop.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("releases the body of a refused 3xx instead of leaving it unread", async () => {
    const cancel = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 302,
        headers: { location: "https://evil.example/" },
      }),
    );
    const r = await callTimelog(creds, "/v1/user", { method: "GET" });
    expect(r.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("§607: logs the redirect body-cancel failure as a plain object with its cause", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({ cancel: () => Promise.reject(new TypeError("fetch failed", { cause })) }),
        { status: 302, headers: { location: "https://evil.example/" } },
      ),
    );
    const r = await callTimelog(creds, "/v1/user", { method: "GET" });
    expect(r.status).toBe(502);
    await new Promise((resolve) => setTimeout(resolve, 0)); // the cancel is deliberately not awaited
    const call = errSpy.mock.calls.find(
      ([label]) => label === "Timelog upstream redirect body cancel failed:",
    );
    expect(call).toBeDefined(); // presence: the cancel path really ran
    expect(call![1]).not.toBeInstanceOf(Error);
    expect(call![1]).toEqual({
      message: "fetch failed",
      cause: "connect ECONNREFUSED",
      code: "ECONNREFUSED",
    });
  });

  it("answers a refused 3xx without waiting for a cancel that never settles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream({ cancel: () => new Promise<void>(() => {}) }), { status: 302 }),
    );
    const outcome = await Promise.race([
      callTimelog(creds, "/v1/user", { method: "GET" }),
      new Promise<"stalled">((resolve) => setTimeout(() => resolve("stalled"), 1000)),
    ]);
    expect(outcome).not.toBe("stalled");
    expect((outcome as Response).status).toBe(502);
  });

  it("tells fetch not to follow redirects itself", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await callTimelog(creds, "/v1/user", { method: "GET" });
    // The mock cannot model a real redirect chain, so the 3xx test above can
    // never see this option go missing: against a real fetch without it, the
    // redirect is followed transparently and a 3xx never reaches our check.
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("gives the heavy v2 per-project time-registrations call a longer (30s) upstream timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await callTimelog(creds, "/v2/projects/12345/time-registrations?startDate=2026-06-01", { method: "GET" });
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });

  it("keeps the default (10s) upstream timeout for light v1 calls", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await callTimelog(creds, "/v1/user?$page=1", { method: "GET" });
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  });

  it("on an upstream timeout returns 502 and logs the attributable path (query-stripped) but never the token", async () => {
    const err = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(err);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await callTimelog(creds, "/v2/projects/12345/time-registrations?startDate=2026-06-01", { method: "GET" });
    expect(r.status).toBe(502);
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("TimeoutError");
    expect(logged).toContain("/v2/projects/12345/time-registrations"); // attributable
    expect(logged).not.toContain("startDate"); // query stripped
    expect(logged).not.toContain(creds.token);  // token never logged
  });

  it("parseTimelogRequest surfaces the rate limiter's 429 once the per-IP window is exhausted", async () => {
    // Unique IP + the "timelog" scope isolate this from the shared bucket store.
    const ip = "203.0.113.201";
    const body = { ...creds, path: "/v1/time-tracking-item/get-by-date" };
    for (let i = 0; i < MAX_REQUESTS; i++) {
      const ok = await parseTimelogRequest(reqIp(body, ip));
      expect("error" in ok).toBe(false);
    }
    const blocked = await parseTimelogRequest(reqIp(body, ip));
    expect("error" in blocked && (blocked.error as Response).status).toBe(429);
  });
});
