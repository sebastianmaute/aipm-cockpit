// src/app/next-actions-workload.ts
//
// Pure pre-computation of workload alerts for the next-actions `workload`
// provider. Two reasons: over-allocated (planned util > 100% near-term) and
// overload (>= N overdue tasks). The surface calls this once and passes the
// result into the engine via ActionInput.workloadAlerts.
//
// NOTE on the data model: ResourcePlan only carries the date range + canonical
// `granularity` (no per-resource rows). Per-resource utilization lives on
// Resource.utilization (periodKey -> value) with Resource.utilizationMode. So
// the over-allocated signal reads the plan for the periods, then each Resource
// for its own near-term utilization.
import { buildResourceWorkload } from "./resource-workload-rows";
import { generatePeriods, convertUtilization } from "./resource-capacity";
import { resourceDisplayName } from "./resource-foundation";
import type { Resource, ResourcePlan, Task, Absence, Shift, RaidItem } from "./types";

export interface WorkloadAlert {
  resourceId: number;
  resourceName: string;
  reason: "over-allocated" | "overload";
  value: number; // utilization % (over-allocated) | overdue count (overload)
}

export interface BuildWorkloadAlertsArgs {
  resources: readonly Resource[];
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  raid: readonly RaidItem[];
  plan?: ResourcePlan;
  today: string;
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  overdueThreshold?: number;
  overAllocatedPct?: number;
}

const DEFAULT_OVERDUE_THRESHOLD = 3;
const NEAR_TERM_PERIODS = 1; // check the current/next period only
const OVER_ALLOCATED_PCT = 100;

export function buildWorkloadAlerts(a: BuildWorkloadAlertsArgs): WorkloadAlert[] {
  const threshold = a.overdueThreshold ?? DEFAULT_OVERDUE_THRESHOLD;
  const overAllocatedPct = a.overAllocatedPct ?? OVER_ALLOCATED_PCT;
  const out: WorkloadAlert[] = [];

  const { managed } = buildResourceWorkload(a.resources, a.tasks, a.absences, a.shifts, a.raid, a.today);
  for (const row of managed) {
    if (row.overdueCount >= threshold) {
      out.push({
        resourceId: row.resource.id,
        resourceName: resourceDisplayName(row.resource),
        reason: "overload",
        value: row.overdueCount,
      });
    }
  }

  if (a.plan) {
    const periods = generatePeriods(a.plan.startDate, a.plan.endDate, a.plan.granularity);
    const nearKeys = periods.slice(0, NEAR_TERM_PERIODS).map((p) => p.key);
    for (const r of a.resources) {
      const pct = convertUtilization(r.utilization, r.utilizationMode, "percent", periods, a.workdayHours, a.holidaySet);
      let max = 0;
      for (const k of nearKeys) {
        const v = pct[k] ?? 0;
        if (v > max) max = v;
      }
      if (max > overAllocatedPct) {
        out.push({
          resourceId: r.id,
          resourceName: resourceDisplayName(r),
          reason: "over-allocated",
          value: Math.round(max),
        });
      }
    }
  }

  return out;
}
