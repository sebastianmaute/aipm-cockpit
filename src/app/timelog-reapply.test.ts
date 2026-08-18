import { describe, it, expect } from "vitest";
import { decideReapply } from "./timelog-reapply";
import type { BudgetBucket, Resource, Role } from "./types";
import type { ActualsAggregate } from "./timelog-actuals";

const ROLES: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const RESOURCES: Resource[] = [
  { id: 1, firstName: "Ana", lastName: "R", roleId: 3, utilizationMode: "percent", utilization: {} },
];

/** One bucket with a role-3 line, so hours Ana booked route somewhere. */
function bucket(actualHours: Record<string, number> = {}): BudgetBucket {
  return {
    id: 10, name: "Alpha", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours }],
  };
}

function aggregate(hours: number): ActualsAggregate {
  return {
    byBucket: { 10: { "2026-06": { hours, billableHours: hours, byResource: { 1: { hours, billableHours: hours } } } } },
    byResource: { 1: { hours, billableHours: hours } },
    unattributed: { hours: 0, billableHours: 0 },
  };
}

describe("decideReapply", () => {
  it("aborts when the refresh returned nothing at all", () => {
    expect(decideReapply(undefined, [bucket()], RESOURCES, ROLES)).toEqual({ kind: "abort" });
  });

  it("aborts when the refresh produced no aggregate", () => {
    expect(
      decideReapply({ failedProjects: 0, projectCount: 0 }, [bucket()], RESOURCES, ROLES),
    ).toEqual({ kind: "abort" });
  });

  // ★★★ THE DATA-LOSS PIN. Apply OWNS every allocation line of a routed period
  //     and writes the non-booking ones to 0, so confirming an aggregate that is
  //     missing a failed project's hours ERASES real booked hours from the
  //     buckets that project fed. The aggregate here is well-formed and yields
  //     rows — the ONLY thing wrong with it is that it is partial.
  it("aborts on a PARTIAL fetch even though the aggregate is present and yields rows", () => {
    const partial = { failedProjects: 1, projectCount: 2, aggregates: aggregate(24) };
    expect(decideReapply(partial, [bucket()], RESOURCES, ROLES)).toEqual({ kind: "abort" });
    // Control: the identical aggregate with every project fetched DOES confirm,
    // so the assertion above cannot pass for any reason but `failedProjects`.
    expect(
      decideReapply({ ...partial, failedProjects: 0 }, [bucket()], RESOURCES, ROLES),
    ).toEqual({ kind: "confirm", overlay: partial.aggregates.byBucket });
  });

  it("reports NOTHING when the fresh aggregate yields no plan rows", () => {
    // The bucket already holds exactly what the refresh resolved, so the plan is
    // empty — a dialog here would read "Apply 0 bucket changes" over an empty list.
    const settled = bucket({ "2026-06": 20 });
    expect(
      decideReapply({ failedProjects: 0, projectCount: 1, aggregates: aggregate(20) }, [settled], RESOURCES, ROLES),
    ).toEqual({ kind: "nothing" });
  });

  it("confirms with the FRESH overlay when there are rows to write", () => {
    const agg = aggregate(20);
    expect(
      decideReapply({ failedProjects: 0, projectCount: 1, aggregates: agg }, [bucket()], RESOURCES, ROLES),
    ).toEqual({ kind: "confirm", overlay: agg.byBucket });
  });
});
