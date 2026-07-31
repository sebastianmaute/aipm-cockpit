import { describe, expect, it, vi } from "vitest";

vi.mock("./ai-forced-call", () => ({ runForcedToolCall: vi.fn() }));
import { runForcedToolCall } from "./ai-forced-call";
import { runRaciSuggestion } from "./raci-suggest-call";

describe("runRaciSuggestion", () => {
  it("forces propose_raci and returns the parsed proposal", async () => {
    vi.mocked(runForcedToolCall).mockResolvedValue({
      cells: [{ stakeholderId: 1, milestoneId: 10, role: "A" }],
    });
    const out = await runRaciSuggestion(
      { text: "ctx", truncated: false },
      { apiKey: "sk-ant-x", model: "claude-opus-5" },
    );
    expect(vi.mocked(runForcedToolCall).mock.calls[0][0].toolName).toBe("propose_raci");
    expect(out.cells).toHaveLength(1);
  });

  it("never puts the api key in the request body", async () => {
    vi.mocked(runForcedToolCall).mockResolvedValue({ cells: [] });
    await runRaciSuggestion({ text: "ctx", truncated: false }, { apiKey: "sk-ant-secret", model: "m" });
    const args = vi.mocked(runForcedToolCall).mock.calls[0][0];
    expect(JSON.stringify(args.messages)).not.toContain("sk-ant-secret");
    expect(JSON.stringify(args.system ?? "")).not.toContain("sk-ant-secret");
  });
});
