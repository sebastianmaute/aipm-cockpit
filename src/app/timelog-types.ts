// src/app/timelog-types.ts
// Pure, i18n-free type definitions for the Timelog integration.

/** A Timelog organisation user (from GET /v1/user → UserApiReadModel). */
export type TimelogUser = {
  userId: number;        // UserApiReadModel.UserID
  firstName: string;
  lastName: string;
  initials: string;
  email: string;
  isActive: boolean;
};

/** One time-tracking registration (from time-tracking-item endpoints). */
export type TimelogTimeItem = {
  timeRegistrationId: number;
  userId: number;
  projectId: number;
  projectName: string;
  projectNo: string;
  taskId: number;
  date: string;          // ISO "YYYY-MM-DD" (item.Date, date portion)
  hours: number;
  billableHours: number;
  isBillable: boolean;
};

/** Per-user/per-date financial aggregate (financial-data endpoint). */
export type TimelogFinancialDay = {
  userId: number;
  date: string;
  totalActualHour: number;
  totalBillableHour: number;
  totalBillableAmount: number;
  billableCurrency: string;
};

/** Durable mapping: Timelog user → app Resource. `manual` pins it against auto re-derive. */
export type TimelogUserLink = { timelogUserId: number; resourceId: number; manual: boolean };
/** Durable mapping: Timelog project → app budget bucket (null = explicitly unmapped). */
export type TimelogProjectLink = { timelogProjectId: number; bucketId: number | null; manual: boolean };
/** Per-project blob persisted on the Workspace (mirror SteeringCommittee).
 *  `customerId` is the TimeLog CustomerID the booking fetch is scoped to
 *  (positive int; absent = unscoped / whole-org per-user fetch). `projectIds`
 *  are the specific TimeLog projects of that customer the user picked to fetch
 *  (positive ints; absent/empty = none selected yet). */
export type TimelogLinks = {
  userLinks: TimelogUserLink[];
  projectLinks: TimelogProjectLink[];
  customerId?: number;
  projectIds?: number[];
  /** Guardrail policy. Absent when no rule is configured — see
   *  `sanitizeTimelogLinks`, which drops the key to keep the blob byte-stable. */
  policy?: TimelogPolicy;
};

/** The four guardrail rules. These literals are ALSO the four guardrail
 *  `InsightType` members — deliberately identical, so no rule→type lookup
 *  table exists to drift. `timelog-policy.test.ts` pins the identity. */
export type TimelogRuleId =
  | "timelogCapPerEntry"
  | "timelogCapPerDay"
  | "timelogNonWorkingDay"
  | "timelogWorkingHours";

export const TIMELOG_RULE_IDS: readonly TimelogRuleId[] = [
  "timelogCapPerEntry",
  "timelogCapPerDay",
  "timelogNonWorkingDay",
  "timelogWorkingHours",
];

/** `threshold` is hours. Absent on the two rules that compare against the
 *  shift rather than a number. */
export type TimelogRulePolicy = { enabled: boolean; threshold?: number };

/** Partial by construction: an unconfigured rule has NO key, which is what
 *  keeps an unconfigured blob byte-stable. */
export type TimelogPolicy = Partial<Record<TimelogRuleId, TimelogRulePolicy>>;

/** One (user, date) cell of the daily roll.
 *  ★ `maxEntryHours` is the whole reason this is a roll and not a sum: a daily
 *  total cannot distinguish one 18h entry from three 6h ones, and
 *  `timelogCapPerEntry` is exactly that distinction. */
export type TimelogDailyCell = {
  hours: number;
  maxEntryHours: number;
  entryCount: number;
};

/** Keyed by `dailyKey(userId, date)`. Sparse — only days carrying bookings. */
export type TimelogDailyRoll = Record<string, TimelogDailyCell>;

/** ★★ The shape BOTH the cache ingress and the policy engine require, and it
 *  lives here — a leaf with no imports — precisely so the two share ONE rule.
 *  `timelog-actuals-store.ts` applies it per cell on load (`withCheckedDaily`)
 *  and re-exports it; `timelog-policy.ts` applies it again in its own loop,
 *  because its `daily` parameter is typed `TimelogDailyRoll | null` and a TYPE
 *  is a promise the caller makes, not one the engine can verify. A duplicate
 *  predicate in the engine would be a second rule free to drift from this one.
 *  ★★ The policy engine reads `cell.hours` / `cell.maxEntryHours` inside a
 *  debounced effect with no try/catch, so a `null` cell reaching it is an
 *  UNCAUGHT throw that kills the whole insights reconcile — not a bad number.
 *  ★★ SHAPE, not sense: the three fields are checked for being finite numbers,
 *  never for being plausible ones, so a negative or absurd `hours` still
 *  reaches the rules.
 *  ★★★ THE `Number.isFinite` STRICTNESS IS NOT PINNABLE THROUGH THE STORE, and
 *  that is a statement about REACHABILITY, not a preference. `JSON.parse` is
 *  that store's sole ingress (`readDeviceJson`) and JSON has no `NaN` or
 *  `Infinity` literal, so no non-finite field can arrive through
 *  `loadActualsCache` — `JSON.stringify` writes both as `null` on the way out
 *  too. A test driving the store therefore CANNOT tell `Number.isFinite(x)`
 *  from `typeof x === "number"`: the string case does not separate them either
 *  (`typeof "8" === "number"` is false, so the weaker check drops it too), and
 *  a mutation proof run through the store reports that guard as vacuous. The
 *  strictness is kept for the ingress the store does not have yet — a
 *  structured-clone cache, an in-memory hand-off, a caller passing a computed
 *  roll straight to `saveActualsCache` or to `evaluateTimelogPolicy` — where
 *  non-finite IS expressible. */
export function isDailyCell(v: unknown): v is TimelogDailyCell {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const c = v as TimelogDailyCell;
  // ★ `Number.isFinite`, never the global `isFinite`: the global COERCES, so
  // it reads a stored `"8"` as a number and lets a string reach the rules,
  // where it propagates into the rendered violation text instead of throwing.
  return Number.isFinite(c.hours) && Number.isFinite(c.maxEntryHours) && Number.isFinite(c.entryCount);
}

export function dailyKey(userId: number, date: string): string {
  return `${userId}|${date}`;
}

export function parseDailyKey(key: string): { userId: number; date: string } | null {
  const i = key.indexOf("|");
  if (i <= 0) return null;
  const userId = Number(key.slice(0, i));
  const date = key.slice(i + 1);
  if (!Number.isInteger(userId) || !date) return null;
  return { userId, date };
}

export type TimelogScopeMode = "auto" | "self" | "org";

/** Per-device connection config (mirror JiraConfig). Lives at settings.timelog (TOP-LEVEL). */
export type TimelogConfig = {
  enabled: boolean;
  host: string;     // e.g. "app2.timelog.com"
  tenant: string;   // e.g. "Acme"
  email: string;    // identifying, plaintext
  apiToken: string; // sealed secret; blanked on disk by writeSettings
  scopeMode: TimelogScopeMode;
  /** ISO timestamp set on a 401/403; cleared on next success. Drives the reactive "rejected" state. */
  tokenInvalidAt?: string;
};

export const defaultTimelogConfig: TimelogConfig = {
  enabled: false,
  host: "app2.timelog.com",
  tenant: "Acme",
  email: "",
  apiToken: "",
  scopeMode: "auto",
};
