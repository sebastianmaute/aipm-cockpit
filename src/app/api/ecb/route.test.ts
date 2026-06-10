import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { MAX_REQUESTS } from "../jira/_rate-limit";
import { GET } from "./route";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
 <Cube><Cube time='2026-05-26'>
   <Cube currency='USD' rate='1.0823'/>
   <Cube currency='GBP' rate='0.8512'/>
 </Cube></Cube>
</gesmes:Envelope>`;

function mockFetch(impl: () => Promise<Partial<Response>>) {
  const fn: ReturnType<typeof vi.fn> = vi.fn(impl);
  vi.stubGlobal("fetch", fn as unknown as typeof fetch);
  return fn;
}

// The rate limiter keeps a module-level Map keyed by client IP with no reset
// hook, so each test uses a UNIQUE ip to avoid bleeding state between tests.
function ecbRequest(ip: string): Request {
  return new Request("https://app.example.com/api/ecb", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("GET /api/ecb", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  test("returns 200 with an EUR-base rate table on success", async () => {
    mockFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    const res = await GET(ecbRequest("203.0.113.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ base: "EUR", date: "2026-05-26", rates: { EUR: 1, USD: 1.0823, GBP: 0.8512 } });
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
  });

  test("returns 502 when ECB responds non-ok", async () => {
    mockFetch(async () => ({ ok: false, status: 503, text: async () => "" }));
    const res = await GET(ecbRequest("203.0.113.2"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/503/);
  });

  test("returns 502 when the XML cannot be parsed", async () => {
    mockFetch(async () => ({ ok: true, text: async () => "<nope/>" }));
    const res = await GET(ecbRequest("203.0.113.3"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/parse/i);
  });

  test("returns 502 with a generic message when the fetch throws, leaking no detail", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => { throw new Error("network down"); });
    const res = await GET(ecbRequest("203.0.113.4"));
    expect(res.status).toBe(502);
    // Client sees a generic message — the internal error text must NOT leak.
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ECB fetch failed");
    expect(body.error).not.toMatch(/network down/);
    // The detail is preserved server-side for diagnostics.
    expect(errSpy).toHaveBeenCalledWith("ECB fetch failed:", expect.any(Error));
  });

  test("bounds the upstream call with an abort signal so a hung ECB cannot stall the route", async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    await GET(ecbRequest("203.0.113.5"));
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("returns the generic 502 shape when the upstream call times out", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // AbortSignal.timeout rejects the fetch with a TimeoutError DOMException —
    // it must take the same generic-502 path as any other upstream failure.
    mockFetch(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const res = await GET(ecbRequest("203.0.113.6"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ECB fetch failed");
    expect(errSpy).toHaveBeenCalledWith("ECB fetch failed:", expect.any(DOMException));
  });

  test("returns 429 with Retry-After once an IP exceeds the rate limit, without fetching", async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    const ip = "203.0.113.7";
    for (let i = 0; i < MAX_REQUESTS; i++) {
      expect((await GET(ecbRequest(ip))).status).toBe(200);
    }
    const blocked = await GET(ecbRequest(ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    await expect(blocked.json()).resolves.toEqual({ error: "too-many-requests" });
    // The blocked request never reaches the upstream.
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REQUESTS);
  });
});
