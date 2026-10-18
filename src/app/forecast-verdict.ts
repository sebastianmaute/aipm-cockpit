/**
 * The Reports Forecast section's verdict (§502 part 4, spec §3.2): the banner severity for the chance on time
 * against the project's target confidence, and how many milestones are below it. Pure, i18n-free, React-free —
 * the section formats the sentence.
 */
import { chanceSeverity, type TargetConfidence } from "./forecast-target";
import type { MilestoneChance } from "./forecast/milestones";

export type VerdictSeverity = "error" | "warn" | "success";
export type ForecastVerdict = { severity: VerdictSeverity; below: number; total: number };

const BANNER_SEVERITY: Record<ReturnType<typeof chanceSeverity>, VerdictSeverity> = {
  red: "error",
  amber: "warn",
  green: "success",
};

/** `chanceSeverity` as a `Banner` severity: error below even odds, warn below the goal, success at or above it.
 *  Null when there is no chance on time (no valid plan end). */
export function forecastVerdict(
  chanceOnTime: number | null,
  goal: TargetConfidence,
  below: number,
  total: number,
): ForecastVerdict | null {
  if (chanceOnTime === null) return null;
  return { severity: BANNER_SEVERITY[chanceSeverity(chanceOnTime, goal)], below, total };
}

/** `total` is every milestone the run reports (achieved ones are not reported); `below` counts those WITH a chance
 *  under the goal. An overdue milestone, or one with nothing linked, has no chance and is not counted as below. */
export function milestonesBelowTarget(
  chances: readonly MilestoneChance[],
  goal: TargetConfidence,
): { below: number; total: number } {
  const below = chances.filter((c) => c.state === "chance" && chanceSeverity(c.chance, goal) !== "green").length;
  return { below, total: chances.length };
}
