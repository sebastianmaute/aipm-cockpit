import type { Task } from "../types";
import { isWorkingDay, nthWorkingDayAfter, workingDaysBefore, workingDaysInRange } from "../working-days";
import type { ForecastUnit, HistoryWindow } from "./constants";

export type ThroughputHistory = {
  /** Completions (or estimated minutes) per working day, zero days kept. */
  samples: number[];
  days: string[];
  /** Completions that landed inside the window. */
  finished: number;
  /** Done tasks with no usable completedDate; never part of `samples`. */
  doneWithoutDate: number;
  /** A fixed window R14 shortened: it starts at the first completion (`days[0]`), not `window` days back. */
  cutAtFirstCompletion: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD: the shape and a real calendar day. */
export function isValidIsoDate(s: string | undefined): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * The working day a completion (on or before today) counts on: itself, or the next working day, but
 * never after the window's end — a shift that would pass today counts on the window's last working day.
 */
function attributedDay(completed: string, today: string, holidaySet: ReadonlySet<string>): string {
  const day = isWorkingDay(completed, holidaySet) ? completed : nthWorkingDayAfter(completed, 1, holidaySet);
  return day <= today ? day : windowEnd(today, holidaySet);
}

function windowEnd(today: string, holidaySet: ReadonlySet<string>): string {
  return isWorkingDay(today, holidaySet) ? today : workingDaysBefore(today, 1, holidaySet)[0];
}

function windowDays(
  window: HistoryWindow,
  today: string,
  holidaySet: ReadonlySet<string>,
  earliest: string | null,
): string[] {
  if (earliest === null) return [];
  const end = windowEnd(today, holidaySet);
  if (window === "all") return workingDaysInRange(earliest, end, holidaySet);
  const fixed = isWorkingDay(today, holidaySet)
    ? [...workingDaysBefore(today, window - 1, holidaySet), today]
    : workingDaysBefore(today, window, holidaySet);
  // R14: days before the first completion are not real zero days, so a young project is not padded.
  return fixed.filter((d) => d >= earliest);
}

function effortWeight(t: Task, unestimatedSize: number): number {
  const minutes = t.originalEstimateMinutes ?? 0;
  return minutes > 0 ? minutes : unestimatedSize;
}

export function dailyThroughput(args: {
  tasks: readonly Task[];
  today: string;
  window: HistoryWindow;
  holidaySet: ReadonlySet<string>;
  unit: ForecastUnit;
  /** Effort unit: minutes counted for a Done task with no estimate (default 0). */
  unestimatedSize?: number;
}): ThroughputHistory {
  const { tasks, today, window, holidaySet, unit, unestimatedSize = 0 } = args;
  let doneWithoutDate = 0;
  const completions: { day: string; weight: number }[] = [];
  for (const t of tasks) {
    if (t.status !== "Done") continue;
    if (!t.completedDate) {
      doneWithoutDate += 1;
      continue;
    }
    if (!isValidIsoDate(t.completedDate) || t.completedDate > today) continue;
    completions.push({
      day: attributedDay(t.completedDate, today, holidaySet),
      weight: unit === "effort" ? effortWeight(t, unestimatedSize) : 1,
    });
  }
  const earliest = completions.reduce<string | null>((m, c) => (m === null || c.day < m ? c.day : m), null);
  const days = windowDays(window, today, holidaySet, earliest);
  const totals = new Map<string, number>(days.map((d) => [d, 0]));
  let finished = 0;
  for (const c of completions) {
    const prev = totals.get(c.day);
    if (prev === undefined) continue;
    totals.set(c.day, prev + c.weight);
    finished += 1;
  }
  // A fixed window always holds `window` days unless R14 cut it; an empty one has no first completion.
  const cutAtFirstCompletion = window !== "all" && days.length > 0 && days.length < window;
  return { samples: days.map((d) => totals.get(d) ?? 0), days, finished, doneWithoutDate, cutAtFirstCompletion };
}
