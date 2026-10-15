/** One memoised default forecast run shared by app surfaces (§502). Pure, i18n-free, React-free. */

import type { Milestone, Task } from "../types";
import { isTaskClosed } from "../task-closed";
import type { ForecastHistoryEntry } from "../forecast-history";
import { addCalendarDays, countWorkingDays } from "../working-days";
import { DEFAULT_HISTORY_WINDOW, MAX_HORIZON_WORKING_DAYS } from "./constants";
import { DEFAULT_WHAT_IF, computeScheduleForecast, effortCoverage } from "./index";
import { isValidIsoDate } from "./throughput";

export type AppForecast =
  | {
      kind: "forecast";
      p50: string | null;
      p80: string | null;
      p95: string | null;
      chanceOnTime: number | null;
      estimateCoverage: number;
      windowDays: number;
      distribution: Int32Array;
      trials: number;
    }
  | { kind: "insufficient" };

export type AppForecastArgs = {
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  planEnd: string;
  today: string;
  holidaySet: ReadonlySet<string>;
};

/** Share of trials done within the plan's working days; a beyond-horizon trial is never on time. */
function chanceOnTime(
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

let memo: { args: AppForecastArgs; result: AppForecast } | null = null;

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
  if (memo && sameInputs(memo.args, a)) return memo.result;
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
    result = { kind: "insufficient" };
  } else {
    const open = a.tasks.filter((t) => !isTaskClosed(t));
    const date = (p: number): string | null => r.when.find((w) => w.p === p)?.date ?? null;
    result = {
      kind: "forecast",
      p50: date(50),
      p80: date(80),
      p95: date(95),
      chanceOnTime: chanceOnTime(a.planEnd, a.today, a.holidaySet, r.distribution, open.length > 0),
      estimateCoverage: effortCoverage(open),
      windowDays: r.windowDays,
      distribution: r.distribution,
      trials: r.trials,
    };
  }
  memo = { args: a, result };
  return result;
}

/** The day's history row, or null when the forecast was insufficient. */
export function toHistoryEntry(f: AppForecast, today: string): ForecastHistoryEntry | null {
  if (f.kind !== "forecast") return null;
  return { date: today, p50: f.p50, p80: f.p80, p95: f.p95, chanceOnTime: f.chanceOnTime };
}
