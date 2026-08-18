// src/app/timelog-matchable.ts — the cost-bearing slice of the resource directory.
//
// Only INTERNAL resources are linkable to TimeLog people: an external is
// capacity-only (excluded from every cost figure) and never books time as an
// internal user, so they are dropped from the auto-match pool, the aggregation
// engine (byResource/byBucket), the people picker AND every apply plan. Filter
// at the SOURCE so display and cost attribution agree — filtering only the
// dropdown would still let a name-colliding external soak up hours in
// apply-to-budget.
//
// ★★ THIS IS A MONEY GUARD, NOT A DISPLAY FILTER. `buildApplyPlan` resolves a
//    resource's `roleId` to pick the allocation line that receives their hours,
//    and `budget-report` then costs that line at ITS internal rate — so handing
//    the plan the UNFILTERED directory costs an external's hours at an internal
//    rate. It lives in its own module because there are now two callers with
//    different inputs: the Timelog panel reads the directory straight from the
//    workspace, while `workspace-section` passes `BudgetPanel` the UNFILTERED
//    list, so the Budget-side notice has to apply the filter itself. Two call
//    sites, one definition — an approximation at either would be the defect.
import type { Resource } from "./types";

/** The resources that may receive TimeLog hours. Named `pick*` so a caller can
 *  keep a local `matchableResources` binding without shadowing this import. */
export function pickMatchableResources(resources: readonly Resource[]): Resource[] {
  return resources.filter((r) => !r.isExternal);
}
