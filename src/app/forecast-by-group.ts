/**
 * "Forecast by group" (§502; surfaces design §3.7, kept by part 4 §3.2 item 6): each task group forecast on its own,
 * from its own past days, with the app-wide defaults (60-working-day window, tasks, no What-if). Pure, i18n-free,
 * React-free. One full run per group, so the Reports fold-out calls this only once it is opened.
 */
import { DEFAULT_WHAT_IF, computeScheduleForecast } from "./forecast";
import { chanceOnTime } from "./forecast/app-forecast";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import { isTaskClosed } from "./task-closed";
import type { Task } from "./types";

export type GroupForecastRow = {
  /** The trimmed `task.group`; "" for tasks without a group. */
  key: string;
  open: number;
} & (
  | { kind: "forecast"; p80: string | null; chanceOnTime: number | null }
  | { kind: "insufficient"; finished: number; neededFinished: number; days: number; neededDays: number }
);

export type GroupForecastInput = {
  tasks: readonly Task[];
  today: string;
  holidaySet: ReadonlySet<string>;
  planEnd: string;
};

const P80 = 80;

function groupOf(task: Task): string {
  return (task.group ?? "").trim();
}

function forecastGroup(key: string, tasks: readonly Task[], input: GroupForecastInput): GroupForecastRow {
  const open = tasks.filter((task) => !isTaskClosed(task)).length;
  const run = computeScheduleForecast({
    tasks, milestones: [], today: input.today, holidaySet: input.holidaySet,
    window: DEFAULT_HISTORY_WINDOW, unit: "tasks", whatIf: DEFAULT_WHAT_IF, howManyTarget: input.today,
  });
  if (run.kind === "insufficient") {
    return { key, open, kind: "insufficient", finished: run.finished, neededFinished: run.neededFinished, days: run.days, neededDays: run.neededDays };
  }
  const p80 = run.when.find((w) => w.p === P80)?.date ?? null;
  const onTime = chanceOnTime(input.planEnd, input.today, input.holidaySet, run.distribution, run.distribution.some((d) => d > 0));
  return { key, open, kind: "forecast", p80, chanceOnTime: onTime };
}

/** Worst first: the lowest chance on time, then a group without one (no plan end), then the groups below the
 *  history floor; ties by name, the ungrouped row last among equals. */
function compare(a: GroupForecastRow, b: GroupForecastRow): number {
  const rank = (r: GroupForecastRow) => (r.kind === "insufficient" ? 2 : r.chanceOnTime === null ? 1 : 0);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.kind === "forecast" && b.kind === "forecast" && a.chanceOnTime !== null && b.chanceOnTime !== null && a.chanceOnTime !== b.chanceOnTime) {
    return a.chanceOnTime - b.chanceOnTime;
  }
  if ((a.key === "") !== (b.key === "")) return a.key === "" ? 1 : -1;
  return a.key.localeCompare(b.key);
}

/** One row per group that has open tasks. A group's history is its own finished tasks only. */
export function forecastByGroup(input: GroupForecastInput): GroupForecastRow[] {
  const byGroup = new Map<string, Task[]>();
  for (const task of input.tasks) {
    const key = groupOf(task);
    // A local, freshly built list (no shared state), so pushing keeps this O(n) rather than copying per task.
    const list = byGroup.get(key);
    if (list) list.push(task);
    else byGroup.set(key, [task]);
  }
  return [...byGroup.entries()]
    .filter(([, tasks]) => tasks.some((task) => !isTaskClosed(task)))
    .map(([key, tasks]) => forecastGroup(key, tasks, input))
    .sort(compare);
}
