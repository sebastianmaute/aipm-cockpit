import { describe, expect, it } from "vitest";
import { parseWeightSuggestions, applyWeightSuggestion, WEIGHT_FIELDS } from "./next-actions-tuning";
import { defaultNextActionsConfig } from "./settings-types";

const cur = defaultNextActionsConfig; // clarityBonus 15, semiClarityBonus 7, staticPenalty 25, ...

describe("parseWeightSuggestions", () => {
  it("parses valid weight suggestions and drops no-ops", () => {
    const out = parseWeightSuggestions(
      { suggestions: [
        { field: "clarityBonus", suggested: 20, rationale: "you act on clear fixes" },
        { field: "staticPenalty", suggested: 25, rationale: "no change" },
      ] },
      cur, "weights",
    );
    expect(out.map((s) => s.field)).toEqual(["clarityBonus"]);
    expect(out[0]).toMatchObject({ field: "clarityBonus", current: 15, suggested: 20 });
    expect(out[0].rationale).toBe("you act on clear fixes");
  });
  it("clamps an out-of-bounds value through the per-field coercer", () => {
    const out = parseWeightSuggestions({ suggestions: [{ field: "clarityBonus", suggested: -9, rationale: "x" }] }, cur, "weights");
    expect(out).toEqual([]); // intMin0 floors negatives to the default (15) === current -> dropped no-op
  });
  it("drops fields outside the weights scope", () => {
    const out = parseWeightSuggestions({ suggestions: [{ field: "scopePendingRed", suggested: 9, rationale: "x" }] }, cur, "weights");
    expect(out).toEqual([]);
  });
  it("allows threshold fields when scope is 'all'", () => {
    const out = parseWeightSuggestions({ suggestions: [{ field: "scopePendingRed", suggested: 9, rationale: "x" }] }, cur, "all");
    expect(out.map((s) => s.field)).toEqual(["scopePendingRed"]);
    expect(out[0].suggested).toBe(9);
  });
  it("ignores malformed entries and never throws", () => {
    expect(parseWeightSuggestions(null, cur, "weights")).toEqual([]);
    expect(parseWeightSuggestions({ suggestions: "x" }, cur, "weights")).toEqual([]);
    expect(parseWeightSuggestions({ suggestions: [{ field: "clarityBonus" }] }, cur, "weights")).toEqual([]);
  });
  it("only exposes the 3 weight fields by default scope", () => {
    expect(WEIGHT_FIELDS).toEqual(["clarityBonus", "semiClarityBonus", "staticPenalty"]);
  });
});

describe("applyWeightSuggestion", () => {
  it("sets one field immutably", () => {
    const next = applyWeightSuggestion(cur, { field: "clarityBonus", current: 15, suggested: 22, rationale: "x" });
    expect(next.clarityBonus).toBe(22);
    expect(next).not.toBe(cur);
    expect(cur.clarityBonus).toBe(15);
  });
});
