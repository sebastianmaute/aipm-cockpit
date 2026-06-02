import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
 <Cube><Cube time='2026-05-26'>
   <Cube currency='USD' rate='1.0823'/>
   <Cube currency='GBP' rate='0.8512'/>
 </Cube></Cube>
</gesmes:Envelope>`;

function mockFetch(impl: () => Promise<Partial<Response>>) {
  vi.stubGlobal("fetch", vi.fn(impl) as unknown as typeof fetch);
}

describe("GET /api/ecb", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  test("returns 200 with an EUR-base rate table on success", async () => {
    mockFetch(async () => ({ ok: true, text: async () => SAMPLE }));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ base: "EUR", date: "2026-05-26", rates: { EUR: 1, USD: 1.0823, GBP: 0.8512 } });
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
  });

  test("returns 502 when ECB responds non-ok", async () => {
    mockFetch(async () => ({ ok: false, status: 503, text: async () => "" }));
    const res = await GET();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/503/);
  });

  test("returns 502 when the XML cannot be parsed", async () => {
    mockFetch(async () => ({ ok: true, text: async () => "<nope/>" }));
    const res = await GET();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/parse/i);
  });

  test("returns 502 with a generic message when the fetch throws, leaking no detail", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () => { throw new Error("network down"); });
    const res = await GET();
    expect(res.status).toBe(502);
    // Client sees a generic message — the internal error text must NOT leak.
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ECB fetch failed");
    expect(body.error).not.toMatch(/network down/);
    // The detail is preserved server-side for diagnostics.
    expect(errSpy).toHaveBeenCalledWith("ECB fetch failed:", expect.any(Error));
  });
});
