import "../test/ai-consent-live";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spyAiFetch } from "../test/fetch-real-response";
import { runJobAnalysis } from "./scheduled-job-analysis";
import { AiConsentRevokedError, newConsent, publishAiConsentState } from "./ai-consent";
import { defaultAiConfig } from "./settings-types";
import { aiPrivacyFor } from "./ai-privacy";

/** These tests are about the call mechanics, not people: a request for no project (unprotected). */
const UNPROTECTED = aiPrivacyFor([]);

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe("runJobAnalysis", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns the parsed analysis from a tool_use response", async () => {
    spyAiFetch().mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "report_analysis", input: { summary: "s", actions: [] } }] }),
    );
    const result = await runJobAnalysis("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" });
    expect(result).toEqual({ summary: "s", actions: [] });
  });

  it("throws the HTTP status on a non-OK response, leaking neither key nor body", async () => {
    const secret = "secret-key";
    const body = "internal-error-body-detail";
    spyAiFetch().mockResolvedValue(
      { ok: false, status: 500, json: async () => ({ error: body }) } as unknown as Response,
    );
    await expect(runJobAnalysis("ctx", { apiKey: secret, privacy: UNPROTECTED, model: "m" })).rejects.toThrow("500");
    try {
      await runJobAnalysis("ctx", { apiKey: secret, privacy: UNPROTECTED, model: "m" });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toBe("500");
      expect(msg).not.toContain(secret);
      expect(msg).not.toContain(body);
    }
  });

  // 2048 tokens could cut a full answer (eight actions with rationale) short, and a cut tool input fails the parse.
  it("asks for an output budget of 4096 tokens", async () => {
    const fetchSpy = spyAiFetch().mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "report_analysis", input: { summary: "s", actions: [] } }] }),
    );
    await runJobAnalysis("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).max_tokens).toBe(4096);
  });

  // A cut reply's input can pass parseAnalysis with actions missing, so it is never read: it is asked for again.
  const cut = () => ok({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "report_analysis", input: { summary: "cut", actions: [] } }] });
  const whole = () => ok({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "report_analysis", input: { summary: "whole", actions: [] } }] });
  const budgets = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).max_tokens);

  it("asks once more with 8192 tokens when the reply was cut, and returns that answer", async () => {
    const fetchSpy = spyAiFetch().mockResolvedValueOnce(cut()).mockResolvedValueOnce(whole());
    await expect(runJobAnalysis("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" })).resolves.toEqual({ summary: "whole", actions: [] });
    expect(budgets(fetchSpy)).toEqual([4096, 8192]);
  });

  it("throws 'parse' when the retry is cut too, after two calls", async () => {
    const fetchSpy = spyAiFetch().mockResolvedValueOnce(cut()).mockResolvedValueOnce(cut());
    await expect(runJobAnalysis("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" })).rejects.toThrow("parse");
    expect(budgets(fetchSpy)).toEqual([4096, 8192]);
  });

  it.each([1, 2])("passes the caller's signal to the retry too (aborted during request %i)", async (abortAt) => {
    // Since §798 the request carries the transport's own per-attempt signal, which the caller's abort
    // aborts: the caller's signal reaches the request when aborting the caller aborts the request's signal.
    const controller = new AbortController();
    const abortedWithCaller: boolean[] = [];
    const answers = [cut(), whole()];
    const fetchSpy = spyAiFetch().mockImplementation(async (_url, init) => {
      const n = fetchSpy.mock.calls.length;
      if (n === abortAt) controller.abort();
      abortedWithCaller.push(init?.signal?.aborted === true);
      return answers[n - 1];
    });
    await expect(runJobAnalysis("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" }, controller.signal)).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(abortAt);
    expect(abortedWithCaller).toEqual([...Array(abortAt - 1).fill(false), true]);
  });

  it("does not retry a malformed reply that was not cut", async () => {
    const fetchSpy = spyAiFetch().mockResolvedValue(ok({ stop_reason: "tool_use", content: [{ type: "text", text: "nope" }] }));
    await expect(runJobAnalysis("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" })).rejects.toThrow("parse");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws 'parse' on malformed tool output", async () => {
    spyAiFetch().mockResolvedValue(ok({ content: [{ type: "text", text: "nope" }] }));
    await expect(runJobAnalysis("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" })).rejects.toThrow("parse");
  });
});

// AI-01 — the runner's `level` reaches the forced call: with an interactive consent only, a background
// analysis is refused before any request, while an interactive one (no level) is sent.
describe("runJobAnalysis — the consent level", () => {
  const both = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)) };
  beforeEach(() => publishAiConsentState({ ...both, backgroundConsent: undefined }));
  afterEach(() => publishAiConsentState(both));

  it("a background analysis needs the background consent", async () => {
    const fetchSpy = spyAiFetch().mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "report_analysis", input: { summary: "s", actions: [] } }] }),
    );
    await expect(runJobAnalysis("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m", level: "background" })).rejects.toBeInstanceOf(AiConsentRevokedError);
    expect(fetchSpy).not.toHaveBeenCalled();
    // control: the same consent lets an interactive analysis through
    await expect(runJobAnalysis("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" })).resolves.toEqual({ summary: "s", actions: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
