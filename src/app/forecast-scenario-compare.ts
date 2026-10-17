/**
 * The scenario comparison (§502, spec §4.1a / §4.5 / §5.4) — pure, i18n-free, React-free. The ONE place a scenario
 * column is computed: the Forecast view's Scenarios mode reads it now, and `get_forecast` (§4.4) will call it.
 *
 * Common random numbers: every column runs `computeScheduleForecast` with the same inputs apart from `changes` (the
 * seed leaves changes out) and the cost pass with the same seed tag, so two columns differ only by their changes, and
 * a scenario with no changes shows exactly the As-is numbers.
 */
import { simulateCostFromRun } from "./budget-sim";
import type { ForecastFactsByUnit } from "./budget-forecast";
import { DEFAULT_WHAT_IF, computeScheduleForecast, type ScheduleForecastResult } from "./forecast";
import { chanceOnTime } from "./forecast/app-forecast";
import { MAX_HORIZON_WORKING_DAYS, type ForecastUnit, type HistoryWindow } from "./forecast/constants";
import type { CostAtFinish } from "./forecast/cost";
import { simulatedDates } from "./forecast/day-index";
import {
  onTeamResourceIds, teamHoursPerDay, type ScenarioDirectory, type ScheduleContext,
} from "./forecast-added-people";
import { buildScenarioSchedule, type ScenarioSchedule } from "./forecast-scenario-schedule";
import type { ForecastScenario, ScenarioChange } from "./forecast-scenarios";
import type { Milestone, Task } from "./types";

/** Every column shares one cost stream: a per-column tag would break common random numbers between cost rows. */
const COST_SEED_TAG = "eur";

export type ScenarioRunInput = {
  tasks: readonly Task[]; milestones: readonly Milestone[]; today: string; holidaySet: ReadonlySet<string>;
  window: HistoryWindow; unit: ForecastUnit; planEnd: string;
  directory: ScenarioDirectory;
  /** Per-unit facts; null when the Budget module is off or there are no buckets. */
  budgetFacts: ForecastFactsByUnit | null;
  /** Cost rows only when the simulation switch AND the Budget module are on (as the Forecast view's cost card). */
  costOn: boolean;
};

export type ScenarioColumn = {
  forecast: ScheduleForecastResult;
  chanceOnTime: number | null;
  /** null when !costOn, there are no facts, or the run is insufficient. */
  cost: CostAtFinish | null;
  /** null for As is. */
  schedule: ScenarioSchedule | null;
};

export type ScenarioComparison = {
  asIs: ScenarioColumn;
  scenarios: readonly { scenario: ForecastScenario; column: ScenarioColumn }[];
  /** The context every column was built with; the editor reads it, so it sees the same window. */
  context: ScheduleContext;
};

/** The one way to build a ScheduleContext: dates, onTeam and teamHours from the given window dates. */
export function buildScheduleContext(input: ScenarioRunInput, windowDates: readonly string[]): ScheduleContext {
  const { tasks, milestones, today, holidaySet, directory } = input;
  const hoursFacts = input.budgetFacts?.hours ?? null;
  return {
    today, holidaySet, dates: simulatedDates(today, MAX_HORIZON_WORKING_DAYS, holidaySet),
    tasks, milestones, directory, windowDates, hoursFacts,
    onTeam: onTeamResourceIds(tasks, directory, windowDates),
    teamHours: teamHoursPerDay(hoursFacts, windowDates),
  };
}

/** One column for any change list (null = As is); `get_forecast`'s `whatIf` calls this with an unsaved list. */
export function computeScenarioColumn(
  input: ScenarioRunInput, changes: readonly ScenarioChange[] | null, context: ScheduleContext,
): ScenarioColumn {
  return runColumn(input, changes === null ? null : buildScenarioSchedule(changes, context));
}

function runColumn(input: ScenarioRunInput, schedule: ScenarioSchedule | null): ScenarioColumn {
  const forecast = computeScheduleForecast({
    tasks: input.tasks,
    milestones: input.milestones,
    today: input.today,
    holidaySet: input.holidaySet,
    window: input.window,
    unit: input.unit,
    whatIf: DEFAULT_WHAT_IF,
    // The comparison shows no How-many; a target of today costs nothing.
    howManyTarget: input.today,
    ...(schedule ? { changes: schedule.changes } : {}),
  });
  if (forecast.kind !== "forecast") return { forecast, chanceOnTime: null, cost: null, schedule };
  const { distribution } = forecast;
  const onTime = chanceOnTime(input.planEnd, input.today, input.holidaySet, distribution, distribution.some((d) => d > 0));
  const cost = input.costOn && input.budgetFacts !== null
    ? simulateCostFromRun(forecast, input.budgetFacts.eur, COST_SEED_TAG, schedule?.spendScale ?? 1, schedule?.addedCost)
    : null;
  return { forecast, chanceOnTime: onTime, cost, schedule };
}

/** As is first; its window (a forecast's or an insufficient run's) builds the context every scenario column uses. */
export function computeScenarioComparison(input: ScenarioRunInput, scenarios: readonly ForecastScenario[]): ScenarioComparison {
  // As is has no changes, so it needs no context; the window the context is built from only exists once it has run.
  const asIs = runColumn(input, null);
  const context = buildScheduleContext(input, asIs.forecast.windowDates);
  return {
    asIs,
    scenarios: scenarios.map((scenario) => ({ scenario, column: computeScenarioColumn(input, scenario.changes, context) })),
    context,
  };
}
