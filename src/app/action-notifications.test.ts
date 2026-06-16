import { describe, it, expect } from "vitest";
import { newUrgentActions, buildNotificationPlan, nextSeenIds } from "./action-notifications";
import type { SuggestedAction } from "./next-actions/types";

function action(id: string, tier: SuggestedAction["tier"]): SuggestedAction {
  return {
    id,
    source: "milestone",
    title: { key: "actionMilestoneTitle", params: ["X"] },
    why: { key: "actionMilestoneWhyAtRisk" },
    score: 10,
    tier,
    cta: { kind: "open", view: "milestones", id: 1 },
  };
}

describe("newUrgentActions", () => {
  it("returns only now-tier actions whose id is unseen, preserving order", () => {
    const actions = [action("a", "now"), action("b", "soon"), action("c", "now")];
    expect(newUrgentActions(actions, ["c"]).map((a) => a.id)).toEqual(["a"]);
  });
  it("excludes soon and monitor tiers", () => {
    const actions = [action("a", "soon"), action("b", "monitor")];
    expect(newUrgentActions(actions, [])).toEqual([]);
  });
  it("is empty when every now-tier id is already seen", () => {
    const actions = [action("a", "now"), action("b", "now")];
    expect(newUrgentActions(actions, ["a", "b"])).toEqual([]);
  });
});

describe("buildNotificationPlan", () => {
  it("returns null when nothing is new", () => {
    expect(buildNotificationPlan([])).toBeNull();
  });
  it("returns a single plan carrying the action for exactly one", () => {
    const a = action("a", "now");
    expect(buildNotificationPlan([a])).toEqual({ kind: "single", action: a });
  });
  it("returns a summary plan with the count for more than one", () => {
    expect(buildNotificationPlan([action("a", "now"), action("b", "now")])).toEqual({
      kind: "summary",
      count: 2,
    });
  });
});

describe("nextSeenIds", () => {
  it("returns the present now-tier ids only (deduped)", () => {
    const actions = [action("a", "now"), action("a", "now"), action("b", "soon"), action("c", "now")];
    expect(nextSeenIds(actions).sort()).toEqual(["a", "c"]);
  });
  it("drops ids that are no longer present so a returning signal re-notifies", () => {
    expect(nextSeenIds([action("b", "now")])).toEqual(["b"]);
  });
});
