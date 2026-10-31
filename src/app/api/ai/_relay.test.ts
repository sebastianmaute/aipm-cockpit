// @vitest-environment node
//
// The relay runs on the server only; undici's Request/ReadableStream are the real ones
// under the node environment. Every upstream call goes through a fake `send`, so no
// test reaches the network.
import { Readable } from "node:stream";
import type { RequestOptions } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../diagnostics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../diagnostics")>();
  return { ...actual, logDiag: vi.fn() };
});

import { logDiag } from "../../diagnostics";
import { createKeyChecker } from "./_key-check";
import {
  relay,
  RELAY_MAX_BODY_BYTES,
  RELAY_TIMEOUT_MS,
  type RelaySend,
  type UpstreamResponse,
} from "./_relay";

const KEY = "sk-ant-secret-key";
const TOKEN = "gateway-secret-token";
const PROMPT = "a-secret-prompt";
const BASE = "https://gateway.example.com/acct/gw/anthropic";

const GATEWAY_ENV = { AIPM_AI_GATEWAY_URL: `${BASE}/`, AIPM_AI_GATEWAY_TOKEN: TOKEN };

type Call = {
  url: URL;
  options: RequestOptions;
  body: Buffer | undefined;
  destroyed: boolean;
  fire: (event: "error" | "timeout", err?: Error) => void;
  respond: (res: UpstreamResponse) => void;
};

/** A fake `https.request`: records the call; `onEnd` decides what upstream does. */
function fakeSend(onEnd: (call: Call) => void = () => {}): { send: RelaySend; calls: Call[] } {
  const calls: Call[] = [];
  const send: RelaySend = (url, options, onResponse) => {
    const listeners = new Map<string, (err?: Error) => void>();
    const call: Call = {
      url,
      options,
      body: undefined,
      destroyed: false,
      fire: (event, err) => listeners.get(event)?.(err),
      respond: onResponse,
    };
    calls.push(call);
    return {
      on(event, cb) {
        listeners.set(event, cb);
        return this;
      },
      end(body) {
        call.body = body ? Buffer.from(body) : undefined;
        queueMicrotask(() => onEnd(call));
        return this;
      },
      destroy() {
        call.destroyed = true;
        return this;
      },
    };
  };
  return { send, calls };
}

function upstream(
  status: number,
  body: string,
  contentType = "application/json",
  extra: Record<string, string> = {},
): UpstreamResponse {
  return Object.assign(Readable.from([Buffer.from(body)]), {
    statusCode: status,
    headers: { "content-type": contentType, ...extra },
  });
}

const respondWith = (status: number, body: string, contentType?: string) => (call: Call) =>
  call.respond(upstream(status, body, contentType));

function post(headers: Record<string, string> = {}, body = JSON.stringify({ prompt: PROMPT })): Request {
  return new Request("http://localhost:3000/api/ai/messages", {
    method: "POST",
    headers: {
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body,
  });
}

function getModels(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/ai/models", {
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "sec-fetch-site": "same-origin", ...headers },
  });
}

const ANTHROPIC_OK = JSON.stringify({ id: "msg_1", type: "message", content: [{ type: "text", text: "hi" }] });

describe("relay — refusals before any upstream call", () => {
  it("switched off → 503 integration-disabled", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post(), "messages", { ...GATEWAY_ENV, AIPM_DISABLED_INTEGRATIONS: "ai" }, send);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "integration-disabled" });
    expect(calls).toHaveLength(0);
  });

  it("invalid setting → 503 ai-gateway-invalid", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post(), "messages", { AIPM_AI_GATEWAY_URL: "http://insecure.example.com" }, send);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai-gateway-invalid" });
    expect(calls).toHaveLength(0);
  });

  it("a token without a URL is invalid too → 503", async () => {
    const { send } = fakeSend();
    const res = await relay(post(), "messages", { AIPM_AI_GATEWAY_TOKEN: TOKEN }, send);
    expect(res.status).toBe(503);
  });

  it("a token a header cannot carry is invalid → 503, nothing sent", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post(), "messages", { AIPM_AI_GATEWAY_URL: `${BASE}/`, AIPM_AI_GATEWAY_TOKEN: "to ken" }, send);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai-gateway-invalid" });
    expect(calls).toHaveLength(0);
  });

  it("direct deployment → 404, no relay", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post(), "messages", {}, send);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("Sec-Fetch-Site: cross-site → 403 not-same-origin", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post({ "sec-fetch-site": "cross-site" }), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not-same-origin" });
    expect(calls).toHaveLength(0);
  });

  it("Sec-Fetch-Site: same-site → 403 (a sibling subdomain is not this origin)", async () => {
    // The fake answers if called, so a regression fails on the status, not on a hung send.
    const { send, calls } = fakeSend(respondWith(200, ANTHROPIC_OK));
    const res = await relay(post({ "sec-fetch-site": "same-site" }), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("no Sec-Fetch-Site and a foreign Origin → 403", async () => {
    const { send, calls } = fakeSend();
    const req = new Request("http://localhost:3000/api/ai/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, origin: "https://evil.example.com" },
      body: "{}",
    });
    const res = await relay(req, "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("no Sec-Fetch-Site and the request's own Origin → relayed", async () => {
    const { send, calls } = fakeSend(respondWith(200, ANTHROPIC_OK));
    const req = new Request("http://localhost:3000/api/ai/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, origin: "http://localhost:3000" },
      body: "{}",
    });
    const res = await relay(req, "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
  ])("an x-api-key that is %s → 400 missing-api-key without calling send", async (_name, key) => {
    const { send, calls } = fakeSend(respondWith(200, ANTHROPIC_OK));
    const headers: Record<string, string> = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
    if (key !== undefined) headers["x-api-key"] = key;
    const req = new Request("http://localhost:3000/api/ai/messages", { method: "POST", headers, body: "{}" });
    const res = await relay(req, "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing-api-key" });
    expect(calls).toHaveLength(0);
  });

  it("models without a key → 400 missing-api-key without calling send", async () => {
    const { send, calls } = fakeSend(respondWith(200, "{}"));
    const req = new Request("http://localhost:3000/api/ai/models", { headers: { "sec-fetch-site": "same-origin" } });
    const res = await relay(req, "models", GATEWAY_ENV, send);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("the key check comes before the body cap (no key + oversized → 400, not 413)", async () => {
    const { send } = fakeSend();
    const req = post();
    Object.defineProperty(req, "headers", {
      value: new Headers({ "sec-fetch-site": "same-origin", "content-length": String(33 * 1024 * 1024) }),
    });
    const res = await relay(req, "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(400);
  });

  it("the same-origin check comes before the key check (cross-site, no key → 403)", async () => {
    const { send } = fakeSend();
    const req = new Request("http://localhost:3000/api/ai/messages", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
      body: "{}",
    });
    const res = await relay(req, "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(403);
  });

  it("a content-length over 32 MB → 413 without calling send", async () => {
    expect(RELAY_MAX_BODY_BYTES).toBe(32 * 1024 * 1024);
    const { send, calls } = fakeSend(respondWith(200, ANTHROPIC_OK));
    const req = post();
    Object.defineProperty(req, "headers", {
      value: new Headers({
        "x-api-key": KEY,
        "sec-fetch-site": "same-origin",
        "content-length": String(33 * 1024 * 1024),
      }),
    });
    const res = await relay(req, "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("a body over 32 MB with no content-length → 413 while reading, without calling send", async () => {
    const { send, calls } = fakeSend(respondWith(200, ANTHROPIC_OK));
    const big = new Uint8Array(RELAY_MAX_BODY_BYTES + 1);
    const req = new Request("http://localhost:3000/api/ai/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "sec-fetch-site": "same-origin" },
      body: new Blob([big]).stream(),
      duplex: "half",
    } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await relay(req, "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});

describe("relay — what is forwarded", () => {
  it("forwards exactly the four Anthropic headers plus the gateway token", async () => {
    const { send, calls } = fakeSend(respondWith(200, ANTHROPIC_OK));
    await relay(
      post({
        "anthropic-beta": "files-api-2025-04-14",
        cookie: "session=abc",
        "anthropic-dangerous-direct-browser-access": "true",
        authorization: "Bearer other",
      }),
      "messages",
      GATEWAY_ENV,
      send,
    );
    const headers = calls[0].options.headers as Record<string, string>;
    const { "content-length": length, ...rest } = headers;
    expect(rest).toEqual({
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
      "content-type": "application/json",
      "cf-aig-authorization": `Bearer ${TOKEN}`,
    });
    expect(length).toBe(String(calls[0].body?.length));
  });

  it("omits anthropic-beta when not sent and the token header when no token is set", async () => {
    const { send, calls } = fakeSend(respondWith(200, ANTHROPIC_OK));
    await relay(post(), "messages", { AIPM_AI_GATEWAY_URL: BASE }, send);
    const headers = calls[0].options.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(
      ["anthropic-version", "content-length", "content-type", "x-api-key"].sort(),
    );
  });

  it("messages → POST <base>/v1/messages with the body bytes unchanged, timeout 15 min", async () => {
    const { send, calls } = fakeSend(respondWith(200, ANTHROPIC_OK));
    const body = JSON.stringify({ model: "m", messages: [{ role: "user", content: PROMPT }] });
    await relay(post({}, body), "messages", GATEWAY_ENV, send);
    expect(calls[0].url.href).toBe(`${BASE}/v1/messages`);
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.timeout).toBe(RELAY_TIMEOUT_MS);
    expect(RELAY_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(calls[0].body?.toString("utf8")).toBe(body);
  });

  it("models → GET <base>/v1/models?limit=1000 with no body", async () => {
    const { send, calls } = fakeSend(respondWith(200, JSON.stringify({ data: [] })));
    const res = await relay(getModels(), "models", GATEWAY_ENV, send);
    expect(res.status).toBe(200);
    expect(calls[0].url.href).toBe(`${BASE}/v1/models?limit=1000`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].body).toBeUndefined();
  });
});

describe("relay — what comes back", () => {
  it("upstream 200 → same status, bytes and content-type", async () => {
    const sse = "event: message_start\ndata: {}\n\n";
    const { send } = fakeSend(respondWith(200, sse, "text/event-stream"));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe(sse);
  });

  it.each([
    [429, "rate_limit_error"],
    [401, "authentication_error"],
    [413, "request_too_large"],
    [529, "overloaded_error"],
  ])("upstream %i Anthropic-shaped → passed through unchanged", async (status, type) => {
    const body = JSON.stringify({ type: "error", error: { type, message: "m" } });
    const { send } = fakeSend(respondWith(status, body));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(status);
    expect(await res.text()).toBe(body);
  });

  it.each([401, 403])("upstream %i with an HTML body → 502 ai-gateway-rejected", async (status) => {
    const { send } = fakeSend(respondWith(status, "<html>Unauthorized</html>", "text/html"));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai-gateway-rejected" });
  });

  it.each([
    ["an HTML", "<html>Too many requests</html>", "text/html"],
    ["a non-Anthropic JSON", JSON.stringify({ error: "rate limited" }), "application/json"],
  ])("the gateway's own 429 with %s body → 502 ai-gateway-rate-limited, never Anthropic's rate limit", async (_n, body, type) => {
    const { send } = fakeSend(respondWith(429, body, type));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "ai-gateway-rate-limited" });
  });

  it.each([503, 500, 404, 302])("upstream %i with a non-Anthropic body → 502 ai-gateway-error", async (status) => {
    const { send } = fakeSend(respondWith(status, "<html>Bad gateway</html>", "text/html"));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai-gateway-error" });
  });

  it("JSON that is not Anthropic-shaped (error.type not a string) → 502 ai-gateway-error", async () => {
    const { send } = fakeSend(respondWith(500, JSON.stringify({ type: "error", error: { type: 5 } })));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai-gateway-error" });
  });

  it("a network error before any response → 502 ai-gateway-error", async () => {
    const { send } = fakeSend((call) => call.fire("error", new Error(`connect failed ${KEY}`)));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai-gateway-error" });
  });

  it("an upstream timeout → the upstream request is destroyed and 504 ai-gateway-error", async () => {
    const { send, calls } = fakeSend((call) => call.fire("timeout"));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(calls[0].destroyed).toBe(true);
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "ai-gateway-error" });
  });

  it.each([304, 600, 199])(
    "upstream status %i (not a passable error status) → 502 ai-gateway-error, even with an Anthropic-shaped body",
    async (status) => {
      const body = JSON.stringify({ type: "error", error: { type: "api_error", message: "m" } });
      const { send } = fakeSend(respondWith(status, body));
      const res = await relay(post(), "messages", GATEWAY_ENV, send);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "ai-gateway-error" });
    },
  );

  it("passes back only content-type and cache-control, never set-cookie or gateway headers", async () => {
    const { send } = fakeSend((call) =>
      call.respond(
        Object.assign(Readable.from([Buffer.from(ANTHROPIC_OK)]), {
          statusCode: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "gw=1; Path=/",
            "cf-ray": "abc123-FRA",
            "cf-aig-log-id": "log-1",
          },
        }),
      ),
    );
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect([...res.headers.keys()].sort()).toEqual(["cache-control", "content-type"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("relay — the browser goes away", () => {
  it("an abort before upstream answers destroys the upstream request", async () => {
    const controller = new AbortController();
    const { send, calls } = fakeSend(() => controller.abort());
    const req = new Request(post(), { signal: controller.signal });
    await relay(req, "messages", GATEWAY_ENV, send);
    expect(calls).toHaveLength(1);
    expect(calls[0].destroyed).toBe(true);
  });

  it("an abort mid-stream destroys the upstream request", async () => {
    const controller = new AbortController();
    // A stream that sends one chunk and then never ends.
    const endless = new Readable({ read() {} });
    endless.push(Buffer.from("event: ping\n\n"));
    const { send, calls } = fakeSend((call) =>
      call.respond(Object.assign(endless, { statusCode: 200, headers: { "content-type": "text/event-stream" } })),
    );
    const req = new Request(post(), { signal: controller.signal });
    const res = await relay(req, "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    expect(calls[0].destroyed).toBe(false);
    controller.abort();
    expect(calls[0].destroyed).toBe(true);
  });

  it("cancelling the response stream destroys the upstream request", async () => {
    const endless = new Readable({ read() {} });
    endless.push(Buffer.from("event: ping\n\n"));
    const { send, calls } = fakeSend((call) =>
      call.respond(Object.assign(endless, { statusCode: 200, headers: { "content-type": "text/event-stream" } })),
    );
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    await res.body!.cancel();
    expect(calls[0].destroyed).toBe(true);
  });
});

describe("relay — an upstream answer it drops never raises an unhandled error", () => {
  /** A send whose `destroy` makes the unread upstream answer emit 'error', as a reset socket does.
   *  `emit("error")` with no listener throws, so `threw` records an error nobody handles. */
  function resettingSend(res: UpstreamResponse & Readable) {
    const seen = { destroyed: false, threw: false };
    const send: RelaySend = (_url, _options, onResponse) => ({
      on() {
        return this;
      },
      end() {
        queueMicrotask(() => onResponse(res));
        return this;
      },
      destroy() {
        seen.destroyed = true;
        try {
          res.emit("error", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
        } catch {
          seen.threw = true;
        }
        return this;
      },
    });
    return { send, seen };
  }

  const answer = (status: number, contentType: string) =>
    Object.assign(new Readable({ read() {} }), { statusCode: status, headers: { "content-type": contentType } });

  it.each([302, 304, 600, 199])("upstream %i: the answer is dropped with an error listener attached", async (status) => {
    const { send, seen } = resettingSend(answer(status, "application/json"));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(502);
    expect(seen.destroyed).toBe(true);
    expect(seen.threw).toBe(false);
  });

  it("an answer whose response cannot be built is dropped with an error listener attached", async () => {
    // A content-type a Headers object refuses makes building the response throw.
    const { send, seen } = resettingSend(answer(200, "text/plain\r\nx-injected: 1"));
    const res = await relay(post(), "messages", GATEWAY_ENV, send);
    expect(res.status).toBe(502);
    expect(seen.destroyed).toBe(true);
    expect(seen.threw).toBe(false);
  });
});

describe("relay — logs nothing secret", () => {
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
    }
  });
  afterEach(() => {
    spies.splice(0).forEach((s) => s.mockRestore());
    vi.mocked(logDiag).mockClear();
  });

  it("no console or diagnostics output carries the key, token, body or URL", async () => {
    const scenarios: Array<(call: Call) => void> = [
      respondWith(200, ANTHROPIC_OK),
      respondWith(401, "<html>no</html>", "text/html"),
      respondWith(503, "<html>down</html>", "text/html"),
      (call) => call.fire("error", new Error(`boom ${KEY} ${TOKEN}`)),
      (call) => call.fire("timeout"),
    ];
    for (const onEnd of scenarios) {
      const { send } = fakeSend(onEnd);
      const res = await relay(post(), "messages", GATEWAY_ENV, send);
      await res.text();
    }
    const logged = JSON.stringify([
      ...spies.map((s) => s.mock.calls),
      vi.mocked(logDiag).mock.calls,
    ]);
    for (const secret of [KEY, TOKEN, PROMPT, "gateway.example.com"]) {
      expect(logged).not.toContain(secret);
    }
  });
});

const ORG = "11111111-2222-3333-4444-555555555555";
const RESTRICTED_ENV = { AIPM_AI_ORGANIZATION_ID: ORG };

const isPreflight = (call: Call) => call.url.pathname.endsWith("/v1/models") && call.url.searchParams.get("limit") === "1";

/** Answers the key check's pre-flight with `orgId` (and `ws`), every other call with `onEnd`. */
const checkedAs =
  (orgId: string, onEnd: (call: Call) => void = respondWith(200, ANTHROPIC_OK), ws?: string) =>
  (call: Call) => {
    if (!isPreflight(call)) return onEnd(call);
    const headers: Record<string, string> = { "anthropic-organization-id": orgId };
    if (ws) headers["anthropic-workspace-id"] = ws;
    call.respond(upstream(200, '{"data":[]}', "application/json", headers));
  };

describe("relay — straight to Anthropic when keys are restricted and there is no gateway", () => {
  it("a Messages call goes to api.anthropic.com with the four forwarded headers and no gateway token", async () => {
    const { send, calls } = fakeSend(checkedAs(ORG));
    const res = await relay(
      post({ "anthropic-beta": "b1", cookie: "session=1" }),
      "messages",
      RESTRICTED_ENV,
      send,
      createKeyChecker(),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].url.href).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[1].options.method).toBe("POST");
    const headers = calls[1].options.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(
      ["anthropic-beta", "anthropic-version", "content-length", "content-type", "x-api-key"],
    );
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["cf-aig-authorization"]).toBeUndefined();
  });

  it("a models call goes to /v1/models?limit=1000", async () => {
    const { send, calls } = fakeSend(checkedAs(ORG, respondWith(200, "{}")));
    await relay(getModels(), "models", RESTRICTED_ENV, send, createKeyChecker());
    expect(calls).toHaveLength(2);
    expect(calls[1].url.href).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(calls[1].options.method).toBe("GET");
  });

  it("an invalid restriction → 503 ai-gateway-invalid, nothing sent", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post(), "messages", { AIPM_AI_ORGANIZATION_ID: "not-an-id" }, send);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai-gateway-invalid" });
    expect(calls).toHaveLength(0);
  });

  it("a call without a key of its own is still refused with 400", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post({ "x-api-key": " " }), "messages", RESTRICTED_ENV, send);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("a gateway wins over the restriction: the check and the call both go to it with its token (K9)", async () => {
    const { send, calls } = fakeSend(checkedAs(ORG));
    await relay(post(), "messages", { ...GATEWAY_ENV, ...RESTRICTED_ENV }, send, createKeyChecker());
    expect(calls.map((c) => c.url.href)).toEqual([`${BASE}/v1/models?limit=1`, `${BASE}/v1/messages`]);
    for (const call of calls) {
      expect((call.options.headers as Record<string, string>)["cf-aig-authorization"]).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("a valid gateway beside an invalid restriction → 503 ai-gateway-invalid, nothing sent", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post(), "messages", { ...GATEWAY_ENV, AIPM_AI_ORGANIZATION_ID: "not-an-id" }, send);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai-gateway-invalid" });
    expect(calls).toHaveLength(0);
  });

  it("an invalid gateway URL wins over a valid restriction: 503, nothing sent", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post(), "messages", { AIPM_AI_GATEWAY_URL: "http://insecure.example.com", ...RESTRICTED_ENV }, send);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai-gateway-invalid" });
    expect(calls).toHaveLength(0);
  });

  it("a gateway token with no URL beside a restriction → 503 ai-gateway-invalid, nothing sent", async () => {
    const { send, calls } = fakeSend();
    const res = await relay(post(), "messages", { AIPM_AI_GATEWAY_TOKEN: TOKEN, ...RESTRICTED_ENV }, send);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai-gateway-invalid" });
    expect(calls).toHaveLength(0);
  });

  it("neither set → 404 as before", async () => {
    const { send, calls } = fakeSend();
    expect((await relay(post(), "messages", {}, send)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

const OTHER_ORG = "99999999-8888-7777-6666-555555555555";
const WS = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_WS = "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee";
const isMessages = (call: Call) => call.url.pathname.endsWith("/v1/messages");

describe("relay — the key check before forwarding (AI organisation key)", () => {
  it("another organisation → 403 ai-key-wrong-organization; no Messages call, no body read upstream", async () => {
    const { send, calls } = fakeSend(checkedAs(OTHER_ORG));
    const res = await relay(post(), "messages", RESTRICTED_ENV, send, createKeyChecker());
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "ai-key-wrong-organization" });
    expect(calls).toHaveLength(1);
    expect(isPreflight(calls[0])).toBe(true);
    expect(calls.some(isMessages)).toBe(false);
    expect(calls[0].body).toBeUndefined();
  });

  it("a workspace not on the list → 403 ai-key-wrong-workspace; no Messages call", async () => {
    const { send, calls } = fakeSend(checkedAs(ORG, undefined, OTHER_WS));
    const env = { ...RESTRICTED_ENV, AIPM_AI_WORKSPACE_IDS: WS };
    const res = await relay(post(), "messages", env, send, createKeyChecker());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai-key-wrong-workspace" });
    expect(calls.some(isMessages)).toBe(false);
  });

  it("a pass → the Messages call follows the pre-flight, with the caller's key on both", async () => {
    const { send, calls } = fakeSend(checkedAs(ORG, undefined, WS));
    const env = { ...RESTRICTED_ENV, AIPM_AI_WORKSPACE_IDS: WS };
    const res = await relay(post(), "messages", env, send, createKeyChecker());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ANTHROPIC_OK);
    expect(calls.map((c) => c.url.href)).toEqual([
      "https://api.anthropic.com/v1/models?limit=1",
      "https://api.anthropic.com/v1/messages",
    ]);
    for (const call of calls) expect((call.options.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
  });

  it("a passed key is not checked again on the next call", async () => {
    const { send, calls } = fakeSend(checkedAs(ORG));
    const checker = createKeyChecker();
    await (await relay(post(), "messages", RESTRICTED_ENV, send, checker)).text();
    await (await relay(post(), "messages", RESTRICTED_ENV, send, checker)).text();
    expect(calls.filter(isPreflight)).toHaveLength(1);
    expect(calls.filter(isMessages)).toHaveLength(2);
  });

  it("the check unavailable → 503 ai-key-check-unavailable; no Messages call", async () => {
    const { send, calls } = fakeSend((call) => (isPreflight(call) ? call.fire("timeout") : respondWith(200, ANTHROPIC_OK)(call)));
    const res = await relay(post(), "messages", RESTRICTED_ENV, send, createKeyChecker());
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "ai-key-check-unavailable" });
    expect(calls.some(isMessages)).toBe(false);
  });

  it("workspaces configured and the pre-flight has no workspace header → 503; no Messages call (Review Focus 2)", async () => {
    const { send, calls } = fakeSend(checkedAs(ORG));
    const env = { ...RESTRICTED_ENV, AIPM_AI_WORKSPACE_IDS: WS };
    const res = await relay(post(), "messages", env, send, createKeyChecker());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai-key-check-unavailable" });
    expect(calls.some(isMessages)).toBe(false);
  });

  it("Anthropic refuses the key (401) → its own answer, unchanged; no Messages call", async () => {
    const refusal = JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    const { send, calls } = fakeSend(respondWith(401, refusal));
    const res = await relay(post(), "messages", RESTRICTED_ENV, send, createKeyChecker());
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(refusal);
    expect(calls).toHaveLength(1);
    expect(calls.some(isMessages)).toBe(false);
  });

  it("a refused key's model list is never returned: only the pre-flight goes out", async () => {
    const { send, calls } = fakeSend(checkedAs(OTHER_ORG, respondWith(200, '{"data":[{"id":"claude-x"}]}')));
    const res = await relay(getModels(), "models", RESTRICTED_ENV, send, createKeyChecker());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ai-key-wrong-organization" });
    expect(calls).toHaveLength(1);
  });

  it("through a gateway, a wrong organisation is refused before any Messages call", async () => {
    const { send, calls } = fakeSend(checkedAs(OTHER_ORG));
    const res = await relay(post(), "messages", { ...GATEWAY_ENV, ...RESTRICTED_ENV }, send, createKeyChecker());
    expect(res.status).toBe(403);
    expect(calls.map((c) => c.url.href)).toEqual([`${BASE}/v1/models?limit=1`]);
  });

  it("no restriction → no pre-flight at all (today's behaviour), gateway or not", async () => {
    const { send, calls } = fakeSend(respondWith(200, ANTHROPIC_OK));
    const checker = createKeyChecker();
    expect((await relay(post(), "messages", GATEWAY_ENV, send, checker)).status).toBe(200);
    expect(calls.map((c) => c.url.href)).toEqual([`${BASE}/v1/messages`]);
    expect(checker.size()).toBe(0);
  });

  it("the default checker is used when none is passed (one module-level instance)", async () => {
    const { send, calls } = fakeSend(checkedAs(OTHER_ORG));
    const res = await relay(post({ "x-api-key": "sk-ant-default-instance-key" }), "messages", RESTRICTED_ENV, send);
    expect(res.status).toBe(403);
    expect(calls.some(isMessages)).toBe(false);
  });

  it("logs nothing that carries the key in any check outcome", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      for (const onEnd of [checkedAs(ORG), checkedAs(OTHER_ORG), (call: Call) => call.fire("error", new Error(`boom ${KEY}`))]) {
        const { send } = fakeSend(onEnd);
        const res = await relay(post(), "messages", RESTRICTED_ENV, send, createKeyChecker());
        expect(await res.text()).not.toContain(KEY);
      }
      const logged = JSON.stringify([...spies.map((s) => s.mock.calls), vi.mocked(logDiag).mock.calls]);
      expect(logged).not.toContain(KEY);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
