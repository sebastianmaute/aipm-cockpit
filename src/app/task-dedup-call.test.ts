import "../test/ai-consent-live";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runDedupProposal } from "./task-dedup-call";
import { aiPrivacyFor } from "./ai-privacy";

/** These tests are about the call mechanics, not people: a request for no project (unprotected). */
const UNPROTECTED = aiPrivacyFor([]);

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe("runDedupProposal", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns the raw parsed groups from a forced tool_use response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({
        content: [
          {
            type: "tool_use",
            name: "propose_task_merges",
            input: { groups: [{ keepId: 1, mergeIds: [2], rationale: "dup" }] },
          },
        ],
      }),
    );
    const result = await runDedupProposal("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" });
    expect(result).toEqual([{ keepId: 1, mergeIds: [2], rationale: "dup", unifiedFields: undefined }]);
  });

  it("sends the forced tool_choice and the propose tool", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "propose_task_merges", input: { groups: [] } }] }),
    );
    await runDedupProposal("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" });
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tool_choice).toEqual({ type: "tool", name: "propose_task_merges" });
    expect(body.tools[0].name).toBe("propose_task_merges");
  });

  it("throws the HTTP status on a non-OK response, leaking neither key nor body message", async () => {
    const secret = "sk-ant-secret-key";
    const bodyMsg = "internal-error-body-detail";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      { ok: false, status: 500, json: async () => ({ error: { message: bodyMsg } }) } as unknown as Response,
    );
    try {
      await runDedupProposal("ctx", { apiKey: secret, privacy: UNPROTECTED, model: "m" });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toBe("500");
      expect(msg).not.toContain(secret);
      // the status-only Error.message must not carry the body; safeMessage rides
      // a separate field (surfaceable, not logged).
      expect(msg).not.toContain(bodyMsg);
    }
  });

  it("throws 'parse' on malformed tool output (no groups array)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ content: [{ type: "text", text: "nope" }] }));
    await expect(runDedupProposal("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" })).rejects.toThrow("parse");
  });
});

// §764 — a reply cut at the output budget is asked for once more at a larger one, and never read.
describe("runDedupProposal output budget (§764)", () => {
  afterEach(() => vi.restoreAllMocks());
  const cutOr = (stop: string, input: unknown) =>
    ({ ok: true, json: async () => ({ stop_reason: stop, content: [{ type: "tool_use", name: "propose_task_merges", input }] }) }) as unknown as Response;
  const budgets = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).max_tokens as number);
  const GROUPS = { groups: [{ keepId: 1, mergeIds: [2], rationale: "dup" }] };

  it("asks once more at 8192 when the reply was cut at 4096, and returns that answer", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(cutOr("max_tokens", {})).mockResolvedValueOnce(cutOr("tool_use", GROUPS));
    await expect(runDedupProposal("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" })).resolves.toHaveLength(1);
    expect(budgets(spy)).toEqual([4096, 8192]);
  });

  it("never reads a reply cut at the retry budget too, even one that parses", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(cutOr("max_tokens", GROUPS));
    await expect(runDedupProposal("ctx", { apiKey: "k", privacy: UNPROTECTED, model: "m" })).rejects.toThrow(/^parse$/);
    expect(budgets(spy)).toEqual([4096, 8192]);
  });
});
