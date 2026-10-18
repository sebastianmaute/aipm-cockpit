// The forecast decision an export carries (§502 part 4, spec §3.8): target confidence, Safe to commit (P80) against
// the plan end, cost at finish, each milestone below target with what it would take, and the proposal. Pure,
// i18n-free and React-free; `export-forecast-decision-section.ts` words it.
//
// ★ Computed on demand, never on a render path: a `ForecastDecisionSource` is a thunk that runs the engine the first
//  time an export (or a document with a `forecastDecision` block) asks, and answers from its cache after that. The
//  As-is run is the SHARED app run (`computeAppScheduleRun`) when the input is its call, so an export made while the
//  Reports or Dashboard memo is warm runs no second 10,000 trials; the lever searches are `whatItTakesSync`.

import type { ScheduleForecastResult } from "./forecast";
import { computeAppScheduleRun } from "./forecast/app-forecast";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import { whatItTakesSync, type WhatItTakes } from "./forecast-levers";
import { computeScenarioColumn, computeScenarioComparison, type ScenarioRunInput } from "./forecast-scenario-compare";
import type { ForecastScenario } from "./forecast-scenarios";
import { proposalIdOf, targetConfidenceOf, type TargetConfidence } from "./forecast-target";
import type { SettingsOverrides } from "./settings-types";
import type { BudgetCurrency } from "./types";

const SAFE_TO_COMMIT = 80;
const PERCENT = 100;

/** A cost in the baseline currency, or "beyond" (a trial past the horizon). */
export type DecisionMoney = number | "beyond";

export type ForecastDecisionMilestone = {
  name: string;
  date: string;
  /** 0..1, below the goal. */
  chance: number;
  /** What it would take; null when the search has no answer for the milestone (`whatItTakesSync` returned null). */
  take: WhatItTakes | null;
};

export type ForecastDecisionProposal = {
  name: string;
  p80: string | null;
  chanceOnTime: number | null;
  costP80: DecisionMoney | null;
};

export type ForecastDecision =
  | {
      insufficient: false;
      goal: TargetConfidence;
      trials: number;
      /** Safe to commit; null past the horizon. */
      p80: string | null;
      planEnd: string;
      chanceOnTime: number | null;
      /** Null when the run has no simulated cost (Budget module off, no booked hours, cost floor). */
      cost: { p80: DecisionMoney; overBudget: number | null; currency: BudgetCurrency } | null;
      /** Worst first. Only milestones WITH a chance below the goal: overdue and unlinked ones have none. */
      below: ForecastDecisionMilestone[];
      /** Null when no proposal is set, or the stored id names no saved scenario (`proposalIdOf`). */
      proposal: ForecastDecisionProposal | null;
    }
  | { insufficient: true; goal: TargetConfidence };

/** A lazily computed decision: null while the simulation is off. Called only when an export includes the section. */
export type ForecastDecisionSource = () => ForecastDecision | null;

export type ForecastDecisionArgs = {
  /** `isSimulationActive(settingsOverrides, features)`; off, there is no decision at all (the section is omitted). */
  simulationActive: boolean;
  /** The As-is run's inputs at the app-wide defaults; null while the holiday calendar loads. */
  input: ScenarioRunInput | null;
  scenarios: readonly ForecastScenario[];
  settingsOverrides: SettingsOverrides | undefined;
};

/** The shared app run when `input` is exactly its call (the app-wide defaults), else undefined: the comparison then
 *  runs its own. Same references as `useAppForecast`, so the memo answers and the trials do not rerun. */
export function sharedAsIsRun(input: ScenarioRunInput): ScheduleForecastResult | undefined {
  if (input.window !== DEFAULT_HISTORY_WINDOW || input.unit !== "tasks") return undefined;
  return computeAppScheduleRun({
    tasks: input.tasks, milestones: input.milestones, planEnd: input.planEnd, today: input.today, holidaySet: input.holidaySet,
  });
}

function p80Of(forecast: ScheduleForecastResult): string | null {
  return forecast.kind === "forecast" ? forecast.when.find((w) => w.p === SAFE_TO_COMMIT)?.date ?? null : null;
}

/** The decision, or null with the simulation off or no input yet. */
export function buildForecastDecision({ simulationActive, input, scenarios, settingsOverrides }: ForecastDecisionArgs): ForecastDecision | null {
  if (!simulationActive || input === null) return null;
  const goal = targetConfidenceOf(settingsOverrides);
  const { asIs, context } = computeScenarioComparison(input, [], sharedAsIsRun(input));
  const forecast = asIs.forecast;
  if (forecast.kind !== "forecast") return { insufficient: true, goal };

  const byId = new Map(input.milestones.map((m) => [m.id, m]));
  const below = forecast.milestones
    .flatMap((c): ForecastDecisionMilestone[] => {
      const m = byId.get(c.id);
      if (m === undefined || c.state !== "chance" || c.chance >= goal / PERCENT) return [];
      const take = whatItTakesSync(input, context, { kind: "milestone", id: m.id }, goal, asIs);
      return [{ name: m.name, date: m.date, chance: c.chance, take }];
    })
    // Worst first, as the Reports milestones table (`milestoneRowsWorstFirst`): chance, then date, then name.
    .sort((a, b) => a.chance - b.chance || (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

  const proposalId = proposalIdOf(settingsOverrides, scenarios);
  const scenario = proposalId === null ? undefined : scenarios.find((s) => s.id === proposalId);
  let proposal: ForecastDecisionProposal | null = null;
  if (scenario !== undefined) {
    const column = computeScenarioColumn(input, scenario.changes, context);
    proposal = {
      name: scenario.name, p80: p80Of(column.forecast), chanceOnTime: column.chanceOnTime,
      costP80: column.cost?.kind === "sim" ? column.cost.p80 : null,
    };
  }

  return {
    insufficient: false, goal, trials: forecast.trials, p80: p80Of(forecast), planEnd: input.planEnd,
    chanceOnTime: asIs.chanceOnTime,
    cost: asIs.cost?.kind === "sim"
      ? { p80: asIs.cost.p80, overBudget: asIs.cost.chanceOverBudget, currency: input.directory.baseCurrency } : null,
    below, proposal,
  };
}

/** A source that builds the decision the first time it is asked and answers from that after. */
export function forecastDecisionSource(args: () => ForecastDecisionArgs): ForecastDecisionSource {
  let cached: { value: ForecastDecision | null } | null = null;
  return () => {
    if (cached === null) cached = { value: buildForecastDecision(args()) };
    return cached.value;
  };
}
