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

/** The date half of a daily-roll key. SHAPE, never existence — `9999-99-99` is
 *  admitted deliberately.
 *  ★★ The point is to make `<` and `>` comparisons on the date lexicographically
 *  meaningful downstream, not to certify a date exists. `timelog-policy.ts`
 *  tracks a running min/max into `firstViolationDate`/`lastViolationDate` and
 *  the reconcile then compares those against a roll window with plain string
 *  comparison; a key like `"7|tomorrow"` orders against ISO dates arbitrarily
 *  and still reaches both bounds.
 *  ★★★ THIS IS A KEY RULE AND IS DELIBERATELY NOT A WINDOW RULE. The identical
 *  `^\d{4}-\d{2}-\d{2}$` shape is declared in several other modules — the
 *  nearest being the one `timelog-actuals-store.ts` gates its `dailyWindow` on —
 *  and each answers a DIFFERENT question: "is this key usable?" versus "is this
 *  stored window usable?" versus whatever its own caller is asking. Sharing one
 *  constant across them would couple decisions that are free to move apart. The
 *  store's own docstring argues the same split from the other side, explaining
 *  why validating keys is not its job.
 *  ★★ NO FILE LIST AND NO COUNT IS QUOTED, deliberately: an earlier revision
 *  named one arbitrary sibling as if it were the whole set, which was stale the
 *  moment another landed. Enumerate today's with
 *  `grep -rn "d{4}-.d{2}-.d{2}" src --include=*.ts --include=*.tsx | grep -v "\.test\."`
 *  — the hits include unanchored variants and this docstring itself.
 *  See open-followups §367. */
const KEY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The userId half. `dailyKey` is `${userId}|${date}` over a `number`, so the
 *  heads it can produce are optionally signed digit strings — for every id this
 *  app can hold.
 *  ★★ NOT FOR EVERY `number`, and the unqualified claim was here until
 *  2026-09-07: template interpolation is `String(n)`, which switches to
 *  exponential notation at 1e21, so `dailyKey(1e21, d)` emits `"1e+21|…"` and
 *  THIS REGEX REJECTS A KEY `dailyKey` ITSELF WROTE. Measured:
 *  `node -e 'console.log(String(1e21), /^-?\d+$/.test(String(1e21)))'` → `1e+21 false`.
 *  Unreachable in practice — a TimeLog `UserID` is a small positive integer, and
 *  the surrounding code drops `userId <= 0` before keying — so the guard stays
 *  as written; what is corrected is the ABSOLUTE claim, since a reader deriving
 *  "the regex can never reject our own output" from it would be wrong.
 *  ★★ `-?` IS LOAD-BEARING. `dailyKey(-7, d)` genuinely emits `"-7|…"`, so a
 *  bare `/^\d+$/` would start rejecting a key the app's own writer can make.
 *  With the sign, this still rejects everything `Number()` would have coerced
 *  and `dailyKey` cannot emit: `"0x10"` (→16), `"1e3"` (→1000), `"+7"` (→7),
 *  and — the one §367 is named for — a whitespace-PADDED head, since `Number()`
 *  strips leading and trailing whitespace before parsing. */
const KEY_USER_RE = /^-?\d+$/;

/** ★★★ THE TWO GUARDS BELOW CLOSE ONE HOLE TOGETHER AND NEITHER DOES ALONE — do
 *  not delete `Number.isInteger` on the grounds that the regex "already
 *  validates" the head. `KEY_USER_RE` admits a 600,000-DIGIT head quite happily;
 *  `Number()` of that is `Infinity`, and only `Number.isInteger` rejects it.
 *  Conversely the integer check alone admits a 600,000-SPACE PAD, because
 *  `Number()` strips leading and trailing whitespace: a padded `"       7"`
 *  reads as a clean `7`, and a head that is nothing BUT whitespace reads as `0`.
 *  With BOTH, a key caps at 309 digits (`Number` of 310 is `Infinity` —
 *  measured, since `MAX_VALUE` is 1.797e308 and the boundary depends on the
 *  leading digit) plus `|` plus the 10 characters `KEY_DATE_RE` allows, so 320 —
 *  or 321 with the leading `-` the rule three lines up calls load-bearing, which
 *  is the number to quote, since the worst case is the bound that matters. One
 *  cell can therefore no longer exceed `MAX_DAILY_ROLL_CHARS` on its own, which
 *  is the oversized-cell shape open-followups §367 is named for.
 *  ★ SHAPE BEFORE COERCION: both halves are tested against their rule before
 *  `Number()` is called, so a coercion this function does not want cannot
 *  happen at all rather than being unpicked afterwards. */
export function parseDailyKey(key: string): { userId: number; date: string } | null {
  const i = key.indexOf("|");
  if (i <= 0) return null;
  const head = key.slice(0, i);
  const date = key.slice(i + 1);
  if (!KEY_USER_RE.test(head) || !KEY_DATE_RE.test(date)) return null;
  const userId = Number(head);
  if (!Number.isInteger(userId)) return null;
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
