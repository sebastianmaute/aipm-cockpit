/**
 * Baseline-currency switch planner (§476). Pure, i18n-free. Converts every
 * stored money rate once by the cross rate, rounded to 2 decimals. Never touches
 * `fixedPriceAmount` or `fxRateOverride`.
 */
import { crossRate, rebaseFactor, type BaselineEntry } from "./baseline-currency";
import { materializeRoleRates, round2 } from "./role-rates";
import type { BudgetBucket, BudgetCurrency, ChangeItem, FxRates, Role } from "./types";
import type { Workspace } from "./workspace";

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

/** The money fields a switch converts — and a restore, from a version captured before one. */
export const ROLE_FIELDS = ["internalRate", "externalRate", "internalRateDay", "externalRateDay"] as const;
export const BUCKET_FIELDS = ["rateOverrideInternal", "rateOverrideExternal"] as const;

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

function convertChange(change: ChangeItem, rate: number): ChangeItem {
  return typeof change.costImpact === "number" ? { ...change, costImpact: round2(change.costImpact * rate) } : change;
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
    const next = convertChange(change, rate);
    if (typeof change.costImpact === "number" && typeof next.costImpact === "number" && next.costImpact !== change.costImpact) {
      rows.push({ kind: "change", id: change.id, label: change.title, field: "costImpact", before: change.costImpact, after: next.costImpact });
    }
    return next;
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
/**
 * §476 — make a VERSION safe to restore into the current denomination, BEFORE it is
 * diffed and merged (`useVersionHistory.restore`), so a whole-record and a per-field
 * restore both take converted values:
 *  - `plan.currency` is pinned to `currency`: a restore NEVER changes the currency;
 *    the guarded Budget-panel switch is the only way to do that. Every other plan
 *    field restores normally.
 *  - every money field the planner converts (`ROLE_FIELDS`, `BUCKET_FIELDS`, a
 *    change's `costImpact`) is multiplied by `rebaseFactor(history, capturedAt)` —
 *    every switch made since the version was captured — rounded to 2 decimals.
 *    A day-basis role re-derives its hourly rates from the converted day rates via
 *    `materializeRoleRates`, as the planner does, so restoring only its hourly
 *    field takes the hourly value consistent with the version's converted day rate.
 *  - `fixedPriceAmount` and `fxRateOverride` are never converted.
 * An unknown `capturedAt` converts nothing (factor 1) but still pins the currency.
 * Returns `version` itself when there is nothing to change.
 */
export function prepareRestoredVersion(
  version: Workspace,
  opts: { history: readonly BaselineEntry[]; capturedAt: string | null; currency: BudgetCurrency; workdayHours: number },
): Workspace {
  const factor = opts.capturedAt === null ? 1 : rebaseFactor(opts.history, opts.capturedAt);
  const plan = version.plan && version.plan.currency !== opts.currency ? { ...version.plan, currency: opts.currency } : version.plan;
  const pinned = plan === version.plan ? version : { ...version, plan };
  if (factor === 1) return pinned;
  return {
    ...pinned,
    roles: Array.isArray(version.roles) ? version.roles.map((r) => convertRole(r, factor, opts.workdayHours)) : version.roles,
    budgets: Array.isArray(version.budgets) ? version.budgets.map((b) => convertBucket(b, factor)) : version.budgets,
    changes: Array.isArray(version.changes) ? version.changes.map((c) => convertChange(c, factor)) : version.changes,
  };
}
