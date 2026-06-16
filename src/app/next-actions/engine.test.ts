import { describe, expect, it } from "vitest";
import { computeNextActions } from "./engine";
import { TIER_NOW } from "./score";
import type { ActionInput, ActionProvider, SuggestedAction } from "./types";
import { budgetProvider } from "./providers/budget";
import { raidProvider } from "./providers/raid";

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
  it("ranks a clear RAID-no-owner action above a static red budget", () => {
    const input = {
      tasks: [], changes: [], milestones: [], stakeholders: [], commsReminders: [],
      features: ["budget", "raid"], projectName: "P",
      today: "2026-01-01", now: new Date("2026-01-01T00:00:00Z"),
      reminderLeadDays: 7, dueSoonWorkdays: 5, raidReviewIntervalDays: 14,
      raidReviewEnabled: false, dismissed: new Set<string>(),
      dashboard: { budget: { effective: "R" }, evm: { cpi: 0.8 } },
      raid: [{ id: 1, category: "R", title: "DB outage", severity: "High",
               status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01" }],
    } as never;
    const actions = computeNextActions(input, [budgetProvider, raidProvider]);
    const raidIdx = actions.findIndex((a) => a.source === "raid");
    const budgetIdx = actions.findIndex((a) => a.source === "budget");
    expect(raidIdx).toBeGreaterThanOrEqual(0);
    expect(budgetIdx).toBeGreaterThanOrEqual(0);
    expect(raidIdx).toBeLessThan(budgetIdx); // raid clarity-boosted, budget penalised
  });
});

describe("learnedBias in the engine", () => {
  function stubAction(id: string, source: SuggestedAction["source"], whyKey: string, score: number): SuggestedAction {
    return { id, source, title: { key: "x" as never }, why: { key: whyKey as never }, score, tier: "monitor", cta: { kind: "snooze", actionId: id } };
  }
  function providerOf(actions: SuggestedAction[]): ActionProvider { return { provide: () => actions }; }
  function inp(over: Partial<ActionInput> = {}): ActionInput {
    return { tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], commsReminders: [], dashboard: {} as never, features: [], today: "2026-06-16", projectName: "P", now: new Date("2026-06-16T00:00:00Z"), reminderLeadDays: 7, dueSoonWorkdays: 3, raidReviewIntervalDays: 14, dismissed: new Set<string>(), ...over };
  }
  it("adds positive bias and annotates moved:up", () => {
    const out = computeNextActions(inp({ learnedBias: { "raid:wk": 15 } }), [providerOf([stubAction("raid:1:x", "raid", "wk", 40)])]);
    expect(out[0].score).toBe(55);
    expect(out[0].learning).toEqual({ bias: 15, moved: "up" });
  });
  it("safety floor: an intrinsically-now item is never demoted out of now", () => {
    const out = computeNextActions(inp({ learnedBias: { "raid:wk": -20 } }), [providerOf([stubAction("raid:2:x", "raid", "wk", 65)])]);
    expect(out[0].score).toBeGreaterThanOrEqual(TIER_NOW);
    expect(out[0].tier).toBe("now");
    // The floor rescued it (65-20=45 would drop below now) — no misleading "demoted" hint.
    expect(out[0].learning).toBeUndefined();
  });
  it("genuine within-now demotion is still annotated (floor did NOT rescue)", () => {
    const out = computeNextActions(inp({ learnedBias: { "raid:wk": -5 } }), [providerOf([stubAction("raid:4:x", "raid", "wk", 70)])]);
    expect(out[0].score).toBe(65);
    expect(out[0].tier).toBe("now");
    expect(out[0].learning).toEqual({ bias: -5, moved: "down" });
  });
  it("no learnedBias = unchanged score, no annotation", () => {
    const out = computeNextActions(inp(), [providerOf([stubAction("raid:3:x", "raid", "wk", 40)])]);
    expect(out[0].score).toBe(40);
    expect(out[0].learning).toBeUndefined();
  });
});
