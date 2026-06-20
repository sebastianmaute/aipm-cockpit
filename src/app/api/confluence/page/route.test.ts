import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";

const CREDS = { siteUrl: "https://x.atlassian.net", email: "a@b.c", apiToken: "tok" };

function mockFetch(impl: () => Promise<Partial<Response>>) {
  const fn: ReturnType<typeof vi.fn> = vi.fn(impl);
  vi.stubGlobal("fetch", fn as unknown as typeof fetch);
  return fn;
}

// The rate limiter keeps a module-level Map keyed by client IP with no reset
// hook, so each test uses a UNIQUE ip to avoid bleeding state between tests.
function pageRequest(ip: string, body: Record<string, unknown>): Request {
  return new Request("https://app.example.com/api/confluence/page", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/confluence/page", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  test("rejects a non-numeric pageId with 400 before reaching the upstream", async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, text: async () => "{}" }));
    const res = await POST(pageRequest("198.51.100.1", { ...CREDS, pageId: "42; DROP" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid-page-id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("forwards a numeric pageId to the Confluence content path and returns the upstream JSON", async () => {
    const fetchMock = mockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ title: "Charter" }),
    }));
    const res = await POST(pageRequest("198.51.100.2", { ...CREDS, pageId: "42" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "Charter" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://x.atlassian.net/wiki/rest/api/content/42?expand=body.view");
  });
});
