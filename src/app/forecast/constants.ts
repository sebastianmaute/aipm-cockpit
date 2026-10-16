/** Engine constants for the Monte Carlo schedule forecast (§502). */

export type HistoryWindow = 30 | 60 | 90 | "all";
export type ForecastUnit = "tasks" | "effort";

export const FORECAST_TRIALS = 10000;
/** Fewer finished tasks inside the history window than this and the forecast is "insufficient". */
export const MIN_FINISHED_TASKS = 10;
export const MIN_HISTORY_WORKING_DAYS = 10;
/** Fewer spend days than this (or all-zero spend) and the simulated cost range is "unavailable". */
export const MIN_SPEND_WORKING_DAYS = 10;
export const HISTORY_WINDOWS: readonly HistoryWindow[] = [30, 60, 90, "all"];
export const DEFAULT_HISTORY_WINDOW: HistoryWindow = 60;
/** Share of open tasks that must carry an estimate before the effort unit is offered. */
export const EFFORT_MODE_MIN_COVERAGE = 0.7;
/** A trial still short after this many working days is reported as "beyond". */
export const MAX_HORIZON_WORKING_DAYS = 1300;
export const FORECAST_PERCENTILES = [50, 80, 95] as const;
