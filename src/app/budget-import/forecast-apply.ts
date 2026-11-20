// src/app/budget-import/forecast-apply.ts — applies a forecast import plan
// (`buildForecastImportPlan`, forecast-plan.ts) to ONE budget bucket, immutably
// (§500; split from forecast-plan.ts for §727).
// Pure: no i18n, no React, and no input is ever mutated.
import type { BucketAllocation, BudgetBucket, DisciplineAllocation } from "../types";
import { allocId, type AllocationKey, type ImportPlan } from "./forecast-plan";

type StoredAlloc = BucketAllocation | DisciplineAllocation;
type Patch = { alloc: AllocationKey; hours: Record<string, number>; ids: number[] };

function patchFor(patches: Map<string, Patch>, alloc: AllocationKey): Patch {
  const id = allocId(alloc);
  const patch = patches.get(id) ?? { alloc, hours: {}, ids: [] };
  patches.set(id, patch);
  return patch;
}

function collectPatches(plan: ImportPlan): Map<string, Patch> {
  const patches = new Map<string, Patch>();
  for (const c of plan.changes) patchFor(patches, c.alloc).hours[c.period] = c.next;
  for (const a of plan.addResources) patchFor(patches, a.alloc).ids.push(...a.resourceIds);
  return patches;
}

function mergeStored<T extends StoredAlloc>(stored: T, patch: Patch): T {
  const fresh = [...new Set(patch.ids)].filter((id) => !stored.resourceIds.includes(id));
  return {
    ...stored,
    resourceIds: fresh.length > 0 ? [...stored.resourceIds, ...fresh] : stored.resourceIds,
    budgetHours: { ...stored.budgetHours, ...patch.hours },
  };
}

/** Merges the patches of one kind into a list: a matched allocation becomes a
 *  new object, an unmatched patch appends a created one, the rest is untouched. */
function applyToList<T extends StoredAlloc>(
  list: readonly T[],
  patches: readonly Patch[],
  idOf: (a: T) => string,
  create: (patch: Patch) => T,
): T[] {
  const byId = new Map(patches.map((p) => [allocId(p.alloc), p]));
  const used = new Set<string>();
  const next = list.map((a) => {
    const id = idOf(a);
    const patch = byId.get(id);
    if (!patch || used.has(id)) return a;
    used.add(id);
    return mergeStored(a, patch);
  });
  for (const patch of patches) if (!used.has(allocId(patch.alloc))) next.push(create(patch));
  return next;
}

function freshFields(patch: Patch) {
  return { resourceIds: [...new Set(patch.ids)], budgetHours: { ...patch.hours }, actualHours: {} };
}

/** Applies a plan to a bucket and returns a NEW bucket; touched allocations are
 *  new objects, everything untouched is carried by reference. Does not read
 *  `plan.blockers` — the caller must not call it when blockers exist. */
export function applyForecastImport(bucket: BudgetBucket, plan: ImportPlan): BudgetBucket {
  const patches = [...collectPatches(plan).values()];
  const result: BudgetBucket = { ...bucket };
  const roles = patches.filter((p) => p.alloc.kind === "role");
  const disciplines = patches.filter((p) => p.alloc.kind === "discipline");
  if (roles.length > 0) {
    result.allocations = applyToList(
      bucket.allocations,
      roles,
      (a) => `r:${a.roleId}`,
      (p) => ({ roleId: p.alloc.kind === "role" ? p.alloc.roleId : 0, ...freshFields(p) }),
    );
  }
  if (disciplines.length > 0) {
    result.disciplineAllocations = applyToList(
      bucket.disciplineAllocations ?? [],
      disciplines,
      (a) => `d:${a.disciplineId}`,
      (p) => ({ disciplineId: p.alloc.kind === "discipline" ? p.alloc.disciplineId : 0, ...freshFields(p) }),
    );
  }
  return result;
}
