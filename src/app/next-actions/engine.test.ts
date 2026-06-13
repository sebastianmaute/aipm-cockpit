import { describe, expect, it } from "vitest";
import { computeNextActions } from "./engine";
import type { ActionInput, ActionProvider, SuggestedAction } from "./types";

function mkAction(id: string, score: number, moduleId?: SuggestedAction["moduleId"]): SuggestedAction {
  return {
    id, source: "raid", moduleId,
    title: { key: "actionRaidTitle", params: [id, id] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score, tier: "soon", cta: { kind: "open", view: "raid", id },
  };
}
const baseInput = { features: ["raid", "changes"], dismissed: new Set<string>() } as unknown as ActionInput;
const provider = (acts: SuggestedAction[], moduleId?: SuggestedAction["moduleId"]): ActionProvider =>
  ({ moduleId, provide: () => acts });

describe("computeNextActions", () => {
  it("sorts by score descending with id tiebreak and re-bands tier from score", () => {
    const p = provider([mkAction("b", 70), mkAction("a", 70), mkAction("c", 10)]);
    const out = computeNextActions(baseInput, [p]);
    expect(out.map((a) => a.id)).toEqual(["a", "b", "c"]); // 70,70 → id asc; then 10
    expect(out[0].tier).toBe("now");   // 70 → now (re-banded, ignoring the stub "soon")
    expect(out[2].tier).toBe("monitor"); // 10 → monitor
  });
  it("skips a provider whose moduleId is disabled", () => {
    const p = provider([mkAction("x", 50)], "stakeholders"); // not in features
    expect(computeNextActions(baseInput, [p])).toEqual([]);
  });
  it("runs a provider with no moduleId (core/always-on)", () => {
    const p = provider([mkAction("core", 50)], undefined);
    expect(computeNextActions(baseInput, [p]).map((a) => a.id)).toEqual(["core"]);
  });
  it("dedups by id (first provider wins)", () => {
    const out = computeNextActions(baseInput, [provider([mkAction("dup", 80)]), provider([mkAction("dup", 10)])]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(80);
  });
  it("filters out dismissed ids", () => {
    const input = { ...baseInput, dismissed: new Set(["gone"]) } as ActionInput;
    const out = computeNextActions(input, [provider([mkAction("gone", 90), mkAction("keep", 40)])]);
    expect(out.map((a) => a.id)).toEqual(["keep"]);
  });
});
