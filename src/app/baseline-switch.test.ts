import { describe, expect, it } from "vitest";
import { planBaselineSwitch, prepareRestoredVersion } from "./baseline-switch";
import type { BaselineEntry } from "./baseline-currency";
import { materializeRoleRates, round2 } from "./role-rates";
import { diffWorkspaces } from "./version-diff";
import { applyRestore, changeKey } from "./version-restore";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { BudgetBucket, BudgetCurrency, ChangeItem, FxRates, Role } from "./types";

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
    workdayHours: 8, roleLabel: (r) => `role-${r.id}`, nowIso: NOW, today: "2026-10-15", ...over,
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
    // `from` is the project day handed in, never the UTC day of `at` (A2).
    expect(p.entry).toEqual({ from: "2026-10-15", at: NOW, currency: "GBP", perPrevious: 0.852 });
    expect(p.rate).toBe(0.852);
    expect(p.fxDate).toBe("2026-10-01");
    expect(p.from).toBe("EUR");
    expect(p.to).toBe("GBP");
  });

  it("rounds converted rates to two decimals", () => {
    const odd: Role = { id: 3, disciplineId: 1, gradeId: 1, internalRate: 33.33, externalRate: 50 };
    expect(plan({ roles: [odd] })!.roles[0].internalRate).toBe(28.4);
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

// §476 pre-merge ruling — a version restore NEVER changes `plan.currency`, and every money field it
// takes from the version is converted into the current currency by the switches made since the
// version was captured (`rebaseFactor`), round2. `fixedPriceAmount` and `fxRateOverride` never move.
describe("prepareRestoredVersion", () => {
  const V_AT = "2026-10-01T08:00:00.000Z"; // the version
  const S1 = { from: "2026-10-02", at: "2026-10-02T08:00:00.000Z", currency: "GBP" as const, perPrevious: 0.85 };
  const ws = (over: Partial<Workspace> = {}): Workspace => ({
    ...emptyWorkspace(),
    plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
    roles: [{ ...hourRole, internalRate: 100 }],
    budgets: [bucket({ rateOverrideInternal: 90, fixedPriceAmount: 5000, fxRateOverride: 1.1, currency: "USD" })],
    changes: [change({ costImpact: 1000 })],
    ...over,
  });
  const prep = (v: Workspace, history: BaselineEntry[], currency: BudgetCurrency = "GBP", capturedAt: string | null = V_AT) =>
    prepareRestoredVersion(v, { history, capturedAt, currency, workdayHours: 8 });

  it("pins the plan's currency to the current one and keeps every other plan field", () => {
    const out = prep(ws({ plan: { startDate: "2025-01-01", endDate: "2025-06-30", granularity: "week", currency: "EUR" } }), [S1]);
    expect(out.plan).toEqual({ startDate: "2025-01-01", endDate: "2025-06-30", granularity: "week", currency: "GBP" });
  });

  it("converts role, bucket-override and costImpact money by the later switches, round2", () => {
    const out = prep(ws(), [S1]);
    expect(out.roles[0]).toMatchObject({ internalRate: 85, externalRate: 119, internalRateDay: 680, externalRateDay: 952 });
    expect(out.budgets?.[0].rateOverrideInternal).toBe(76.5);
    expect(out.changes?.[0].costImpact).toBe(850);
  });

  it("never converts fixedPriceAmount or fxRateOverride", () => {
    const out = prep(ws(), [S1]);
    expect(out.budgets?.[0]).toMatchObject({ fixedPriceAmount: 5000, fxRateOverride: 1.1 });
  });

  it("re-derives a day-basis role's hourly rates from the converted day rates", () => {
    const dayRole: Role = { id: 2, disciplineId: 1, gradeId: 1, rateBasis: "day", internalRateDay: 800, externalRateDay: 1000, internalRate: 100, externalRate: 125 };
    const out = prep(ws({ roles: [dayRole] }), [S1]);
    expect(out.roles[0]).toMatchObject({ internalRateDay: 680, externalRateDay: 850, internalRate: 85, externalRate: 106.25 });
  });

  it("a non-cancelling round trip (EUR→USD 1.10→EUR 0.95) carries the FX move: 100 → 104.5", () => {
    const history: BaselineEntry[] = [
      { from: "2026-10-02", at: "2026-10-02T08:00:00.000Z", currency: "USD", perPrevious: 1.1 },
      { from: "2026-10-03", at: "2026-10-03T08:00:00.000Z", currency: "EUR", perPrevious: 0.95 },
    ];
    expect(prep(ws(), history, "EUR").roles[0].internalRate).toBe(104.5);
  });

  it("a version captured after every switch is returned untouched (factor 1, same currency)", () => {
    const v = ws({ plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "GBP" } });
    expect(prep(v, [S1], "GBP", "2026-10-05T08:00:00.000Z")).toBe(v);
  });

  it("an unknown capture time converts nothing but still pins the currency", () => {
    const out = prep(ws(), [S1], "GBP", null);
    expect(out.plan.currency).toBe("GBP");
    expect(out.roles[0].internalRate).toBe(100);
  });
});

// §476 A3 — a day-basis role's day and hourly rates restore as a PAIR, re-materialised at the
// CURRENT workday hours, so neither a compare nor a per-field restore can split them.
describe("restore of a day-basis role (A3)", () => {
  const dayRole = (over: Partial<Role> = {}): Role => ({
    id: 5, disciplineId: 1, gradeId: 1, rateBasis: "day",
    internalRateDay: 800, externalRateDay: 1000, internalRate: 100, externalRate: 125, ...over,
  });
  const at = (roles: Role[]): Workspace => ({ ...emptyWorkspace(), roles });
  const prepNow = (v: Workspace, wdh: number) =>
    prepareRestoredVersion(v, { history: [], capturedAt: "2026-10-01T08:00:00.000Z", currency: "EUR", workdayHours: wdh });

  it("an unchanged day rate shows no hourly row, though the workday hours changed since", () => {
    const version = at([dayRole()]); // captured at 8 h
    const now = at([materializeRoleRates(dayRole(), 7.5)]); // same day rate, live at 7.5 h
    expect(now.roles[0].internalRate).toBe(106.67); // control: the stored hourly really differs
    const rows = diffWorkspaces(prepNow(version, 7.5), now).filter((c) => c.collection === "roles");
    expect(rows).toEqual([]);
  });

  it("selecting only the hourly field restores the version's day rate and its derived hourly", () => {
    const version = prepNow(at([dayRole({ internalRateDay: 640, internalRate: 80 })]), 8);
    const now = at([dayRole()]);
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, { [changeKey("roles", 5)]: ["internalRate"] }, { workdayHours: 8 });
    expect(out.roles[0]).toMatchObject({ internalRateDay: 640, internalRate: 80, externalRateDay: 1000, externalRate: 125 });
  });

  it("selecting only the day field restores the derived hourly with it, at the current workday hours", () => {
    const version = prepNow(at([dayRole({ externalRateDay: 900, externalRate: 112.5 })]), 7.5);
    const now = at([materializeRoleRates(dayRole(), 7.5)]);
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, { [changeKey("roles", 5)]: ["externalRateDay"] }, { workdayHours: 7.5 });
    expect(out.roles[0]).toMatchObject({ externalRateDay: 900, externalRate: 120, internalRateDay: 800, internalRate: 106.67 });
  });

  it("an hour-basis role still restores one field alone", () => {
    const version = at([{ ...hourRole, internalRate: 90 }]);
    const now = at([hourRole]);
    const out = applyRestore(now, version, diffWorkspaces(version, now), { [changeKey("roles", 1)]: ["internalRate"] }, { workdayHours: 8 });
    expect(out.roles[0]).toMatchObject({ internalRate: 90, internalRateDay: 800 });
  });
});

// §476 A4 — a restore converts through every later switch IN ORDER, rounding at each step
// exactly as the successive switches did, so a value untouched since the version comes back
// to the cent. Expected values come from chaining the planner itself, not from hand arithmetic.
describe("restore conversion chains the switches (A4)", () => {
  const FX_GBP: FxRates = { base: "EUR", date: "2026-10-01", fetchedAt: "2026-10-01T08:00:00.000Z", rates: { GBP: 0.852 } };
  const FX_USD: FxRates = { base: "EUR", date: "2026-10-05", fetchedAt: "2026-10-05T08:00:00.000Z", rates: { GBP: 1, USD: 1.27 } };
  const odd: Role = { id: 9, disciplineId: 1, gradeId: 1, internalRate: 33.33, externalRate: 77.77, internalRateDay: 266.64, externalRateDay: 622.16 };
  const oddDay: Role = { id: 10, disciplineId: 1, gradeId: 1, rateBasis: "day", internalRateDay: 333.33, externalRateDay: 555.55, internalRate: 44.44, externalRate: 74.07 };
  const versionWs: Workspace = {
    ...emptyWorkspace(),
    plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
    roles: [odd, oddDay],
    budgets: [bucket({ rateOverrideInternal: 33.33 })],
    changes: [change({ costImpact: 333.33 })],
  };
  const s1 = plan({ from: "EUR", to: "GBP", sessionRates: FX_GBP, roles: versionWs.roles, buckets: versionWs.budgets, changes: versionWs.changes, workdayHours: 7.5, nowIso: "2026-10-02T08:00:00.000Z" })!;
  const s2 = plan({ from: "GBP", to: "USD", sessionRates: FX_USD, roles: s1.roles, buckets: s1.buckets, changes: s1.changes, workdayHours: 7.5, nowIso: "2026-10-06T08:00:00.000Z" })!;
  const history: BaselineEntry[] = [s1.entry, s2.entry];
  const live: Workspace = { ...versionWs, plan: { ...versionWs.plan, currency: "USD" }, roles: s2.roles, budgets: s2.buckets, changes: s2.changes };
  const prepared = prepareRestoredVersion(versionWs, { history, capturedAt: "2026-10-01T08:00:00.000Z", currency: "USD", workdayHours: 7.5 });

  it("uses rates whose single compound rounding would differ from the stepwise one (control)", () => {
    expect(s1.rate).toBe(0.852);
    expect(s2.rate).toBe(1.27);
    expect(round2(odd.internalRate * 0.852 * 1.27)).not.toBe(s2.roles[0].internalRate);
  });

  it("a record untouched since the pre-switch version shows no compare row", () => {
    expect(diffWorkspaces(prepared, live).filter((c) => ["roles", "budgets", "changes", "plan"].includes(c.collection))).toEqual([]);
  });

  it("restoring it writes the identical live values", () => {
    expect(prepared.roles).toEqual(live.roles);
    expect(prepared.budgets).toEqual(live.budgets);
    expect(prepared.changes).toEqual(live.changes);
  });
});

// §476 B2/B3 — the review's row-filter, missing-day-field and identity pins.
describe("planBaselineSwitch — rows and edge records (B2, B3)", () => {
  it("a value the rate leaves unchanged (zero) produces no row", () => {
    const zero: Role = { id: 11, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 140 };
    const p = plan({ roles: [zero], changes: [change({ costImpact: 0 })], buckets: [bucket({ rateOverrideInternal: 0 })] })!;
    expect(p.rows).toEqual([{ kind: "role", id: 11, label: "role-11", field: "externalRate", before: 140, after: 119.28 }]);
  });

  it("a change whose costImpact converts to the same value keeps its identity", () => {
    const zero = change({ costImpact: 0 });
    expect(plan({ changes: [zero] })!.changes[0]).toBe(zero);
  });

  // Ruling: a day-basis role missing one day field keeps that side's money. Its day rate is
  // derived from the CONVERTED hourly before re-materialising, so the side is neither zeroed
  // (what `materializeRoleRates` alone would do) nor left inconsistent.
  it("a day-basis role missing one day field converts that side from its hourly instead of zeroing it", () => {
    const partial: Role = { id: 12, disciplineId: 1, gradeId: 1, rateBasis: "day", internalRateDay: 800, internalRate: 100, externalRate: 150 };
    const p = plan({ roles: [partial] })!;
    expect(p.roles[0]).toMatchObject({ internalRateDay: 681.6, internalRate: 85.2, externalRateDay: 1022.4, externalRate: 127.8 });
    expect(p.rows).toContainEqual({ kind: "role", id: 12, label: "role-12", field: "externalRate", before: 150, after: 127.8 });
  });
});
