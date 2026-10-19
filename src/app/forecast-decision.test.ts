// §502 part 4 — the forecast decision an export carries (spec §3.8): the pure model, run against the real engine.
import { describe, expect, it, vi } from "vitest";
import {
  buildForecastDecision, buildForecastDecisionBase, forecastDecisionSource, withTakes, type ForecastDecision, type ForecastDecisionArgs,
} from "./forecast-decision";
import { whatItTakesSync } from "./forecast-levers";
import { computeScenarioComparison, type ScenarioRunInput } from "./forecast-scenario-compare";
import type { ForecastScenario } from "./forecast-scenarios";
import { forecastDecisionRows } from "./export-forecast-decision-section";
import type { Milestone } from "./types";
import { OPEN, PLAN_END, TODAY, decisionInput } from "../test/forecast-decision-fixture";

const input = (over: Partial<ScenarioRunInput> = {}): ScenarioRunInput => decisionInput(over);
const ADD_ONE: ForecastScenario = {
  id: 5, name: "Contractor from Nov",
  changes: [{ kind: "scope", tasks: -4, on: TODAY }],
};

function args(over: Partial<ForecastDecisionArgs> = {}): ForecastDecisionArgs {
  return { simulationActive: true, input: input(), scenarios: [], settingsOverrides: undefined, ...over };
}
function ready(d: ForecastDecision | null): Extract<ForecastDecision, { insufficient: false }> {
  if (d === null || d.insufficient) throw new Error("expected a decision with a forecast");
  return d;
}

describe("buildForecastDecision (§502 part 4)", () => {
  it("is null while the simulation is off — the export then OMITS the section, it never empties it", () => {
    expect(buildForecastDecision(args({ simulationActive: false }))).toBeNull();
  });

  // Task 11b — the simulation is on, so a ticked section must not vanish while the holiday calendar loads.
  it("says the holiday calendar is loading while the input is not ready, for the export and the preview alike", () => {
    const loading = { insufficient: true, goal: 95, calendarLoading: true };
    const over = { input: null, settingsOverrides: { forecast: { targetConfidence: 95 as const } } };
    expect(buildForecastDecision(args(over))).toEqual(loading);
    expect(buildForecastDecisionBase(args(over))).toEqual(loading);
  });

  it("says insufficient below the history floor, and runs no lever search", () => {
    const d = buildForecastDecision(args({ input: input({ tasks: OPEN }) }));
    expect(d).toEqual({ insufficient: true, goal: 80 });
  });

  it("reads the goal from the project's target confidence (absent = 80)", () => {
    expect(ready(buildForecastDecision(args())).goal).toBe(80);
    expect(ready(buildForecastDecision(args({ settingsOverrides: { forecast: { targetConfidence: 95 } } }))).goal).toBe(95);
  });

  it("lists only milestones WITH a chance below the goal, worst first, each with its whatItTakesSync answer", () => {
    const d = ready(buildForecastDecision(args()));
    const { asIs, context } = computeScenarioComparison(input(), []);
    // Overdue ("Old") and unlinked ("Empty") milestones have no chance: never listed.
    const names = d.below.map((m) => m.name);
    expect(names).not.toContain("Old");
    expect(names).not.toContain("Empty");
    expect(names).not.toContain("Easy");
    expect(names.length).toBeGreaterThan(0);
    if (asIs.forecast.kind !== "forecast") throw new Error("fixture must forecast");
    const easy = asIs.forecast.milestones.find((m) => m.id === 5);
    expect(easy?.state === "chance" && easy.chance >= 0.95).toBe(true);
    for (const m of d.below) expect(m.chance).toBeLessThan(0.8);
    const chances = d.below.map((m) => m.chance);
    expect(chances).toEqual([...chances].sort((a, b) => a - b));
    const beta = d.below.find((m) => m.name === "Beta");
    expect(beta?.date).toBe("2026-10-30");
    expect(beta?.take).toEqual(whatItTakesSync(input(), context, { kind: "milestone", id: 1 }, 80, asIs));
  });

  it("matches the As-is run's P80 and chance on time, and carries the plan end and the trial count", () => {
    const d = ready(buildForecastDecision(args()));
    const { asIs } = computeScenarioComparison(input(), []);
    if (asIs.forecast.kind !== "forecast") throw new Error("fixture must forecast");
    expect(d.p80).toBe(asIs.forecast.when.find((w) => w.p === 80)?.date ?? null);
    expect(d.chanceOnTime).toBe(asIs.chanceOnTime);
    expect(d.planEnd).toBe(PLAN_END);
    expect(d.trials).toBe(10000);
  });

  it("has a cost only with the cost pass on, in the baseline currency", () => {
    expect(ready(buildForecastDecision(args())).cost).toBeNull();
    const cost = ready(buildForecastDecision(args({ input: input({ costOn: true }) }))).cost;
    expect(cost).not.toBeNull();
    expect(cost?.currency).toBe("EUR");
  });

  it("carries the proposal when the stored id names a saved scenario", () => {
    const d = ready(buildForecastDecision(args({ scenarios: [ADD_ONE], settingsOverrides: { forecast: { proposalScenarioId: 5 } } })));
    expect(d.proposal?.name).toBe("Contractor from Nov");
    expect(typeof d.proposal?.p80).toBe("string");
    expect(d.proposal?.costP80).toBeNull();
  });

  it("reads a proposal id naming no saved scenario (deleted, or never there) as NO proposal — the stale-id rule", () => {
    const stale = ready(buildForecastDecision(args({ scenarios: [ADD_ONE], settingsOverrides: { forecast: { proposalScenarioId: 99 } } })));
    expect(stale.proposal).toBeNull();
    const none = ready(buildForecastDecision(args({ scenarios: [ADD_ONE] })));
    expect(none.proposal).toBeNull();
  });
});

describe("forecastDecisionSource", () => {
  it("builds nothing until asked, then once: later calls answer from the cache", () => {
    const read = vi.fn(() => args());
    const source = forecastDecisionSource(read);
    expect(read).not.toHaveBeenCalled();
    const first = source();
    expect(source()).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("caches a null (simulation off) too", () => {
    const read = vi.fn(() => args({ simulationActive: false }));
    const source = forecastDecisionSource(read);
    expect(source()).toBeNull();
    expect(source()).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("buildForecastDecisionBase and withTakes (the preview path)", () => {
  it("is the same decision with every below-target take pending, and no lever search", () => {
    const full = ready(buildForecastDecision(args()));
    const base = ready(buildForecastDecisionBase(args()));
    expect(base.below.map((m) => m.take)).toEqual(full.below.map(() => "pending"));
    expect({ ...base, below: base.below.map((m) => ({ ...m, take: null })) })
      .toEqual({ ...full, below: full.below.map((m) => ({ ...m, take: null })) });
  });

  it("fills each take by milestone id; an insufficient decision passes through", () => {
    const base = ready(buildForecastDecisionBase(args()));
    const filled = ready(withTakes(base, (id) => (id === 1 ? null : "pending")));
    expect(filled.below.find((m) => m.id === 1)?.take).toBeNull();
    expect(filled.below.find((m) => m.id === 4)?.take).toBe("pending");
    const insufficient = { insufficient: true, goal: 80 } as const;
    expect(withTakes(insufficient, () => null)).toBe(insufficient);
  });
});

// Third review — overdue milestones must not vanish from the export behind an empty below-target list.
describe("overdue milestones in the decision and its export rows", () => {
  const MIXED: Milestone[] = [
    { id: 21, name: "Kickoff", date: "2026-10-01", linkedTaskIds: [OPEN[0].id] },
    { id: 22, name: "Design", date: "2026-10-05", linkedTaskIds: [OPEN[1].id] },
    { id: 23, name: "Nothing linked", date: "2026-12-01", linkedTaskIds: [] },
    { id: 24, name: "A", date: "2027-06-01", linkedTaskIds: [OPEN[2].id] },
    { id: 25, name: "B", date: "2027-06-01", linkedTaskIds: [OPEN[3].id] },
    { id: 26, name: "C", date: "2027-06-01", linkedTaskIds: [OPEN[4].id] },
  ];

  it("2 overdue + 1 unlinked + 3 on target: nothing below, both overdue in date order, the unlinked in neither", () => {
    const d = ready(buildForecastDecision(args({ input: input({ milestones: MIXED, planEnd: "2027-06-30" }) })));
    expect(d.below).toEqual([]);
    expect(d.overdue.map((m) => m.name)).toEqual(["Kickoff", "Design"]);
    const rows = forecastDecisionRows(d, "en-GB");
    expect(rows.filter(([label]) => label.startsWith("Overdue: ")).map(([label, value]) => [label.replace(/ \(.*\)$/, ""), value]))
      .toEqual([["Overdue: Kickoff", "Overdue"], ["Overdue: Design", "Overdue"]]);
    expect(rows.some(([label, value]) => `${label} ${value}`.includes("Nothing linked"))).toBe(false);
  });
});
