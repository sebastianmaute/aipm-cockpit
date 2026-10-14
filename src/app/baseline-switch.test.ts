import { describe, expect, it } from "vitest";
import { planBaselineSwitch } from "./baseline-switch";
import type { BudgetBucket, ChangeItem, FxRates, Role } from "./types";

const FX: FxRates = { base: "EUR", date: "2026-10-01", fetchedAt: "2026-10-01T08:00:00.000Z", rates: { GBP: 0.852 } };
const NOW = "2026-10-14T09:30:00.000Z";

const hourRole: Role = {
  id: 1, disciplineId: 1, gradeId: 1,
  internalRate: 100, externalRate: 140, internalRateDay: 800, externalRateDay: 1120,
};
const bucket = (over: Partial<BudgetBucket> = {}): BudgetBucket => ({
  id: 1, name: "B", type: "T&M", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31",
  status: "Active", allocations: [], ...over,
} as BudgetBucket);
const change = (over: Partial<ChangeItem> = {}): ChangeItem => ({
  id: 7, title: "C", raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], ...over,
} as ChangeItem);

function plan(over: Partial<Parameters<typeof planBaselineSwitch>[0]> = {}) {
  return planBaselineSwitch({
    from: "EUR", to: "GBP", sessionRates: FX, roles: [], buckets: [], changes: [],
    workdayHours: 8, roleLabel: (r) => `role-${r.id}`, nowIso: NOW, ...over,
  });
}

describe("planBaselineSwitch", () => {
  it("converts an hour-basis role's four rate fields", () => {
    const p = plan({ roles: [hourRole] })!;
    expect(p.roles[0]).toMatchObject({ internalRate: 85.2, externalRate: 119.28, internalRateDay: 681.6, externalRateDay: 954.24 });
  });

  it("leaves a legacy hour role without day fields without them", () => {
    const legacy: Role = { id: 2, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 140 };
    const r = plan({ roles: [legacy] })!.roles[0];
    expect(r.internalRate).toBe(85.2);
    expect("internalRateDay" in r).toBe(false);
    expect("externalRateDay" in r).toBe(false);
  });

  it("derives a day-basis role's hourly from the converted day rate", () => {
    const dayRole: Role = { ...hourRole, rateBasis: "day", internalRateDay: 750, externalRateDay: 1000 };
    const r = plan({ roles: [dayRole], workdayHours: 7.5 })!.roles[0];
    expect(r.internalRateDay).toBe(639);
    expect(r.internalRate).toBe(85.2);
    expect(r.externalRateDay).toBe(852);
    expect(r.externalRate).toBe(113.6);
  });

  it("converts bucket overrides, returns untouched buckets as the same object, never touches fixed price or fx override", () => {
    const plain = bucket({ id: 2 });
    const withOverride = bucket({ rateOverrideInternal: 90, fixedPriceAmount: 1234, fxRateOverride: 1.1 });
    const p = plan({ buckets: [plain, withOverride] })!;
    expect(p.buckets[0]).toBe(plain);
    expect(p.buckets[1].rateOverrideInternal).toBe(76.68);
    expect(p.buckets[1].rateOverrideExternal).toBeUndefined();
    expect(p.buckets[1].fixedPriceAmount).toBe(1234);
    expect(p.buckets[1].fxRateOverride).toBe(1.1);
  });

  it("converts costImpact and leaves a change without one unchanged", () => {
    const none = change({ id: 8 });
    const p = plan({ changes: [change({ costImpact: 5000 }), none] })!;
    expect(p.changes[0].costImpact).toBe(4260);
    expect(p.changes[1]).toBe(none);
  });

  it("lists every changed number once and builds the history entry", () => {
    const p = plan({ roles: [hourRole], buckets: [bucket({ name: "Alpha", rateOverrideInternal: 90 })], changes: [change({ costImpact: 5000 })] })!;
    expect(p.rows).toHaveLength(6);
    expect(p.rows).toContainEqual({ kind: "role", id: 1, label: "role-1", field: "internalRate", before: 100, after: 85.2 });
    expect(p.rows).toContainEqual({ kind: "bucket", id: 1, label: "Alpha", field: "rateOverrideInternal", before: 90, after: 76.68 });
    expect(p.rows).toContainEqual({ kind: "change", id: 7, label: "C", field: "costImpact", before: 5000, after: 4260 });
    expect(p.entry).toEqual({ from: "2026-10-14", at: NOW, currency: "GBP", perPrevious: 0.852 });
    expect(p.rate).toBe(0.852);
    expect(p.fxDate).toBe("2026-10-01");
    expect(p.from).toBe("EUR");
    expect(p.to).toBe("GBP");
  });

  it("returns null for the same currency or a missing rate", () => {
    expect(plan({ to: "EUR" })).toBeNull();
    expect(plan({ to: "INR" })).toBeNull();
  });

  it("round-trips EUR to GBP to EUR within one cent", () => {
    const there = plan({ roles: [hourRole] })!;
    const back = plan({ from: "GBP", to: "EUR", roles: there.roles })!;
    expect(Math.abs(back.roles[0].internalRate - 100)).toBeLessThanOrEqual(0.01);
  });
});
