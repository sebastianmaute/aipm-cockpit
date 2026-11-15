// @vitest-environment node
//
// jsdom's Blob/FormData/Request implementations don't interoperate with
// Node's undici multipart parser (a Blob appended with a filename fails
// undici's `webidl.is.File` brand check on decode) — this route has no DOM
// dependency, so run it under the real `node` environment instead.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { STT_MAX_REQUESTS } from "./_helpers";

// §803: the route resolves the endpoint's host name before forwarding. No test may reach real DNS,
// so every lookup goes through this mock; by default a name resolves to a public address.
const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));

// The rate limiter's store is module-level and keyed by caller address, so each request carries
// an address of its own unless a test wants them to share one.
let nextIp = 1;
function req(fields: Record<string, string>, key = "sk-test", withFile = true, ip = `198.51.100.${nextIp++}`): Request {
  const form = new FormData();
  if (withFile) form.append("file", new Blob(["x"], { type: "audio/webm" }), "a.webm");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://localhost/api/stt", {
    method: "POST",
    headers: key ? { "x-stt-key": key, "x-forwarded-for": ip } : { "x-forwarded-for": ip },
    body: form,
  });
}

beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ text: "hi" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

describe("POST /api/stt", () => {
  it("blocks a private-IP baseUrl (SSRF)", async () => {
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://192.168.0.1/v1" }));
    expect(res.status).toBe(400);
  });

  // §803: a public-looking name that resolves to a private address is refused like the address itself.
  it.each([
    ["an IPv4 private address", [{ address: "10.0.0.5", family: 4 }]],
    ["the cloud metadata address", [{ address: "169.254.169.254", family: 4 }]],
    ["IPv6 loopback", [{ address: "::1", family: 6 }]],
    ["one private address among public ones", [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]],
  ])("blocks a host name that resolves to %s, calling nothing upstream", async (_name, addresses) => {
    lookup.mockResolvedValue(addresses);
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://stt.example.com/v1" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("blocked host");
    expect(lookup).toHaveBeenCalledWith("stt.example.com", { all: true, verbatim: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a host name that does not resolve → 502, calling nothing upstream", async () => {
    lookup.mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://nowhere.example.com/v1" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "stt upstream failed" });
    expect(fetch).not.toHaveBeenCalled();
  });

  // A public literal, so only the literal branch decides: a private one is refused before the lookup is reached.
  it("a public IP literal is forwarded without a lookup", async () => {
    lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://93.184.216.34/v1" }));
    expect(res.status).toBe(200);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("a lookup that returns no address → 502, calling nothing upstream", async () => {
    lookup.mockResolvedValue([]);
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://empty.example.com/v1" }));
    expect(res.status).toBe(502);
    expect(fetch).not.toHaveBeenCalled();
  });

  // §806: the route is limited per caller like the Jira, Timelog and exchange-rate routes.
  it("a burst over STT_MAX_REQUESTS from one caller → 429, and the refused call sends nothing upstream", async () => {
    const ip = "203.0.113.90";
    for (let i = 0; i < STT_MAX_REQUESTS; i++) {
      const ok = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }, "sk-test", true, ip));
      expect(ok.status).toBe(200);
    }
    const refused = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }, "sk-test", true, ip));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "too-many-requests" });
    expect(fetch).toHaveBeenCalledTimes(STT_MAX_REQUESTS);
  });

  // A key-less call (a web page cannot add the key header cross-site without a CORS preflight) is refused before
  // it counts, so a page cannot use up a visitor's limit.
  it("key-less calls do not count against the caller's limit", async () => {
    const ip = "203.0.113.91";
    for (let i = 0; i < STT_MAX_REQUESTS + 5; i++) {
      const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }, "", true, ip));
      expect(res.status).toBe(400);
    }
    const ok = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }, "sk-test", true, ip));
    expect(ok.status).toBe(200);
  });

  it("blocks a non-https baseUrl", async () => {
    const res = await POST(req({ model: "whisper-1", baseUrl: "http://api.openai.com/v1" }));
    expect(res.status).toBe(400);
  });

  it("400 when the key header is missing", async () => {
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }, ""));
    expect(res.status).toBe(400);
  });

  it("forwards to {baseUrl}/audio/transcriptions with Bearer key", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }));
    expect(res.status).toBe(200);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("refuses an upstream redirect (SSRF via 3xx)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })),
    );
    const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }));
    expect(res.status).toBe(502);
  });

  it("rejects an oversized upload (content-length cap)", async () => {
    const r = req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" });
    Object.defineProperty(r, "headers", {
      value: new Headers({ "x-stt-key": "sk-test", "content-length": String(30 * 1024 * 1024) }),
    });
    const res = await POST(r);
    expect(res.status).toBe(413);
  });

  it("rejects an oversized file post-parse (chunked bypass defense)", async () => {
    const big = new Blob([new Uint8Array(26 * 1024 * 1024)], { type: "audio/webm" }); // 26MB > 25MB cap
    const form = new FormData();
    form.append("file", big, "a.webm");
    form.append("model", "whisper-1");
    form.append("baseUrl", "https://api.openai.com/v1");
    const r = new Request("http://localhost/api/stt", { method: "POST", headers: { "x-stt-key": "sk-test" }, body: form });
    const res = await POST(r);
    expect(res.status).toBe(413);
  });

  // Dictation sends recorded speech to a model provider, so the deployment's AI
  // switch closes it as well as its own `stt` switch.
  it("refuses with 503 integration-disabled when AI is switched off, calling nothing upstream", async () => {
    vi.stubEnv("AIPM_DISABLED_INTEGRATIONS", "ai");
    try {
      const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "integration-disabled" });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // §786: the people-protection lock closes dictation here too, so a tab opened before the lock was set cannot
  // send one more recording while it has not yet heard about the lock.
  it("refuses with 503 integration-disabled when people protection is forced, calling nothing upstream", async () => {
    vi.stubEnv("AIPM_DISABLED_INTEGRATIONS", "ai-people");
    try {
      const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "integration-disabled" });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // An invalid gateway setting turns AI off for the deployment, so it closes dictation like the switch does.
  it("refuses with 503 ai-gateway-invalid when the AI gateway setting is invalid, calling nothing upstream", async () => {
    vi.stubEnv("AIPM_AI_GATEWAY_URL", "");
    vi.stubEnv("AIPM_AI_GATEWAY_TOKEN", "tok");
    try {
      const res = await POST(req({ model: "whisper-1", baseUrl: "https://api.openai.com/v1" }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "ai-gateway-invalid" });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
