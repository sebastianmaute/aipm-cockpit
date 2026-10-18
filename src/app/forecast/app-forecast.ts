/** One memoised default forecast run shared by app surfaces (§502). Pure, i18n-free, React-free. */

import type { Milestone, Task } from "../types";
import { isTaskClosed } from "../task-closed";
import type { ForecastHistoryEntry } from "../forecast-history";
import { addCalendarDays, countWorkingDays } from "../working-days";
import { DEFAULT_HISTORY_WINDOW, MAX_HORIZON_WORKING_DAYS } from "./constants";
import { DEFAULT_WHAT_IF, computeScheduleForecast, effortCoverage, type ScheduleForecastResult } from "./index";
import type { MilestoneChance } from "./milestones";
import { isValidIsoDate } from "./throughput";

export type { MilestoneChance };

export type AppForecast =
  | {
      kind: "forecast";
      p50: string | null;
      p80: string | null;
      p95: string | null;
      chanceOnTime: number | null;
      /** Share of open tasks carrying an estimate; null when nothing is open (no remaining work to cover). */
      estimateCoverage: number | null;
      windowDays: number;
      distribution: Int32Array;
      /** Per-trial finish days in trial order (horizon + 1 = beyond). */
      trialDays: Int32Array;
      /** The history window's working days. */
      windowDates: readonly string[];
      trials: number;
      /** The engine's working days ahead per percentile (beyond the horizon: horizon + 1), for the explainer's cut lines. */
      markers: { p50: number; p80: number; p95: number };
      /** The engine's per-milestone chances from this same run. */
      milestones: readonly MilestoneChance[];
    }
  | {
      kind: "insufficient";
      /** The engine's floor figures, so a surface can say which one is short. */
      finished: number;
      neededFinished: number;
      days: number;
      neededDays: number;
    };

export type AppForecastArgs = {
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  planEnd: string;
  today: string;
  holidaySet: ReadonlySet<string>;
};

/** Share of trials done within the plan's working days; a beyond-horizon trial is never on time. Shared with the
 *  scenario comparison (`forecast-scenario-compare.ts`), so every column reads the plan end the same way. */
export function chanceOnTime(
  planEnd: string,
  today: string,
  holidaySet: ReadonlySet<string>,
  distribution: Int32Array,
  hasOpen: boolean,
): number | null {
  if (!isValidIsoDate(planEnd)) return null;
  if (!hasOpen) return 1;
  if (planEnd < today || distribution.length === 0) return 0;
  const days = countWorkingDays(addCalendarDays(today, 1), addCalendarDays(planEnd, 1), holidaySet);
  const limit = Math.min(days, MAX_HORIZON_WORKING_DAYS);
  let within = 0;
  for (const d of distribution) if (d <= limit) within += 1;
  return within / distribution.length;
}

/** `run` is the engine's raw result, kept beside the narrowed `result` so a surface that needs the whole run (the
 *  Reports Forecast section's scenario comparison, §502 part 4) reuses it instead of running the trials again. */
let memo: { args: AppForecastArgs; result: AppForecast; run: ScheduleForecastResult } | null = null;

function sameInputs(a: AppForecastArgs, b: AppForecastArgs): boolean {
  return (
    a.tasks === b.tasks &&
    a.milestones === b.milestones &&
    a.holidaySet === b.holidaySet &&
    a.planEnd === b.planEnd &&
    a.today === b.today
  );
}

export function computeAppForecast(a: AppForecastArgs): AppForecast {
  return appForecastEntry(a).result;
}

/**
 * The same memoised run, unnarrowed: exactly `computeScheduleForecast` with the app-wide defaults (60-working-day
 * window, tasks, no What-if, How-many at today). ★ Same single-entry memo as `computeAppForecast`, so pass the
 * same references and the trials run once for both.
 */
export function computeAppScheduleRun(a: AppForecastArgs): ScheduleForecastResult {
  return appForecastEntry(a).run;
}

function appForecastEntry(a: AppForecastArgs): NonNullable<typeof memo> {
  if (memo && sameInputs(memo.args, a)) return memo;
  const r = computeScheduleForecast({
    tasks: a.tasks,
    milestones: a.milestones,
    today: a.today,
    holidaySet: a.holidaySet,
    window: DEFAULT_HISTORY_WINDOW,
    unit: "tasks",
    whatIf: DEFAULT_WHAT_IF,
    howManyTarget: a.today,
  });
  let result: AppForecast;
  if (r.kind !== "forecast") {
    result = {
      kind: "insufficient",
      finished: r.finished,
      neededFinished: r.neededFinished,
      days: r.days,
      neededDays: r.neededDays,
    };
  } else {
    const open = a.tasks.filter((t) => !isTaskClosed(t));
    const row = (p: number) => r.when.find((w) => w.p === p);
    const date = (p: number): string | null => row(p)?.date ?? null;
    const ahead = (p: number): number => {
      const d = row(p)?.daysAhead;
      return typeof d === "number" ? d : MAX_HORIZON_WORKING_DAYS + 1;
    };
    result = {
      kind: "forecast",
      p50: date(50),
      p80: date(80),
      p95: date(95),
      chanceOnTime: chanceOnTime(a.planEnd, a.today, a.holidaySet, r.distribution, open.length > 0),
      estimateCoverage: open.length > 0 ? effortCoverage(open) : null,
      windowDays: r.windowDays,
      distribution: r.distribution,
      trialDays: r.trialDays,
      windowDates: r.windowDates,
      trials: r.trials,
      markers: { p50: ahead(50), p80: ahead(80), p95: ahead(95) },
      milestones: r.milestones,
    };
  }
  memo = { args: a, result, run: r };
  return memo;
}

/** The day's history row, or null when the forecast was insufficient. */
export function toHistoryEntry(f: AppForecast, today: string): ForecastHistoryEntry | null {
  if (f.kind !== "forecast") return null;
  return { date: today, p50: f.p50, p80: f.p80, p95: f.p95, chanceOnTime: f.chanceOnTime };
}
