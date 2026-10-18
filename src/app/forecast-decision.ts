// The forecast decision an export carries (§502 part 4, spec §3.8): target confidence, Safe to commit (P80) against
// the plan end, cost at finish, each milestone below target with what it would take, and the proposal. Pure,
// i18n-free and React-free; `export-forecast-decision-section.ts` words it.
//
// ★ Two paths, and the lever searches never run on a render path (spec §3.3):
//  - EXPORTS AND DOWNLOADS: a `ForecastDecisionSource` is a thunk that runs everything, `whatItTakesSync` included,
//    the first time an export or a document download asks, and answers from its cache after that.
//  - PREVIEWS: `ForecastDecisionLive` gives the decision with every take "pending" (`buildForecastDecisionBase`), and
//    the preview fills the takes from its own `useLeverSearch`, one probe per macrotask.
//  The As-is run is the SHARED app run (`computeAppScheduleRun`) when the input is its call, so a decision built while
//  the Reports or Dashboard memo is warm runs no second 10,000 trials.

import type { ScheduleForecastResult } from "./forecast";
import { whatItTakesSync, type WhatItTakes } from "./forecast-levers";
import {
  computeScenarioColumn, computeScenarioComparison, sharedAsIsRun,
  type ScenarioColumn, type ScenarioComparison, type ScenarioRunInput,
} from "./forecast-scenario-compare";
import type { ForecastScenario } from "./forecast-scenarios";
import { proposalIdOf, targetConfidenceOf, type TargetConfidence } from "./forecast-target";
import type { SettingsOverrides } from "./settings-types";
import type { BudgetCurrency } from "./types";

const SAFE_TO_COMMIT = 80;
const PERCENT = 100;

/** A cost in the baseline currency, or "beyond" (a trial past the horizon). */
export type DecisionMoney = number | "beyond";

/** What it would take for one below-target milestone: the search's answer; "pending" while a preview's background
 *  search (`useLeverSearch`) is still running; null when the search has no answer (`whatItTakesSync` returned null). */
export type DecisionTake = WhatItTakes | "pending" | null;

export type ForecastDecisionMilestone = {
  id: number;
  name: string;
  date: string;
  /** 0..1, below the goal. */
  chance: number;
  take: DecisionTake;
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

/** What a document PREVIEW reads instead of the synchronous source (spec §3.3: no lever search on the render path).
 *  `input` is the As-is input the preview's `useLeverSearch` runs on; `base` is the decision with every below-target
 *  milestone "pending", built once (the As-is run, shared with the app memo, and the proposal column, which the Reports
 *  section also pays in a render memo); the preview fills in each take as the search settles (`withTakes`). */
export type ForecastDecisionLive = {
  goal: TargetConfidence;
  input: () => ScenarioRunInput | null;
  base: () => ForecastDecision | null;
};

/** Both halves, as `useForecastDecisionSource` builds them and `ExportExtrasProvider` hands them out. */
export type ForecastDecisionHandle = { source: ForecastDecisionSource; live: ForecastDecisionLive };

export type ForecastDecisionArgs = {
  /** `isSimulationActive(settingsOverrides, features)`; off, there is no decision at all (the section is omitted). */
  simulationActive: boolean;
  /** The As-is run's inputs at the app-wide defaults; null while the holiday calendar loads. */
  input: ScenarioRunInput | null;
  scenarios: readonly ForecastScenario[];
  settingsOverrides: SettingsOverrides | undefined;
};

function p80Of(forecast: ScheduleForecastResult): string | null {
  return forecast.kind === "forecast" ? forecast.when.find((w) => w.p === SAFE_TO_COMMIT)?.date ?? null : null;
}

type DecisionBase = {
  decision: ForecastDecision;
  /** What the synchronous search needs; null below the history floor (nothing to search). */
  run: { input: ScenarioRunInput; context: ScenarioComparison["context"]; asIs: ScenarioColumn } | null;
};

/** Everything but the lever searches: every below-target milestone's take is "pending". */
function decisionBase({ simulationActive, input, scenarios, settingsOverrides }: ForecastDecisionArgs): DecisionBase | null {
  if (!simulationActive || input === null) return null;
  const goal = targetConfidenceOf(settingsOverrides);
  const { asIs, context } = computeScenarioComparison(input, [], sharedAsIsRun(input));
  const forecast = asIs.forecast;
  if (forecast.kind !== "forecast") return { decision: { insufficient: true, goal }, run: null };

  const byId = new Map(input.milestones.map((m) => [m.id, m]));
  const below = forecast.milestones
    .flatMap((c): ForecastDecisionMilestone[] => {
      const m = byId.get(c.id);
      if (m === undefined || c.state !== "chance" || c.chance >= goal / PERCENT) return [];
      return [{ id: m.id, name: m.name, date: m.date, chance: c.chance, take: "pending" }];
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

  const decision: ForecastDecision = {
    insufficient: false, goal, trials: forecast.trials, p80: p80Of(forecast), planEnd: input.planEnd,
    chanceOnTime: asIs.chanceOnTime,
    cost: asIs.cost?.kind === "sim"
      ? { p80: asIs.cost.p80, overBudget: asIs.cost.chanceOverBudget, currency: input.directory.baseCurrency } : null,
    below, proposal,
  };
  return { decision, run: { input, context, asIs } };
}

/** `d` with each below-target milestone's take from `takes` (by milestone id). */
export function withTakes(d: ForecastDecision, takes: (milestoneId: number) => DecisionTake): ForecastDecision {
  return d.insufficient ? d : { ...d, below: d.below.map((m) => ({ ...m, take: takes(m.id) })) };
}

/** The decision with every lever search run to completion (`whatItTakesSync`), or null with the simulation off or no
 *  input yet. For the explicit export and download actions only, never a render path (spec §3.3). */
export function buildForecastDecision(args: ForecastDecisionArgs): ForecastDecision | null {
  const base = decisionBase(args);
  if (base === null) return null;
  if (base.run === null) return base.decision;
  const { input, context, asIs } = base.run;
  const goal = base.decision.goal;
  return withTakes(base.decision, (id) => whatItTakesSync(input, context, { kind: "milestone", id }, goal, asIs));
}

/** The decision with no lever search at all: every below-target milestone "pending" (a preview's starting point). */
export function buildForecastDecisionBase(args: ForecastDecisionArgs): ForecastDecision | null {
  return decisionBase(args)?.decision ?? null;
}

/** `build()` the first time it is asked, and that same answer after. */
export function once<T>(build: () => T): () => T {
  let cached: { value: T } | null = null;
  return () => {
    if (cached === null) cached = { value: build() };
    return cached.value;
  };
}

/** A source that builds the decision the first time it is asked and answers from that after. */
export function forecastDecisionSource(args: () => ForecastDecisionArgs): ForecastDecisionSource {
  return once(() => buildForecastDecision(args()));
}
