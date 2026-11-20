// §798 — every AI request is timed (5 minutes per attempt) and a rate-limit / overload answer is
// retried at most twice. Fake timers throughout: no wait or timeout here is real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiDeploymentError, AiGatewayError, getAiModels, postAiMessages, subscribeAiUsage } from "./ai-transport";
import { setAiDeploymentState, type AiDeploymentState } from "./ai-deployment";
import { AiTimeoutError, AI_GATEWAY_RATE_LIMITED, AI_RELAY_RATE_LIMITED } from "./ai-errors";
import { AI_REQUEST_TIMEOUT_MS } from "./ai-retry";
import { aiPrivacyFor, type AiPrivacy } from "./ai-privacy";
import { aiStatusResponse, DIRECT_AI_STATUS } from "../test/ai-status-fetch";
import { __setAiStatusRequestForTests } from "./ai-status-request";
import { withPeopleAllowed } from "./ai-people-protection";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { Resource } from "./types";

const KEY = "sk-ant-api03-test";
const GATEWAY: AiDeploymentState = { off: false, route: "gateway", invalid: false, keyRestricted: false, chat: null };
const UNPROTECTED: AiPrivacy = { protected: false };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const overloaded = (status = 529, headers: Record<string, string> = {}) =>
  json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, status, headers);
const limited = (headers: Record<string, string> = {}) =>
  json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429, headers);

type StatusAnswer = AiDeploymentState | typeof DIRECT_AI_STATUS;

/** A fetch stub: the status request answers `statusFor(n)` (n = 1-based status call), every other
 *  request answers the next entry of `replies` (the last one repeats). */
function stubFetch(
  replies: Array<(init?: RequestInit) => Response | Promise<Response>>,
  statusFor: (n: number) => StatusAnswer = () => DIRECT_AI_STATUS,
) {
  let statusCalls = 0;
  let sends = 0;
  const mock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    if (input === "/api/ai/status") return aiStatusResponse(statusFor(++statusCalls));
    const reply = replies[Math.min(sends++, replies.length - 1)];
    return reply(init);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const sends = (m: ReturnType<typeof stubFetch>) => m.mock.calls.filter((c) => c[0] !== "/api/ai/status");
const statusCalls = (m: ReturnType<typeof stubFetch>) => m.mock.calls.filter((c) => c[0] === "/api/ai/status");

/** Settle a promise's outcome without an unhandled rejection while timers are advanced. */
function settle<T>(p: Promise<T>): { result: () => { ok: true; value: T } | { ok: false; error: unknown } | undefined } {
  let out: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
  p.then(
    (value) => (out = { ok: true, value }),
    (error: unknown) => (out = { ok: false, error }),
  );
  return { result: () => out };
}

const never = () => new Promise<Response>(() => {});
const stalledBody = () =>
  new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode("{\"partial\":")) }), { status: 200 });

beforeEach(() => {
  __setAiStatusRequestForTests(null);
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setAiDeploymentState(DIRECT_AI_STATUS);
});

describe("postAiMessages retries a rate limit or overload", () => {
  it("a 429 then a 200 returns the 200 after the retry-after wait", async () => {
    const f = stubFetch([() => limited({ "retry-after": "3" }), () => json({ ok: 2 })]);
    const onRetryWait = vi.fn();
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat", onRetryWait }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sends(f)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(sends(f)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sends(f)).toHaveLength(2);
    const out = run.result();
    expect(out?.ok).toBe(true);
    const res = (out as { value: Response }).value;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 2 });
    expect(onRetryWait).toHaveBeenCalledTimes(1);
    expect(onRetryWait).toHaveBeenCalledWith(3000);
  });

  it("529 and overloaded_error are retried; three failures return the last answer", async () => {
    let n = 0;
    const f = stubFetch([() => overloaded(529, { "x-attempt": String(++n) })]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(20_000);
    const out = run.result();
    expect(out?.ok).toBe(true);
    const res = (out as { value: Response }).value;
    expect(res.status).toBe(529);
    expect(res.headers.get("x-attempt")).toBe("3");
    expect(await res.json()).toMatchObject({ error: { type: "overloaded_error" } });
    expect(sends(f)).toHaveLength(3);
  });

  it("an overloaded_error type is retried at a status other than 529", async () => {
    const f = stubFetch([() => overloaded(503, { "retry-after": "1" }), () => json({ ok: true })]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sends(f)).toHaveLength(2);
    expect((run.result() as { value: Response }).value.status).toBe(200);
  });

  it.each([400, 401, 403, 500])("no retry on %i", async (status) => {
    const f = stubFetch([() => json({ type: "error", error: { type: "api_error" } }, status, { "retry-after": "1" })]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(20_000);
    const res = (run.result() as { value: Response }).value;
    expect(res.status).toBe(status);
    expect(sends(f)).toHaveLength(1);
  });

  it("no retry on a network failure", async () => {
    const f = stubFetch([() => Promise.reject(new TypeError("Failed to fetch"))]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(20_000);
    const out = run.result() as { ok: false; error: unknown };
    expect(out.ok).toBe(false);
    expect(out.error).toBeInstanceOf(TypeError);
    expect(sends(f)).toHaveLength(1);
  });

  it("retry-after over 60 s is not waited", async () => {
    const onRetryWait = vi.fn();
    const f = stubFetch([() => limited({ "retry-after": "120" }), () => json({ ok: true })]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat", onRetryWait }));
    await vi.advanceTimersByTimeAsync(0);
    expect((run.result() as { value: Response }).value.status).toBe(429);
    expect(sends(f)).toHaveLength(1);
    expect(onRetryWait).not.toHaveBeenCalled();
  });

  it("the gateway's own limit (502 ai-gateway-rate-limited) is retried", async () => {
    setAiDeploymentState(GATEWAY);
    const f = stubFetch([() => json({ error: AI_GATEWAY_RATE_LIMITED }, 502, { "retry-after": "1" }), () => json({ ok: true })], () => GATEWAY);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(999);
    expect(sends(f)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sends(f)).toHaveLength(2);
    expect((run.result() as { value: Response }).value.status).toBe(200);
  });

  it("a throwing onRetryWait never breaks the retry", async () => {
    const onRetryWait = vi.fn(() => {
      throw new Error("ui listener");
    });
    const f = stubFetch([() => limited({ "retry-after": "1" }), () => json({ ok: true })]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat", onRetryWait }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRetryWait).toHaveBeenCalledWith(1000);
    expect(sends(f)).toHaveLength(2);
    expect((run.result() as { value: Response }).value.status).toBe(200);
  });

  it("the relay's own limit is retried", async () => {
    setAiDeploymentState(GATEWAY);
    const f = stubFetch([() => json({ error: AI_RELAY_RATE_LIMITED }, 429, { "retry-after": "1" }), () => json({ ok: true })], () => GATEWAY);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(999);
    expect(sends(f)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sends(f)).toHaveLength(2);
    expect((run.result() as { value: Response }).value.status).toBe(200);
  });

  it("the relay's own limit, still refused after every attempt, throws the same AiGatewayError", async () => {
    setAiDeploymentState(GATEWAY);
    const f = stubFetch([() => json({ error: AI_RELAY_RATE_LIMITED }, 429, { "retry-after": "1" })], () => GATEWAY);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(5000);
    const out = run.result() as { ok: false; error: unknown };
    expect(out.error).toBeInstanceOf(AiGatewayError);
    expect((out.error as AiGatewayError).code).toBe(AI_RELAY_RATE_LIMITED);
    expect(sends(f)).toHaveLength(3);
  });
});

describe("each retry re-confirms the deployment and consent", () => {
  it("asks the status and runs beforeSend once per attempt", async () => {
    const beforeSend = vi.fn();
    const f = stubFetch([() => limited({ "retry-after": "1" }), () => json({ ok: true })]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat", beforeSend }));
    await vi.advanceTimersByTimeAsync(1000);
    expect((run.result() as { value: Response }).value.status).toBe(200);
    expect(statusCalls(f)).toHaveLength(2);
    expect(beforeSend).toHaveBeenCalledTimes(2);
  });

  it("an `off` status on attempt 2 throws AiDeploymentError(off) and sends nothing more", async () => {
    const f = stubFetch(
      [() => limited({ "retry-after": "1" }), () => json({ ok: true })],
      (n) => (n === 1 ? DIRECT_AI_STATUS : { ...DIRECT_AI_STATUS, off: true }),
    );
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(1000);
    const out = run.result() as { ok: false; error: unknown };
    expect(out.error).toBeInstanceOf(AiDeploymentError);
    expect((out.error as AiDeploymentError).reason).toBe("off");
    expect(sends(f)).toHaveLength(1);
  });

  it("a consent revoked during the wait: beforeSend throws on attempt 2 and nothing is sent", async () => {
    let attempt = 0;
    const revoked = new Error("consent revoked");
    const beforeSend = vi.fn(() => {
      if (++attempt === 2) throw revoked;
    });
    const f = stubFetch([() => limited({ "retry-after": "1" }), () => json({ ok: true })]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat", beforeSend }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.result()).toEqual({ ok: false, error: revoked });
    expect(sends(f)).toHaveLength(1);
  });
});

describe("Stop and the time limit", () => {
  it("Stop during a wait ends it at once with an AbortError and sends nothing more", async () => {
    const ctrl = new AbortController();
    const f = stubFetch([() => limited({ "retry-after": "30" }), () => json({ ok: true })]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat", signal: ctrl.signal }));
    await vi.advanceTimersByTimeAsync(5000);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(0);
    const out = run.result() as { ok: false; error: unknown };
    expect(out.ok).toBe(false);
    expect((out.error as { name?: string }).name).toBe("AbortError");
    expect(sends(f)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a request with no answer times out after 5 minutes as AiTimeoutError, without a retry", async () => {
    const f = stubFetch([never]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS - 1);
    expect(run.result()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    const out = run.result() as { ok: false; error: unknown };
    expect(out.error).toBeInstanceOf(AiTimeoutError);
    expect((out.error as Error).name).not.toBe("AbortError");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sends(f)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the time limit aborts the send's own signal", async () => {
    const f = stubFetch([never]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS);
    expect(run.result()?.ok).toBe(false);
    expect(sends(f)[0][1]?.signal?.aborted).toBe(true);
  });

  it("a stalled body times out too", async () => {
    stubFetch([stalledBody]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS - 1);
    expect(run.result()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect((run.result() as { ok: false; error: unknown }).error).toBeInstanceOf(AiTimeoutError);
  });

  it("a caller abort near the timer stays an AbortError", async () => {
    const ctrl = new AbortController();
    stubFetch([stalledBody]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat", signal: ctrl.signal }));
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS - 1);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(1);
    const out = run.result() as { ok: false; error: unknown };
    expect(out.error).not.toBeInstanceOf(AiTimeoutError);
    expect((out.error as { name?: string }).name).toBe("AbortError");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a caller abort that lands as the timer fires stays an AbortError", async () => {
    const ctrl = new AbortController();
    // The caller aborts synchronously inside the timer's own abort, so by the time the attempt's
    // rejection is handled both have happened: the caller's Stop must win.
    stubFetch([
      (init) => {
        init?.signal?.addEventListener("abort", () => ctrl.abort());
        return never();
      },
    ]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat", signal: ctrl.signal }));
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS);
    const out = run.result() as { ok: false; error: unknown };
    expect(out.error).not.toBeInstanceOf(AiTimeoutError);
    expect((out.error as { name?: string }).name).toBe("AbortError");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a caller's own shorter limit still wins", async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20_000);
    stubFetch([never]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat", signal: ctrl.signal }));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(run.result()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect((run.result() as { ok: false; error: unknown }).error).toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("privacy and usage across a retry", () => {
  const ws: Workspace = {
    ...emptyWorkspace(),
    resources: [{ id: 1, firstName: "Rosalind", lastName: "Quenby", email: "r.quenby@example.test" } as Resource],
  };

  it("a protected retry is redacted again and restored", async () => {
    const privacy = aiPrivacyFor([{ key: "p798-retry", ws }]);
    if (!privacy.protected) throw new Error("expected protected");
    const placeholder = privacy.session.redact("Rosalind Quenby");
    const f = stubFetch([
      () => limited({ "retry-after": "1" }),
      () => json({ content: [{ type: "text", text: `Ask ${placeholder} now` }] }),
    ]);
    const body = JSON.stringify({ messages: [{ role: "user", content: "Rosalind Quenby is late" }] });
    const run = settle(postAiMessages({ privacy, apiKey: KEY, body, path: "chat" }));
    await vi.advanceTimersByTimeAsync(1000);
    const sent = sends(f).map((c) => String(c[1]?.body));
    expect(sent).toHaveLength(2);
    for (const s of sent) {
      expect(s).not.toMatch(/Rosalind|Quenby/);
      expect(s).toContain(placeholder);
    }
    const res = (run.result() as { value: Response }).value;
    expect(((await res.json()) as { content: { text: string }[] }).content[0].text).toBe("Ask Rosalind Quenby now");
  });

  it("a people lock that appears between attempts: the retry is redacted and the reply restored with its privacy", async () => {
    // An allowing project's privacy is unprotected; `ifForced` builds its protected privacy when the
    // server forces protection. Attempt 1 goes out unforced, attempt 2's status answers peopleForced.
    const privacy = aiPrivacyFor([{ key: "p798-lock", ws: { ...ws, settingsOverrides: withPeopleAllowed(undefined, true) } }]);
    expect(privacy.protected).toBe(false);
    const f = stubFetch(
      [
        () => limited({ "retry-after": "0" }),
        (init) => {
          const placeholder = /\[Person \d+\]/.exec(String(init?.body))?.[0] ?? "none";
          return json({ content: [{ type: "text", text: `Ask ${placeholder} now` }] });
        },
      ],
      (n) => (n === 1 ? DIRECT_AI_STATUS : { ...DIRECT_AI_STATUS, peopleForced: true }),
    );
    const body = JSON.stringify({ messages: [{ role: "user", content: "Rosalind Quenby is late" }] });
    const run = settle(postAiMessages({ privacy, apiKey: KEY, body, path: "chat" }));
    await vi.advanceTimersByTimeAsync(10);
    const sent = sends(f).map((c) => String(c[1]?.body));
    expect(sent).toHaveLength(2);
    expect(statusCalls(f)).toHaveLength(2);
    expect(sent[0]).toContain("Rosalind Quenby");
    expect(sent[1]).not.toMatch(/Rosalind|Quenby/);
    expect(sent[1]).toMatch(/\[Person \d+\]/);
    const res = (run.result() as { value: Response }).value;
    expect(((await res.json()) as { content: { text: string }[] }).content[0].text).toBe("Ask Rosalind Quenby now");
  });

  it("the usage tap hears only the final 2xx", async () => {
    const heard = vi.fn();
    const off = subscribeAiUsage(heard);
    stubFetch([() => limited({ "retry-after": "1" }), () => json({ usage: { input_tokens: 5, output_tokens: 7 } })]);
    const run = settle(postAiMessages({ privacy: UNPROTECTED, apiKey: KEY, body: "{}", path: "chat" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect((run.result() as { value: Response }).value.status).toBe(200);
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith("chat", expect.objectContaining({ input_tokens: 5, output_tokens: 7 }));
    off();
  });
});

describe("getAiModels times out and retries the same way", () => {
  it("a 429 then a 200", async () => {
    const f = stubFetch([() => limited({ "retry-after": "2" }), () => json({ data: [] })]);
    const run = settle(getAiModels(KEY));
    await vi.advanceTimersByTimeAsync(1999);
    expect(sends(f)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sends(f)).toHaveLength(2);
    const res = (run.result() as { value: Response }).value;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
    expect(statusCalls(f)).toHaveLength(2);
  });

  it("a request with no answer times out as AiTimeoutError", async () => {
    stubFetch([never]);
    const run = settle(getAiModels(KEY));
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS);
    expect((run.result() as { ok: false; error: unknown }).error).toBeInstanceOf(AiTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });
});
