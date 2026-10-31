import { describe, expect, it, vi } from "vitest";

vi.mock("./ai-forced-call", () => ({ runForcedToolCallWithRetry: vi.fn() }));
import { runForcedToolCallWithRetry } from "./ai-forced-call";
import { runRaciSuggestion } from "./raci-suggest-call";
import { RACI_SUGGEST_TOOL } from "./raci-suggest/raci-suggest";
import { aiPrivacyFor } from "./ai-privacy";

/** These tests are about the call mechanics, not people: a request for no project (unprotected). */
const UNPROTECTED = aiPrivacyFor([]);

describe("runRaciSuggestion", () => {
  it("forces propose_raci and returns the parsed proposal", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({
      input: { cells: [{ stakeholderId: 1, milestoneId: 10, role: "A" }] },
      stopReason: "tool_use",
    });
    const out = await runRaciSuggestion(
      { text: "ctx", truncated: false },
      { apiKey: "sk-ant-x", privacy: UNPROTECTED, model: "claude-opus-5" },
    );
    expect(vi.mocked(runForcedToolCallWithRetry).mock.calls[0][0].toolName).toBe("propose_raci");
    expect(out.cells).toHaveLength(1);
  });

  it("never puts the api key in the request body", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({ input: { cells: [] }, stopReason: "tool_use" });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "sk-ant-secret", privacy: UNPROTECTED, model: "m" });
    const args = vi.mocked(runForcedToolCallWithRetry).mock.calls[0][0];
    expect(JSON.stringify(args.messages)).not.toContain("sk-ant-secret");
    expect(JSON.stringify(args.system ?? "")).not.toContain("sk-ant-secret");
  });

  it("asks for a reply cut at 4096 once more at 8192 (§764)", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({ input: { cells: [] }, stopReason: "tool_use" });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "k", privacy: UNPROTECTED, model: "m" });
    const [args, retry] = vi.mocked(runForcedToolCallWithRetry).mock.calls.at(-1)!;
    expect([args.maxTokens, retry]).toEqual([4096, 8192]);
  });

  it("never reads a reply cut at the retry budget too, whatever cells it carries (§764)", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({
      input: { cells: [{ stakeholderId: 1, milestoneId: 10, role: "A" }] },
      stopReason: "max_tokens",
    });
    await expect(runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "k", privacy: UNPROTECTED, model: "m" })).rejects.toThrow(/^parse$/);
  });
});

// §701 — Suggest RACI forwards the user's guides to the forced call.
describe("runRaciSuggestion guide text", () => {
  it("passes guideText through to the forced call", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({ input: { cells: [] }, stopReason: "tool_use" });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "k", privacy: UNPROTECTED, model: "m", guideText: "GUIDE-MARK" });
    expect(vi.mocked(runForcedToolCallWithRetry).mock.calls.at(-1)![0].guideText).toBe("GUIDE-MARK");
  });
});

describe("Suggest RACI prompt and tool text (§771)", () => {
  it("SYSTEM names EVIDENCE and REQUEST and keeps one Accountable above the request", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({ input: { cells: [] }, stopReason: "tool_use" });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "k", privacy: UNPROTECTED, model: "m" });
    const system = String(vi.mocked(runForcedToolCallWithRetry).mock.calls.at(-1)![0].system);
    expect(system).toContain("EVIDENCE");
    expect(system).toContain("REQUEST");
    expect(system).toMatch(/exactly one Accountable[^.]*always wins over the request/i);
  });

  it("SYSTEM explains the milestone scope column and judges a scope-0 milestone without dropping the omit rule", async () => {
    vi.mocked(runForcedToolCallWithRetry).mockResolvedValue({ input: { cells: [] }, stopReason: "tool_use" });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "k", privacy: UNPROTECTED, model: "m" });
    const system = String(vi.mocked(runForcedToolCallWithRetry).mock.calls.at(-1)![0].system);
    expect(system).toMatch(/MILESTONES[^.]*scope[^.]*number of linked tasks/i);
    expect(system).toMatch(/scope 0 there is no evidence: judge it from titles, discipline and grade[^.]*still omit any cell you are not confident about/i);
    expect(system).toContain("Prefer omitting a cell to guessing.");
    // The old wording told the model to fill a scope-0 milestone, against the omit rule.
    expect(system).not.toMatch(/instead of omitting it/i);
  });

  it("the tool description teaches the handover and drops the blanket ban", () => {
    expect(RACI_SUGGEST_TOOL.description).toContain("propose the new holder's A and a new role for the current holder in the same call");
    expect(RACI_SUGGEST_TOOL.description).not.toContain("Never propose a second Accountable");
  });
});
