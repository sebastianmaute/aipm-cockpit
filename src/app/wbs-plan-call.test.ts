import { describe, it, expect, vi, beforeEach } from "vitest";
import { runWbsProposal } from "./wbs-plan-call";
import { runForcedToolCall } from "./ai-forced-call";
import { PROPOSE_WBS_TOOL, buildWbsSystemPrompt } from "./wbs-plan/wbs-plan";

vi.mock("./ai-forced-call", () => ({ runForcedToolCall: vi.fn() }));

const mocked = vi.mocked(runForcedToolCall);
const ai = { apiKey: "k", model: "m" };

describe("runWbsProposal", () => {
  beforeEach(() => mocked.mockReset());

  it("passes the tool name, system prompt and maxTokens 8192", async () => {
    mocked.mockResolvedValue({ items: [] });
    await runWbsProposal("ctx", ai, "split big ones");
    const args = mocked.mock.calls[0][0];
    expect(args.toolName).toBe("propose_wbs_changes");
    expect(args.tools).toEqual([PROPOSE_WBS_TOOL]);
    expect(args.system).toBe(buildWbsSystemPrompt());
    expect(args.maxTokens).toBe(8192);
  });

  it("returns the parsed proposal", async () => {
    mocked.mockResolvedValue({ items: [] });
    const result = await runWbsProposal("ctx", ai, "split big ones");
    expect(result).toEqual({ items: [], truncated: false });
  });

  it("throws parse on malformed output", async () => {
    mocked.mockResolvedValue({});
    await expect(runWbsProposal("ctx", ai, "x")).rejects.toThrow("parse");
  });

  it("passes the signal through", async () => {
    mocked.mockResolvedValue({ items: [] });
    const ctrl = new AbortController();
    await runWbsProposal("ctx", ai, "x", ctrl.signal);
    expect(mocked.mock.calls[0][0].signal).toBe(ctrl.signal);
  });

  it("builds the user message with the request separator", async () => {
    mocked.mockResolvedValue({ items: [] });
    await runWbsProposal("ctx", ai, "split big ones");
    expect(mocked.mock.calls[0][0].messages[0].content).toBe("ctx\n\n---\nUSER REQUEST: split big ones");
  });
});
