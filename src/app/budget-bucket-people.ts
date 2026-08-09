// Pure, i18n-free: which people sit behind one bucket role line, and what they
// booked against what they were planned. No React, no clock, no DOM.
import { resourceDisplayName } from "./resource-foundation";
import type { BucketAllocation, Resource } from "./types";
import type { BucketPeriodCell } from "./timelog-actuals";
import type { Period } from "./resource-capacity";

/** Only what membership, naming and budget-eligibility need. `Resource` carries
 *  firstName/lastName rather than a `name`, so the row's display name is DERIVED
 *  here — narrowing the input also keeps test fixtures honest instead of cast to
 *  `never[]`. `isExternal` is in the Pick because the PLANNED figure depends on
 *  it (see `build` below), so the dependency is at least VISIBLE in the input
 *  type instead of reaching past it into the full `Resource`.
 *  ★ It does NOT force the caller to decide: `Resource.isExternal` is OPTIONAL
 *  (`types.ts:541`) and `Pick` preserves optionality, so omitting it is still a
 *  silent default to `undefined`, which `build` reads as internal. Only a
 *  REQUIRED field would make omission a type error, and requiring it here would
 *  diverge from the entity. Stated plainly because the earlier wording of this
 *  comment claimed the opposite. */
export type BucketPeopleResource = Pick<Resource, "id" | "firstName" | "lastName" | "roleId" | "isExternal">;

export interface PersonRow {
  readonly resourceId: number;
  readonly name: string;
  /** True when this person is on the allocation's plan (`resourceIds`). */
  readonly hasPlanLine: boolean;
  /** null = the period's actuals cell carries NO per-resource breakdown, so the
   *  figure is UNKNOWN. Never conflate that with a real zero. */
  readonly booked: Readonly<Record<string, number | null>>;
  /** null = this person contributes NO planned figure to the role line above —
   *  either they are not on its plan (`hasPlanLine` false) or they are EXTERNAL
   *  and therefore outside every budget figure (see `build`). Not a zero: the
   *  hours exist, they are simply not part of what this line budgets. */
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
    // ★★ These rows are read as a BREAKDOWN of the role line directly above, so
    //    the planned axis has to answer the same question that line does — and
    //    that line's budget comes from `effectiveBudgetHours` →
    //    `allocationPlannedHours`, which SKIPS `isExternal` resources ("planned/
    //    capacity-tracked elsewhere but excluded from all budget figures").
    //    Nothing stops an allocation's `resourceIds` from naming an external, so
    //    without this the people rows would sum to MORE than the line they
    //    explain under budget-follows-plan. Mirrored deliberately rather than
    //    imported: `allocationPlannedHours` needs the clock/capacity inputs this
    //    engine is kept free of. Keep the two in step — grep that symbol.
    //    ★ null, not 0: a fabricated zero would claim the person is planned for
    //    nothing here, when the truth is that their plan is accounted elsewhere.
    const plannedHere = hasPlanLine && !res.isExternal;
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
      const plan = plannedHere ? (plannedByResourcePeriod[id]?.[p.key] ?? 0) : null;
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
      plannedTotal: plannedHere ? plannedTotal : null,
    };
  };

  const byName = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name);
  // Walking `resources` (rather than the id sets) drops ids that resolve to no
  // resource and de-duplicates a repeated id without a second guard.
  const planRows = resources.filter((r) => plannedIds.has(r.id)).map((r) => build(r, true)).sort(byName);
  const extraRows = resources.filter((r) => extraIds.has(r.id)).map((r) => build(r, false)).sort(byName);

  return [...planRows, ...extraRows];
}
