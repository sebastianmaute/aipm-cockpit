import { describe, expect, it } from "vitest";
import { SUGGEST_TOOL, buildSuggestionSystemPrompt, buildSuggestionContext, parseSuggestionResponse } from "./weight-suggestion-ai";
import { defaultNextActionsConfig } from "./settings-types";

describe("weight-suggestion-ai", () => {
  it("SUGGEST_TOOL is the forced suggest_weights tool", () => {
    expect(SUGGEST_TOOL.name).toBe("suggest_weights");
    expect(SUGGEST_TOOL.input_schema.required).toContain("suggestions");
  });
  it("system prompt is stable (no volatile data) and frames a senior PM", () => {
    const p = buildSuggestionSystemPrompt();
    expect(p).toMatch(/suggest_weights/);
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it("buildSuggestionContext includes current weights + scope + learning summary", () => {
    const ctx = buildSuggestionContext({
      workspaceDigest: "Project: X. Today: 2026-06-20.",
      current: defaultNextActionsConfig,
      scope: "weights",
      learning: "acted=12 snoozed=3 dismissed=1",
      trends: "(no snapshots)",
      learningEnabled: true,
    });
    expect(ctx).toMatch(/clarityBonus/);
    expect(ctx).toMatch(/acted=12/);
    expect(ctx).toMatch(/weights/);
  });
  it("parseSuggestionResponse extracts suggestions + recommendEnableLearning", () => {
    const res = parseSuggestionResponse(
      { suggestions: [{ field: "clarityBonus", suggested: 20, rationale: "x" }], recommendEnableLearning: true, overallRationale: "tune up clarity" },
      defaultNextActionsConfig, "weights",
    );
    expect(res.suggestions.map((s) => s.field)).toEqual(["clarityBonus"]);
    expect(res.recommendEnableLearning).toBe(true);
    expect(res.overallRationale).toBe("tune up clarity");
  });
});
