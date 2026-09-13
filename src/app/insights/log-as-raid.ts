// src/app/insights/log-as-raid.ts
//
// Pure, i18n-free: the insight side of "Log as RAID" (§515). Saving the RAID
// item IS acting on the insight, so this is the Act transition (`onActInsight`
// in task-manager.tsx) plus the link — the SAME `metricAtActionPatch` spread,
// so the first transition to `acted` captures the outcome baseline and a later
// one never overwrites it.
import type { Insight, InsightStatus } from "./insight";
import { metricAtActionPatch } from "./outcome";

/** The statuses Act moves to `acted` — the same gate the Log-as-RAID button uses. */
const ACTABLE: ReadonlySet<InsightStatus> = new Set<InsightStatus>(["active", "acknowledged"]);

/** ★★ The status is read at SAVE, not when the editor opened: an insight that was
 *  resolved, dismissed or acted meanwhile only gains the link, so a late save
 *  can never re-open it as `acted` or overwrite its timestamps (§515). */
export function markInsightLoggedAsRaid(insight: Insight, raidId: number, today: string): Insight {
  if (!ACTABLE.has(insight.status)) return { ...insight, loggedRaidId: raidId };
  return {
    ...insight,
    status: "acted",
    actedAt: today,
    loggedRaidId: raidId,
    ...metricAtActionPatch(insight),
  };
}

/** The functional-setter body task-manager's on-saved writer hands to `setInsights`.
 *  ★★ `raidId` must be the id the save COMMITTED — re-minted on an id collision —
 *  never the draft's open-time id. Reads each insight from `prev` (first act wins). */
export function applyInsightLoggedAsRaid(
  prev: readonly Insight[] | undefined,
  insightId: number,
  raidId: number,
  today: string,
): Insight[] {
  return (prev ?? []).map((i) => (i.id === insightId ? markInsightLoggedAsRaid(i, raidId, today) : i));
}
