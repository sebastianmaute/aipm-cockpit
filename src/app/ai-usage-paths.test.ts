import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AI_FEATURE_LABEL, FORCED_TOOL_FEATURE, forcedPathId, parseAiPathId } from "./ai-usage-paths";
import { PROPOSE_ALLOCATIONS_TOOL } from "./alloc-plan/alloc-plan";
import { FORECAST_MAPPING_TOOL } from "./forecast-import-call";
import { RECOMMEND_TOOL } from "./insights/recommend";
import { RACI_SUGGEST_TOOL } from "./raci-suggest/raci-suggest";
import { PROPOSE_MERGES_TOOL } from "./task-dedup/dedup";
import { PROPOSE_WBS_TOOL } from "./wbs-plan/wbs-plan";
import { en } from "./i18n";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("parseAiPathId", () => {
  it("reads the fixed ids and round-trips a forced id", () => {
    expect(parseAiPathId("chat")).toEqual({ feature: "chat", level: "interactive" });
    expect(parseAiPathId("inline-edit")).toEqual({ feature: "inline-edit", level: "interactive" });
    expect(parseAiPathId("legacy")).toEqual({ feature: "legacy", level: "interactive" });
    expect(parseAiPathId(forcedPathId("report_analysis", "background"))).toEqual({ feature: "job-analysis", level: "background" });
  });

  it("maps an unknown tool to other and a bare tool name to interactive", () => {
    expect(parseAiPathId("no_such_tool:interactive")).toEqual({ feature: "other", level: "interactive" });
    expect(parseAiPathId("suggest_weights")).toEqual({ feature: "weights", level: "interactive" });
    expect(parseAiPathId("toString:background")).toEqual({ feature: "other", level: "background" });
  });

  it("has a label key in the English dictionary for every feature", () => {
    for (const key of Object.values(AI_FEATURE_LABEL)) expect(en).toHaveProperty(key);
  });
});

describe("every forced caller has a feature", () => {
  it("finds exactly eleven callers, each with a mapped tool name", () => {
    const callers = sourceFiles("src").filter((f) => !f.endsWith("ai-forced-call.ts") && /runForcedToolCall\w*\(/.test(readFileSync(f, "utf8")));
    expect(callers).toHaveLength(11);
    expect(Object.keys(FORCED_TOOL_FEATURE)).toHaveLength(11);
    const named = callers.map((f) => /toolName:\s*(?:"([^"]+)"|(\w+)\.name)/.exec(readFileSync(f, "utf8")));
    const constants: Record<string, string> = {
      PROPOSE_ALLOCATIONS_TOOL: PROPOSE_ALLOCATIONS_TOOL.name, FORECAST_MAPPING_TOOL: FORECAST_MAPPING_TOOL.name,
      RECOMMEND_TOOL: RECOMMEND_TOOL.name, RACI_SUGGEST_TOOL: RACI_SUGGEST_TOOL.name,
      PROPOSE_MERGES_TOOL: PROPOSE_MERGES_TOOL.name, PROPOSE_WBS_TOOL: PROPOSE_WBS_TOOL.name,
    };
    const names = named.map((m, i) => {
      expect(m, callers[i]).not.toBeNull();
      return m![1] ?? constants[m![2]];
    });
    for (const n of names) expect(FORCED_TOOL_FEATURE, n).toHaveProperty(n);
    expect(new Set(names).size).toBe(11);
  });
});
