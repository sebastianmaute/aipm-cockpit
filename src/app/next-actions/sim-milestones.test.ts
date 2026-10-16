// Pins the simulated "unlikely on time" milestone signal (§502 part 2, spec §3.3):
// which milestones raise it, its id/tier/score/copy, and how it merges into the
// already-grouped Next-actions list without entering the flat engine list.
import { describe, it, expect } from "vitest";
import type { AppForecast, MilestoneChance } from "../forecast/app-forecast";
import type { Milestone } from "../types";
import type { SuggestedAction } from "./types";
import { groupNextActions, type ActionGroup } from "./group";
import { TIER_NOW, TIER_SOON } from "./score";
import { SIM_UNLIKELY_BELOW, buildSimMilestoneActions, mergeSimActions } from "./sim-milestones";

function forecast(milestones: readonly MilestoneChance[]): AppForecast {
  return {
    kind: "forecast", p50: null, p80: null, p95: null, chanceOnTime: null, estimateCoverage: null,
    windowDays: 30, distribution: new Int32Array(0), trialDays: new Int32Array(0), windowDates: [], trials: 0,
    markers: { p50: 0, p80: 0, p95: 0 }, milestones,
  };
}
const INSUFFICIENT: AppForecast = { kind: "insufficient", finished: 1, neededFinished: 5, days: 3, neededDays: 10 };

function ms(id: number, over: Partial<Milestone> = {}): Milestone {
  return { id, name: id === 7 ? "Go-live" : `M${id}`, date: "2026-12-01", ...over } as Milestone;
}
const chance = (id: number, c: number): MilestoneChance => ({ id, state: "chance", chance: c, chancePrioritised: c });

function build(chances: readonly MilestoneChance[], milestones: readonly Milestone[] = [ms(7)], dismissed: ReadonlySet<string> = new Set()) {
  return buildSimMilestoneActions({ forecast: forecast(chances), milestones, dismissed });
}

describe("buildSimMilestoneActions", () => {
  it("raises one soon action for a milestone with a 31% chance, with the id, source, CTA and copy", () => {
    const out = build([chance(7, 0.31)]);
    expect(out).toHaveLength(1);
    const [a] = out;
    expect(a.id).toBe("forecast-sim:milestone:7");
    expect(a.source).toBe("forecast-sim");
    expect(a.moduleId).toBe("milestones");
    expect(a.tier).toBe("soon");
    expect(a.cta).toEqual({ kind: "open", view: "forecast", id: 7 });
    expect(a.title).toEqual({ key: "actionForecastSimTitle", params: ["Go-live", 31] });
    expect(a.why).toEqual({ key: "actionForecastSimWhy", params: [31, { date: "2026-12-01" }] });
    expect(a.score).toBeGreaterThanOrEqual(TIER_SOON);
    expect(a.score).toBeLessThan(TIER_NOW);
  });

  it("raises nothing at exactly the threshold, and one just below it", () => {
    expect(SIM_UNLIKELY_BELOW).toBe(0.5);
    expect(build([chance(7, 0.5)])).toEqual([]);
    expect(build([chance(7, 0.49)])).toHaveLength(1);
  });

  it("raises nothing for an achieved milestone", () => {
    expect(build([chance(7, 0.1)], [ms(7, { achievedDate: "2026-10-01" })])).toEqual([]);
  });

  it("raises nothing when the forecast is insufficient", () => {
    expect(buildSimMilestoneActions({ forecast: INSUFFICIENT, milestones: [ms(7)], dismissed: new Set() })).toEqual([]);
  });

  it("raises nothing for an overdue or unlinked milestone, or one no longer in the list", () => {
    expect(build([{ id: 7, state: "overdue" }, { id: 8, state: "no-linked-tasks" }], [ms(7), ms(8)])).toEqual([]);
    expect(build([chance(9, 0.1)], [ms(7)])).toEqual([]);
  });

  it("drops a snoozed id", () => {
    expect(build([chance(7, 0.2)], [ms(7)], new Set(["forecast-sim:milestone:7"]))).toEqual([]);
  });

  it("uses the <1% keys for a chance that rounds to zero but is not zero", () => {
    const [a] = build([chance(7, 0.003)]);
    expect(a.title).toEqual({ key: "actionForecastSimTitleBelow1", params: ["Go-live"] });
    expect(a.why).toEqual({ key: "actionForecastSimWhyBelow1", params: [{ date: "2026-12-01" }] });
  });

  it("scores a lower chance higher, spanning exactly the soon band", () => {
    const [low, high] = build([chance(1, 0), chance(2, 0.499)], [ms(1), ms(2)]);
    expect(low.score).toBe(TIER_NOW - 1);
    expect(high.score).toBe(TIER_SOON);
    const [a] = build([chance(7, 0.2)]);
    const [b] = build([chance(7, 0.3)]);
    expect(a.score).toBeGreaterThan(b.score);
  });
});

function measured(id: string, over: Partial<SuggestedAction> = {}): SuggestedAction {
  return {
    id, source: "milestone", title: { key: "actionMilestoneTitle", params: ["X"] },
    why: { key: "actionMilestoneWhyAtRisk" }, score: 70, tier: "now",
    cta: { kind: "open", view: "milestones", id: 7 }, ...over,
  };
}

describe("mergeSimActions", () => {
  it("adds the sim action to the same milestone's group as an extra; primary, score and tier unchanged", () => {
    const groups = groupNextActions([measured("milestone:7:at-risk", { score: 20, tier: "monitor" })]);
    const sim = build([chance(7, 0.31)]);
    const [g] = mergeSimActions(groups, sim);
    expect(g.key).toBe("milestones:7");
    expect(g.primary.id).toBe("milestone:7:at-risk");
    expect(g.extra.map((e) => e.id)).toEqual(["forecast-sim:milestone:7"]);
    expect(g.score).toBe(20);
    expect(g.tier).toBe("monitor");
  });

  it("re-sorts a group's extras score desc then id asc", () => {
    const groups = groupNextActions([
      measured("milestone:7:a", { score: 90 }),
      measured("milestone:7:b", { score: 31 }),
    ]);
    const sim = build([chance(7, 0.1)]);
    const [g] = mergeSimActions(groups, sim);
    expect(g.extra.map((e) => e.id)).toEqual(["forecast-sim:milestone:7", "milestone:7:b"]);
  });

  it("breaks an extras score tie by id asc, with groupNextActions' comparator", () => {
    const groups = groupNextActions([
      measured("milestone:7:a", { score: 90 }),
      measured("milestone:7:b", { score: 53 }),
    ]);
    const sim = build([chance(7, 0.1)]); // score 53 — ties with milestone:7:b
    expect(sim[0].score).toBe(53);
    const [g] = mergeSimActions(groups, sim);
    expect(g.extra.map((e) => e.id)).toEqual(["forecast-sim:milestone:7", "milestone:7:b"]);
  });

  it("gives an unmatched sim action its own group, after every now group", () => {
    const groups = groupNextActions([
      measured("raid:1", { score: 60, cta: { kind: "open", view: "raid", id: 1 } }),
      measured("m:3", { score: 61, cta: { kind: "open", view: "milestones", id: 3 } }),
      measured("t:1", { score: 10, tier: "monitor", cta: { kind: "open", view: "open-points", id: 1 } }),
    ]);
    const sim = build([chance(7, 0)]);
    const merged = mergeSimActions(groups, sim);
    expect(merged.map((g) => g.key)).toEqual(["milestones:3", "raid:1", "forecast-sim:milestone:7", "open-points:1"]);
    const own = merged[2];
    expect(own).toEqual({ key: sim[0].id, primary: sim[0], extra: [], score: sim[0].score, tier: "soon" });
  });

  it("sorts ties by key asc, as groupNextActions does, and leaves the input untouched", () => {
    const groups: ActionGroup[] = groupNextActions([
      measured("z", { score: 59, tier: "soon", cta: { kind: "open", view: "raid", id: 9 } }),
    ]);
    const before = JSON.stringify(groups);
    const sim = build([chance(7, 0)]); // score 59, key "forecast-sim:..." < "raid:9"
    const merged = mergeSimActions(groups, sim);
    expect(merged.map((g) => g.key)).toEqual(["forecast-sim:milestone:7", "raid:9"]);
    expect(JSON.stringify(groups)).toBe(before);
  });
});
