import { beforeEach, describe, expect, it, vi } from "vitest";
// Rendered without task-manager's AI privacy provider: requests carry the privacy of no project.
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import { renderHook, act } from "@testing-library/react";
vi.mock("./weight-suggestion-call", () => ({ runWeightSuggestion: vi.fn() }));
import { runWeightSuggestion } from "./weight-suggestion-call";
import { useWeightSuggestions } from "./use-weight-suggestions";
import { AiGatewayError, AiKeyCheckUnavailableError, AiKeyRefusedError } from "./ai-errors";
import { defaultNextActionsConfig } from "./settings-types";
import type { ReactNode } from "react";
import { ActionGuidesProvider } from "./action-guides-context";
import { actionGuideText, type OperatingGuide } from "./operating-guide";

describe("useWeightSuggestions", () => {
  // One module-level mock serves every test, so reset its calls and its resolved value before each:
  // without this the "no-key" test sees the other tests' calls whenever a shuffle runs it last (§614).
  beforeEach(() => { vi.mocked(runWeightSuggestion).mockReset(); });
  it("sets error 'no-key' and does not call when key blank", async () => {
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "  ", model: "claude-x" }));
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(result.current.error).toBe("no-key");
    expect(runWeightSuggestion).not.toHaveBeenCalled();
  });
  it("stores the result on success", async () => {
    (runWeightSuggestion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ suggestions: [{ field: "clarityBonus", current: 15, suggested: 20, rationale: "x" }], overallRationale: "", recommendEnableLearning: false });
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "k", model: "claude-x" }));
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(result.current.result?.suggestions[0].field).toBe("clarityBonus");
  });
  it("maps a numeric-status throw to that status and a generic throw to 'network'", async () => {
    (runWeightSuggestion as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("429"));
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "k", model: "claude-x" }));
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(result.current.error).toBe("429");
  });
  it("names a transport failure by its message key, not 'network'", async () => {
    vi.mocked(runWeightSuggestion).mockRejectedValueOnce(new AiGatewayError("ai-gateway-rejected"));
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "k", model: "claude-x" }));
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(result.current.error).toBe("aiGatewayRejected");
  });
  it.each([
    [new AiKeyRefusedError("organization"), "aiKeyWrongOrganization"],
    [new AiKeyRefusedError("workspace"), "aiKeyWrongWorkspace"],
    [new AiKeyCheckUnavailableError(), "aiKeyCheckUnavailable"],
  ] as const)("names a refused or unchecked key (%o) by its message key, not network", async (err, key) => {
    vi.mocked(runWeightSuggestion).mockRejectedValueOnce(err);
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "k", model: "claude-x" }));
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(result.current.error).toBe(key);
  });
});

// §701 — the suggestion call carries the weights action's operating guides.
describe("useWeightSuggestions operating guides (§701)", () => {
  beforeEach(() => { vi.mocked(runWeightSuggestion).mockReset(); });
  const guide: OperatingGuide = {
    id: "g-weights", name: "weights guide", content: "WEIGHTS-GUIDE-701", enabled: true,
    priority: 1, scope: { targets: ["weights"] }, builtIn: false,
  };
  function wrapper({ children }: { children: ReactNode }) {
    return <ActionGuidesProvider value={{ guides: [guide], groundInGuides: true, ready: true }}>{children}</ActionGuidesProvider>;
  }

  it("hands the provider's weights guide text to the call", async () => {
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "k", model: "claude-x" }), { wrapper });
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(runWeightSuggestion).toHaveBeenCalledTimes(1);
    const ai = vi.mocked(runWeightSuggestion).mock.calls[0][1];
    expect(ai.guideText).toBe(actionGuideText([guide], true, "weights"));
    expect(ai.guideText).toContain("WEIGHTS-GUIDE-701");
  });

  it("sends no guide text when grounding is off", async () => {
    function off({ children }: { children: ReactNode }) {
      return <ActionGuidesProvider value={{ guides: [guide], groundInGuides: false, ready: true }}>{children}</ActionGuidesProvider>;
    }
    const { result } = renderHook(() => useWeightSuggestions({ apiKey: "k", model: "claude-x" }), { wrapper: off });
    await act(async () => { await result.current.run("ctx", defaultNextActionsConfig, "weights"); });
    expect(vi.mocked(runWeightSuggestion).mock.calls[0][1].guideText).toBe("");
  });
});
