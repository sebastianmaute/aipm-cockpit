import { describe, expect, it } from "vitest";
import type { BudgetBucket, BucketAllocation, DisciplineAllocation, Resource, ResourcePlan, Role } from "../types";
import type { ForecastRow } from "./forecast-types";
import { splitToGranularity } from "./period-split";
import {
  applyForecastImport,
  buildForecastImportPlan,
  normalisePerson,
  type ImportCtx,
  type ImportPlan,
  type PersonOverride,
} from "./forecast-plan";

const NONE: ReadonlySet<string> = new Set();

const ROLE_A: Role = { id: 10, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 };
const ROLE_B: Role = { id: 11, disciplineId: 2, gradeId: 1, internalRate: 80, externalRate: 120 };

function person(id: number, first: string, last: string, extra: Partial<Resource> = {}): Resource {
  return {
    id,
    firstName: first,
    lastName: last,
    roleId: ROLE_A.id,
    utilizationMode: "percent",
    utilization: {},
    ...extra,
  };
}

function alloc(roleId: number, budgetHours: Record<string, number> = {}, resourceIds: number[] = []): BucketAllocation {
  return { roleId, resourceIds, budgetHours, actualHours: {} };
}

function bucketOf(over: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id: 1,
    name: "B",
    type: "time-and-material",
    currency: "EUR",
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    status: "open",
    allocations: [],
    ...over,
  } as BudgetBucket;
}

const MONTH_PLAN: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };

function ctxOf(over: Partial<ImportCtx> = {}): ImportCtx {
  return {
    bucket: bucketOf(),
    resources: [person(1, "Ann", "Lee", { email: "ann@x.com" })],
    roles: [ROLE_A, ROLE_B],
    plan: MONTH_PLAN,
    holidaySet: NONE,
    overrides: new Map<string, PersonOverride>(),
    ...over,
  };
}

function row(name: string, period: string, hours: number, extra: Partial<ForecastRow> = {}): ForecastRow {
  return { person: name, period, hours, ...extra };
}

function plan(rows: ForecastRow[], over: Partial<ImportCtx> = {}): ImportPlan {
  return buildForecastImportPlan(rows, ctxOf(over));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe("normalisePerson", () => {
  it("lower-cases, trims and collapses whitespace", () => {
    expect(normalisePerson("  Ann \t  LEE ")).toBe("ann lee");
  });
});

describe("matching", () => {
  it("an email match beats a same-name different person", () => {
    const resources = [
      person(1, "Ann", "Lee", { email: "other@x.com" }),
      person(2, "Anna", "Other", { email: "ann@x.com" }),
    ];
    const p = plan([row("Ann Lee", "2026-01", 10, { email: " ANN@x.com " })], { resources });
    expect(p.unresolved).toEqual([]);
    expect(p.addResources[0].resourceIds).toEqual([2]);
  });

  it("matches any address in Resource.emails", () => {
    const resources = [person(1, "Ann", "Lee", { email: "a@x.com", emails: ["Alt@X.com"] })];
    const p = plan([row("Someone", "2026-01", 10, { email: "alt@x.com" })], { resources });
    expect(p.unresolved).toEqual([]);
    expect(p.addResources[0].resourceIds).toEqual([1]);
  });

  it("matches the name ignoring case and whitespace", () => {
    const p = plan([row("  ann   LEE ", "2026-01", 10)]);
    expect(p.unresolved).toEqual([]);
    expect(p.changes).toHaveLength(1);
  });

  it("reports two same-name resources as ambiguous with both ids", () => {
    const resources = [person(1, "Ann", "Lee"), person(2, "Ann", "Lee")];
    const p = plan([row("Ann Lee", "2026-01", 10)], { resources });
    expect(p.unresolved).toEqual([{ person: "Ann Lee", why: "ambiguous", candidates: [1, 2] }]);
    expect(p.changes).toEqual([]);
  });

  it("reports an unknown person as no-match, keeping the sheet email", () => {
    const p = plan([row("Zed Zee", "2026-01", 10, { email: "z@x.com" })]);
    expect(p.unresolved).toEqual([{ person: "Zed Zee", email: "z@x.com", why: "no-match", candidates: [] }]);
  });

  it("reports a role-less resource as no-role", () => {
    const resources = [person(1, "Ann", "Lee", { roleId: null })];
    const p = plan([row("Ann Lee", "2026-01", 10)], { resources });
    expect(p.unresolved).toEqual([{ person: "Ann Lee", why: "no-role", candidates: [1] }]);
    expect(p.changes).toEqual([]);
  });

  it("lists an unresolved person once however many rows they have", () => {
    const p = plan([row("Zed", "2026-01", 1), row("ZED ", "2026-02", 1)]);
    expect(p.unresolved).toHaveLength(1);
  });

  it("an override to a resource id resolves the person", () => {
    const resources = [person(1, "Ann", "Lee"), person(2, "Bob", "Ray")];
    const overrides = new Map<string, PersonOverride>([["a. lee", 2]]);
    const p = plan([row("A. Lee", "2026-01", 10)], { resources, overrides });
    expect(p.unresolved).toEqual([]);
    expect(p.addResources[0].resourceIds).toEqual([2]);
  });

  it("an override does not re-route a row that resolved by email", () => {
    const resources = [person(1, "Ann", "Lee", { email: "ann@x.com" }), person(2, "Bob", "Ray")];
    const overrides = new Map<string, PersonOverride>([["ann lee", 2]]);
    const p = plan([row("Ann Lee", "2026-01", 10, { email: "ann@x.com" })], { resources, overrides });
    expect(p.addResources[0].resourceIds).toEqual([1]);
  });

  it("settling an ambiguous namesake leaves the email-matched row where it was", () => {
    const resources = [
      person(1, "Ann", "Lee", { email: "ann@x.com", roleId: ROLE_A.id }),
      person(2, "Ann", "Lee", { roleId: ROLE_B.id }),
    ];
    const overrides = new Map<string, PersonOverride>([["ann lee", 2]]);
    const rows = [row("Ann Lee", "2026-01", 10, { email: "ann@x.com" }), row("Ann Lee", "2026-02", 4)];
    const p = plan(rows, { resources, overrides });
    expect(p.unresolved).toEqual([]);
    expect(p.changes).toEqual([
      { alloc: { kind: "role", roleId: 10 }, period: "2026-01", old: undefined, next: 10 },
      { alloc: { kind: "role", roleId: 11 }, period: "2026-02", old: undefined, next: 4 },
    ]);
    // Without the override the email row is unaffected and the other stays ambiguous.
    const bare = plan(rows, { resources });
    expect(bare.changes).toHaveLength(1);
    expect(bare.unresolved).toEqual([{ person: "Ann Lee", why: "ambiguous", candidates: [1, 2] }]);
  });

  it("an override to a missing resource id is no-match", () => {
    const overrides = new Map<string, PersonOverride>([["zed zee", 99]]);
    const p = plan([row("Zed Zee", "2026-01", 10)], { overrides });
    expect(p.unresolved).toEqual([{ person: "Zed Zee", why: "no-match", candidates: [] }]);
  });

  it("an override to skip drops the rows and lists the person once", () => {
    const overrides = new Map<string, PersonOverride>([["zed zee", "skip"]]);
    const p = plan([row("Zed Zee", "2026-01", 10), row("zed zee", "2026-02", 5)], { overrides });
    expect(p.skipped).toEqual(["Zed Zee"]);
    expect(p.changes).toEqual([]);
    expect(p.unresolved).toEqual([]);
  });

  // §500 fix wave 2 (CR minor 7): an archived resource is not matched, by name
  // or by email — it supersedes the earlier "still matches" behaviour.
  it("does not match an archived resource, by name or by email", () => {
    const resources = [person(1, "Ann", "Lee", { active: false, email: "ann@x.com" })];
    expect(plan([row("Ann Lee", "2026-01", 10)], { resources }).unresolved).toEqual([
      { person: "Ann Lee", why: "no-match", candidates: [] },
    ]);
    expect(plan([row("Someone", "2026-01", 10, { email: "ann@x.com" })], { resources }).changes).toEqual([]);
  });

  it("matches the active one of an active and an archived namesake", () => {
    const resources = [person(1, "Ann", "Lee", { active: false }), person(2, "Ann", "Lee")];
    const p = plan([row("Ann Lee", "2026-01", 10)], { resources });
    expect(p.unresolved).toEqual([]);
    expect(p.addResources[0].resourceIds).toEqual([2]);
  });

  it("matches a name written Last, First", () => {
    const resources = [person(1, "Hans", "Müller")];
    for (const name of ["Müller, Hans", "müller,hans", " Müller ,  Hans "]) {
      const p = plan([row(name, "2026-01", 10)], { resources });
      expect(p.unresolved).toEqual([]);
      expect(p.addResources[0].resourceIds).toEqual([1]);
    }
  });
});

describe("routing", () => {
  it("writes a detailed bucket by role", () => {
    const p = plan([row("Ann Lee", "2026-01", 10)]);
    expect(p.changes).toEqual([{ alloc: { kind: "role", roleId: 10 }, period: "2026-01", old: undefined, next: 10 }]);
    expect(p.newAllocations).toEqual([{ kind: "role", roleId: 10 }]);
  });

  it("writes a blended bucket by discipline", () => {
    const p = plan([row("Ann Lee", "2026-01", 10)], { bucket: bucketOf({ planningMode: "blended" }) });
    expect(p.changes[0].alloc).toEqual({ kind: "discipline", disciplineId: 1 });
  });

  it("reads the stored value from the right array", () => {
    const bucket = bucketOf({
      planningMode: "blended",
      allocations: [alloc(10, { "2026-01": 99 })],
      disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 4 }, actualHours: {} }],
    });
    const p = plan([row("Ann Lee", "2026-01", 10)], { bucket });
    expect(p.changes[0].old).toBe(4);
    expect(p.newAllocations).toEqual([]);
  });
});

// §500 fix wave 2 (CR minor 8): a covered cell is replaced whole, so a cell on
// a line shared with people the sheet does not list names them.
describe("cells on a line shared with people not in the sheet", () => {
  const resources = [person(1, "Ann", "Lee"), person(2, "Bob", "Ray")];

  it("names the line's members the sheet does not list", () => {
    const bucket = bucketOf({ allocations: [alloc(ROLE_A.id, { "2026-01": 50 }, [1, 2])] });
    const p = plan([row("Ann Lee", "2026-01", 10)], { resources, bucket });
    expect(p.changes).toEqual([
      { alloc: { kind: "role", roleId: ROLE_A.id }, period: "2026-01", old: 50, next: 10, othersOnLine: ["Bob Ray"] },
    ]);
  });

  it("names nobody when every member of the line is in the sheet", () => {
    const bucket = bucketOf({ allocations: [alloc(ROLE_A.id, {}, [1, 2])] });
    const p = plan([row("Ann Lee", "2026-01", 10), row("Bob Ray", "2026-01", 5)], { resources, bucket });
    expect(p.changes[0].othersOnLine).toBeUndefined();
  });
});

describe("aggregation", () => {
  it("sums two people of one role in one month into one change", () => {
    const resources = [person(1, "Ann", "Lee"), person(2, "Bob", "Ray")];
    const p = plan([row("Ann Lee", "2026-01", 10.25), row("Bob Ray", "2026-01", 20.5)], { resources });
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0].next).toBe(30.75);
    expect(p.addResources[0].resourceIds).toEqual([1, 2]);
  });

  it("sums the shares a boundary week gets from two months", () => {
    const bucket = bucketOf({ startDate: "2026-04-01", endDate: "2026-06-30" });
    const weekly: ResourcePlan = { ...MONTH_PLAN, granularity: "week" };
    const apr = splitToGranularity("2026-04", 100, "week", NONE).find((s) => s.key === "2026-W18");
    const may = splitToGranularity("2026-05", 100, "week", NONE).find((s) => s.key === "2026-W18");
    expect(apr && may).toBeTruthy();
    const p = plan([row("Ann Lee", "2026-04", 100), row("Ann Lee", "2026-05", 100)], { bucket, plan: weekly });
    const w18 = p.changes.filter((c) => c.period === "2026-W18");
    expect(w18).toHaveLength(1);
    expect(w18[0].next).toBe(Math.round(((apr?.hours ?? 0) + (may?.hours ?? 0)) * 100) / 100);
    // W14 starts Mar 30, before the bucket, so April's share of it is not written.
    expect(p.changes.some((c) => c.period === "2026-W14")).toBe(false);
    expect(p.outOfRange).toContainEqual({ person: "Ann Lee", period: "2026-W14" });
  });

  it("sums duplicate cents without float drift", () => {
    const resources = [person(1, "Ann", "Lee"), person(2, "Bob", "Ray")];
    const p = plan([row("Ann Lee", "2026-01", 0.1), row("Bob Ray", "2026-01", 0.2)], { resources });
    expect(p.changes[0].next).toBe(0.3);
  });

  it("omits a cell equal to its stored value and leaves other stored months alone", () => {
    const bucket = bucketOf({ allocations: [alloc(10, { "2026-01": 10, "2026-03": 7 })] });
    const p = plan([row("Ann Lee", "2026-01", 10), row("Ann Lee", "2026-02", 5)], { bucket });
    expect(p.changes).toEqual([{ alloc: { kind: "role", roleId: 10 }, period: "2026-02", old: undefined, next: 5 }]);
    expect(p.hoursDelta).toBe(5);
  });

  it("a deliberate zero overwrites a stored value", () => {
    const bucket = bucketOf({ allocations: [alloc(10, { "2026-01": 8 })] });
    const p = plan([row("Ann Lee", "2026-01", 0)], { bucket });
    expect(p.changes).toEqual([{ alloc: { kind: "role", roleId: 10 }, period: "2026-01", old: 8, next: 0 }]);
    expect(p.hoursDelta).toBe(-8);
  });

  it("totals the delta across increases and decreases", () => {
    const bucket = bucketOf({ allocations: [alloc(10, { "2026-01": 8, "2026-02": 1.5 })] });
    const p = plan([row("Ann Lee", "2026-01", 3), row("Ann Lee", "2026-02", 4.25)], { bucket });
    expect(p.hoursDelta).toBe(-2.25);
  });
});

describe("hoursDelta rounding", () => {
  it("reads a sub-cent change as 0, never -0", () => {
    const bucket = bucketOf({ allocations: [alloc(10, { "2026-01": 10.004 })] });
    const p = plan([row("Ann Lee", "2026-01", 10)], { bucket });
    expect(p.changes).toHaveLength(1);
    expect(p.hoursDelta).toBe(0);
  });
});

describe("partial cells", () => {
  const weekly: ResourcePlan = { ...MONTH_PLAN, granularity: "week" };
  const bucket = bucketOf({ startDate: "2026-01-01", endDate: "2026-04-30" });

  it("flags a week only partly covered by the sheet's periods", () => {
    const p = plan([row("Ann Lee", "2026-03", 100)], { bucket, plan: weekly });
    const byPeriod = new Map(p.changes.map((c) => [c.period, c]));
    expect(byPeriod.get("2026-W14")?.partial).toBe(true);
    for (const w of ["2026-W10", "2026-W11", "2026-W12", "2026-W13"]) {
      expect(byPeriod.get(w)).toBeDefined();
      expect(byPeriod.get(w)?.partial).toBeUndefined();
    }
  });

  it("does not flag the straddling week once both months are in the sheet", () => {
    const p = plan([row("Ann Lee", "2026-03", 100), row("Ann Lee", "2026-04", 100)], { bucket, plan: weekly });
    expect(p.changes.find((c) => c.period === "2026-W14")?.partial).toBeUndefined();
  });

  it("counts a period supplied by another person of the same role", () => {
    const resources = [person(1, "Ann", "Lee"), person(2, "Bob", "Ray")];
    const p = plan([row("Ann Lee", "2026-03", 100), row("Bob Ray", "2026-04", 100)], {
      bucket,
      plan: weekly,
      resources,
    });
    expect(p.changes.find((c) => c.period === "2026-W14")?.partial).toBeUndefined();
  });

  it("never flags a cell written at the sheet's own granularity", () => {
    expect(plan([row("Ann Lee", "2026-01", 10)]).changes[0].partial).toBeUndefined();
  });

  // Only a WORKING day nobody covers makes a cell partial. W32-W36 cover
  // 3 Aug - 6 Sep 2026; August's uncovered 1st and 2nd are a Saturday and a
  // Sunday, so August is whole. September is genuinely partial (the positive
  // control that the check ran at all).
  it("ignores uncovered weekend days", () => {
    const weeks = ["2026-W32", "2026-W33", "2026-W34", "2026-W35", "2026-W36"].map((w) => row("Ann Lee", w, 40));
    const p = plan(weeks, { bucket: bucketOf({ startDate: "2026-01-01", endDate: "2026-12-31" }) });
    const byPeriod = new Map(p.changes.map((c) => [c.period, c]));
    expect(byPeriod.get("2026-08")).toBeDefined();
    expect(byPeriod.get("2026-08")?.partial).toBeUndefined();
    expect(byPeriod.get("2026-09")?.partial).toBe(true);
  });

  // W18 runs 27 Apr - 3 May 2026. April covers its Monday to Thursday; Friday
  // 1 May is a public holiday and the rest is weekend, so W18 is whole. Without
  // the holiday the same week is partial (the control).
  it("ignores an uncovered public holiday", () => {
    const bucket = bucketOf({ startDate: "2026-01-01", endDate: "2026-06-30" });
    const ctx = { bucket, plan: weekly };
    const w18 = (holidaySet: ReadonlySet<string>) =>
      plan([row("Ann Lee", "2026-04", 100)], { ...ctx, holidaySet }).changes.find((c) => c.period === "2026-W18");
    expect(w18(new Set(["2026-05-01"]))).toBeDefined();
    expect(w18(new Set(["2026-05-01"]))?.partial).toBeUndefined();
    expect(w18(NONE)?.partial).toBe(true);
  });
});

describe("range", () => {
  it("sends a period outside the bucket to outOfRange once per person and period", () => {
    const resources = [person(1, "Ann", "Lee")];
    const p = plan([row("Ann Lee", "2026-01", 10), row("Ann Lee", "2026-06", 5), row("ann lee", "2026-06", 5)], { resources });
    expect(p.outOfRange).toEqual([{ person: "Ann Lee", period: "2026-06" }]);
    expect(p.changes.map((c) => c.period)).toEqual(["2026-01"]);
  });

  it("uses the app's active periods: a period starting before the bucket is out", () => {
    const bucket = bucketOf({ startDate: "2026-01-15", endDate: "2026-03-31" });
    const p = plan([row("Ann Lee", "2026-01", 10), row("Ann Lee", "2026-02", 5)], { bucket });
    expect(p.outOfRange).toEqual([{ person: "Ann Lee", period: "2026-01" }]);
    expect(p.changes.map((c) => c.period)).toEqual(["2026-02"]);
  });

  it("keeps a Q2 bucket's weekly cells to weeks that start inside it", () => {
    const bucket = bucketOf({ startDate: "2026-04-01", endDate: "2026-06-30" });
    const p = plan([row("Ann Lee", "2026-04", 100)], { bucket, plan: { ...MONTH_PLAN, granularity: "week" } });
    expect(p.outOfRange).toContainEqual({ person: "Ann Lee", period: "2026-W14" });
    expect(p.changes.map((c) => c.period)).not.toContain("2026-W14");
    expect(p.changes.map((c) => c.period)).toContain("2026-W15");
  });

  it("treats periods past the plan's end as out of range", () => {
    const bucket = bucketOf({ startDate: "2026-01-01", endDate: "2026-06-30" });
    const short: ResourcePlan = { ...MONTH_PLAN, endDate: "2026-03-31" };
    const p = plan([row("Ann Lee", "2026-03", 10), row("Ann Lee", "2026-04", 5)], { bucket, plan: short });
    expect(p.outOfRange).toEqual([{ person: "Ann Lee", period: "2026-04" }]);
    expect(p.changes.map((c) => c.period)).toEqual(["2026-03"]);
  });

  it("does not add a person whose every period is out of range", () => {
    const p = plan([row("Ann Lee", "2026-09", 10)]);
    expect(p.addResources).toEqual([]);
    expect(p.newAllocations).toEqual([]);
    expect(p.changes).toEqual([]);
  });

  it("adds a person whose cell equals the stored value, but not one already on the allocation", () => {
    const resources = [person(1, "Ann", "Lee"), person(2, "Bob", "Ray")];
    const bucket = bucketOf({ allocations: [alloc(10, { "2026-01": 10 }, [2])] });
    const p = plan([row("Ann Lee", "2026-01", 10), row("Bob Ray", "2026-01", 0)], { bucket, resources });
    expect(p.addResources).toEqual([{ alloc: { kind: "role", roleId: 10 }, resourceIds: [1] }]);
  });
});

describe("rate notes", () => {
  it("notes nothing when the sheet rate equals the internal rate", () => {
    expect(plan([row("Ann Lee", "2026-01", 10, { rate: 100 })]).rateNotes).toEqual([]);
  });

  it("notes nothing when it equals the external rate", () => {
    expect(plan([row("Ann Lee", "2026-01", 10, { rate: 150 })]).rateNotes).toEqual([]);
  });

  it("notes nothing within the 0.5% tolerance", () => {
    expect(plan([row("Ann Lee", "2026-01", 10, { rate: 100.4 })]).rateNotes).toEqual([]);
  });

  it("sits exactly on the 0.005 boundary: equal passes, just over is noted", () => {
    expect(plan([row("Ann Lee", "2026-01", 10, { rate: 100.5 })]).rateNotes).toEqual([]);
    expect(plan([row("Ann Lee", "2026-01", 10, { rate: 100.51 })]).rateNotes).toHaveLength(1);
  });

  it("does not note the rate of a row with no in-range period", () => {
    expect(plan([row("Ann Lee", "2026-09", 10, { rate: 120 })]).rateNotes).toEqual([]);
  });

  it("notes a rate that matches neither, once per person and rate", () => {
    const p = plan([row("Ann Lee", "2026-01", 10, { rate: 120 }), row("Ann Lee", "2026-02", 10, { rate: 120 })]);
    expect(p.rateNotes).toEqual([
      { person: "Ann Lee", resourceId: 1, sheetRate: 120, internalRate: 100, externalRate: 150 },
    ]);
  });
});

describe("blockers", () => {
  it("is empty when there is something to apply", () => {
    expect(plan([row("Ann Lee", "2026-01", 10)]).blockers).toEqual([]);
  });

  it("follows-plan", () => {
    const p = plan([row("Ann Lee", "2026-01", 10)], { plan: { ...MONTH_PLAN, budgetFollowsPlan: true } });
    expect(p.blockers).toEqual(["follows-plan"]);
  });

  it("closed", () => {
    const p = plan([row("Ann Lee", "2026-01", 10)], { bucket: bucketOf({ status: "closed" }) });
    expect(p.blockers).toEqual(["closed"]);
  });

  it("nothing-to-apply", () => {
    expect(plan([]).blockers).toEqual(["nothing-to-apply"]);
  });

  it("same-row-period when the validator reported a same-row collision", () => {
    const collisions = [{ person: "Ann Lee", period: "2026-02", sources: ["S!B2", "S!C2"] }];
    expect(plan([row("Ann Lee", "2026-01", 10)], { collisions }).blockers).toEqual(["same-row-period"]);
    expect(plan([row("Ann Lee", "2026-01", 10)], { collisions: [] }).blockers).toEqual([]);
  });
});

describe("applyForecastImport", () => {
  const resources = [person(1, "Ann", "Lee"), person(2, "Bob", "Ray", { roleId: ROLE_B.id })];

  it("returns a new bucket and carries untouched allocations and fields by reference", () => {
    const untouched = alloc(11, { "2026-01": 3 });
    const touched = alloc(10, { "2026-01": 1, "2026-03": 9 }, [1]);
    const bucket = bucketOf({ allocations: [untouched, touched], taskIds: [5] });
    const p = plan([row("Ann Lee", "2026-02", 20)], { bucket, resources });
    const next = applyForecastImport(bucket, p);
    expect(next).not.toBe(bucket);
    expect(next.allocations[0]).toBe(untouched);
    expect(next.allocations[1]).not.toBe(touched);
    expect(next.allocations[1].budgetHours).toEqual({ "2026-01": 1, "2026-02": 20, "2026-03": 9 });
    expect(next.allocations[1].actualHours).toBe(touched.actualHours);
    expect(next.allocations[1].resourceIds).toBe(touched.resourceIds);
    expect(next.taskIds).toBe(bucket.taskIds);
    expect(bucket.allocations[1].budgetHours).toEqual({ "2026-01": 1, "2026-03": 9 });
  });

  it("creates a missing allocation with empty actuals and the matched people", () => {
    const bucket = bucketOf();
    const p = plan([row("Ann Lee", "2026-01", 5), row("Ann Lee", "2026-02", 6)], { bucket, resources });
    const next = applyForecastImport(bucket, p);
    expect(next.allocations).toEqual([
      { roleId: 10, resourceIds: [1], budgetHours: { "2026-01": 5, "2026-02": 6 }, actualHours: {} },
    ]);
    expect(bucket.allocations).toEqual([]);
  });

  it("appends a matched person to resourceIds without duplicates", () => {
    const bucket = bucketOf({ allocations: [alloc(10, {}, [1])] });
    const p = plan([row("Ann Lee", "2026-01", 5)], { bucket, resources });
    expect(applyForecastImport(bucket, p).allocations[0].resourceIds).toEqual([1]);
    const withBob = person(3, "Cy", "Dee");
    const p2 = plan([row("Ann Lee", "2026-01", 5), row("Cy Dee", "2026-01", 5)], {
      bucket,
      resources: [...resources, withBob],
    });
    expect(applyForecastImport(bucket, p2).allocations[0].resourceIds).toEqual([1, 3]);
  });

  it("a blended bucket writes disciplineAllocations and leaves allocations by reference", () => {
    const existing = alloc(10, { "2026-01": 2 });
    const bucket = bucketOf({ planningMode: "blended", allocations: [existing] });
    const p = plan([row("Ann Lee", "2026-01", 5)], { bucket, resources });
    const next = applyForecastImport(bucket, p);
    expect(next.allocations).toBe(bucket.allocations);
    expect(next.disciplineAllocations).toEqual([
      { disciplineId: 1, resourceIds: [1], budgetHours: { "2026-01": 5 }, actualHours: {} },
    ]);
    expect(bucket.disciplineAllocations).toBeUndefined();
  });

  it("updates an existing discipline allocation without touching its neighbours", () => {
    const d1: DisciplineAllocation = { disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 2 }, actualHours: {} };
    const d2: DisciplineAllocation = { disciplineId: 2, resourceIds: [], budgetHours: {}, actualHours: {} };
    const bucket = bucketOf({ planningMode: "blended", disciplineAllocations: [d1, d2] });
    const p = plan([row("Ann Lee", "2026-01", 5)], { bucket, resources });
    const next = applyForecastImport(bucket, p);
    expect(next.disciplineAllocations?.[1]).toBe(d2);
    expect(next.disciplineAllocations?.[0].budgetHours).toEqual({ "2026-01": 5 });
  });

  it("dedupes a hand-built addResources against the stored ids and itself", () => {
    const hand: ImportPlan = {
      changes: [],
      unresolved: [],
      skipped: [],
      outOfRange: [],
      rateNotes: [],
      addResources: [
        { alloc: { kind: "role", roleId: 10 }, resourceIds: [1, 1, 2] },
        { alloc: { kind: "role", roleId: 12 }, resourceIds: [3, 3] },
      ],
      newAllocations: [],
      blockers: [],
      hoursDelta: 0,
    };
    const bucket = bucketOf({ allocations: [alloc(10, {}, [1])] });
    const next = applyForecastImport(bucket, hand);
    expect(next.allocations[0].resourceIds).toEqual([1, 2]);
    expect(next.allocations[1].resourceIds).toEqual([3]);
  });

  it("never mutates a deep-frozen bucket or plan", () => {
    const bucket = deepFreeze(
      bucketOf({ allocations: [alloc(10, { "2026-01": 1 }, [1])], taskIds: [1], planningMode: "detailed" }),
    );
    const blended = deepFreeze(bucketOf({ planningMode: "blended", disciplineAllocations: [] }));
    const rows = deepFreeze([row("Ann Lee", "2026-02", 7), row("Bob Ray", "2026-02", 3)]);
    const ctx = deepFreeze(ctxOf({ bucket, resources }));
    const built = buildForecastImportPlan(rows, ctx);
    expect(() => applyForecastImport(bucket, deepFreeze(built))).not.toThrow();
    const builtBlended = buildForecastImportPlan(rows, deepFreeze(ctxOf({ bucket: blended, resources })));
    expect(() => applyForecastImport(blended, deepFreeze(builtBlended))).not.toThrow();
  });

  it("applying a plan twice is idempotent in outcome", () => {
    const bucket = bucketOf();
    const once = applyForecastImport(bucket, plan([row("Ann Lee", "2026-01", 5)], { bucket, resources }));
    const again = plan([row("Ann Lee", "2026-01", 5)], { bucket: once, resources });
    expect(again.blockers).toEqual(["nothing-to-apply"]);
    expect(again.addResources).toEqual([]);
  });
});

// Final review 3, M3 (owner decision 2026-10-13): a person the bucket already
// places on ONE line has their hours routed to that line, whatever its role;
// on several lines they are unresolved. Routing by the resource's role once
// created a Dev line beside Ann's Senior line and counted her January twice.
describe("routing to the line the bucket already places the person on (final review 3, M3)", () => {
  const SENIOR = ROLE_B;

  it("routes Ann (role Dev) to the Senior line she sits on: Senior Jan becomes 120, no Dev line", () => {
    const bucket = bucketOf({ allocations: [alloc(SENIOR.id, { "2026-01": 100 }, [1])] });
    const p = plan([row("Ann Lee", "2026-01", 120)], { bucket });
    expect(p.changes).toEqual([{ alloc: { kind: "role", roleId: SENIOR.id }, period: "2026-01", old: 100, next: 120 }]);
    expect(p.newAllocations).toEqual([]);
    expect(p.addResources).toEqual([]);
    const next = applyForecastImport(bucket, p);
    expect(next.allocations).toHaveLength(1);
    expect(next.allocations.reduce((sum, a) => sum + (a.budgetHours["2026-01"] ?? 0), 0)).toBe(120);
  });

  it("compares a sheet rate against the line's role", () => {
    const bucket = bucketOf({ allocations: [alloc(SENIOR.id, {}, [1])] });
    expect(plan([row("Ann Lee", "2026-01", 10, { rate: SENIOR.internalRate })], { bucket }).rateNotes).toEqual([]);
  });

  it("routes a blended bucket to the one discipline line the person sits on", () => {
    const line: DisciplineAllocation = { disciplineId: 2, resourceIds: [1], budgetHours: {}, actualHours: {} };
    const p = plan([row("Ann Lee", "2026-01", 10)], { bucket: bucketOf({ planningMode: "blended", disciplineAllocations: [line] }) });
    expect(p.changes.map((c) => c.alloc)).toEqual([{ kind: "discipline", disciplineId: 2 }]);
  });

  it("leaves a person on two lines unresolved, with a reason of its own, and writes nothing for them", () => {
    const bucket = bucketOf({ allocations: [alloc(ROLE_A.id, { "2026-01": 5 }, [1]), alloc(SENIOR.id, { "2026-01": 100 }, [1])] });
    const p = plan([row("Ann Lee", "2026-01", 120)], { bucket });
    expect(p.unresolved).toEqual([{ person: "Ann Lee", why: "several-lines", candidates: [] }]);
    expect(p.changes).toEqual([]);
    expect(p.blockers).toContain("nothing-to-apply");
  });

  it("the picker can name another resource for such a person, or skip them", () => {
    const resources = [person(1, "Ann", "Lee"), person(2, "Bob", "Ray")];
    const bucket = bucketOf({ allocations: [alloc(ROLE_A.id, {}, [1]), alloc(SENIOR.id, {}, [1])] });
    const picked = plan([row("Ann Lee", "2026-01", 7)], { resources, bucket, overrides: new Map([[normalisePerson("Ann Lee"), 2]]) });
    expect(picked.unresolved).toEqual([]);
    expect(picked.changes).toEqual([{ alloc: { kind: "role", roleId: ROLE_A.id }, period: "2026-01", old: undefined, next: 7, othersOnLine: ["Ann Lee"] }]);
    expect(picked.addResources).toEqual([{ alloc: { kind: "role", roleId: ROLE_A.id }, resourceIds: [2] }]);
    const skipped = plan([row("Ann Lee", "2026-01", 7)], { resources, bucket, overrides: new Map<string, PersonOverride>([[normalisePerson("Ann Lee"), "skip"]]) });
    expect(skipped.skipped).toEqual(["Ann Lee"]);
    expect(skipped.changes).toEqual([]);
  });

  it("a person on no line is routed by role, as before", () => {
    const bucket = bucketOf({ allocations: [alloc(SENIOR.id, { "2026-01": 100 }, [2])] });
    const p = plan([row("Ann Lee", "2026-01", 10)], { bucket });
    expect(p.changes.map((c) => c.alloc)).toEqual([{ kind: "role", roleId: ROLE_A.id }]);
    expect(p.newAllocations).toEqual([{ kind: "role", roleId: ROLE_A.id }]);
  });
});
