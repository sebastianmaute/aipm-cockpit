/** Monte Carlo schedule forecast: history floor, backlog, effort mode and what-if (§502). */

import type { Milestone, Task } from "../types";
import { isTaskClosed } from "../task-closed";
import { addCalendarDays, countWorkingDays, nthWorkingDayAfter } from "../working-days";
import {
  EFFORT_MODE_MIN_COVERAGE,
  FORECAST_PERCENTILES,
  FORECAST_TRIALS,
  MAX_HORIZON_WORKING_DAYS,
  MIN_FINISHED_TASKS,
  MIN_HISTORY_WORKING_DAYS,
  type ForecastUnit,
  type HistoryWindow,
} from "./constants";
import {
  clampAttributedRemovals,
  isAttributableMilestone,
  milestoneChances,
  orderBacklog,
  ownWorkToday,
  type MilestoneChance,
} from "./milestones";
import { mulberry32, seedFrom, type Rng } from "./rng";
import { buildArrivals, percentile, simulateHowMany, simulateWhen, type Arrivals, type SimOptions } from "./simulate";
import { dailyThroughput, type ThroughputHistory } from "./throughput";

export type WhatIf = { scopeTasks: number; scopePercent: number; capacityPercent: number };

/** A dated scope change: `tasks` (±) arrive on simulated day `day`; `milestoneId` attributes them to a milestone. */
export type ScopeArrival = { day: number; tasks: number; milestoneId: number | null };

/** Dated scenario changes in simulated days: a multiplier per day (index 1..horizon) and the scope arrivals. */
export type DatedScheduleChanges = { capacityByDay: Float64Array; arrivals: readonly ScopeArrival[] };

export type ScheduleForecastInput = {
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  today: string;
  holidaySet: ReadonlySet<string>;
  window: HistoryWindow;
  unit: ForecastUnit;
  whatIf: WhatIf;
  /** YYYY-MM-DD */
  howManyTarget: string;
  trials?: number;
  /** When set it replaces `whatIf` in the simulation (`whatIf` still feeds the seed). */
  changes?: DatedScheduleChanges;
};

type Percentile = (typeof FORECAST_PERCENTILES)[number];

export type ScheduleForecast = {
  kind: "forecast";
  unit: ForecastUnit;
  /** Tasks, or minutes in the effort unit. */
  backlog: number;
  when: { p: Percentile; daysAhead: number | "beyond"; date: string | null }[];
  howMany: { p: Percentile; amount: number }[];
  milestones: MilestoneChance[];
  /** simulateWhen's sorted days, for the chart. */
  distribution: Int32Array;
  /** The same per-trial days in trial order (unsorted), so a later pass can pair a trial with its own finish day. */
  trialDays: Int32Array;
  /** The history's working days (`history.days`), the window the samples were drawn from. */
  windowDates: readonly string[];
  beyondShare: number;
  finished: number;
  windowDays: number;
  doneWithoutDate: number;
  trials: number;
};

export type ForecastInsufficient = {
  kind: "insufficient";
  finished: number;
  neededFinished: number;
  days: number;
  neededDays: number;
  doneWithoutDate: number;
  /** The first completion's day when R14 shortened a fixed window to start there, else null. */
  windowCutAt: string | null;
  /** The history's working days, as on a forecast. */
  windowDates: readonly string[];
};

export type ScheduleForecastResult = ScheduleForecast | ForecastInsufficient;

export const DEFAULT_WHAT_IF: WhatIf = { scopeTasks: 0, scopePercent: 0, capacityPercent: 100 };

const MAX_SCOPE_TASKS = 1000;
const MIN_SCOPE_PERCENT = -100;
const MAX_SCOPE_PERCENT = 500;
const MIN_CAPACITY_PERCENT = 10;
const MAX_CAPACITY_PERCENT = 300;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const finiteOr = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

export function clampWhatIf(w: WhatIf, backlog: number): WhatIf {
  return {
    scopeTasks: clamp(Math.round(finiteOr(w.scopeTasks, DEFAULT_WHAT_IF.scopeTasks)), -backlog, MAX_SCOPE_TASKS),
    scopePercent: clamp(finiteOr(w.scopePercent, DEFAULT_WHAT_IF.scopePercent), MIN_SCOPE_PERCENT, MAX_SCOPE_PERCENT),
    capacityPercent: clamp(
      finiteOr(w.capacityPercent, DEFAULT_WHAT_IF.capacityPercent),
      MIN_CAPACITY_PERCENT,
      MAX_CAPACITY_PERCENT,
    ),
  };
}

const hasEstimate = (t: Task): boolean => (t.originalEstimateMinutes ?? 0) > 0;

/** Share of open tasks carrying an estimate; 0 when there are none. */
export function effortCoverage(open: readonly Task[]): number {
  return open.length === 0 ? 0 : open.filter(hasEstimate).length / open.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Size of one task in the chosen unit; an unestimated task counts at the median estimate. */
function sizer(open: readonly Task[], unit: ForecastUnit): { sizeOf: (t: Task) => number; unitSize: number } {
  if (unit === "tasks") return { sizeOf: () => 1, unitSize: 1 };
  const med = median(open.filter(hasEstimate).map((t) => t.originalEstimateMinutes ?? 0));
  return { sizeOf: (t) => (hasEstimate(t) ? (t.originalEstimateMinutes ?? 0) : med), unitSize: med };
}

/**
 * Net amount the what-if adds: the absolute tasks at one task's size, plus a percent of the base
 * backlog (rounded half-up). Removing every open task empties the backlog whatever their estimates.
 */
function scopeDelta(w: WhatIf, openCount: number, base: number, unitSize: number): number {
  const removesAll = w.scopeTasks < 0 && -w.scopeTasks >= openCount;
  const absolute = removesAll ? -base : w.scopeTasks * unitSize;
  return absolute + Math.floor((base * w.scopePercent) / 100 + 0.5);
}

function resultUnit(requested: ForecastUnit, open: readonly Task[]): ForecastUnit {
  return requested === "effort" && effortCoverage(open) >= EFFORT_MODE_MIN_COVERAGE ? "effort" : "tasks";
}

function simOptions(rng: Rng, trials: number, capacityPercent: number, unit: ForecastUnit, capacityByDay?: Float64Array): SimOptions {
  const o: SimOptions = { trials, rng, capacity: capacityPercent / 100, horizon: MAX_HORIZON_WORKING_DAYS, integer: unit === "tasks" };
  return capacityByDay ? { ...o, capacityByDay } : o;
}

type DatedScope = {
  /** Every arrival: the backlog When and How many simulate. */
  arrivals: Arrivals;
  /** The arrivals on an attributable milestone, in the forecast unit. */
  attributed: { day: number; amount: number; milestoneId: number }[];
  /** Base + every addition + attributed removals: unattributed removals come off the queue's end, not its front. */
  cap: Arrivals;
};

/**
 * Arrivals in the forecast unit (`tasks × unitSize`, so the effort unit sizes a task at the median estimate). An
 * arrival whose milestone is not an attributable milestone of `milestones` counts as unattributed. An attributed
 * removal counts only what came off its milestone's remaining work, never below zero (§4.1), in every total.
 */
function datedScope(
  changes: DatedScheduleChanges,
  base: number,
  unitSize: number,
  milestones: readonly Milestone[],
  openSizes: ReadonlyMap<number, number>,
): DatedScope {
  const attributable = new Set(milestones.filter(isAttributableMilestone).map((m) => m.id));
  const raw = changes.arrivals.map((a) => ({
    day: Math.min(MAX_HORIZON_WORKING_DAYS, Math.max(0, a.day)),
    amount: a.tasks * unitSize,
    milestoneId: a.milestoneId !== null && attributable.has(a.milestoneId) ? a.milestoneId : null,
  }));
  const onMilestone = raw.flatMap((s, index) => (s.milestoneId === null ? [] : [{ ...s, milestoneId: s.milestoneId, index }]));
  const clamped = clampAttributedRemovals(onMilestone, ownWorkToday(milestones, openSizes));
  const amountAt = new Map(clamped.map((c) => [c.index, c.amount]));
  const steps = raw.map((s, i) => ({ ...s, amount: amountAt.get(i) ?? s.amount }));
  return {
    arrivals: buildArrivals(base, steps, MAX_HORIZON_WORKING_DAYS),
    attributed: clamped.map(({ day, amount, milestoneId }) => ({ day, amount, milestoneId })),
    cap: buildArrivals(base, steps.filter((s) => s.amount > 0 || s.milestoneId !== null), MAX_HORIZON_WORKING_DAYS),
  };
}

function whenRows(days: Int32Array, today: string, holidaySet: ReadonlySet<string>): ScheduleForecast["when"] {
  return FORECAST_PERCENTILES.map((p) => {
    const d = percentile(days, p);
    if (d > MAX_HORIZON_WORKING_DAYS) return { p, daysAhead: "beyond" as const, date: null };
    return { p, daysAhead: d, date: d === 0 ? today : nthWorkingDayAfter(today, d, holidaySet) };
  });
}

/** The last date a How-many target may name: `MAX_HORIZON_WORKING_DAYS` working days after today (R15). */
export function lastForecastableDay(today: string, holidaySet: ReadonlySet<string>): string {
  return nthWorkingDayAfter(today, MAX_HORIZON_WORKING_DAYS, holidaySet);
}

export function computeScheduleForecast(input: ScheduleForecastInput): ScheduleForecastResult {
  const { tasks, milestones, today, holidaySet, window } = input;
  const open = tasks.filter((t) => !isTaskClosed(t));
  const unit = resultUnit(input.unit, open);
  const whatIf = clampWhatIf(input.whatIf, open.length);
  const { sizeOf, unitSize } = sizer(open, unit);
  const base = open.reduce((s, t) => s + sizeOf(t), 0);
  // `changes` replaces the What-if's scope and capacity; the What-if still feeds the seed below.
  const dated = input.changes ? datedScope(input.changes, base, unitSize, milestones, new Map(open.map((t) => [t.id, sizeOf(t)]))) : null;
  const backlog = dated
    ? dated.arrivals.arrivedAt[MAX_HORIZON_WORKING_DAYS]
    : Math.max(0, base + scopeDelta(whatIf, open.length, base, unitSize));
  const simulatedWork = dated ? dated.arrivals.arrivedAt.some((a) => a > 0) : backlog > 0;

  const history: ThroughputHistory = dailyThroughput({ tasks, today, window, holidaySet, unit, unestimatedSize: unitSize });
  const windowDays = history.days.length;
  // The floor applies when there is real OR simulated work: a what-if that empties the real backlog, or
  // adds scope to an empty one, must not let below-floor numbers out. Only no work at all skips it (R3).
  if ((open.length > 0 || simulatedWork) && (history.finished < MIN_FINISHED_TASKS || windowDays < MIN_HISTORY_WORKING_DAYS)) {
    return {
      kind: "insufficient",
      finished: history.finished,
      neededFinished: MIN_FINISHED_TASKS,
      days: windowDays,
      neededDays: MIN_HISTORY_WORKING_DAYS,
      doneWithoutDate: history.doneWithoutDate,
      windowCutAt: history.cutAtFirstCompletion ? history.days[0] : null,
      windowDates: history.days,
    };
  }

  const seedParts = [
    ...open.map((t) => t.id).sort((a, b) => a - b),
    ...history.samples,
    window,
    unit,
    whatIf.scopeTasks,
    whatIf.scopePercent,
    whatIf.capacityPercent,
  ];
  // R15: capped at the horizon like When, so a far (or mistyped) target cannot stall the render.
  const lastDay = lastForecastableDay(today, holidaySet);
  const target = input.howManyTarget < lastDay ? input.howManyTarget : lastDay;
  const targetDays = countWorkingDays(addCalendarDays(today, 1), addCalendarDays(target, 1), holidaySet);
  const trials = input.trials === undefined ? FORECAST_TRIALS : Math.max(1, Math.floor(input.trials));
  // One stream per output, so no result depends on whether another ran first.
  const stream = (name: string) =>
    simOptions(mulberry32(seedFrom([...seedParts, name])), trials, whatIf.capacityPercent, unit, input.changes?.capacityByDay);

  const when = simulateWhen(history.samples, backlog, stream("when"), dated?.arrivals);
  const reached = simulateHowMany(history.samples, targetDays, backlog, stream("howMany"), dated?.arrivals);
  const chances = milestoneChances({
    ...(dated ? { attributed: dated.attributed, cap: dated.cap } : {}),
    milestones,
    ordered: orderBacklog(open),
    closedIds: new Set(tasks.filter(isTaskClosed).map((t) => t.id)),
    sizeOf,
    samples: history.samples,
    today,
    holidaySet,
    o: stream("milestones"),
  });

  return {
    kind: "forecast",
    unit,
    backlog,
    when: whenRows(when.days, today, holidaySet),
    howMany: FORECAST_PERCENTILES.map((p) => ({ p, amount: percentile(reached, 100 - p) })),
    milestones: chances,
    distribution: when.days,
    trialDays: when.trialDays,
    windowDates: history.days,
    beyondShare: when.beyondShare,
    finished: history.finished,
    windowDays,
    doneWithoutDate: history.doneWithoutDate,
    trials,
  };
}
