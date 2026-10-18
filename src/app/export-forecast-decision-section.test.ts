// §502 part 4 — the forecast decision as an export section (spec §3.8, the mockup's "Exports / documents" block).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { forecastDecisionRows } from "./export-forecast-decision-section";
import { buildExportSections } from "./export-sections";
import type { ForecastDecision } from "./forecast-decision";
import type { LeverOutcome, WhatItTakes } from "./forecast-levers";
import { loadI18n } from "./i18n";
import { EXPORT_SECTION_KEYS, type ExportConfig } from "./settings-types";
import { emptyWorkspace } from "./workspace";

const LANG = "en-GB";
const reaches = (n: number): LeverOutcome => ({ state: "reaches", n, chance: 0.81, hours: null });
function take(prioritised: number | null, people: LeverOutcome, tasks: LeverOutcome): WhatItTakes {
  return { target: { kind: "milestone", id: 1 }, chance: 0.3, prioritised, people, tasks };
}

// The mockup's sample: below target, two milestones short, a proposal set.
const MOCKUP: ForecastDecision = {
  insufficient: false, goal: 80, trials: 10000, p80: "2027-03-17", planEnd: "2027-02-27", chanceOnTime: 0.41,
  cost: { p80: 412000, overBudget: 0.38, currency: "EUR" },
  below: [
    { name: "Go-live", date: "2027-02-27", chance: 0.31, take: take(0.58, reaches(2), reaches(9)) },
    { name: "UAT sign-off", date: "2027-02-06", chance: 0.64, take: take(0.83, reaches(1), reaches(3)) },
  ],
  proposal: { name: "Contractor from Feb + drop reporting", p80: "2027-02-24", chanceOnTime: 0.83, costP80: 431000 },
};
type Ready = Extract<ForecastDecision, { insufficient: false }>;
const decision = (over: Partial<Ready>): ForecastDecision => ({ ...(MOCKUP as Ready), ...over });
const ONLY = Object.fromEntries(EXPORT_SECTION_KEYS.map((k) => [k, k === "forecastDecision"])) as ExportConfig;
const ALL_ON = Object.fromEntries(EXPORT_SECTION_KEYS.map((k) => [k, true])) as ExportConfig;

describe("forecastDecisionRows (§502 part 4)", () => {
  it("words the mockup's block line by line", () => {
    expect(forecastDecisionRows(MOCKUP, LANG)).toEqual([
      ["Forecast (simulated)", "10,000 runs, target confidence 80%"],
      ["Safe to commit (P80)", "17 Mar 2027 — plan end 27 Feb 2027, 41% chance on time"],
      ["Cost at finish (P80)", "€412,000 — 38% chance over budget"],
      ["Below target: Go-live (27 Feb 2027)", "31% — to reach 80%: +2 people (team average), or 9 fewer tasks, prioritising alone: not enough"],
      ["Below target: UAT sign-off (6 Feb 2027)", "64% — to reach 80%: prioritise it → 83%, or +1 person (team average), or 3 fewer tasks"],
      ["Proposed intervention", "“Contractor from Feb + drop reporting” → P80 24 Feb 2027, 83% on time, cost at finish €431,000"],
    ]);
  });

  it("says insufficient in ONE row, still marked simulated", () => {
    expect(forecastDecisionRows({ insufficient: true, goal: 95 }, LANG)).toEqual([
      ["Forecast (simulated)", "Not enough history to forecast yet"],
    ]);
  });

  it("words a milestone whose search had no answer (whatItTakesSync returned null) without crashing", () => {
    const rows = forecastDecisionRows(decision({ below: [{ name: "Beta", date: "2027-01-15", chance: 0.2, take: null }] }), LANG);
    expect(rows).toContainEqual(["Below target: Beta (15 Jan 2027)", "20% — what it would take is not known"]);
  });

  it("words every lever that does not reach: out of reach, needs booked hours, too few tasks, no open tasks", () => {
    const row = (t: WhatItTakes) => forecastDecisionRows(decision({ below: [{ name: "M", date: "2027-01-15", chance: 0.2, take: t }] }), LANG).at(-2)?.[1];
    expect(row(take(null, { state: "out-of-reach" }, { state: "out-of-reach" })))
      .toBe("20% — no single lever reaches 80%, adding people: not within reach, dropping tasks: not within reach");
    expect(row(take(null, { state: "inert", reason: "needs-booked-hours" }, { state: "inert", reason: "too-few-tasks" })))
      .toBe("20% — no single lever reaches 80%, adding people needs booked hours, too few open tasks to drop");
    expect(row(take(0.4, { state: "inert", reason: "needs-booked-hours" }, { state: "inert", reason: "no-open-tasks" })))
      .toBe("20% — no single lever reaches 80%, adding people needs booked hours, prioritising alone: not enough");
    expect(row(take(null, { state: "inert", reason: "needs-booked-hours" }, { state: "reaches", n: 2, chance: 0.81, hours: 6 })))
      .toBe("20% — to reach 80%: 2 fewer tasks (≈ 6 h), adding people needs booked hours");
  });

  it("drops the cost row without a simulated cost, and the over-budget clause without a budget", () => {
    const noCost = forecastDecisionRows(decision({ cost: null }), LANG);
    expect(noCost.map((r) => r[0])).not.toContain("Cost at finish (P80)");
    // With no As-is cost the proposal shows no cost either (the Reports comparison table's rule).
    expect(noCost.at(-1)?.[1]).toBe("“Contractor from Feb + drop reporting” → P80 24 Feb 2027, 83% on time");
    expect(forecastDecisionRows(decision({ cost: { p80: "beyond", overBudget: null, currency: "EUR" } }), LANG))
      .toContainEqual(["Cost at finish (P80)", "beyond the horizon"]);
  });

  it("drops the plan-end clause without a chance on time, and the proposal row without a proposal", () => {
    const rows = forecastDecisionRows(decision({ chanceOnTime: null, p80: null, proposal: null }), LANG);
    expect(rows[1]).toEqual(["Safe to commit (P80)", "> 5 y"]);
    expect(rows.map((r) => r[0])).not.toContain("Proposed intervention");
  });
});

describe("the forecastDecision export section", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("is headed 'simulated' and carries the rows", () => {
    const sections = buildExportSections(emptyWorkspace(), ONLY, LANG, { forecastDecision: () => MOCKUP });
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("forecastDecision");
    expect(sections[0].title).toBe("Forecast decision (simulated)");
    expect(sections[0].columns).toEqual(["Field", "Value"]);
    expect(sections[0].rows).toEqual(forecastDecisionRows(MOCKUP, LANG));
  });

  it("is headed 'simuliert' in German", () => {
    const sections = buildExportSections(emptyWorkspace(), ONLY, "de", { forecastDecision: () => MOCKUP });
    expect(sections[0].title).toBe("Prognose-Entscheidung (simuliert)");
    expect(sections[0].rows[0][0]).toBe("Prognose (simuliert)");
  });

  it("is OMITTED, not emptied, with the simulation off: no source, or a source answering null", () => {
    expect(buildExportSections(emptyWorkspace(), ALL_ON, LANG).map((s) => s.key)).not.toContain("forecastDecision");
    expect(buildExportSections(emptyWorkspace(), ALL_ON, LANG, { forecastDecision: () => null }).map((s) => s.key))
      .not.toContain("forecastDecision");
  });

  it("never runs the source for an export that leaves the section out", () => {
    const source = vi.fn(() => MOCKUP);
    const off = { ...ALL_ON, forecastDecision: false };
    expect(buildExportSections(emptyWorkspace(), off, LANG, { forecastDecision: source }).map((s) => s.key)).not.toContain("forecastDecision");
    expect(source).not.toHaveBeenCalled();
  });
});
