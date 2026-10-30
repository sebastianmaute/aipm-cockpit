import { describe, it, expect, vi, beforeEach } from "vitest";
import { runWbsProposal } from "./wbs-plan-call";
import { runForcedToolCallWithRetry } from "./ai-forced-call";
import { PROPOSE_WBS_TOOL, buildWbsSystemPrompt } from "./wbs-plan/wbs-plan";
import { aiPrivacyFor } from "./ai-privacy";

/** These tests are about the call mechanics, not people: a request for no project (unprotected). */
const UNPROTECTED = aiPrivacyFor([]);

vi.mock("./ai-forced-call", () => ({ runForcedToolCallWithRetry: vi.fn() }));

const mocked = vi.mocked(runForcedToolCallWithRetry);
const whole = (input: Record<string, unknown>) => ({ input, stopReason: "tool_use" });
const ai = { apiKey: "k", privacy: UNPROTECTED, model: "m" };

describe("runWbsProposal", () => {
  beforeEach(() => mocked.mockReset());

  it("passes the tool name, system prompt and maxTokens 8192", async () => {
    mocked.mockResolvedValue(whole({ items: [] }));
    await runWbsProposal("ctx", ai, "split big ones");
    const args = mocked.mock.calls[0][0];
    expect(args.toolName).toBe("propose_wbs_changes");
    expect(args.tools).toEqual([PROPOSE_WBS_TOOL]);
    expect(args.system).toBe(buildWbsSystemPrompt());
    expect(args.maxTokens).toBe(8192);
  });

  it("asks for a reply cut at 8192 once more at 16384 (§764)", async () => {
    mocked.mockResolvedValue(whole({ items: [] }));
    await runWbsProposal("ctx", ai, "x");
    expect(mocked.mock.calls[0][1]).toBe(16_384);
  });

  it("never reads a reply cut at the retry budget too, even one that parses (§764)", async () => {
    mocked.mockResolvedValue({ input: { items: [] }, stopReason: "max_tokens" });
    await expect(runWbsProposal("ctx", ai, "x")).rejects.toThrow(/^parse$/);
  });

  it("returns the parsed proposal", async () => {
    mocked.mockResolvedValue(whole({ items: [] }));
    const result = await runWbsProposal("ctx", ai, "split big ones");
    expect(result).toEqual({ items: [], truncated: false });
  });

  it("throws parse on malformed output", async () => {
    mocked.mockResolvedValue(whole({}));
    await expect(runWbsProposal("ctx", ai, "x")).rejects.toThrow("parse");
  });

  it("passes the signal through", async () => {
    mocked.mockResolvedValue(whole({ items: [] }));
    const ctrl = new AbortController();
    await runWbsProposal("ctx", ai, "x", ctrl.signal);
    expect(mocked.mock.calls[0][0].signal).toBe(ctrl.signal);
  });

  it("builds the user message with the request separator", async () => {
    mocked.mockResolvedValue(whole({ items: [] }));
    await runWbsProposal("ctx", ai, "split big ones");
    expect(mocked.mock.calls[0][0].messages[0].content).toBe("ctx\n\n---\nUSER REQUEST: split big ones");
  });
});
