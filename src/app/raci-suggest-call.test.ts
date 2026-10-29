import { describe, expect, it, vi } from "vitest";

vi.mock("./ai-forced-call", () => ({ runForcedToolCallWithRetry: vi.fn() }));
import { runForcedToolCallWithRetry } from "./ai-forced-call";
import { runRaciSuggestion } from "./raci-suggest-call";

describe("runRaciSuggestion", () => {
  it("forces propose_raci and returns the parsed proposal", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({
      input: { cells: [{ stakeholderId: 1, milestoneId: 10, role: "A" }] },
      stopReason: "tool_use",
    });
    const out = await runRaciSuggestion(
      { text: "ctx", truncated: false },
      { apiKey: "sk-ant-x", model: "claude-opus-5" },
    );
    expect(vi.mocked(runForcedToolCallWithRetry).mock.calls[0][0].toolName).toBe("propose_raci");
    expect(out.cells).toHaveLength(1);
  });

  it("never puts the api key in the request body", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({ input: { cells: [] }, stopReason: "tool_use" });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "sk-ant-secret", model: "m" });
    const args = vi.mocked(runForcedToolCallWithRetry).mock.calls[0][0];
    expect(JSON.stringify(args.messages)).not.toContain("sk-ant-secret");
    expect(JSON.stringify(args.system ?? "")).not.toContain("sk-ant-secret");
  });

  it("asks for a reply cut at 4096 once more at 8192 (§764)", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({ input: { cells: [] }, stopReason: "tool_use" });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "k", model: "m" });
    const [args, retry] = vi.mocked(runForcedToolCallWithRetry).mock.calls.at(-1)!;
    expect([args.maxTokens, retry]).toEqual([4096, 8192]);
  });

  it("never reads a reply cut at the retry budget too, whatever cells it carries (§764)", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({
      input: { cells: [{ stakeholderId: 1, milestoneId: 10, role: "A" }] },
      stopReason: "max_tokens",
    });
    await expect(runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "k", model: "m" })).rejects.toThrow(/^parse$/);
  });
});

// §701 — Suggest RACI forwards the user's guides to the forced call.
describe("runRaciSuggestion guide text", () => {
  it("passes guideText through to the forced call", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({ input: { cells: [] }, stopReason: "tool_use" });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "k", model: "m", guideText: "GUIDE-MARK" });
    expect(vi.mocked(runForcedToolCallWithRetry).mock.calls.at(-1)![0].guideText).toBe("GUIDE-MARK");
  });
});
