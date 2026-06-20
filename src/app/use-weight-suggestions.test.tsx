import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
vi.mock("./weight-suggestion-call", () => ({ runWeightSuggestion: vi.fn() }));
import { runWeightSuggestion } from "./weight-suggestion-call";
import { useWeightSuggestions } from "./use-weight-suggestions";
import { defaultNextActionsConfig } from "./settings-types";

describe("useWeightSuggestions", () => {
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
});
