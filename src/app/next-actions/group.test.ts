import { describe, expect, it } from "vitest";
import { groupNextActions } from "./group";
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

  it("orders group members by score desc then id asc", () => {
    const groups = groupNextActions([mk("z", 50, 1), mk("a", 50, 1), mk("m", 90, 1)]);
    expect(groups[0].primary.id).toBe("m");
    expect(groups[0].extra.map((e) => e.id)).toEqual(["a", "z"]); // equal score → id asc
  });
});
