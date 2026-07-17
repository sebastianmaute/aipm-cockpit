import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runDedupProposal } from "./task-dedup-call";

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
    const result = await runDedupProposal("ctx", { apiKey: "k", model: "m" });
    expect(result).toEqual([{ keepId: 1, mergeIds: [2], rationale: "dup", unifiedFields: undefined }]);
  });

  it("sends the forced tool_choice and the propose tool", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "propose_task_merges", input: { groups: [] } }] }),
    );
    await runDedupProposal("ctx", { apiKey: "k", model: "m" });
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
      await runDedupProposal("ctx", { apiKey: secret, model: "m" });
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
    await expect(runDedupProposal("ctx", { apiKey: "k", model: "m" })).rejects.toThrow("parse");
  });
});
