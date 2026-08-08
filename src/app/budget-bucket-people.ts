// Pure, i18n-free: which people sit behind one bucket role line, and what they
// booked against what they were planned. No React, no clock, no DOM.
import { resourceDisplayName } from "./resource-foundation";
import type { BucketAllocation, Resource } from "./types";
import type { BucketPeriodCell } from "./timelog-actuals";
import type { Period } from "./resource-capacity";

/** Only what membership and naming need. `Resource` carries firstName/lastName
 *  rather than a `name`, so the row's display name is DERIVED here — narrowing
 *  the input also keeps test fixtures honest instead of cast to `never[]`. */
export type BucketPeopleResource = Pick<Resource, "id" | "firstName" | "lastName" | "roleId">;

export interface PersonRow {
  readonly resourceId: number;
  readonly name: string;
  /** True when this person is on the allocation's plan (`resourceIds`). */
  readonly hasPlanLine: boolean;
  /** null = the period's actuals cell carries NO per-resource breakdown, so the
   *  figure is UNKNOWN. Never conflate that with a real zero. */
  readonly booked: Readonly<Record<string, number | null>>;
  readonly planned: Readonly<Record<string, number | null>>;
  readonly bookedTotal: number | null;
  readonly plannedTotal: number | null;
}

export interface BucketPeopleArgs {
  readonly allocation: Pick<BucketAllocation, "roleId" | "resourceIds">;
  readonly resources: readonly BucketPeopleResource[];
  /** This bucket's actuals, keyed by period key. */
  readonly actualsByPeriod: Readonly<Record<string, BucketPeriodCell>>;
  /** Resolved by the caller from `periodCapacityHours` — see the module note. */
  readonly plannedByResourcePeriod: Readonly<Record<number, Record<string, number>>>;
  readonly periods: readonly Period[];
}

export function buildBucketPeopleRows(args: BucketPeopleArgs): readonly PersonRow[] {
  const { allocation, resources, actualsByPeriod, plannedByResourcePeriod, periods } = args;
  const byId = new Map(resources.map((r) => [r.id, r]));
  const plannedIds = new Set(allocation.resourceIds);

  // Anyone who booked on this bucket AND whose role matches this line. A booker
  // whose role has no line here is intentionally absent — those hours stay in
  // the existing `unattributed` total (recorded limit, not a defect).
  const extraIds = new Set<number>();
  for (const p of periods) {
    const breakdown = actualsByPeriod[p.key]?.byResource;
    if (!breakdown) continue;
    for (const key of Object.keys(breakdown)) {
      const id = Number(key);
      if (plannedIds.has(id)) continue;
      const res = byId.get(id);
      if (res && res.roleId === allocation.roleId) extraIds.add(id);
    }
  }

  const build = (res: BucketPeopleResource, hasPlanLine: boolean): PersonRow => {
    const id = res.id;
    const booked: Record<string, number | null> = {};
    const plannedByPeriod: Record<string, number | null> = {};
    let bookedTotal = 0;
    // ★ A total of 0 across periods that are ALL unknown is the same fabricated
    //   zero the per-cell null exists to prevent — the total stays null unless
    //   at least one period actually reported.
    let anyBooked = false;
    let plannedTotal = 0;
    for (const p of periods) {
      const breakdown = actualsByPeriod[p.key]?.byResource;
      const cell = breakdown ? (breakdown[id]?.hours ?? 0) : null;
      booked[p.key] = cell;
      if (cell != null) { bookedTotal += cell; anyBooked = true; }
      const plan = hasPlanLine ? (plannedByResourcePeriod[id]?.[p.key] ?? 0) : null;
      plannedByPeriod[p.key] = plan;
      if (plan != null) plannedTotal += plan;
    }
    return {
      resourceId: id,
      name: resourceDisplayName(res),
      hasPlanLine,
      booked,
      planned: plannedByPeriod,
      bookedTotal: anyBooked ? bookedTotal : null,
      plannedTotal: hasPlanLine ? plannedTotal : null,
    };
  };

  const byName = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name);
  // Walking `resources` (rather than the id sets) drops ids that resolve to no
  // resource and de-duplicates a repeated id without a second guard.
  const planRows = resources.filter((r) => plannedIds.has(r.id)).map((r) => build(r, true)).sort(byName);
  const extraRows = resources.filter((r) => extraIds.has(r.id)).map((r) => build(r, false)).sort(byName);

  return [...planRows, ...extraRows];
}
