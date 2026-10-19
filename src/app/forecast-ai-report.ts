/**
 * The forecast report `get_forecast` returns (§502, spec §4.4) — pure, i18n-free, React-free. It reshapes the
 * existing scenario comparison into one JSON-serialisable object: no typed arrays, dates as ISO strings, a
 * trial past the horizon as "beyond". Every column comes from the comparison (or `computeScenarioColumn` on its
 * context), so all share its common random numbers, and a `whatIf` equal to a saved scenario reproduces that
 * scenario's result exactly. Three things run beside it: the lever search (`whatItTakesSync`, §502 part 4), whose
 * probes are columns on that same context and which is the bulk of a call's cost (docs/AGENTS/forecast.md), so a call
 * with a `whatIf` or non-default settings skips it; one As-is run with the plan end as the How-many date
 * (`howManyByPlanEnd`), which the comparison's runs leave at today; and, only when asked, `forecastByGroup`.
 */
import { entityToken } from "./ai-entity-token";
import type { ScheduleContext } from "./forecast-added-people";
import { DEFAULT_HISTORY_WINDOW, FORECAST_TRIALS, type ForecastUnit } from "./forecast/constants";
import {
  DEFAULT_WHAT_IF, computeScheduleForecast, lastForecastableDay, type ForecastInsufficient, type ScheduleForecast,
} from "./forecast";
import { forecastByGroup, type GroupForecastRow } from "./forecast-by-group";
import type { CostAtFinish } from "./forecast/cost";
import type { ForecastHistoryEntry } from "./forecast-history";
import { whatItTakesSync, type LeverTarget, type WhatItTakes } from "./forecast-levers";
import { belowTargetRows, milestoneRowsWorstFirst } from "./forecast-milestone-rows";
import {
  computeScenarioColumn, computeScenarioComparison, type ScenarioColumn, type ScenarioComparison, type ScenarioRunInput,
} from "./forecast-scenario-compare";
import type { ScenarioRowStatus } from "./forecast-scenario-schedule";
import type { ForecastScenario, ScenarioChange, ValidationContext } from "./forecast-scenarios";
import { proposalIdOf, targetConfidenceOf, type TargetConfidence } from "./forecast-target";
import { weeklyChange, type WeeklyChange } from "./forecast-tile-model";
import type { SettingsOverrides } from "./settings-types";
import type { BudgetCurrency } from "./types";

/** How many recorded days `p80History` carries: about five working weeks, the newest last. */
export const P80_HISTORY_ENTRIES = 26;

/** A milestone with a chance, or one the engine gives none (overdue, or no linked tasks). `prioritised` is its chance
 *  if its own open linked tasks went first (the view's "Chance if prioritised" column). */
export type MilestoneReport =
  | { id: number; name: string; date: string; chance: number; prioritised: number }
  | { id: number; name: string; date: string; state: "overdue" | "no-linked-tasks" };

/** A cost in the baseline currency, or "beyond" (a trial past the horizon). */
export type Money = number | "beyond";

/** What a column was simulated from, so a reader can say why its dates are what they are (§502 tooling). */
export type ForecastBasis = {
  /** Open work simulated: tasks, or estimated hours in the effort unit. */
  backlog: number;
  /** Tasks finished inside the history window: the days the samples are drawn from. */
  finishedInWindow: number;
  windowWorkingDays: number;
  /** Done tasks with no completion date: they count nowhere in the history. */
  doneWithoutDate: number;
  /** 0–1: the share of runs that finished past the horizon. */
  beyondShare: number;
};

export type ColumnReport =
  | {
      status: "forecast"; p50: string | "beyond"; p80: string | "beyond"; p95: string | "beyond";
      /** 0–1, by plan end. */
      chanceOnTime: number | null;
      milestones: MilestoneReport[];
      cost: { p50: Money; p80: Money; p95: Money; chanceOverBudget: number | null } | { unavailable: string } | null;
      basis: ForecastBasis;
    }
  | {
      status: "insufficient"; finished: number; neededFinished: number; days: number; neededDays: number;
      doneWithoutDate: number; reason: string;
    };

/** How much As is finishes by the plan end (capped at the horizon, `by`): in P percent of runs at least that much. */
export type HowManyReport = { by: string; p50: number; p80: number; p95: number };

export type RowReport =
  | { index: number; kind: "availability"; ended: boolean }
  | { index: number; kind: "scope"; milestoneGone: boolean }
  | {
      index: number; kind: "addPeople";
      sizing: { name: string; weeklyHours: number; ratePerHour: number; rateNote: string; shareAtFullSpeed: number };
    }
  | { index: number; kind: "addPeople"; inert: "person-gone" | "on-team" | "ended" | "needs-booked-hours" };

export type ForecastReport = {
  simulated: true;
  settings: {
    historyWindowWorkingDays: number | "all"; unit: ForecastUnit; trials: number; currency: BudgetCurrency; planEnd: string; today: string;
  };
  asIs: ColumnReport;
  /** null when As is is insufficient: there is no P80 to compare, and "beyond" would claim one past the horizon. */
  weeklyChange: WeeklyChange | null;
  scenarios: {
    id: number; name: string; expectedToken: string; changes: readonly ScenarioChange[]; result: ColumnReport; rows: RowReport[];
  }[];
  whatIf?: { result: ColumnReport; rows: RowReport[] };
  /** As is only; null when As is is insufficient or the plan end is not after today. */
  howManyByPlanEnd: HowManyReport | null;
  /** Only on a call that asks for it: each task group forecast from its own history, always at the app defaults. */
  byGroup?: GroupForecastRow[];
  /** The project's goal for a chance (`targetConfidenceOf`). */
  targetConfidence: TargetConfidence;
  /** The lever engine's answer (`whatItTakesSync`) against `targetConfidence`, on As is. `planEnd` is null when As is
   *  has no plan-end chance; `milestones` holds only those with a chance below the goal (`belowTargetRows`), worst
   *  first, at most `WHAT_IT_TAKES_MILESTONE_CAP` of them; `notSearched` names the rest. Below the history floor `planEnd` is null and
   *  both lists are empty. ★ A call with a `whatIf` gets `{ omitted: "whatIf" }`: the take is
   *  defined on As is, identical with or without the draft, and the search is most of a call's cost, so a drafting loop
   *  of `whatIf` checks would pay it again on every check. A call without `whatIf` returns it. */
  whatItTakes: WhatItTakesReport | { omitted: "whatIf" | "settings" };
  /** The scenario the user proposed; null when none is set or the id names no saved scenario (`proposalIdOf`). Its
   *  figures are that scenario's entry in `scenarios`. */
  proposal: { id: number; name: string } | null;
  /** The last `P80_HISTORY_ENTRIES` recorded days, oldest first; p80 null = past the horizon that day. */
  p80History: { date: string; p80: string | null }[];
};

/** `run.window` and `run.unit` are the app defaults (`DEFAULT_HISTORY_WINDOW`, `"tasks"`) unless the call asked for
 *  others; `isDefaultRun` tells them apart. */
export type ForecastReportInput = {
  run: ScenarioRunInput;
  /** Sorted by date, as `sanitizeForecastHistory` and `upsertForecastHistory` keep it. */
  history: readonly ForecastHistoryEntry[];
  scenarios: readonly ForecastScenario[];
  currency: BudgetCurrency;
  /** The target confidence and the proposal ride here. */
  settingsOverrides: SettingsOverrides | undefined;
};

/** Which shortfall(s) the floor reports, by the rule `InsufficientState` uses: a part is short when below its need. */
function insufficientReason(f: ForecastInsufficient): string {
  const parts: string[] = [];
  if (f.finished < f.neededFinished) parts.push(`${f.finished} of ${f.neededFinished} finished tasks`);
  if (f.days < f.neededDays) parts.push(`${f.days} of ${f.neededDays} working days in the window`);
  return `Not enough history: ${parts.join(" and ")}.`;
}

function costReport(cost: CostAtFinish | null): Extract<ColumnReport, { status: "forecast" }>["cost"] {
  if (cost === null) return null;
  if (cost.kind === "unavailable") return { unavailable: cost.reason };
  return { p50: cost.p50, p80: cost.p80, p95: cost.p95, chanceOverBudget: cost.chanceOverBudget };
}

/** Minutes to hours with one decimal in the effort unit; a task count as it is. */
function amountIn(unit: ForecastUnit, value: number): number {
  return unit === "effort" ? Math.round(value / 6) / 10 : value;
}

/** The app defaults: the only settings the daily history, the weekly change and the lever search are defined at. */
export function isDefaultRun(run: Pick<ScenarioRunInput, "window" | "unit">): boolean {
  return run.window === DEFAULT_HISTORY_WINDOW && run.unit === "tasks";
}

function finishDate(f: ScheduleForecast, p: 50 | 80 | 95): string | "beyond" {
  return f.when.find((w) => w.p === p)?.date ?? "beyond";
}

/** P80 as `weeklyChange` takes it: null for a trial past the horizon. */
function finishOrNull(f: ScheduleForecast): string | null {
  return f.when.find((w) => w.p === 80)?.date ?? null;
}

function columnReport(column: ScenarioColumn, run: ScenarioRunInput): ColumnReport {
  const f = column.forecast;
  if (f.kind === "insufficient") {
    return {
      status: "insufficient", finished: f.finished, neededFinished: f.neededFinished, days: f.days, neededDays: f.neededDays,
      doneWithoutDate: f.doneWithoutDate, reason: insufficientReason(f),
    };
  }
  const milestones: MilestoneReport[] = [];
  for (const m of f.milestones) {
    const row = run.milestones.find((x) => x.id === m.id);
    if (row === undefined) continue;
    const { id, name, date } = row;
    milestones.push(m.state === "chance"
      ? { id, name, date, chance: m.chance, prioritised: m.chancePrioritised }
      : { id, name, date, state: m.state });
  }
  return {
    status: "forecast", p50: finishDate(f, 50), p80: finishDate(f, 80), p95: finishDate(f, 95),
    chanceOnTime: column.chanceOnTime, milestones, cost: costReport(column.cost),
    basis: {
      backlog: amountIn(f.unit, f.backlog), finishedInWindow: f.finished, windowWorkingDays: f.windowDays,
      doneWithoutDate: f.doneWithoutDate, beyondShare: f.beyondShare,
    },
  };
}

function rowReport(row: ScenarioRowStatus, index: number): RowReport {
  if (row.kind === "availability") return { index, kind: "availability", ended: row.ended };
  if (row.kind === "scope") return { index, kind: "scope", milestoneGone: row.milestoneGone };
  const s = row.status;
  if (s.kind === "inert") return { index, kind: "addPeople", inert: s.reason };
  return {
    index, kind: "addPeople",
    sizing: {
      name: s.name, weeklyHours: s.weeklyHours, ratePerHour: s.ratePerHour, rateNote: s.rateNote,
      shareAtFullSpeed: s.shareAtFullSpeed,
    },
  };
}

function rowsOf(column: ScenarioColumn): RowReport[] {
  return (column.schedule?.rows ?? []).map(rowReport);
}

/** How many below-target milestones one call searches, worst first. Each search is synchronous inside the tool call
 *  and costs more on a bigger backlog (about 0.33 s each on the huge sample), so an uncapped call froze the app for about 10 s with 30 milestones below target (§502 gate 1,
 *  docs/AGENTS/forecast.md). */
export const WHAT_IT_TAKES_MILESTONE_CAP = 5;

export type WhatItTakesReport = {
  planEnd: WhatItTakes | null;
  milestones: { id: number; name: string; take: WhatItTakes }[];
  /** Below-target milestones with no take, worst first: any searched one whose take came back null, then those past the cap. */
  notSearched: { id: number; name: string }[];
};

/** The plan end's lever search and the worst `WHAT_IT_TAKES_MILESTONE_CAP` below-target milestones', on the comparison's own
 *  As-is run and context (no second As-is run). Below the floor there is no chance to search from, so nothing runs. */
function whatItTakesReport(
  run: ScenarioRunInput, { asIs, context }: ScenarioComparison, goal: TargetConfidence,
): WhatItTakesReport {
  const f = asIs.forecast;
  // A second mechanism, not the only one: `planWhatItTakes` already answers null for an insufficient column (its
  // plan-end chance is null and it has no milestone chances), so this saves only the row build, no engine run.
  if (f.kind !== "forecast") return { planEnd: null, milestones: [], notSearched: [] };
  const take = (target: LeverTarget) => whatItTakesSync(run, context, target, goal, asIs);
  const below = belowTargetRows(milestoneRowsWorstFirst(run.milestones, f.milestones), goal);
  const milestones: WhatItTakesReport["milestones"] = [];
  const noTake: WhatItTakesReport["notSearched"] = [];
  for (const r of below.slice(0, WHAT_IT_TAKES_MILESTONE_CAP)) {
    // A below-target row has a chance on this same As-is column, so its take should never be null; if one ever is,
    // the milestone is still named below target (first, keeping worst-first order) rather than dropped from both lists.
    const t = take({ kind: "milestone", id: r.id });
    if (t === null) noTake.push({ id: r.id, name: r.name });
    else milestones.push({ id: r.id, name: r.name, take: t });
  }
  const notSearched = [...noTake, ...below.slice(WHAT_IT_TAKES_MILESTONE_CAP).map((r) => ({ id: r.id, name: r.name }))];
  return { planEnd: take({ kind: "planEnd" }), milestones, notSearched };
}

/** One more As-is run with the plan end as the How-many date: the comparison's runs pass today, which costs nothing
 *  and answers nothing. Same inputs otherwise, and the engine keeps one random stream per output, so its When and
 *  milestone figures are As is's own. */
function howManyByPlanEnd(run: ScenarioRunInput, asIs: ScenarioColumn): HowManyReport | null {
  if (asIs.forecast.kind !== "forecast" || !run.planEnd || run.planEnd <= run.today) return null;
  const f = computeScheduleForecast({
    tasks: run.tasks, milestones: run.milestones, today: run.today, holidaySet: run.holidaySet,
    window: run.window, unit: run.unit, whatIf: DEFAULT_WHAT_IF, howManyTarget: run.planEnd,
  });
  if (f.kind !== "forecast") return null;
  const lastDay = lastForecastableDay(run.today, run.holidaySet);
  const at = (p: 50 | 80 | 95) => amountIn(f.unit, f.howMany.find((h) => h.p === p)?.amount ?? 0);
  return { by: run.planEnd < lastDay ? run.planEnd : lastDay, p50: at(50), p80: at(80), p95: at(95) };
}

function proposalReport({ settingsOverrides, scenarios }: ForecastReportInput): ForecastReport["proposal"] {
  const id = proposalIdOf(settingsOverrides, scenarios);
  const scenario = id === null ? undefined : scenarios.find((s) => s.id === id);
  return scenario === undefined ? null : { id: scenario.id, name: scenario.name };
}

/** As is, every saved scenario, and optionally one unsaved `whatIf` change list, as one JSON report.
 *  ★ `comparison` must be `computeScenarioComparison(input.run, input.scenarios)`: `getForecast` builds it first so
 *  the `whatIf` check reads its context, and the As-is run is paid once per call. */
export function buildForecastReport(
  input: ForecastReportInput,
  whatIf: readonly ScenarioChange[] | null,
  comparison: ScenarioComparison = computeScenarioComparison(input.run, input.scenarios),
  options: { byGroup?: boolean } = {},
): ForecastReport {
  const { run, history, currency } = input;
  const { asIs } = comparison;
  const asIsReport = columnReport(asIs, run);
  const goal = targetConfidenceOf(input.settingsOverrides);
  const defaults = isDefaultRun(run);
  const report: ForecastReport = {
    simulated: true,
    settings: {
      // The unit the run used: effort falls back to tasks when too few open tasks carry an estimate.
      historyWindowWorkingDays: run.window, unit: asIs.forecast.kind === "forecast" ? asIs.forecast.unit : run.unit,
      trials: asIs.forecast.kind === "forecast" ? asIs.forecast.trials : FORECAST_TRIALS,
      currency, planEnd: run.planEnd, today: run.today,
    },
    asIs: asIsReport,
    // The history is recorded at the app defaults, so another window or unit has nothing to compare against.
    weeklyChange: asIs.forecast.kind === "forecast" && defaults
      ? weeklyChange({ history, today: run.today, p80: finishOrNull(asIs.forecast), holidaySet: run.holidaySet })
      : null,
    scenarios: comparison.scenarios.map(({ scenario, column }) => ({
      id: scenario.id, name: scenario.name, expectedToken: entityToken("forecastScenario", scenario),
      changes: scenario.changes, result: columnReport(column, run), rows: rowsOf(column),
    })),
    targetConfidence: goal,
    whatItTakes: whatIf !== null ? { omitted: "whatIf" } : defaults ? whatItTakesReport(run, comparison, goal) : { omitted: "settings" },
    proposal: proposalReport(input),
    p80History: history.slice(-P80_HISTORY_ENTRIES).map(({ date, p80 }) => ({ date, p80 })),
    howManyByPlanEnd: howManyByPlanEnd(run, asIs),
    ...(options.byGroup === true
      ? { byGroup: forecastByGroup({ tasks: run.tasks, today: run.today, holidaySet: run.holidaySet, planEnd: run.planEnd }) }
      : {}),
  };
  if (whatIf === null) return report;
  const column = computeScenarioColumn(run, whatIf, comparison.context);
  return { ...report, whatIf: { result: columnReport(column, run), rows: rowsOf(column) } };
}

/** What `validateScenarioChange` needs: the run's lists and the As-is run's on-team set. Pass the `context` of a
 *  comparison already built for this input to skip a second As-is run; without it, this builds one. */
export function scenarioValidationContext(
  input: ForecastReportInput,
  context: ScheduleContext = computeScenarioComparison(input.run, []).context,
): ValidationContext {
  return { milestones: input.run.milestones, resources: input.run.directory.resources, onTeam: context.onTeam };
}
