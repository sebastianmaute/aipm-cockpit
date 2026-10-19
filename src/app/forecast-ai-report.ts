/**
 * The forecast report `get_forecast` returns (§502, spec §4.4) — pure, i18n-free, React-free. It reshapes the
 * existing scenario comparison into one JSON-serialisable object: no typed arrays, dates as ISO strings, a
 * trial past the horizon as "beyond". It runs no forecast of its own: every column comes from the comparison (or
 * `computeScenarioColumn` on its context), so all share its common random numbers, and a `whatIf` equal to a saved
 * scenario reproduces that scenario's result exactly. The one extra work is the lever search (`whatItTakesSync`, §502
 * part 4), whose probes are columns on that same context; it is the bulk of a call's cost (docs/AGENTS/forecast.md),
 * so a call with a `whatIf` skips it.
 */
import { entityToken } from "./ai-entity-token";
import type { ScheduleContext } from "./forecast-added-people";
import { FORECAST_TRIALS } from "./forecast/constants";
import type { ForecastInsufficient, ScheduleForecast } from "./forecast";
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

/** A milestone with a chance, or one the engine gives none (overdue, or no linked tasks). */
export type MilestoneReport =
  | { id: number; name: string; date: string; chance: number }
  | { id: number; name: string; date: string; state: "overdue" | "no-linked-tasks" };

/** A cost in the baseline currency, or "beyond" (a trial past the horizon). */
export type Money = number | "beyond";

export type ColumnReport =
  | {
      status: "forecast"; p50: string | "beyond"; p80: string | "beyond"; p95: string | "beyond";
      /** 0–1, by plan end. */
      chanceOnTime: number | null;
      milestones: MilestoneReport[];
      cost: { p50: Money; p80: Money; p95: Money; chanceOverBudget: number | null } | { unavailable: string } | null;
    }
  | { status: "insufficient"; finished: number; neededFinished: number; days: number; neededDays: number; reason: string };

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
    historyWindowWorkingDays: number | "all"; unit: "tasks"; trials: number; currency: BudgetCurrency; planEnd: string; today: string;
  };
  asIs: ColumnReport;
  /** null when As is is insufficient: there is no P80 to compare, and "beyond" would claim one past the horizon. */
  weeklyChange: WeeklyChange | null;
  scenarios: {
    id: number; name: string; expectedToken: string; changes: readonly ScenarioChange[]; result: ColumnReport; rows: RowReport[];
  }[];
  whatIf?: { result: ColumnReport; rows: RowReport[] };
  /** The project's goal for a chance (`targetConfidenceOf`). */
  targetConfidence: TargetConfidence;
  /** The lever engine's answer (`whatItTakesSync`) against `targetConfidence`, on As is. `planEnd` is null when As is
   *  has no plan-end chance; `milestones` holds only those with a chance below the goal (`belowTargetRows`), worst
   *  first, at most `WHAT_IT_TAKES_MILESTONE_CAP` of them; `notSearched` names the rest. Below the history floor `planEnd` is null and
   *  both lists are empty. ★ A call with a `whatIf` gets `{ omitted: "whatIf" }`: the take is
   *  defined on As is, identical with or without the draft, and the search is most of a call's cost, so a drafting loop
   *  of `whatIf` checks would pay it again on every check. A call without `whatIf` returns it. */
  whatItTakes: WhatItTakesReport | { omitted: "whatIf" };
  /** The scenario the user proposed; null when none is set or the id names no saved scenario (`proposalIdOf`). Its
   *  figures are that scenario's entry in `scenarios`. */
  proposal: { id: number; name: string } | null;
  /** The last `P80_HISTORY_ENTRIES` recorded days, oldest first; p80 null = past the horizon that day. */
  p80History: { date: string; p80: string | null }[];
};

/** `run.window` is `DEFAULT_HISTORY_WINDOW` and `run.unit` is `"tasks"`; the caller builds it that way. */
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
      reason: insufficientReason(f),
    };
  }
  const milestones: MilestoneReport[] = [];
  for (const m of f.milestones) {
    const row = run.milestones.find((x) => x.id === m.id);
    if (row === undefined) continue;
    const { id, name, date } = row;
    milestones.push(m.state === "chance" ? { id, name, date, chance: m.chance } : { id, name, date, state: m.state });
  }
  return {
    status: "forecast", p50: finishDate(f, 50), p80: finishDate(f, 80), p95: finishDate(f, 95),
    chanceOnTime: column.chanceOnTime, milestones, cost: costReport(column.cost),
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
): ForecastReport {
  const { run, history, currency } = input;
  const { asIs } = comparison;
  const asIsReport = columnReport(asIs, run);
  const goal = targetConfidenceOf(input.settingsOverrides);
  const report: ForecastReport = {
    simulated: true,
    settings: {
      historyWindowWorkingDays: run.window, unit: "tasks",
      trials: asIs.forecast.kind === "forecast" ? asIs.forecast.trials : FORECAST_TRIALS,
      currency, planEnd: run.planEnd, today: run.today,
    },
    asIs: asIsReport,
    weeklyChange: asIs.forecast.kind === "forecast"
      ? weeklyChange({ history, today: run.today, p80: finishOrNull(asIs.forecast), holidaySet: run.holidaySet })
      : null,
    scenarios: comparison.scenarios.map(({ scenario, column }) => ({
      id: scenario.id, name: scenario.name, expectedToken: entityToken("forecastScenario", scenario),
      changes: scenario.changes, result: columnReport(column, run), rows: rowsOf(column),
    })),
    targetConfidence: goal,
    whatItTakes: whatIf === null ? whatItTakesReport(run, comparison, goal) : { omitted: "whatIf" },
    proposal: proposalReport(input),
    p80History: history.slice(-P80_HISTORY_ENTRIES).map(({ date, p80 }) => ({ date, p80 })),
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
