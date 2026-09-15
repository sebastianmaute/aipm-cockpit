/**
 * Ordered banner states for the budget forecast (spec §6.1a, §6.4). Pure and
 * i18n-free — a surface maps `ForecastNotice.kind` to its own text/tooltip.
 * States stack in table order: pace-unavailable OR spread, then
 * needs-percent — never both pace states at once.
 */
import { isPaceAvailable, type BudgetForecast } from "./budget-forecast";

export type ForecastNotice =
  | { kind: "starts-on"; severity: "info"; availableFrom: string; bookedWorkingDays: number; firstBookingDate: string }
  | { kind: "starts-once-booked"; severity: "info" }
  | { kind: "no-burn"; severity: "warn"; windowStart: string; windowEnd: string; lastBookingDate: string | null }
  | { kind: "spread"; severity: "info" }
  | { kind: "needs-percent"; severity: "info"; bucketNames: readonly string[] };

/** Spec §6.1a states in table order. `no-actual-cost` / `no-earned-value` give none. */
export function forecastNotices(f: BudgetForecast): ForecastNotice[] {
  const out: ForecastNotice[] = [];
  const p = f.pace;
  if (!isPaceAvailable(p)) {
    if (p.unavailable === "not-enough-bookings") {
      out.push(p.firstBookingDate !== null && p.availableFrom !== null
        ? { kind: "starts-on", severity: "info", availableFrom: p.availableFrom, bookedWorkingDays: p.bookedWorkingDays, firstBookingDate: p.firstBookingDate }
        : { kind: "starts-once-booked", severity: "info" });
    } else {
      out.push({ kind: "no-burn", severity: "warn", windowStart: p.windowStart, windowEnd: p.windowEnd, lastBookingDate: p.lastBookingDate });
    }
  } else if (p.spreadPeriodHoursUsed) {
    out.push({ kind: "spread", severity: "info" });
  }
  const e = f.efficiency;
  if ("unavailable" in e && e.unavailable === "needs-percent-complete") {
    out.push({ kind: "needs-percent", severity: "info", bucketNames: e.bucketsMissingPercent.map((b) => b.name) });
  }
  return out;
}
