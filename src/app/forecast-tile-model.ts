/**
 * Pure model for the Dashboard forecast tile (§502): the week-on-week change of
 * the P80 finish and the milestones most at risk. i18n-free and DOM-free; the
 * tile turns these shapes into words.
 */
import type { MilestoneChance } from "./forecast/app-forecast";
import { entryOnOrBefore, type ForecastHistoryEntry } from "./forecast-history";
import type { Milestone } from "./types";
import { addCalendarDays, countWorkingDays } from "./working-days";

export const WEEK_BACK_DAYS = 7;
export const WEEK_BACK_MAX_DAYS = 13;
export const AT_RISK_LIMIT = 3;

export type WeeklyChange =
  | { kind: "later" | "earlier"; workingDays: number }
  | { kind: "same" }
  | { kind: "pending"; from: string }
  | { kind: "beyond" };

export function weeklyChange(args: {
  history: readonly ForecastHistoryEntry[];
  today: string;
  p80: string | null;
  holidaySet: ReadonlySet<string>;
}): WeeklyChange {
  const { history, today, p80, holidaySet } = args;
  const earlier = entryOnOrBefore(history, addCalendarDays(today, -WEEK_BACK_DAYS));
  const usable = earlier !== null && earlier.date >= addCalendarDays(today, -WEEK_BACK_MAX_DAYS) ? earlier : null;
  if (usable === null) {
    if (p80 === null) return { kind: "beyond" };
    const first = history.reduce<string | null>((m, h) => (m === null || h.date < m ? h.date : m), null);
    return { kind: "pending", from: addCalendarDays(first ?? today, WEEK_BACK_DAYS) };
  }
  if (p80 === null || usable.p80 === null) return { kind: "beyond" };
  if (p80 === usable.p80) return { kind: "same" };
  const later = p80 > usable.p80;
  const [a, b] = later ? [usable.p80, p80] : [p80, usable.p80];
  const workingDays = countWorkingDays(addCalendarDays(a, 1), addCalendarDays(b, 1), holidaySet);
  if (workingDays === 0) return { kind: "same" };
  return { kind: later ? "later" : "earlier", workingDays };
}

export interface AtRiskMilestone {
  id: number;
  name: string;
  date: string;
  chance: number;
}

export function milestonesAtRisk(
  chances: readonly MilestoneChance[],
  milestones: readonly Milestone[],
): AtRiskMilestone[] {
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const out: AtRiskMilestone[] = [];
  for (const c of chances) {
    if (c.state !== "chance" || c.chance >= 1) continue;
    const m = byId.get(c.id);
    if (m) out.push({ id: m.id, name: m.name, date: m.date, chance: c.chance });
  }
  out.sort((x, y) => x.chance - y.chance || (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || x.id - y.id);
  return out.slice(0, AT_RISK_LIMIT);
}
