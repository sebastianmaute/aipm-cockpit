import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseCreds,
  parseJiraRequest,
  callJira,
  sanitizeIssueFields,
  forwardJsonResponse,
  type Creds,
} from "./_helpers";

const CREDS: Creds = {
  siteUrl: "https://acme.atlassian.net",
  email: "user@acme.com",
  apiToken: "tok123",
};

function jsonRequest(body: unknown, ip = "203.0.113.1"): Request {
  return new Request("https://app.example.com/api/jira/test", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("parseCreds", () => {
  it("returns trimmed creds for a valid body", () => {
    expect(
      parseCreds({ siteUrl: "  https://acme.atlassian.net  ", email: " a@b.c ", apiToken: " t " }),
    ).toEqual({ siteUrl: "https://acme.atlassian.net", email: "a@b.c", apiToken: "t" });
  });

  it.each([
    ["null", null],
    ["non-object", "string"],
    ["missing siteUrl", { email: "a@b.c", apiToken: "t" }],
    ["missing email", { siteUrl: "https://x", apiToken: "t" }],
    ["missing apiToken", { siteUrl: "https://x", email: "a@b.c" }],
    ["blank (whitespace) field", { siteUrl: "https://x", email: "   ", apiToken: "t" }],
    ["non-string field", { siteUrl: "https://x", email: 5, apiToken: "t" }],
  ])("returns null for invalid input: %s", (_label, input) => {
    expect(parseCreds(input)).toBeNull();
  });
});

describe("sanitizeIssueFields", () => {
  it("requires a non-empty summary and caps it at 255 chars", () => {
    expect(sanitizeIssueFields({})).toBeNull();
    expect(sanitizeIssueFields({ summary: "   " })).toBeNull();
    const long = "x".repeat(300);
    const out = sanitizeIssueFields({ summary: long });
    expect((out!.summary as string).length).toBe(255);
  });

  it("strips fields not in the allowlist", () => {
    const out = sanitizeIssueFields({
      summary: "Hello",
      watchers: ["evil"],
      parent: { id: "1" },
      customfield_10001: "inject",
    });
    expect(out).toEqual({ summary: "Hello" });
  });

  it("accepts a known priority and rejects unknown / malformed priority", () => {
    expect(sanitizeIssueFields({ summary: "s", priority: { name: "High" } })).toEqual({
      summary: "s",
      priority: { name: "High" },
    });
    expect(sanitizeIssueFields({ summary: "s", priority: { name: "Critical" } })).toBeNull();
    expect(sanitizeIssueFields({ summary: "s", priority: "High" })).toBeNull();
    expect(sanitizeIssueFields({ summary: "s", priority: ["High"] })).toBeNull();
    expect(sanitizeIssueFields({ summary: "s", priority: null })).toBeNull();
  });

  it("cleans labels: drops non-strings/empties, caps length and count", () => {
    const out = sanitizeIssueFields({
      summary: "s",
      labels: ["ok", "  ", 7, "x".repeat(300), ...Array(30).fill("dup")],
    });
    const labels = out!.labels as string[];
    expect(labels).toHaveLength(20); // capped at 20
    expect(labels).toContain("ok");
    expect(labels.some((l) => l.length > 255)).toBe(false);
    expect(labels).not.toContain("  ");
  });

  it("rejects a non-array labels value", () => {
    expect(sanitizeIssueFields({ summary: "s", labels: "ok" })).toBeNull();
  });

  it("accepts an ADF description envelope or null, rejects malformed", () => {
    const adf = { version: 1, type: "doc", content: [] };
    expect(sanitizeIssueFields({ summary: "s", description: adf })!.description).toEqual(adf);
    expect(sanitizeIssueFields({ summary: "s", description: null })!.description).toBeNull();
    expect(sanitizeIssueFields({ summary: "s", description: "text" })).toBeNull();
    expect(sanitizeIssueFields({ summary: "s", description: { version: "1", type: "doc" } })).toBeNull();
    expect(sanitizeIssueFields({ summary: "s", description: { type: "doc" } })).toBeNull();
  });

  it("accepts a YYYY-MM-DD duedate or null, rejects other formats", () => {
    expect(sanitizeIssueFields({ summary: "s", duedate: "2026-06-02" })!.duedate).toBe("2026-06-02");
    expect(sanitizeIssueFields({ summary: "s", duedate: null })!.duedate).toBeNull();
    expect(sanitizeIssueFields({ summary: "s", duedate: "06/02/2026" })).toBeNull();
    expect(sanitizeIssueFields({ summary: "s", duedate: "2026-6-2" })).toBeNull();
    expect(sanitizeIssueFields({ summary: "s", duedate: 20260602 })).toBeNull();
  });
});

describe("callJira — SSRF / URL hardening", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function callWith(siteUrl: string) {
    return callJira({ ...CREDS, siteUrl }, "/rest/api/3/myself");
  }

  it.each([
    ["http (plaintext) rejected", "http://acme.atlassian.net"],
    ["localhost", "https://localhost"],
    ["loopback 127.x", "https://127.0.0.1"],
    ["private 10.x", "https://10.0.0.5"],
    ["private 172.16-31", "https://172.20.1.1"],
    ["private 192.168", "https://192.168.1.1"],
    ["link-local / metadata 169.254", "https://169.254.169.254"],
    ["IPv6 loopback ::1", "https://[::1]"],
    ["IPv6 unique-local fc00", "https://[fc00::1]"],
    ["IPv6 link-local fe80", "https://[fe80::1]"],
    ["NAT64 well-known prefix 64:ff9b::", "https://[64:ff9b::a00:1]"],
    ["IPv4-mapped IPv6 to private (dotted)", "https://[::ffff:10.0.0.1]"],
    // Regression: the URL parser canonicalizes ::ffff:10.0.0.1 to hex
    // ::ffff:a00:1. The guard must decode the hex form, not let it through.
    ["IPv4-mapped IPv6 to private (hex form)", "https://[::ffff:a00:1]"],
    ["garbage url", "not-a-url"],
  ])("blocks %s without fetching", async (_label, url) => {
    const res = await callWith(url);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid-site-url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a public host in the 172.15 range (just outside private 172.16-31)", async () => {
    await callWith("https://172.15.0.1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fetches a public https host with auth + accept headers and a normalized origin", async () => {
    await callWith("https://acme.atlassian.net/wiki/extra/");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    // Trailing path/slash stripped to the origin, then our path appended.
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/myself");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "Basic " + Buffer.from("user@acme.com:tok123").toString("base64"),
    );
    expect(headers.Accept).toBe("application/json");
    expect(init.cache).toBe("no-store");
  });

  it("sets Content-Type only when a body is present", async () => {
    await callJira(CREDS, "/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("allows a public IPv4 that is not in any private range", async () => {
    await callWith("https://8.8.8.8");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("parseJiraRequest", () => {
  it("returns creds + body on a valid request", async () => {
    const result = await parseJiraRequest(jsonRequest(CREDS, "203.0.113.20"));
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.creds).toEqual(CREDS);
      expect(result.body).toMatchObject({ email: "user@acme.com" });
    }
  });

  it("returns a 400 error response on invalid JSON", async () => {
    const result = await parseJiraRequest(jsonRequest("{not json", "203.0.113.21"));
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(400);
      await expect(result.error.json()).resolves.toEqual({ error: "invalid-json" });
    }
  });

  it("returns a 400 error response when credentials are missing", async () => {
    const result = await parseJiraRequest(jsonRequest({ siteUrl: "https://x" }, "203.0.113.22"));
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(400);
      await expect(result.error.json()).resolves.toEqual({ error: "missing-credentials" });
    }
  });
});

describe("forwardJsonResponse", () => {
  it("forwards a JSON body and preserves the upstream status", async () => {
    const upstream = new Response(JSON.stringify({ key: "LOP-1" }), { status: 201 });
    const res = await forwardJsonResponse(upstream);
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ key: "LOP-1" });
  });

  it("returns null data for an empty upstream body", async () => {
    // Use 200 (not 204): undici forbids a body on null-body statuses, and the
    // behavior under test is "empty text → null data", independent of status.
    const res = await forwardJsonResponse(new Response("", { status: 200 }));
    await expect(res.json()).resolves.toBeNull();
  });

  it("wraps a non-JSON upstream body in an error envelope", async () => {
    const upstream = new Response("<html>boom</html>", { status: 502 });
    const res = await forwardJsonResponse(upstream);
    expect(res.status).toBe(502);
    const data = (await res.json()) as { error: string; body: string };
    expect(data.error).toBe("non-json-response");
    expect(data.body).toContain("boom");
  });
});
