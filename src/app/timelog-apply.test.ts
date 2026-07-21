import { describe, it, expect } from "vitest";
import { planApply, applyActualsToBuckets, bucketsMissingAllocations, bucketsWithUnmatchedHours, buildApplyPlan, describeApplyRows } from "./timelog-apply";
import type { BudgetBucket, Discipline, Grade, Resource, Role } from "./types";
import { aggregateActuals, type ActualsByBucket } from "./timelog-actuals";
import type { TimelogLinks, TimelogTimeItem } from "./timelog-types";

/** Minimal booking row for the aggregate→apply integration test. */
const tItem = (id: number, userId: number, date: string, hours: number): TimelogTimeItem => ({
  timeRegistrationId: id, userId, projectId: 9, projectName: "P", projectNo: "1",
  taskId: 0, date, hours, billableHours: hours, isBillable: true,
});

const role = (id: number, disciplineId = 1): Role =>
  ({ id, disciplineId, name: `R${id}`, gradeId: 1, internalRate: 0, externalRate: 0 } as Role);
const res = (id: number, roleId: number | null): Resource =>
  ({ id, name: `P${id}`, roleId } as unknown as Resource);

const bucket = (id: number, actual: Record<string, number> = {}): BudgetBucket =>
  ({ id, name: "B", type: "tm", currency: "EUR", startDate: "", endDate: "", status: "open",
     allocations: [{ roleId: 1, resourceIds: [], budgetHours: {}, actualHours: actual }] } as BudgetBucket);

// Person 10 is in role 1 — the role the single-line `bucket` fixture carries —
// so this overlay routes to that one line. The old engine reached the same cell
// by hardcoding allocations[0]; now it gets there by ATTRIBUTION, which is what
// these baseline cases still assert.
const overlay: ActualsByBucket = {
  7: { "2026-06": { hours: 6, billableHours: 6, byResource: { 10: { hours: 6, billableHours: 6 } } } },
};
const roles = [role(1)];
const resources = [res(10, 1)];

describe("float accumulation", () => {
  // Hours accumulate as a running sum of TimeLog decimals, and the result is
  // written straight into the persisted `actualHours` — so an unrounded sum
  // stores 0.30000000000000004, it does not merely display it.
  it("rounds the accumulated per-line total to 2dp", () => {
    // Two people on the SAME role line, so their hours sum into one cell.
    const twoPeople: ActualsByBucket = {
      7: {
        "2026-06": {
          hours: 0.3, billableHours: 0.3,
          byResource: { 10: { hours: 0.1, billableHours: 0.1 }, 11: { hours: 0.2, billableHours: 0.2 } },
        },
      },
    };
    const diff = planApply([bucket(7, {})], twoPeople, [res(10, 1), res(11, 1)], roles);
    const row = diff.find((r) => r.bucketId === 7 && r.period === "2026-06");
    expect(row?.next).toBe(0.3);
    // Guard the actual failure mode: 0.1 + 0.2 === 0.30000000000000004.
    expect(String(row?.next)).toBe("0.3");
  });
});

describe("planApply", () => {
  it("produces a diff of current→next actualHours per bucket·role·period", () => {
    const diff = planApply([bucket(7, { "2026-06": 2 })], overlay, resources, roles);
    expect(diff).toContainEqual({ bucketId: 7, allocIndex: 0, period: "2026-06", current: 2, next: 6 });
  });
  it("treats a missing current period as current 0", () => {
    const diff = planApply([bucket(7, {})], overlay, resources, roles);
    expect(diff).toContainEqual({ bucketId: 7, allocIndex: 0, period: "2026-06", current: 0, next: 6 });
  });
  it("skips buckets not in the overlay", () => {
    expect(planApply([bucket(8)], overlay, resources, roles)).toEqual([]);
  });
  it("skips an overlay bucketId that has no matching bucket", () => {
    expect(planApply([bucket(1)], overlay, resources, roles)).toEqual([]);
  });
  it("skips a bucket that has overlay hours but no allocation to hold them", () => {
    const empty = { ...bucket(7), allocations: [] } as BudgetBucket;
    expect(planApply([empty], overlay, resources, roles)).toEqual([]);
  });
  it("uses the blended disciplineAllocation as the current-actuals source", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 4 } }] } as BudgetBucket;
    expect(planApply([b], overlay, resources, roles)).toContainEqual({ bucketId: 7, allocIndex: 0, period: "2026-06", current: 4, next: 6 });
  });
  it("skips a blended bucket with no disciplineAllocations", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [], disciplineAllocations: [] } as BudgetBucket;
    expect(planApply([b], overlay, resources, roles)).toEqual([]);
  });
});

describe("applyActualsToBuckets", () => {
  it("writes routed hours into the matching allocation (immutably) and leaves the input unmutated", () => {
    const before = [bucket(7, { "2026-06": 2 })];
    const after = applyActualsToBuckets(before, overlay, resources, roles);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(6);
    expect(before[0].allocations[0].actualHours["2026-06"]).toBe(2); // input untouched
  });
  it("preserves other periods already in actualHours", () => {
    const after = applyActualsToBuckets([bucket(7, { "2026-05": 9 })], overlay, resources, roles);
    expect(after[0].allocations[0].actualHours["2026-05"]).toBe(9);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(6);
  });
  it("leaves a bucket with no allocations untouched (no crash)", () => {
    const empty = { ...bucket(7), allocations: [] } as BudgetBucket;
    expect(applyActualsToBuckets([empty], overlay, resources, roles)[0]).toBe(empty);
  });
  it("does not touch buckets absent from the overlay", () => {
    const other = bucket(8, { "2026-06": 3 });
    const after = applyActualsToBuckets([other], overlay, resources, roles);
    expect(after[0]).toBe(other); // same reference — untouched
  });
  it("writes routed hours into the matching disciplineAllocation for a blended bucket", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 2 } }] } as BudgetBucket;
    const after = applyActualsToBuckets([b], overlay, resources, roles);
    expect(after[0].disciplineAllocations![0].actualHours["2026-06"]).toBe(6);
    expect(after[0].allocations).toEqual([]); // detailed list left untouched
  });
  it("leaves a blended bucket with no disciplineAllocations untouched", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [], disciplineAllocations: [] } as BudgetBucket;
    expect(applyActualsToBuckets([b], overlay, resources, roles)[0]).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Per-role attribution. Previously EVERY bucket's hours were folded into
// allocations[0], so budget-report costed all of them at the first role's rate
// (cost += actual * thatRow'sRate). These pin the corrected routing.

/** Two role lines; role 1 is FIRST so a regression to allocations[0] is visible. */
const twoRoleBucket = (): BudgetBucket =>
  ({ id: 7, name: "B", type: "tm", currency: "EUR", startDate: "", endDate: "", status: "open",
     allocations: [
       { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: {} },
       { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
     ] } as BudgetBucket);

const cell = (hours: number, byResource: Record<number, number>) => ({
  hours, billableHours: hours,
  byResource: Object.fromEntries(
    Object.entries(byResource).map(([r, h]) => [r, { hours: h, billableHours: h }]),
  ),
});

describe("per-role attribution", () => {
  // Person 10 is role 1, person 11 is role 2 — "in directory the people have
  // all different roles".
  const dirRoles = [role(1), role(2)];
  const dirResources = [res(10, 1), res(11, 2)];

  it("routes each person's hours to their OWN role line, not all to the first", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(30, { 10: 10, 11: 20 }) } };
    const after = applyActualsToBuckets([twoRoleBucket()], overlay, dirResources, dirRoles);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(10); // role 1
    expect(after[0].allocations[1].actualHours["2026-06"]).toBe(20); // role 2
  });

  it("keeps the bucket total intact across the split", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(30, { 10: 10, 11: 20 }) } };
    const after = applyActualsToBuckets([twoRoleBucket()], overlay, dirResources, dirRoles);
    const total = after[0].allocations.reduce((s, a) => s + (a.actualHours["2026-06"] ?? 0), 0);
    expect(total).toBe(30);
  });

  it("prefers an explicit resourceIds match over the directory role", () => {
    // Person 10's directory role is 1, but line 2 explicitly names them.
    const b = { ...twoRoleBucket() } as BudgetBucket;
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: {} },
      { roleId: 2, resourceIds: [10], budgetHours: {}, actualHours: {} },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(10, { 10: 10 }) } };
    const after = applyActualsToBuckets([b], overlay, dirResources, dirRoles);
    expect(after[0].allocations[1].actualHours["2026-06"]).toBe(10);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(0);
  });

  // Chosen behaviour: surface, don't apply. Writing them to allocations[0]
  // would reproduce the original defect at the wrong rate.
  // The caller passes the COST-BEARING directory (the panel filters out
  // `isExternal` resources, which are capacity-only and excluded from all cost
  // figures). A person absent from it must not be attributed by ANY path —
  // including an allocation line that names them in `resourceIds`, which
  // otherwise never consults the directory at all. Without this an external, or
  // a deleted resource still referenced by a line, gets costed at that line's
  // role rate.
  it("withholds a person absent from the directory even when a line names them explicitly", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: {} },
      { roleId: 2, resourceIds: [77], budgetHours: {}, actualHours: {} },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(12, { 77: 12 }) } };
    const after = applyActualsToBuckets([b], overlay, dirResources, dirRoles); // 77 not in directory
    expect(after[0].allocations[1].actualHours["2026-06"]).toBeUndefined();
    expect(bucketsWithUnmatchedHours([b], overlay, dirResources, dirRoles)).toEqual([7]);
  });

  it("does NOT apply hours from a person matching no role line", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(15, { 10: 10, 99: 5 }) } };
    const after = applyActualsToBuckets([twoRoleBucket()], overlay, [...dirResources, res(99, 88)], dirRoles);
    const total = after[0].allocations.reduce((s, a) => s + (a.actualHours["2026-06"] ?? 0), 0);
    expect(total).toBe(10); // person 99's 5h withheld, not dumped on line 1
  });

  it("flags a bucket whose bookings include an unmatched person", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(15, { 10: 10, 99: 5 }) } };
    expect(bucketsWithUnmatchedHours([twoRoleBucket()], overlay, [...dirResources, res(99, 88)], dirRoles)).toEqual([7]);
  });

  it("flags a person whose directory role is unset", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(5, { 12: 5 }) } };
    expect(bucketsWithUnmatchedHours([twoRoleBucket()], overlay, [res(12, null)], dirRoles)).toEqual([7]);
  });

  it("does not flag a bucket where every person matches", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(30, { 10: 10, 11: 20 }) } };
    expect(bucketsWithUnmatchedHours([twoRoleBucket()], overlay, dirResources, dirRoles)).toEqual([]);
  });

  // THE double-count trap. Line 1 carries a stale total from a pre-fix apply.
  // If apply only touched matched lines, that stale value would survive and be
  // added to the new per-role numbers.
  it("zeroes a role line that has no bookings in an applied period", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 30 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(20, { 11: 20 }) } }; // only role 2 booked
    const after = applyActualsToBuckets([b], overlay, dirResources, dirRoles);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(0);
    expect(after[0].allocations[1].actualHours["2026-06"]).toBe(20);
  });

  it("leaves periods NOT being applied untouched when zeroing", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-05": 40, "2026-06": 30 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(20, { 11: 20 }) } };
    const after = applyActualsToBuckets([b], overlay, dirResources, dirRoles);
    expect(after[0].allocations[0].actualHours["2026-05"]).toBe(40); // untouched
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(0);
  });

  it("routes blended buckets by the person's role DISCIPLINE", () => {
    const b = { ...twoRoleBucket(), planningMode: "blended", allocations: [],
      disciplineAllocations: [
        { disciplineId: 5, resourceIds: [], budgetHours: {}, actualHours: {} },
        { disciplineId: 6, resourceIds: [], budgetHours: {}, actualHours: {} },
      ] } as BudgetBucket;
    // role 1 → discipline 5, role 2 → discipline 6
    const blendedRoles = [role(1, 5), role(2, 6)];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(30, { 10: 10, 11: 20 }) } };
    const after = applyActualsToBuckets([b], overlay, dirResources, blendedRoles);
    expect(after[0].disciplineAllocations![0].actualHours["2026-06"]).toBe(10);
    expect(after[0].disciplineAllocations![1].actualHours["2026-06"]).toBe(20);
  });

  // A cell from a pre-breakdown persisted actuals cache has NO `byResource`.
  // `use-timelog-sync` seeds `aggregates` from that cache at mount, so an
  // existing user who upgrades and clicks Apply without re-fetching hits this.
  // Apply must not "own" a period it could not attribute a single hour of —
  // zeroing every line there DESTROYS previously applied budget actuals.
  const legacyCell = { hours: 65, billableHours: 65 }; // no byResource

  it("does not zero any line for a period it could not attribute at all (legacy cached cell)", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 40 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 25 } },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": legacyCell } };
    const after = applyActualsToBuckets([b], overlay, dirResources, dirRoles);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(40);
    expect(after[0].allocations[1].actualHours["2026-06"]).toBe(25);
  });

  it("still FLAGS the unattributable legacy period so the user is told", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": legacyCell } };
    expect(bucketsWithUnmatchedHours([twoRoleBucket()], overlay, dirResources, dirRoles)).toEqual([7]);
  });

  // TimeLog emits credit/correction registrations, so a period's net total can
  // be NEGATIVE. Those hours are just as unattributable as a positive legacy
  // cell and must raise the same notice — silently dropping them is the exact
  // thing the notice exists to prevent.
  it("flags an unattributable legacy period whose net total is NEGATIVE", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": { hours: -5, billableHours: -5 } } };
    expect(bucketsWithUnmatchedHours([twoRoleBucket()], overlay, dirResources, dirRoles)).toEqual([7]);
  });

  // A genuinely empty period is not a problem to report — no hours, no notice.
  it("does NOT flag a legacy period of exactly zero hours", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": { hours: 0, billableHours: 0 } } };
    expect(bucketsWithUnmatchedHours([twoRoleBucket()], overlay, dirResources, dirRoles)).toEqual([]);
  });

  it("previews no write at all for an unattributable period", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 40 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    expect(planApply([b], { 7: { "2026-06": legacyCell } }, dirResources, dirRoles)).toEqual([]);
  });

  // Same trap without the legacy shape: every person in the period is unmatched
  // (e.g. a contractor whose directory roleId was never set). Zeroing has no
  // double-count to prevent here — it is pure loss.
  it("does not zero lines when EVERY person in a period is unmatched", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 40 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(30, { 99: 30 }) } };
    const after = applyActualsToBuckets([b], overlay, [...dirResources, res(99, null)], dirRoles);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(40);
  });

  // But a PARTIALLY attributed period is still owned — that is what kills the
  // stale allocations[0] total from the old behaviour.
  it("still zeroes unmatched lines when the period routed at least one booking", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 30 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(25, { 11: 20, 99: 5 }) } };
    const after = applyActualsToBuckets([b], overlay, [...dirResources, res(99, null)], dirRoles);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(0);  // stale, correctly cleared
    expect(after[0].allocations[1].actualHours["2026-06"]).toBe(20); // person 11 routed
  });

  // Per-period, not per-bucket: one unattributable period must not disarm
  // ownership of a sibling period that routed fine.
  it("owns only the periods that routed, leaving an unattributable sibling period alone", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-05": 40, "2026-06": 30 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    const overlay: ActualsByBucket = {
      7: { "2026-05": legacyCell, "2026-06": cell(20, { 11: 20 }) },
    };
    const after = applyActualsToBuckets([b], overlay, dirResources, dirRoles);
    expect(after[0].allocations[0].actualHours["2026-05"]).toBe(40); // untouched
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(0);  // owned + cleared
    expect(after[0].allocations[1].actualHours["2026-06"]).toBe(20);
  });

  // The confirm modal shows applyDiff.length, so the preview must enumerate the
  // SAME writes apply performs, or the count lies about what will happen.
  it("planApply previews one row per role line that actually changes", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(30, { 10: 10, 11: 20 }) } };
    const diff = planApply([twoRoleBucket()], overlay, dirResources, dirRoles);
    expect(diff).toContainEqual({ bucketId: 7, allocIndex: 0, period: "2026-06", current: 0, next: 10 });
    expect(diff).toContainEqual({ bucketId: 7, allocIndex: 1, period: "2026-06", current: 0, next: 20 });
    expect(diff).toHaveLength(2);
  });

  it("planApply omits a role line whose value does not change", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 10 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(30, { 10: 10, 11: 20 }) } };
    const diff = planApply([b], overlay, dirResources, dirRoles);
    expect(diff).toEqual([{ bucketId: 7, allocIndex: 1, period: "2026-06", current: 0, next: 20 }]);
  });

  it("planApply previews the zeroing of a stale line", () => {
    const b = twoRoleBucket();
    b.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 30 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(20, { 11: 20 }) } };
    const diff = planApply([b], overlay, dirResources, dirRoles);
    expect(diff).toContainEqual({ bucketId: 7, allocIndex: 0, period: "2026-06", current: 30, next: 0 });
  });
});

describe("buildApplyPlan", () => {
  const dirRoles = [role(1), role(2)];
  const dirResources = [res(10, 1), res(11, 2)];

  // The panel needs BOTH the diff rows and the unmatched set; computing them
  // via two entry points routed every bucket twice per render.
  it("returns the diff rows and the unmatched buckets from ONE pass", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(15, { 10: 10, 99: 5 }) } };
    const plan = buildApplyPlan([twoRoleBucket()], overlay, [...dirResources, res(99, null)], dirRoles);
    expect(plan.rows).toContainEqual({ bucketId: 7, allocIndex: 0, period: "2026-06", current: 0, next: 10 });
    expect(plan.unmatchedBuckets).toEqual([7]);
  });

  // The notice used to be a bare per-bucket boolean, so a bucket that routed one
  // person and withheld another was still written and read low with nothing
  // saying by how much. The number is what makes it actionable.
  it("reports the total hours it withheld, not just that it withheld some", () => {
    // 10 routes to the role-1 line; 999 is in no directory, so its 40h are
    // withheld and the bucket is written 40h light.
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(72, { 10: 32, 999: 40 }) } };
    const plan = buildApplyPlan([twoRoleBucket()], overlay, dirResources, dirRoles);
    expect(plan.unmatchedBuckets).toEqual([7]);
    expect(plan.unmatchedHours).toBe(40);
  });

  // Mirrors the `!== 0` guards: TimeLog emits credit corrections, so withheld
  // hours can be negative and the budget reads HIGH rather than low.
  it("counts a negative withheld correction toward the total", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(-8, { 999: -8 }) } };
    const plan = buildApplyPlan([twoRoleBucket()], overlay, dirResources, dirRoles);
    expect(plan.unmatchedHours).toBe(-8);
  });

  // A +40/-40 pair nets to zero, so the TOTAL cannot be the signal that something
  // was withheld — the bucket list has to stay authoritative or the notice
  // silently stops firing for exactly the case that most needs explaining.
  it("still flags the bucket when withheld hours cancel out to zero", () => {
    const overlay: ActualsByBucket = {
      7: { "2026-06": cell(40, { 999: 40 }), "2026-07": cell(-40, { 999: -40 }) },
    };
    const plan = buildApplyPlan([twoRoleBucket()], overlay, dirResources, dirRoles);
    expect(plan.unmatchedHours).toBe(0);
    expect(plan.unmatchedBuckets).toEqual([7]);
  });

  // The PREVIEW and the WRITE are two separate traversals of the same routing,
  // and the user approves the preview — so a drift between them writes numbers
  // nobody agreed to. Asserting the applied result against the plan's own rows
  // is the only pairing here that can actually diverge; comparing buildApplyPlan
  // to planApply cannot, since planApply just returns buildApplyPlan().rows.
  it("writes exactly what the preview promised, including the lines it zeroes", () => {
    const overlay: ActualsByBucket = {
      // 11 routes to line 2; line 1 carries a figure that the routed period zeroes.
      7: { "2026-06": cell(20, { 11: 20 }) },
    };
    const seeded = { ...twoRoleBucket() } as BudgetBucket;
    seeded.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 30 } },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ];
    const plan = buildApplyPlan([seeded], overlay, dirResources, dirRoles);
    const after = applyActualsToBuckets([seeded], overlay, dirResources, dirRoles);

    expect(plan.rows).not.toHaveLength(0); // else the loop below asserts nothing
    for (const row of plan.rows) {
      expect(after[0].allocations[row.allocIndex].actualHours[row.period]).toBe(row.next);
    }
    // The destructive row is in the preview, not just in the write.
    expect(plan.rows).toContainEqual({ bucketId: 7, allocIndex: 0, period: "2026-06", current: 30, next: 0 });
  });

  it("reports no unmatched buckets when every person routes", () => {
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(30, { 10: 10, 11: 20 }) } };
    const plan = buildApplyPlan([twoRoleBucket()], overlay, dirResources, dirRoles);
    expect(plan.unmatchedBuckets).toEqual([]);
    expect(plan.rows).toHaveLength(2);
  });

  // The confirm dialog used to show only a COUNT ("Apply 2 bucket changes?").
  // Apply owns every line of a routed period, so it can write a hand-entered
  // actualHours cell to 0 on a line TimeLog knows nothing about — the PM types
  // 40h for a designer who does not book time, someone else books to the same
  // week, and that 40 silently becomes 0. Naming each row is what makes the
  // write informed rather than silent.
  // A Role carries no name of its own — it IS discipline × grade — so the two
  // role lines differ by GRADE here, otherwise both would label identically and
  // the test could not prove it picked the right line.
  const labelDisciplines = [{ id: 1, name: "Dev" }, { id: 3, name: "Design" }] as Discipline[];
  const labelGrades = [{ id: 1, name: "Junior" }, { id: 2, name: "Senior" }] as Grade[];
  const labelRoles = [
    { id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 },
    { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 0 },
  ] as Role[];

  it("labels each diff row with its bucket and role line", () => {
    const rows = [{ bucketId: 7, allocIndex: 1, period: "2026-06", current: 40, next: 0 }];
    const [row] = describeApplyRows(rows, [twoRoleBucket()], labelRoles, labelDisciplines, labelGrades);
    expect(row.bucketName).toBe("B");
    expect(row.lineName).toBe("Dev Senior"); // allocIndex 1 → role 2, the Senior line
    expect(row).toMatchObject({ period: "2026-06", current: 40, next: 0 });
  });

  it("labels a blended bucket's row with its discipline", () => {
    const b = {
      ...twoRoleBucket(), planningMode: "blended", allocations: [],
      disciplineAllocations: [{ disciplineId: 3, resourceIds: [], budgetHours: {}, actualHours: {} }],
    } as BudgetBucket;
    const rows = [{ bucketId: 7, allocIndex: 0, period: "2026-06", current: 5, next: 9 }];
    const [row] = describeApplyRows(rows, [b], labelRoles, labelDisciplines, labelGrades);
    expect(row.lineName).toBe("Design");
  });

  // A deleted role must not drop the row from the preview — the write still
  // happens, so hiding it would recreate the silent-overwrite problem.
  it("keeps a row whose role no longer exists, with a blank line name", () => {
    const rows = [{ bucketId: 7, allocIndex: 0, period: "2026-06", current: 1, next: 2 }];
    const [row] = describeApplyRows(rows, [twoRoleBucket()], [], labelDisciplines, labelGrades);
    expect(row.bucketName).toBe("B");
    expect(row.lineName).toBe("");
  });

  // Both halves are unit-tested against HAND-BUILT cells, and the panel tests
  // mock the aggregate — so dropping `byResource` from aggregateActuals left
  // every suite green even though apply then has nothing to attribute by.
  // `BucketPeriodCell` is the contract between them; this is the only test that
  // feeds a REAL aggregate into apply.
  it("consumes a real aggregateActuals result end to end", () => {
    const links: TimelogLinks = {
      userLinks: [
        { timelogUserId: 5, resourceId: 10, manual: false }, // role 1
        { timelogUserId: 6, resourceId: 11, manual: false }, // role 2
      ],
      projectLinks: [{ timelogProjectId: 9, bucketId: 7, manual: false }],
    };
    const items = [
      tItem(1, 5, "2026-06-10", 4),
      tItem(2, 6, "2026-06-11", 6),
    ];

    const agg = aggregateActuals(items, links, "month");
    const after = applyActualsToBuckets([twoRoleBucket()], agg.byBucket, dirResources, dirRoles);

    // Each person landed on their OWN role line — the whole point of the
    // breakdown surviving the aggregate→apply boundary.
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(4);
    expect(after[0].allocations[1].actualHours["2026-06"]).toBe(6);
    expect(buildApplyPlan([twoRoleBucket()], agg.byBucket, dirResources, dirRoles).unmatchedBuckets)
      .toEqual([]);
  });

  // Ownership means "apply has something real to say about this period". A
  // person whose bookings NET to zero (a +4 and a -4 credit correction) says
  // nothing, so a period containing only that must not claim every other line
  // and write hand-entered figures to 0.
  it("does not take ownership of a period whose only matched booking nets to zero", () => {
    const seeded = { ...twoRoleBucket() } as BudgetBucket;
    seeded.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: {} },
      // Typed by hand; nobody books to this line.
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 40 } },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(0, { 10: 0 }) } };
    const after = applyActualsToBuckets([seeded], overlay, dirResources, dirRoles);
    expect(after[0].allocations[1].actualHours["2026-06"]).toBe(40); // untouched
    expect(buildApplyPlan([seeded], overlay, dirResources, dirRoles).rows).toEqual([]);
  });

  // …but a REAL booking elsewhere in the period still arms ownership, and the
  // net-zero person's own line is then correctly written to 0.
  it("still owns the period when another booking in it is non-zero", () => {
    const seeded = { ...twoRoleBucket() } as BudgetBucket;
    seeded.allocations = [
      { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: {} },
      { roleId: 2, resourceIds: [], budgetHours: {}, actualHours: { "2026-06": 40 } },
    ];
    const overlay: ActualsByBucket = { 7: { "2026-06": cell(8, { 10: 8, 11: 0 }) } };
    const after = applyActualsToBuckets([seeded], overlay, dirResources, dirRoles);
    expect(after[0].allocations[0].actualHours["2026-06"]).toBe(8);
    expect(after[0].allocations[1].actualHours["2026-06"]).toBe(0); // their net IS zero
  });

  it("is empty for an empty overlay", () => {
    const plan = buildApplyPlan([twoRoleBucket()], {}, dirResources, dirRoles);
    expect(plan).toEqual({ rows: [], unmatchedBuckets: [], unmatchedHours: 0 });
  });
});

describe("bucketsMissingAllocations", () => {
  it("flags an overlay bucket with no target allocation (detailed)", () => {
    const empty = { ...bucket(7), allocations: [] } as BudgetBucket;
    expect(bucketsMissingAllocations([empty], overlay)).toEqual([7]);
  });
  it("flags a blended bucket with no disciplineAllocations", () => {
    const b = { ...bucket(7), planningMode: "blended", allocations: [], disciplineAllocations: [] } as BudgetBucket;
    expect(bucketsMissingAllocations([b], overlay)).toEqual([7]);
  });
  it("does not flag a bucket that has an allocation", () => {
    expect(bucketsMissingAllocations([bucket(7)], overlay)).toEqual([]);
  });
  it("keys the branch on planningMode: a detailed bucket ignores stray disciplineAllocations", () => {
    // Empty `allocations` but a populated `disciplineAllocations`; planningMode is
    // absent (⇒ detailed), so the discipline line must NOT count as a target.
    const b = { ...bucket(7), allocations: [],
      disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: {} }] } as BudgetBucket;
    expect(bucketsMissingAllocations([b], overlay)).toEqual([7]);
    expect(planApply([b], overlay, resources, roles)).toEqual([]);
    expect(applyActualsToBuckets([b], overlay, resources, roles)[0]).toBe(b);
  });
  it("ignores buckets absent from the overlay", () => {
    const empty = { ...bucket(8), allocations: [] } as BudgetBucket;
    expect(bucketsMissingAllocations([empty], overlay)).toEqual([]);
  });
});
