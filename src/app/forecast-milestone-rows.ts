// The milestone rows a forecast run reports, and the two rules every surface applies to them (§502 part 4): worst
// first, and "below target". ONE copy, used by the Forecast view's scenario milestones table, the Reports Forecast
// section's milestones and proposal tables, and the export decision (`forecast-decision.ts`). Pure, i18n-free and
// React-free.

import type { MilestoneChance } from "./forecast/milestones";
import { chanceSeverity, type TargetConfidence } from "./forecast-target";
import type { Milestone } from "./types";

export type MilestoneRow = { id: number; name: string; date: string; asIs: MilestoneChance };

/** A row whose As-is run gave it a chance (not "overdue", not "no linked tasks"). */
export type ChanceRow = MilestoneRow & { asIs: Extract<MilestoneChance, { state: "chance" }> };

/** As-is chance ascending (worst first); a state that is not a chance ("overdue", "no linked tasks") goes last,
 *  in date order. */
function compareRows(a: MilestoneRow, b: MilestoneRow): number {
  const aChance = a.asIs.state === "chance" ? a.asIs.chance : null;
  const bChance = b.asIs.state === "chance" ? b.asIs.chance : null;
  if (aChance !== null && bChance !== null && aChance !== bChance) return aChance - bChance;
  if (aChance !== null && bChance === null) return -1;
  if (aChance === null && bChance !== null) return 1;
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name);
}

/** The milestones a run reports, joined to their names and dates, worst first (`compareRows`). */
export function milestoneRowsWorstFirst(milestones: readonly Milestone[], chances: readonly MilestoneChance[]): MilestoneRow[] {
  const byId = new Map(milestones.map((m) => [m.id, m]));
  return chances
    .flatMap((c): MilestoneRow[] => {
      const m = byId.get(c.id);
      return m ? [{ id: m.id, name: m.name, date: m.date, asIs: c }] : [];
    })
    .sort(compareRows);
}

/** The rows below the goal, still worst first: a chance whose severity is not green (`chanceSeverity`). Overdue and
 *  unlinked milestones have no chance, so they are never below target. */
export function belowTargetRows(rows: readonly MilestoneRow[], goal: TargetConfidence): ChanceRow[] {
  return rows.filter((r): r is ChanceRow => r.asIs.state === "chance" && chanceSeverity(r.asIs.chance, goal) !== "green");
}

/** The overdue rows (past due, not finished), in the worst-first order's tail (date order). Worse than below target,
 *  so the verdict and the export name them: they must never vanish behind an on-target count. */
export function overdueRows(rows: readonly MilestoneRow[]): MilestoneRow[] {
  return rows.filter((r) => r.asIs.state === "overdue");
}

export type MilestoneCounts = {
  /** Milestones WITH a chance under the goal. */
  below: number;
  /** Milestones WITH a chance. An unlinked one (nothing to forecast) is neither below nor on target, so not counted. */
  total: number;
  /** Overdue milestones, counted apart: the verdict appends them and is never green while any exists. */
  overdue: number;
};

/** The three counts the Reports verdict reads, by the same rules as `belowTargetRows` and `overdueRows`. */
export function milestoneCounts(chances: readonly MilestoneChance[], goal: TargetConfidence): MilestoneCounts {
  let below = 0;
  let total = 0;
  let overdue = 0;
  for (const c of chances) {
    if (c.state === "overdue") overdue += 1;
    if (c.state !== "chance") continue;
    total += 1;
    if (chanceSeverity(c.chance, goal) !== "green") below += 1;
  }
  return { below, total, overdue };
}
