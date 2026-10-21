import { afterEach, describe, expect, test, vi } from "vitest";
import {
  budgetSetupDismissKey,
  budgetSetupDoneCount,
  budgetSetupStepCount,
  budgetSetupSteps,
  isBudgetSetupDismissed,
  setBudgetSetupDismissed,
} from "./budget-setup";
import type { BudgetBucket, Resource, Role } from "./types";

const role = (patch: Partial<Role> = {}): Role => ({
  id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0, ...patch,
});
const resource = { id: 1, name: "Acme Person" } as unknown as Resource;
const bucket = (patch: Partial<BudgetBucket> = {}): BudgetBucket => ({
  id: 1, name: "Acme phase 1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-06-30",
  status: "open", allocations: [], ...patch,
});

describe("budgetSetupSteps", () => {
  test("an empty project has nothing done and step 1 next", () => {
    expect(budgetSetupSteps({ roles: [], resources: [], buckets: [] })).toEqual({
      ratesDone: false, peopleDone: false, bucketDone: false, bookingsDone: false, next: 1, bookingsApplicable: true,
    });
  });

  test("a role with an internal rate completes step 1", () => {
    const s = budgetSetupSteps({ roles: [role({ internalRate: 80 })], resources: [], buckets: [] });
    expect(s.ratesDone).toBe(true);
    expect(s.next).toBe(2);
  });

  test("a role with only an external rate completes step 1", () => {
    expect(budgetSetupSteps({ roles: [role({ externalRate: 120 })], resources: [], buckets: [] }).ratesDone).toBe(true);
  });

  test("a day-rate role counts through its materialised hourly equivalent", () => {
    const dayRole = role({ rateBasis: "day", internalRateDay: 800, internalRate: 100 });
    expect(budgetSetupSteps({ roles: [dayRole], resources: [], buckets: [] }).ratesDone).toBe(true);
  });

  test("roles whose rates are both zero do not complete step 1", () => {
    const zero = [role(), role({ id: 2, rateBasis: "day", internalRateDay: 0, externalRateDay: 0 })];
    expect(budgetSetupSteps({ roles: zero, resources: [], buckets: [] }).ratesDone).toBe(false);
  });

  test("no roles at all do not complete step 1", () => {
    expect(budgetSetupSteps({ roles: [], resources: [resource], buckets: [] }).ratesDone).toBe(false);
  });

  test("any resource completes step 2", () => {
    const s = budgetSetupSteps({ roles: [role({ internalRate: 1 })], resources: [resource], buckets: [] });
    expect(s.peopleDone).toBe(true);
    expect(s.next).toBe(3);
  });

  test("any bucket completes step 3 and step 4 becomes next", () => {
    const s = budgetSetupSteps({
      roles: [role({ internalRate: 1 })], resources: [resource], buckets: [bucket()],
    });
    expect(s.bucketDone).toBe(true);
    expect(s.bookingsDone).toBe(false);
    expect(s.next).toBe(4);
  });

  test("step 4 is not next while an earlier step is open", () => {
    const s = budgetSetupSteps({ roles: [], resources: [], buckets: [bucket()] });
    expect(s.next).toBe(1);
  });

  test("an allocation with an empty or zero actualHours map is not a booking", () => {
    const s = budgetSetupSteps({
      roles: [], resources: [],
      buckets: [bucket({ allocations: [
        { roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: {} },
        { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-01": 0 } },
      ] })],
    });
    expect(s.bookingsDone).toBe(false);
  });

  test("a positive actualHours value on any allocation completes step 4", () => {
    const s = budgetSetupSteps({
      roles: [role({ internalRate: 1 })], resources: [resource],
      buckets: [bucket(), bucket({ id: 2, allocations: [
        { roleId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-01-05": 6 } },
      ] })],
    });
    expect(s.bookingsDone).toBe(true);
    expect(s.next).toBeNull();
  });

  test("a booking on a blended-mode discipline allocation completes step 4", () => {
    const s = budgetSetupSteps({
      roles: [], resources: [],
      buckets: [bucket({ planningMode: "blended", disciplineAllocations: [
        { disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: { "2026-01": 3 } },
      ] })],
    });
    expect(s.bookingsDone).toBe(true);
  });

  test("the hours planned (budgetHours) alone never count as bookings", () => {
    const s = budgetSetupSteps({
      roles: [], resources: [],
      buckets: [bucket({ allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 99 }, actualHours: {} }] })],
    });
    expect(s.bookingsDone).toBe(false);
  });
});

describe("§762 — budgetSetupSteps bookingsApplicable", () => {
  const first3 = { roles: [role({ internalRate: 80 })], resources: [resource], buckets: [bucket()] };
  test("§762 — steps 1-3 done: next is 4 when bookingsApplicable is true or absent (positive control)", () => {
    expect(budgetSetupSteps(first3).next).toBe(4);
    expect(budgetSetupSteps({ ...first3, bookingsApplicable: true }).next).toBe(4);
  });
  test("§762 — steps 1-3 done: next is null when bookingsApplicable is false", () => {
    expect(budgetSetupSteps({ ...first3, bookingsApplicable: false }).next).toBeNull();
  });
  test("§762 — step 4 is never next while an earlier step is open, applicable or not", () => {
    expect(budgetSetupSteps({ ...first3, buckets: [], bookingsApplicable: false }).next).toBe(3);
  });
  test("§762 — done count ignores bookings when not applicable; step count is 3 vs 4", () => {
    const all = { ratesDone: true, peopleDone: true, bucketDone: true, bookingsDone: true, next: null } as const;
    expect(budgetSetupDoneCount(all)).toBe(4);
    expect(budgetSetupDoneCount({ ...all, bookingsApplicable: true })).toBe(4);
    expect(budgetSetupDoneCount({ ...all, bookingsApplicable: false })).toBe(3);
    expect(budgetSetupStepCount(all)).toBe(4);
    expect(budgetSetupStepCount({ ...all, bookingsApplicable: true })).toBe(4);
    expect(budgetSetupStepCount({ ...all, bookingsApplicable: false })).toBe(3);
  });
});

describe("budgetSetupDoneCount", () => {
  test("counts the done steps out of four", () => {
    expect(budgetSetupDoneCount({ ratesDone: true, peopleDone: false, bucketDone: true, bookingsDone: false, next: 2 })).toBe(2);
    expect(budgetSetupDoneCount({ ratesDone: false, peopleDone: false, bucketDone: false, bookingsDone: false, next: 1 })).toBe(0);
    expect(budgetSetupDoneCount({ ratesDone: true, peopleDone: true, bucketDone: true, bookingsDone: true, next: null })).toBe(4);
  });
});

describe("budget setup dismissal (per device, per project)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  test("the key is namespaced and carries the project key", () => {
    expect(budgetSetupDismissKey("acme")).toBe("aipm-cockpit:budget-setup-dismissed:acme");
  });

  test("is not dismissed until written, then reads back dismissed", () => {
    expect(isBudgetSetupDismissed("acme")).toBe(false);
    setBudgetSetupDismissed("acme");
    expect(window.localStorage.getItem("aipm-cockpit:budget-setup-dismissed:acme")).toBe("1");
    expect(isBudgetSetupDismissed("acme")).toBe(true);
  });

  test("another project is unaffected", () => {
    setBudgetSetupDismissed("acme");
    expect(isBudgetSetupDismissed("other")).toBe(false);
  });

  test("any value other than 1 is not a dismissal", () => {
    window.localStorage.setItem(budgetSetupDismissKey("acme"), "0");
    expect(isBudgetSetupDismissed("acme")).toBe(false);
  });

  test("a throwing storage reads as not dismissed and a write does not throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(isBudgetSetupDismissed("acme")).toBe(false);
    expect(() => setBudgetSetupDismissed("acme")).not.toThrow();
  });
});
