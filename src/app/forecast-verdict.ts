/**
 * The Reports Forecast section's verdict (§502 part 4, spec §3.2): the banner severity for the chance on time
 * against the project's target confidence, and how many milestones are below it. Pure, i18n-free, React-free —
 * the section formats the sentence.
 */
import { chanceSeverity, type TargetConfidence } from "./forecast-target";
import type { MilestoneCounts } from "./forecast-milestone-rows";

export type VerdictSeverity = "error" | "warn" | "success";
/** The counts are `milestoneCounts`' (forecast-milestone-rows.ts), so the verdict and the tables cannot drift. */
export type ForecastVerdict = { severity: VerdictSeverity } & MilestoneCounts;

const BANNER_SEVERITY: Record<ReturnType<typeof chanceSeverity>, VerdictSeverity> = {
  red: "error",
  amber: "warn",
  green: "success",
};

/** `chanceSeverity` as a `Banner` severity: error below even odds, warn below the goal, success at or above it.
 *  ★ AT MOST a warning while any milestone is overdue: a green "on target" must not hide one. Null when there is no
 *  chance on time (no valid plan end). */
export function forecastVerdict(chanceOnTime: number | null, goal: TargetConfidence, counts: MilestoneCounts): ForecastVerdict | null {
  if (chanceOnTime === null) return null;
  const severity = BANNER_SEVERITY[chanceSeverity(chanceOnTime, goal)];
  return { severity: severity === "success" && counts.overdue > 0 ? "warn" : severity, ...counts };
}
