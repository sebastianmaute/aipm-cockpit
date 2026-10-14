/**
 * Baseline-currency switch planner (§476). Pure, i18n-free. Converts every
 * stored money rate once by the cross rate, rounded to 2 decimals. Never touches
 * `fixedPriceAmount` or `fxRateOverride`.
 */
import { crossRate, type BaselineEntry } from "./baseline-currency";
import { materializeRoleRates } from "./role-rates";
import type { BudgetBucket, BudgetCurrency, ChangeItem, FxRates, Role } from "./types";

export type SwitchRow = {
  kind: "role" | "bucket" | "change";
  id: number | string;
  label: string;
  field: string;
  before: number;
  after: number;
};

export type BaselineSwitchPlan = {
  from: BudgetCurrency;
  to: BudgetCurrency;
  rate: number;
  fxDate: string;
  roles: Role[];
  buckets: BudgetBucket[];
  changes: ChangeItem[];
  entry: BaselineEntry;
  rows: SwitchRow[];
};

type PlanInput = {
  from: BudgetCurrency;
  to: BudgetCurrency;
  sessionRates: FxRates;
  roles: readonly Role[];
  buckets: readonly BudgetBucket[];
  changes: readonly ChangeItem[];
  workdayHours: number;
  roleLabel: (r: Role) => string;
  nowIso: string;
};

const ROLE_FIELDS = ["internalRate", "externalRate", "internalRateDay", "externalRateDay"] as const;
const BUCKET_FIELDS = ["rateOverrideInternal", "rateOverrideExternal"] as const;

// Same definition as role-rates.ts (not exported there).
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function convertRole(role: Role, rate: number, workdayHours: number): Role {
  const next: Role = { ...role };
  for (const f of ROLE_FIELDS) {
    const v = role[f];
    if (typeof v === "number") next[f] = round2(v * rate);
  }
  return role.rateBasis === "day" ? materializeRoleRates(next, workdayHours) : next;
}

function convertBucket(bucket: BudgetBucket, rate: number): BudgetBucket {
  const next: BudgetBucket = { ...bucket };
  let changed = false;
  for (const f of BUCKET_FIELDS) {
    const v = bucket[f];
    if (typeof v === "number") {
      next[f] = round2(v * rate);
      changed = true;
    }
  }
  return changed ? next : bucket;
}

export function planBaselineSwitch(input: PlanInput): BaselineSwitchPlan | null {
  const { from, to, sessionRates, workdayHours, roleLabel, nowIso } = input;
  if (from === to) return null;
  const rate = crossRate(sessionRates, from, to);
  if (rate === null) return null;

  const rows: SwitchRow[] = [];

  const roles = input.roles.map((role) => {
    const next = convertRole(role, rate, workdayHours);
    for (const f of ROLE_FIELDS) {
      const before = role[f];
      const after = next[f];
      if (typeof before === "number" && typeof after === "number" && before !== after) {
        rows.push({ kind: "role", id: role.id, label: roleLabel(role), field: f, before, after });
      }
    }
    return next;
  });

  const buckets = input.buckets.map((bucket) => {
    const next = convertBucket(bucket, rate);
    for (const f of BUCKET_FIELDS) {
      const before = bucket[f];
      const after = next[f];
      if (typeof before === "number" && typeof after === "number" && before !== after) {
        rows.push({ kind: "bucket", id: bucket.id, label: bucket.name, field: f, before, after });
      }
    }
    return next;
  });

  const changes = input.changes.map((change) => {
    if (typeof change.costImpact !== "number") return change;
    const after = round2(change.costImpact * rate);
    if (after !== change.costImpact) {
      rows.push({ kind: "change", id: change.id, label: change.title, field: "costImpact", before: change.costImpact, after });
    }
    return { ...change, costImpact: after };
  });

  return {
    from,
    to,
    rate,
    fxDate: sessionRates.date,
    roles,
    buckets,
    changes,
    entry: { from: nowIso.slice(0, 10), at: nowIso, currency: to, perPrevious: rate },
    rows,
  };
}
