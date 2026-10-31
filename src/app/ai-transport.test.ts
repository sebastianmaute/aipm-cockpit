import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiDeploymentError,
  AiGatewayError,
  confirmAiDeployment,
  getAiModels,
  postAiMessages,
  subscribeAiUsage,
} from "./ai-transport";
import { setAiDeploymentState, type AiDeploymentState } from "./ai-deployment";
import { fetchAnthropicModels } from "./anthropic-models";
import { __resetAiKeyStatusForTests, getAiKeyStatus, syncAiKey } from "./ai-key-status";
import { aiTransportMessageKey } from "./ai-errors";
import * as transport from "./ai-transport";
import * as models from "./anthropic-models";
import { aiStatusResponse, DIRECT_AI_STATUS } from "../test/ai-status-fetch";
import { __setAiStatusRequestForTests } from "./ai-status-request";

const GATEWAY: AiDeploymentState = { off: false, route: "gateway", invalid: false, keyRestricted: false };
const RELAY: AiDeploymentState = { off: false, route: "relay", invalid: false, keyRestricted: true };
const KEY = "sk-ant-api03-test";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = [string, RequestInit | undefined];

/** A fetch stub: the status request answers `status` (a state, a Response, or an Error to throw);
 *  every other request answers `reply`. */
function stubFetch(status: AiDeploymentState | Response | Error, reply: () => Response = () => json({ ok: true })) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    void init;
    if (input === "/api/ai/status") {
      if (status instanceof Error) throw status;
      return status instanceof Response ? status : aiStatusResponse(status);
    }
    return reply();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as { mock: { calls: Call[] } } & typeof fetchMock;
}

const urls = (m: { mock: { calls: Call[] } }) => m.mock.calls.map((c) => c[0]);

// The test setup answers the status request itself; here the real request runs against the stub.
beforeEach(() => __setAiStatusRequestForTests(null));

afterEach(() => {
  vi.unstubAllGlobals();
  setAiDeploymentState(DIRECT_AI_STATUS);
  __resetAiKeyStatusForTests();
});

/** The URL's host is exactly Anthropic's, read as a full URL or as a scheme-less host and path. */
function hasAnthropicHost(value: string): boolean {
  const hostOf = (candidate: string): string | null => {
    try {
      return new URL(candidate).host;
    } catch {
      return null;
    }
  };
  return [hostOf(value), hostOf(`https://${value}`)].some((host) => host === "api.anthropic.com");
}

describe("the Anthropic URLs stay inside the transport", () => {
  it("neither the transport nor anthropic-models exports an Anthropic URL", () => {
    const exported = [...Object.values(transport), ...Object.values(models)];
    expect(exported.filter((v) => typeof v === "string" && hasAnthropicHost(v))).toEqual([]);
  });

  it("the host check sees an Anthropic URL in either form, and only the exact host (not vacuous)", () => {
    expect(hasAnthropicHost("https://api.anthropic.com/v1/messages")).toBe(true);
    expect(hasAnthropicHost("api.anthropic.com/v1/models")).toBe(true);
    expect(hasAnthropicHost("https://api.anthropic.com.evil.example/v1")).toBe(false);
    expect(hasAnthropicHost("/api/ai/messages")).toBe(false);
  });
});

describe("confirmAiDeployment", () => {
  it("asks the status route without the HTTP cache", async () => {
    const f = stubFetch(DIRECT_AI_STATUS);
    await confirmAiDeployment();
    expect(f.mock.calls[0][0]).toBe("/api/ai/status");
    expect(f.mock.calls[0][1]?.cache).toBe("no-store");
  });

  it.each([
    ["off", { off: true, route: "direct", invalid: false, keyRestricted: false }],
    ["invalid", { off: false, route: "direct", invalid: true, keyRestricted: false }],
    ["route-changed", GATEWAY],
  ] as const)("throws %s", async (reason, state) => {
    stubFetch(state);
    const err = await confirmAiDeployment().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiDeploymentError);
    expect((err as AiDeploymentError).reason).toBe(reason);
  });

  // Review 5, C1: AI switched off is "off" whatever the answer says about the people lock — nothing is sent either way.
  it("an answer that says AI is off is off even without the people lock", async () => {
    stubFetch(json({ off: true, route: "direct", invalid: false, keyRestricted: false }));
    const err = await confirmAiDeployment().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiDeploymentError);
    expect((err as AiDeploymentError).reason).toBe("off");
  });

  it.each([
    ["the server is down", new TypeError("Failed to fetch")],
    ["the status is not 200", new Response("", { status: 500 })],
    ["the body is not a state", json({ off: "no" })],
    // Review 4, M3: the people lock is part of the answer; without it the answer is not trusted.
    ["the state says nothing about the people lock", json({ off: false, route: "direct", invalid: false, keyRestricted: false })],
    ["the people lock is not a boolean", json({ off: false, route: "direct", invalid: false, peopleForced: "yes" })],
  ])("is unconfirmed when %s", async (_label, status) => {
    stubFetch(status);
    const err = await confirmAiDeployment().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiDeploymentError);
    expect((err as AiDeploymentError).reason).toBe("unconfirmed");
  });

  it("accepts a relay answer that carries a boolean keyRestricted", async () => {
    setAiDeploymentState(RELAY);
    stubFetch(RELAY);
    await expect(confirmAiDeployment()).resolves.toEqual({ peopleForced: false });
  });

  it.each([
    ["keyRestricted is missing", json({ off: false, route: "relay", invalid: false, peopleForced: false })],
    ["keyRestricted is not a boolean", json({ off: false, route: "relay", invalid: false, keyRestricted: "yes", peopleForced: false })],
  ])("is unconfirmed when %s", async (_label, status) => {
    setAiDeploymentState(RELAY);
    stubFetch(status);
    const err = await confirmAiDeployment().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiDeploymentError);
    expect((err as AiDeploymentError).reason).toBe("unconfirmed");
  });

  it("page state direct, status answers relay: route-changed, and Anthropic is never called", async () => {
    const f = stubFetch(RELAY);
    const err = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiDeploymentError);
    expect((err as AiDeploymentError).reason).toBe("route-changed");
    expect(urls(f)).toEqual(["/api/ai/status"]);
  });

  it("lets an abort through as an abort, never as unconfirmed", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    stubFetch(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const err = await confirmAiDeployment(ctrl.signal).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AiDeploymentError);
    expect((err as { name?: string }).name).toBe("AbortError");
  });
});

describe("postAiMessages", () => {
  it("direct: checks the status, then posts to Anthropic with today's four headers", async () => {
    const f = stubFetch(DIRECT_AI_STATUS);
    await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{\"a\":1}", path: "chat" });
    expect(urls(f)).toEqual(["/api/ai/status", "https://api.anthropic.com/v1/messages"]);
    const init = f.mock.calls[1][1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{\"a\":1}");
    expect(init?.headers).toEqual({
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    });
  });

  it("gateway: posts to the same-origin relay without the browser-access header", async () => {
    setAiDeploymentState(GATEWAY);
    const f = stubFetch(GATEWAY);
    await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" });
    expect(urls(f)).toEqual(["/api/ai/status", "/api/ai/messages"]);
    expect(f.mock.calls[1][1]?.headers).toEqual({
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
  });

  it("relay: posts to the same-origin relay, never to Anthropic, without the browser-access header", async () => {
    setAiDeploymentState(RELAY);
    const f = stubFetch(RELAY);
    await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" });
    expect(urls(f)).toEqual(["/api/ai/status", "/api/ai/messages"]);
    expect(urls(f).some((u) => hasAnthropicHost(u))).toBe(false);
    expect(f.mock.calls[1][1]?.headers).toEqual({
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
  });

  it("relay: a relay 502 is read as a relay answer, like the gateway's", async () => {
    setAiDeploymentState(RELAY);
    stubFetch(RELAY, () => json({ error: "ai-gateway-error" }, 502));
    await expect(postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" })).rejects.toBeInstanceOf(AiGatewayError);
  });

  it.each([
    [{ off: true, route: "direct", invalid: false, keyRestricted: false }],
    [{ off: false, route: "direct", invalid: true, keyRestricted: false }],
    [GATEWAY],
  ] as const)("never posts when the status refuses (%o)", async (state) => {
    const f = stubFetch(state);
    await expect(postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" })).rejects.toBeInstanceOf(AiDeploymentError);
    expect(urls(f)).toEqual(["/api/ai/status"]);
  });

  it("an abort that lands while the status is asked stops before the post", async () => {
    const ctrl = new AbortController();
    const f = vi.fn(async (input: string): Promise<Response> => {
      if (input === "/api/ai/status") {
        ctrl.abort();
        return aiStatusResponse(DIRECT_AI_STATUS);
      }
      return json({});
    });
    vi.stubGlobal("fetch", f);
    const err = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat", signal: ctrl.signal }).catch((e: unknown) => e);
    expect((err as { name?: string }).name).toBe("AbortError");
    expect(f.mock.calls.map((c) => c[0])).toEqual(["/api/ai/status"]);
  });

  it("never posts when the server is down", async () => {
    const f = stubFetch(new TypeError("Failed to fetch"));
    const err = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" }).catch((e: unknown) => e);
    expect((err as AiDeploymentError).reason).toBe("unconfirmed");
    expect(urls(f)).toEqual(["/api/ai/status"]);
  });

  it.each(["ai-gateway-rejected", "ai-gateway-error", "ai-gateway-rate-limited"] as const)("relay 502 %s throws AiGatewayError", async (code) => {
    setAiDeploymentState(GATEWAY);
    stubFetch(GATEWAY, () => json({ error: code }, 502));
    const err = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiGatewayError);
    expect((err as AiGatewayError).code).toBe(code);
  });

  it("relay 504 timeout throws AiGatewayError ai-gateway-error", async () => {
    setAiDeploymentState(GATEWAY);
    stubFetch(GATEWAY, () => json({ error: "ai-gateway-error" }, 504));
    const err = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" }).catch((e: unknown) => e);
    expect((err as AiGatewayError).code).toBe("ai-gateway-error");
  });

  it("relay 413 (request too large, Anthropic-shaped) reaches the caller unchanged, like a direct 413", async () => {
    setAiDeploymentState(GATEWAY);
    const tooLarge = { type: "error", error: { type: "request_too_large", message: "Request exceeds the maximum allowed size." } };
    stubFetch(GATEWAY, () => json(tooLarge, 413));
    const res = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(tooLarge);
  });

  it.each(["bad-request", "missing-api-key"])("relay 400 %s reaches the caller as a plain 400, never a gateway error", async (code) => {
    setAiDeploymentState(GATEWAY);
    stubFetch(GATEWAY, () => json({ error: code }, 400));
    const res = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
  });

  it("relay's own 403 is a gateway error, never a key verdict", async () => {
    setAiDeploymentState(GATEWAY);
    stubFetch(GATEWAY, () => json({ error: "not-same-origin" }, 403));
    await expect(postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" })).rejects.toBeInstanceOf(AiGatewayError);
  });

  it.each([
    [503, { error: "integration-disabled" }, "off"],
    [503, { error: "ai-gateway-invalid" }, "invalid"],
  ] as const)("relay %i %o after a good status is a deployment error", async (status, body, reason) => {
    setAiDeploymentState(GATEWAY);
    stubFetch(GATEWAY, () => json(body, status));
    const err = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" }).catch((e: unknown) => e);
    expect((err as AiDeploymentError).reason).toBe(reason);
  });

  it("relay 404 (the deployment went direct) is route-changed", async () => {
    setAiDeploymentState(GATEWAY);
    stubFetch(GATEWAY, () => new Response(null, { status: 404 }));
    const err = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" }).catch((e: unknown) => e);
    expect((err as AiDeploymentError).reason).toBe("route-changed");
  });

  it.each([
    ["an empty body", () => new Response(null, { status: 503 })],
    ["a non-JSON body", () => new Response("Service Unavailable", { status: 503 })],
    ["JSON without a relay code", () => json({ error: "something-else" }, 503)],
  ])("an uncoded relay 503 (%s) is unconfirmed, never route-changed", async (_label, reply) => {
    setAiDeploymentState(GATEWAY);
    stubFetch(GATEWAY, reply);
    const err = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiDeploymentError);
    expect((err as AiDeploymentError).reason).toBe("unconfirmed");
  });

  it.each(["direct", "gateway"] as const)("%s: beforeSend runs after the status answer and can stop the send", async (r) => {
    const state: AiDeploymentState = { off: false, route: r, invalid: false, keyRestricted: false };
    setAiDeploymentState(state);
    const order: string[] = [];
    const f = vi.fn(async (input: string): Promise<Response> => {
      order.push(input);
      return input === "/api/ai/status" ? aiStatusResponse(state) : json({});
    });
    vi.stubGlobal("fetch", f);
    const stop = new Error("stopped");
    const beforeSend = vi.fn(() => {
      order.push("beforeSend");
      throw stop;
    });
    const err = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat", beforeSend }).catch((e: unknown) => e);
    expect(err).toBe(stop);
    expect(order).toEqual(["/api/ai/status", "beforeSend"]);
  });

  it("beforeSend that returns lets the send go out once", async () => {
    const f = stubFetch(DIRECT_AI_STATUS);
    const beforeSend = vi.fn();
    await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat", beforeSend });
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(urls(f)).toEqual(["/api/ai/status", "https://api.anthropic.com/v1/messages"]);
  });

  it("an Anthropic-shaped error through the relay reaches the caller unchanged", async () => {
    setAiDeploymentState(GATEWAY);
    const anthropic = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
    stubFetch(GATEWAY, () => json(anthropic, 401));
    const res = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(anthropic);
  });

  it("a direct non-2xx is returned to the caller unchanged", async () => {
    stubFetch(DIRECT_AI_STATUS, () => json({ error: "ai-gateway-rejected" }, 502));
    const res = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" });
    expect(res.status).toBe(502);
  });
});

describe("getAiModels", () => {
  it("direct: today's URL and headers, after the status check", async () => {
    const f = stubFetch(DIRECT_AI_STATUS);
    await getAiModels(KEY);
    expect(urls(f)).toEqual(["/api/ai/status", "https://api.anthropic.com/v1/models?limit=1000"]);
    expect(f.mock.calls[1][1]?.headers).toEqual({
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it("relay: the models come from /api/ai/models, never from Anthropic", async () => {
    setAiDeploymentState(RELAY);
    const f = stubFetch(RELAY);
    await getAiModels(KEY);
    expect(urls(f)).toEqual(["/api/ai/status", "/api/ai/models"]);
    expect(f.mock.calls[1][1]?.headers).toEqual({ "x-api-key": KEY, "anthropic-version": "2023-06-01" });
  });

  it("gateway: the relay, without the browser-access header", async () => {
    setAiDeploymentState(GATEWAY);
    const f = stubFetch(GATEWAY);
    await getAiModels(KEY);
    expect(urls(f)).toEqual(["/api/ai/status", "/api/ai/models"]);
    expect(f.mock.calls[1][1]?.headers).toEqual({ "x-api-key": KEY, "anthropic-version": "2023-06-01" });
  });
});

describe("the key check never reads a gateway or deployment failure as a key verdict", () => {
  beforeEach(() => syncAiKey(KEY));

  it.each([
    ["relay 502 rejected", () => json({ error: "ai-gateway-rejected" }, 502)],
    ["relay 403 not-same-origin", () => json({ error: "not-same-origin" }, 403)],
  ])("%s: fetchAnthropicModels rejects and the verdict stays unknown", async (_label, reply) => {
    setAiDeploymentState(GATEWAY);
    stubFetch(GATEWAY, reply);
    await expect(fetchAnthropicModels(KEY)).rejects.toBeInstanceOf(Error);
    expect(getAiKeyStatus()).toBe("unknown");
  });

  it("status unconfirmed: rejects, verdict unknown, Anthropic never called", async () => {
    const f = stubFetch(new TypeError("Failed to fetch"));
    await expect(fetchAnthropicModels(KEY)).rejects.toBeInstanceOf(AiDeploymentError);
    expect(getAiKeyStatus()).toBe("unknown");
    expect(urls(f)).toEqual(["/api/ai/status"]);
  });

  it("a real Anthropic 401 through the relay is still the key verdict", async () => {
    setAiDeploymentState(GATEWAY);
    stubFetch(GATEWAY, () => json({ type: "error", error: { type: "authentication_error", message: "x" } }, 401));
    await expect(fetchAnthropicModels(KEY)).resolves.toEqual({ kind: "http", status: 401 });
    expect(getAiKeyStatus()).toBe("rejected");
  });
});

describe("subscribeAiUsage", () => {
  // Every subscription is undone after its test, whether or not it passed: a listener left behind
  // would hear later tests' sends.
  const subscriptions: (() => void)[] = [];
  afterEach(() => {
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  });
  function subscribe(listener: Parameters<typeof subscribeAiUsage>[0]): () => void {
    const unsubscribe = subscribeAiUsage(listener);
    subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  it("notifies once per 2xx with the normalised usage, leaving the caller's body readable", async () => {
    const seen: unknown[] = [];
    subscribe((path, usage) => seen.push([path, usage]));
    stubFetch(DIRECT_AI_STATUS, () => json({ content: [], usage: { input_tokens: 7, output_tokens: 3 } }));
    const res = await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" });
    expect(await res.json()).toEqual({ content: [], usage: { input_tokens: 7, output_tokens: 3 } });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen).toEqual([
      ["chat", { input_tokens: 7, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }],
    ]);
  });

  it("never holds the send while the usage is read", async () => {
    subscribe(() => {});
    // A 2xx whose body never finishes: reading the clone never resolves.
    stubFetch(DIRECT_AI_STATUS, () => new Response(new ReadableStream({ start() {} }), { status: 200 }));
    const outcome = await Promise.race([
      postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" }).then(() => "sent"),
      new Promise((r) => setTimeout(() => r("held"), 200)),
    ]);
    expect(outcome).toBe("sent");
  });

  it("does not notify on an error response, nor after unsubscribing", async () => {
    const listener = vi.fn();
    const off = subscribe(listener);
    stubFetch(DIRECT_AI_STATUS, () => json({ type: "error", error: { type: "invalid_request_error" } }, 400));
    await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" });
    expect(listener).not.toHaveBeenCalled();
    off();
    stubFetch(DIRECT_AI_STATUS, () => json({ usage: { input_tokens: 1 } }));
    await postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("a throwing listener never breaks the send", async () => {
    subscribe(() => {
      throw new Error("listener");
    });
    stubFetch(DIRECT_AI_STATUS, () => json({ usage: { input_tokens: 1 } }));
    await expect(postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "x" })).resolves.toBeInstanceOf(Response);
  });
});

describe("aiTransportMessageKey", () => {
  it.each([
    [new AiDeploymentError("off"), "aiDeploymentOff"],
    [new AiDeploymentError("invalid"), "aiDeploymentInvalid"],
    [new AiDeploymentError("route-changed"), "aiDeploymentChanged"],
    [new AiDeploymentError("unconfirmed"), "aiDeploymentUnconfirmed"],
    [new AiGatewayError("ai-gateway-rejected"), "aiGatewayRejected"],
    [new AiGatewayError("ai-gateway-error"), "aiGatewayFailed"],
    [new AiGatewayError("ai-gateway-rate-limited"), "aiGatewayRateLimited"],
    [new Error("x"), null],
  ] as const)("%o → %s", (err, key) => {
    expect(aiTransportMessageKey(err)).toBe(key);
  });
});
