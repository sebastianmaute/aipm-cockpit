import { describe, expect, it } from "vitest";
import { groupNextActions, pickHeroGroup, topGroupPrimaries } from "./group";
import type { SuggestedAction } from "./types";

const mk = (
  id: string,
  score: number,
  ctaId: string | number,
  tier: SuggestedAction["tier"] = "now",
): SuggestedAction => ({
  id,
  source: "raid",
  title: { key: "actionRaidTitle", params: [1, id] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score,
  tier,
  cta: { kind: "open", view: "raid", id: ctaId },
});

describe("groupNextActions", () => {
  it("collapses signals on the same entity into one group", () => {
    const groups = groupNextActions([mk("a", 40, 1), mk("b", 70, 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("raid:1");
    expect(groups[0].primary.id).toBe("b"); // higher score wins
    expect(groups[0].extra.map((e) => e.id)).toEqual(["a"]);
  });

  it("uses the max score and its tier for the group", () => {
    const groups = groupNextActions([mk("a", 70, 1, "now"), mk("b", 30, 1, "soon")]);
    expect(groups[0].score).toBe(70);
    expect(groups[0].tier).toBe("now");
  });

  it("keeps distinct entities as separate groups", () => {
    const groups = groupNextActions([mk("a", 40, 1), mk("b", 70, 2)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe("raid:2"); // sorted by score desc
    expect(groups[1].key).toBe("raid:1");
  });

  it("passes through a single-signal entity with no extra", () => {
    const groups = groupNextActions([mk("a", 40, 1)]);
    expect(groups[0].extra).toEqual([]);
  });

  it("keys snooze-only actions by their own id (never merges)", () => {
    const snooze: SuggestedAction = {
      id: "s1", source: "raid",
      title: { key: "actionRaidTitle", params: [1, "s1"] },
      why: { key: "actionRaidWhySeverity", params: ["High"] },
      score: 10, tier: "monitor",
      cta: { kind: "snooze", actionId: "s1" },
    };
    const groups = groupNextActions([snooze, { ...snooze, id: "s2", cta: { kind: "snooze", actionId: "s2" } }]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key).sort()).toEqual(["s1", "s2"]);
  });

  it("returns an empty array for empty input", () => {
    expect(groupNextActions([])).toEqual([]);
  });

  it("keeps both workload signals for one resource in a single group", () => {
    const workloadAction = (id: string, score: number, cta: SuggestedAction["cta"]): SuggestedAction => ({
      id, source: "workload",
      title: { key: "actionWorkloadTitle", params: ["Bo"] },
      why: { key: "actionWorkloadWhyOverload", params: [4] },
      score, tier: "now", cta,
    });
    const groups = groupNextActions([
      workloadAction("workload:7:overload", 90, { kind: "open-tasks-for", resourceId: 7, resourceName: "Bo" }),
      workloadAction("workload:7:over-allocated", 40, { kind: "open", view: "workload", id: 7 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("workload:7");
    expect(groups[0].primary.id).toBe("workload:7:overload");
    expect(groups[0].extra.map((x) => x.id)).toEqual(["workload:7:over-allocated"]);
  });

  it("orders group members by score desc then id asc", () => {
    const groups = groupNextActions([mk("z", 50, 1), mk("a", 50, 1), mk("m", 90, 1)]);
    expect(groups[0].primary.id).toBe("m");
    expect(groups[0].extra.map((e) => e.id)).toEqual(["a", "z"]); // equal score → id asc
  });
});

describe("topGroupPrimaries", () => {
  it("returns one primary per group, in rank order", () => {
    // Five signals on entity 1 outrank the lone signal on entity 2 — a flat
    // slice(0, 5) would return five entity-1 rows.
    const actions = [mk("e1a", 50, 1), mk("e1b", 49, 1), mk("e1c", 48, 1), mk("e1d", 47, 1), mk("e1e", 46, 1), mk("e2", 30, 2)];
    expect(topGroupPrimaries(groupNextActions(actions), 5).map((a) => a.id)).toEqual(["e1a", "e2"]);
  });

  it("caps the result at n groups", () => {
    const actions = [mk("a", 90, 1), mk("b", 80, 2), mk("c", 70, 3), mk("c2", 10, 3)];
    expect(topGroupPrimaries(groupNextActions(actions), 2).map((a) => a.id)).toEqual(["a", "b"]);
  });
});

describe("pickHeroGroup (spec C: one rule for the Next-actions page and the Dashboard)", () => {
  it("returns the top-ranked group when it is not monitor-tier", () => {
    const groups = groupNextActions([mk("a", 90, 1, "now"), mk("b", 80, 2, "soon")]);
    expect(pickHeroGroup(groups)).toBe(groups[0]);
  });

  it("returns null when the top-ranked group is monitor-tier", () => {
    expect(pickHeroGroup(groupNextActions([mk("m", 10, 1, "monitor")]))).toBeNull();
  });

  it("never reaches past a monitor-tier top group for a lower Now one", () => {
    // Rank is score order; a monitor group can outrank a now group.
    expect(pickHeroGroup(groupNextActions([mk("m", 99, 1, "monitor"), mk("n", 50, 2, "now")]))).toBeNull();
  });

  it("returns null for no groups", () => {
    expect(pickHeroGroup([])).toBeNull();
  });
});
