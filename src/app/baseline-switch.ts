/**
 * Baseline-currency switch planner (§476). Pure, i18n-free. Converts every
 * stored money rate once by the cross rate, rounded to 2 decimals. Never touches
 * `fixedPriceAmount` or `fxRateOverride`.
 */
import { crossRate, laterSwitchRates, type BaselineEntry } from "./baseline-currency";
import { materializeDayBasisRole, materializeRoleRates, round2 } from "./role-rates";
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
  /** The project day (`clock.today`, local to the project zone) the entry starts on —
   *  never `nowIso.slice(0, 10)`, which is the UTC day and is a day early after
   *  local midnight east of Greenwich. */
  today: string;
};

/** The money fields a switch converts — and a restore, from a version captured before one. */
export const ROLE_FIELDS = ["internalRate", "externalRate", "internalRateDay", "externalRateDay"] as const;
export const BUCKET_FIELDS = ["rateOverrideInternal", "rateOverrideExternal"] as const;

export function convertRole(role: Role, rate: number, workdayHours: number): Role {
  const next: Role = { ...role };
  for (const f of ROLE_FIELDS) {
    const v = role[f];
    if (typeof v === "number") next[f] = round2(v * rate);
  }
  // A day-basis role is re-derived; a side with no day rate keeps its CONVERTED hourly
  // rather than being zeroed (§476 B2) — the same rule the restore paths apply.
  if (role.rateBasis === "day") return materializeDayBasisRole(next, workdayHours);
  // An hour-basis role's HOURLY rate is authoritative: a stored day field is re-derived
  // from the converted hourly (the value the roles editor shows), never converted on its
  // own, which drifts by a cent. A day field the role does not carry stays absent.
  const derived = materializeRoleRates(next, workdayHours);
  const out: Role = { ...next };
  for (const f of ["internalRateDay", "externalRateDay"] as const) {
    if (typeof role[f] === "number") out[f] = derived[f];
  }
  return out;
}

export function convertBucket(bucket: BudgetBucket, rate: number): BudgetBucket {
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

/** A change whose `costImpact` is absent or converts to the same value keeps its identity, like a bucket. */
export function convertChange(change: ChangeItem, rate: number): ChangeItem {
  if (typeof change.costImpact !== "number") return change;
  const costImpact = round2(change.costImpact * rate);
  return costImpact === change.costImpact ? change : { ...change, costImpact };
}

export function planBaselineSwitch(input: PlanInput): BaselineSwitchPlan | null {
  const { from, to, sessionRates, workdayHours, roleLabel, nowIso, today } = input;
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
    entry: { from: today, at: nowIso, currency: to, perPrevious: rate },
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
 *    change's `costImpact`) is converted through every switch made since the
 *    version was captured (`laterSwitchRates`), ONE STEP AT A TIME with round2 and
 *    a day-basis re-derive at each step — exactly what the successive
 *    `planBaselineSwitch` calls did, so a value untouched since the version comes
 *    back to the cent (one compound factor rounded once drifts by 0.01, §476 A4).
 *  - a day-basis role's hourly rates are re-derived from its day rates at the
 *    CURRENT workday hours even when no switch intervened, so a compare against now
 *    shows no hourly row for an unchanged day rate, and `applyRestore` (which takes
 *    the pair together) writes a consistent pair (§476 A3).
 *  - `fixedPriceAmount` and `fxRateOverride` are never converted.
 * An unknown `capturedAt` converts nothing (no switch rates) but still pins the
 * currency and re-derives day-basis hourly rates.
 * Returns `version` itself when there is nothing to change.
 */
export function prepareRestoredVersion(
  version: Workspace,
  opts: { history: readonly BaselineEntry[]; capturedAt: string | null; currency: BudgetCurrency; workdayHours: number },
): Workspace {
  const rates = opts.capturedAt === null ? [] : laterSwitchRates(opts.history, opts.capturedAt);
  const plan = version.plan && version.plan.currency !== opts.currency ? { ...version.plan, currency: opts.currency } : version.plan;
  const pinned = plan === version.plan ? version : { ...version, plan };
  const wdh = opts.workdayHours;
  if (rates.length === 0) {
    if (!Array.isArray(version.roles)) return pinned;
    if (!version.roles.some((r) => r.rateBasis === "day")) return pinned;
    return { ...pinned, roles: version.roles.map((r) => materializeDayBasisRole(r, wdh)) };
  }
  const chain = <T>(x: T, step: (v: T, rate: number) => T): T => rates.reduce(step, x);
  return {
    ...pinned,
    roles: Array.isArray(version.roles) ? version.roles.map((r) => chain(r, (v, k) => convertRole(v, k, wdh))) : version.roles,
    budgets: Array.isArray(version.budgets) ? version.budgets.map((b) => chain(b, convertBucket)) : version.budgets,
    changes: Array.isArray(version.changes) ? version.changes.map((c) => chain(c, convertChange)) : version.changes,
  };
}
