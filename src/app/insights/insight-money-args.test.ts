import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "../chat-tool-defs";
import { ALLOWED_REC_TOOLS, REC_MONEY_ARGS, recommendationPredatesSwitch, type InsightRecommendation } from "./insight";
import type { BaselineEntry } from "../baseline-currency";

type Prop = { type?: string; description?: string };

/** Every NUMBER argument of an allowed recommendation tool whose schema says it is in the
 *  project's currency — the set `REC_MONEY_ARGS` must cover (§476). */
function moneyArgsFromSchemas(): Set<string> {
  const found = new Set<string>();
  for (const def of TOOL_DEFS as ReadonlyArray<{ name: string; input_schema: { properties?: Record<string, Prop> } }>) {
    if (!ALLOWED_REC_TOOLS.has(def.name)) continue;
    for (const [arg, prop] of Object.entries(def.input_schema.properties ?? {})) {
      if (prop.type === "number" && /currency/i.test(prop.description ?? "")) found.add(arg);
    }
  }
  return found;
}

describe("REC_MONEY_ARGS (§476)", () => {
  it("lists exactly the money arguments the allowed tools' schemas declare", () => {
    const found = moneyArgsFromSchemas();
    expect(found.size).toBeGreaterThan(0); // anti-vacuity: the schema scan sees costImpact
    expect([...found].sort()).toEqual([...REC_MONEY_ARGS].sort());
  });
});

describe("recommendationPredatesSwitch (§476)", () => {
  const rec = (input: Record<string, unknown>, generatedAt = "2026-09-03"): InsightRecommendation => ({
    summary: "s", proposedCalls: [{ name: "update_change", input }], generatedAt, status: "proposed",
  });
  const sw = (from: string): BaselineEntry => ({ from, at: `${from}T10:00:00.000Z`, currency: "GBP", perPrevious: 0.85 });

  it("is true for a money call and a switch on or after the generation day", () => {
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }), [sw("2026-09-03")])).toBe(true);
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }), [sw("2026-09-05")])).toBe(true);
  });

  it("is false for a switch before the generation day, or no money argument", () => {
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }), [sw("2026-09-02")])).toBe(false);
    expect(recommendationPredatesSwitch(rec({ id: 1, title: "x" }), [sw("2026-09-05")])).toBe(false);
  });

  it("ignores the creation entry, which is not a switch", () => {
    const creation: BaselineEntry = { from: "2026-09-05", at: "2026-09-05T10:00:00.000Z", currency: "EUR" };
    expect(recommendationPredatesSwitch(rec({ id: 1, costImpact: 10 }), [creation])).toBe(false);
  });
});
