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
