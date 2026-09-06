// src/app/sanitize-entities.ts — per-entity object sanitizers (Absence, Shift,
// Resource, Budget, Milestone, Change, RAID, Stakeholder, ProjectMeta, ...).
// Built on the primitives in sanitize-core.ts; re-exported via sanitize.ts.
import {
  ABSENCE_TYPES,
  type Absence,
  type AbsenceType,
  DEFAULT_WEEK_HOURS,
  MAX_HOURS_PER_DAY,
  type PlanGranularity,
  type ResourcePlan,
  type Shift,
  type WeekHours,
  type Resource,
  type Role,
  type Discipline,
  type Grade,
  type UtilizationMode,
  type BudgetBucket,
  type BucketAllocation,
  type DisciplineAllocation,
  type BudgetType,
  type BucketStatus,
  type FxRates,
  BUDGET_TYPES,
  PLANNING_MODES,
  type PlanningMode,
  SUPPORTED_CURRENCIES,
  isBudgetCurrency,
} from "./types";

import {
  defaultResourcePlan,
  splitName,
} from "./resource-foundation";

import {
  TEXTAREA_MAX,
  GROUP_MAX,
  toNumber,
  sanitizeText,
  sanitizeMultiline,
  sanitizeAssignee,
  sanitizeEmail,
  sanitizeNotes,
  sanitizeIsoDate,
  fkIdOrUndefined,
  isPlainObject,
} from "./sanitize-core";

// --- Absence sanitizers ----------------------------------------------------

const ABSENCE_TYPE_SET: ReadonlySet<AbsenceType> = new Set(ABSENCE_TYPES);

/** Returns the input if it is a valid AbsenceType; otherwise falls back to
 *  "other" so hand-edited files and chat tools can't break the union. */
function sanitizeAbsenceType(s: unknown): AbsenceType {
  if (typeof s === "string" && ABSENCE_TYPE_SET.has(s as AbsenceType)) {
    return s as AbsenceType;
  }
  return "other";
}

function sanitizeAbsenceNote(s: unknown): string {
  return sanitizeMultiline(s, TEXTAREA_MAX);
}

/**
 * Full-record sanitizer for inbound Absence data (file imports, chat tool
 * calls). Drops obviously bad input and clamps fields. Returns null when
 * the record is unrecoverable (missing id, assignee, or dates).
 */
export function sanitizeAbsence(input: unknown): Absence | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<Record<keyof Absence, unknown>>;
  const id = toNumber(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const assignee = sanitizeAssignee(raw.assignee);
  if (!assignee) return null;
  const startDate = sanitizeIsoDate(raw.startDate);
  const endDate = sanitizeIsoDate(raw.endDate);
  if (!startDate || !endDate) return null;
  // Defensive: swap if reversed rather than rejecting.
  const [start, end] =
    endDate < startDate ? [endDate, startDate] : [startDate, endDate];
  return {
    id,
    assignee,
    assigneeEmail:
      typeof raw.assigneeEmail === "string"
        ? sanitizeEmail(raw.assigneeEmail) || undefined
        : undefined,
    startDate: start,
    endDate: end,
    type: sanitizeAbsenceType(raw.type),
    note: sanitizeAbsenceNote(raw.note) || undefined,
    // `|| undefined`, not a bare typeof check: every CSV/MD cell decodes to a
    // real "" rather than undefined, so the typeof form kept the empty string
    // as a value. Same form calendar-event.ts uses.
    localModifiedAt: sanitizeText(raw.localModifiedAt, 1024) || undefined,
    resourceId: fkIdOrUndefined(raw.resourceId),
    outlookEventId: sanitizeText(raw.outlookEventId, 1024) || undefined,
  };
}

// --- Shift sanitizers ------------------------------------------------------

function clampHour(n: unknown): number {
  const num = toNumber(n);
  if (!Number.isFinite(num) || num < 0) return 0;
  if (num > MAX_HOURS_PER_DAY) return MAX_HOURS_PER_DAY;
  // Round to one decimal so spreadsheets don't introduce floating-point noise.
  return Math.round(num * 10) / 10;
}

/**
 * Returns a length-7 WeekHours from `input`. Accepts an array, a pipe-joined
 * string ("0|8|8|8|8|8|0"), or an object indexed by weekday name. Missing or
 * malformed entries fall back to DEFAULT_WEEK_HOURS for that day.
 */
function sanitizeShiftHours(input: unknown): WeekHours {
  let arr: unknown[] | null = null;
  if (Array.isArray(input)) {
    arr = input;
  } else if (typeof input === "string") {
    arr = input.split("|");
  } else if (isPlainObject(input)) {
    const obj = input;
    arr = [
      obj.sun ?? obj.sunday,
      obj.mon ?? obj.monday,
      obj.tue ?? obj.tuesday,
      obj.wed ?? obj.wednesday,
      obj.thu ?? obj.thursday,
      obj.fri ?? obj.friday,
      obj.sat ?? obj.saturday,
    ];
  }
  if (!arr) return DEFAULT_WEEK_HOURS;
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(arr[i] === undefined || arr[i] === "" ? DEFAULT_WEEK_HOURS[i] : clampHour(arr[i]));
  }
  return out as unknown as WeekHours;
}

/**
 * Full-record sanitizer for inbound Shift data (file imports, chat tool
 * calls). Drops obviously bad input and clamps fields. Returns null when
 * the record is unrecoverable (missing id or assignee).
 */
export function sanitizeShift(input: unknown): Shift | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<Record<keyof Shift, unknown>> &
    Record<string, unknown>;
  const id = toNumber(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const assignee = sanitizeAssignee(raw.assignee);
  if (!assignee) return null;
  // Accept either a single `hoursPerWeekday` field or 7 individual fields.
  const hoursInput =
    raw.hoursPerWeekday !== undefined
      ? raw.hoursPerWeekday
      : {
          sun: raw.sunHours ?? raw.sun,
          mon: raw.monHours ?? raw.mon,
          tue: raw.tueHours ?? raw.tue,
          wed: raw.wedHours ?? raw.wed,
          thu: raw.thuHours ?? raw.thu,
          fri: raw.friHours ?? raw.fri,
          sat: raw.satHours ?? raw.sat,
        };
  const hoursPerWeekday = sanitizeShiftHours(hoursInput);
  return {
    id,
    assignee,
    assigneeEmail:
      typeof raw.assigneeEmail === "string"
        ? sanitizeEmail(raw.assigneeEmail) || undefined
        : undefined,
    hoursPerWeekday,
    note: sanitizeNotes(raw.note) || undefined,
    resourceId: fkIdOrUndefined(raw.resourceId),
    // See sanitizeAbsence above — an empty cell must not become a value.
    localModifiedAt: sanitizeText(raw.localModifiedAt, 1024) || undefined,
  };
}

// --- Resource Planner v2 sanitizers ----------------------------------------

const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2]|W[0-4]\d|W5[0-3])$/;
/** Per-period hours ceiling. Exported so the AI allocation planner clamps to the
 *  SAME bound the load-path sanitizer enforces — otherwise a confirmed value
 *  above it is silently trimmed on the next load and what the user approved is
 *  not what persists. */
export const HOURS_MAP_MAX = 1000;

/** Encode a periodKey->number map to "k=v|k=v" (CSV/MD-safe). */
export function encodePeriodMap(map: Record<string, number> | undefined): string {
  if (!map) return "";
  return Object.entries(map)
    .filter(([k, v]) => PERIOD_KEY_RE.test(k) && Number.isFinite(v))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
}

/** Decode "k=v|k=v" back to a map; drops malformed keys/values. */
export function decodePeriodMap(s: unknown): Record<string, number> {
  if (typeof s !== "string" || !s) return {};
  const out: Record<string, number> = {};
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = Number(part.slice(eq + 1).trim());
    if (PERIOD_KEY_RE.test(key) && Number.isFinite(val)) out[key] = val;
  }
  return out;
}

/** Coerce a map input (object OR encoded string) into a clamped number map. */
function coercePeriodMap(input: unknown, clampMax: number): Record<string, number> {
  const raw = typeof input === "string" ? decodePeriodMap(input) : isPlainObject(input) ? input : {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!PERIOD_KEY_RE.test(k)) continue;
    const n = toNumber(v);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.min(clampMax, Math.max(0, n));
  }
  return out;
}

function sanitizeUtilizationMode(s: unknown): UtilizationMode {
  return s === "hours" ? "hours" : "percent";
}

/** `Resource.isExternal`'s decode rule: `true` for the JSON boolean and for the
 *  string "true" the CSV/MD backends serialize it as, `false` for anything else.
 *
 *  ★★ THE FLAG IS STORED PRESENT-OR-ABSENT — `sanitizeResource` sets the key
 *  ONLY when this returns true, so an internal resource carries no `isExternal`
 *  key at all. Anything comparing a stored row's raw field against a candidate
 *  value must run BOTH sides through here, or an absent flag (`undefined`)
 *  reads as different from an incoming `false` and a no-op looks like a change.
 *
 *  ★ EXPORTED for the inline-AI-edit preview, which has to reproduce exactly
 *  this predicate to show what Apply will store. It is the only BOOLEAN field
 *  any entity's `diffFields` names — NOT the only non-string one, which is what
 *  this said until a cold review enumerated all 58 `diffFields` against their
 *  declared types. There are THREE non-string mechanisms, not one: four numeric
 *  fields (`raid.probability`/`impact`, `change.scheduleImpactDays`/`costImpact`)
 *  handled by `numberFields`, one array field (`task.labels`) handled by
 *  `arrayFields`, and this flag. Naming only the numerics — which a first
 *  correction did — makes the array field look like it has no home. */
export function isExternalFlag(v: unknown): boolean {
  return v === true || v === "true";
}

/** `sanitizeResource`'s optional SINGLE-LINE text path: trim, and `undefined`
 *  for a non-string or an all-whitespace value. There is NO cap here — every
 *  `if (x) resource.x = x` call site below drops the key when this returns
 *  undefined, which on an update spread over the stored row CLEARS the field.
 *
 *  ★ EXPORTED so the inline-AI-edit preview can call the very function apply
 *  calls, instead of restating "trim, no cap" in a second place. That restating
 *  is what §373's first cut did with `sanitizeText`'s rules, and the copy
 *  diverged on the surrogate back-off within one commit. */
export function optText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s || undefined;
}

/** `sanitizeResource`'s optional MULTI-LINE text path (`notes`). Same contract
 *  as `optText` plus CRLF→LF normalisation — which is a real divergence a bare
 *  trim does not reproduce, and the reason a preview must call this rather than
 *  approximate it. Exported for the same reason as `optText`. */
export function optMultiline(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\r\n/g, "\n").trim();
  return s || undefined;
}

/** Canonical birthday pattern: "MM-DD" (no year) or "YYYY-MM-DD". Month 01–12,
 *  day 01–31. Feb 29 is intentionally allowed — birthdays are matched month-day
 *  only, so the year (when present) is informational. Kept stricter than
 *  `birthdayMonthDay` in birthdays.ts (which only extracts), so every value
 *  stored here is extractable there. */
const BIRTHDAY_RE = /^(?:\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Validate a birthday string ("MM-DD" or "YYYY-MM-DD"); returns it trimmed, or
 *  undefined when malformed. The authoritative birthday validator — both
 *  `sanitizeResource` and external callers should go through this. */
export function sanitizeBirthday(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return BIRTHDAY_RE.test(s) ? s : undefined;
}

export function sanitizeResource(input: unknown): Resource | null {
  if (!isPlainObject(input)) return null;
  const id = toNumber(input.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  // Prefer explicit firstName/lastName; fall back to splitting a legacy `name`.
  let firstName = sanitizeAssignee(input.firstName) ?? "";
  let lastName = sanitizeAssignee(input.lastName) ?? "";
  if (!firstName && !lastName && typeof input.name === "string") {
    const split = splitName(input.name);
    firstName = split.firstName;
    lastName = split.lastName;
  }
  if (!firstName && !lastName) return null;

  const mode = sanitizeUtilizationMode(input.utilizationMode);
  const roleIdNum = toNumber(input.roleId);
  const roleId = Number.isFinite(roleIdNum) && roleIdNum > 0 ? roleIdNum : null;
  const utilization = coercePeriodMap(input.utilization, mode === "percent" ? 100 : HOURS_MAP_MAX);
  const overrideRaw = coercePeriodMap(input.absenceOverride, HOURS_MAP_MAX);

  const resource: Resource = {
    id,
    firstName,
    lastName,
    roleId,
    utilizationMode: mode,
    utilization,
  };
  const email = typeof input.email === "string" ? sanitizeEmail(input.email) || undefined : undefined;
  if (email) resource.email = email;
  const emails = sanitizeEmailList(input.emails, email);
  if (emails.length > 0) resource.emails = emails;
  const title = optText(input.title); if (title) resource.title = title;
  const phone = optText(input.businessPhone); if (phone) resource.businessPhone = phone;
  const location = optText(input.location); if (location) resource.location = location;
  const department = optText(input.department); if (department) resource.department = department;
  const company = optText(input.company); if (company) resource.company = company;
  const birthday = sanitizeBirthday(input.birthday);
  if (birthday) resource.birthday = birthday;
  const notes = optMultiline(input.notes); if (notes) resource.notes = notes;
  if (Object.keys(overrideRaw).length > 0) resource.absenceOverride = overrideRaw;
  // CSV/MD serialize `active` as the string "false"; JSON keeps the boolean.
  // Accept both so the soft-archive flag round-trips through every backend.
  if (input.active === false || input.active === "false") resource.active = false;
  // External: serialized as the string "true" in CSV/MD; boolean in JSON.
  if (isExternalFlag(input.isExternal)) resource.isExternal = true;
  if (typeof input.localModifiedAt === "string" && input.localModifiedAt) resource.localModifiedAt = input.localModifiedAt;
  return resource;
}

/** Max additional email addresses stored per resource. */
const RESOURCE_EMAILS_MAX = 10;

/** Sanitize a resource's additional emails from a JSON array or a delimited
 *  CSV/MD string. Trims + length-caps each (via sanitizeEmail — NO format
 *  validation, matching the primary `email` field), drops blanks,
 *  case-insensitive dupes, and any equal to the primary email; caps the list.
 *
 *  ★★ EXPORTED FOR THE AI EDIT PREVIEW, which must call this rather than
 *   approximate it (`INLINE_DESCRIPTORS.resource.fieldSanitizers.emails`) —
 *   the descriptor's standing rule is delegate, never restate. ★★ THAT CALLER
 *   PASSES THE MERGED ROW'S `email` SINCE §397 and no longer `undefined`: a
 *   `fieldSanitizers` entry used to receive the FIELD's value alone, so the
 *   preview kept an extra equal to the primary that this function drops, and at
 *   RESOURCE_EMAILS_MAX the two disagreed about which address landed tenth.
 *   Entries now take the row as a second argument. MERGED, not stored — an
 *   `update_resource` may change the primary in the same call. */
export function sanitizeEmailList(input: unknown, primary: string | undefined): string[] {
  let raw: unknown[];
  if (Array.isArray(input)) raw = input;
  else if (typeof input === "string") raw = input.split(/[;,]/);
  else return [];
  const out: string[] = [];
  const seen = new Set<string>();
  if (primary) seen.add(primary.toLowerCase());
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const clean = sanitizeEmail(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= RESOURCE_EMAILS_MAX) break;
  }
  return out;
}

function sanitizeRate(n: unknown): number {
  const num = toNumber(n);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

export function sanitizeRole(input: unknown): Role | null {
  if (!isPlainObject(input)) return null;
  const id = toNumber(input.id);
  const disciplineId = toNumber(input.disciplineId);
  const gradeId = toNumber(input.gradeId);
  if (![id, disciplineId, gradeId].every((n) => Number.isFinite(n) && n > 0)) return null;
  const role: Role = {
    id,
    disciplineId,
    gradeId,
    internalRate: sanitizeRate(input.internalRate),
    externalRate: sanitizeRate(input.externalRate),
  };
  // Which unit the user edits. Sparse-emit "day" only; absent/unknown/"hour" ⇒
  // omit the key so legacy hour-basis roles stay byte-identical (consumers read
  // `role.rateBasis ?? "hour"`). No cross-derive here: workdayHours is not
  // available at load; the editor materializes on edit.
  if (input.rateBasis === "day") role.rateBasis = "day";
  // Sparse-emit day rates only when present so blobs stay minimal for legacy
  // (hour-basis) roles. The CSV/MD named columns always exist regardless.
  if (input.internalRateDay !== undefined && input.internalRateDay !== null && input.internalRateDay !== "") {
    role.internalRateDay = sanitizeRate(input.internalRateDay);
  }
  if (input.externalRateDay !== undefined && input.externalRateDay !== null && input.externalRateDay !== "") {
    role.externalRateDay = sanitizeRate(input.externalRateDay);
  }
  if (input.order !== undefined && input.order !== null && input.order !== "") {
    const orderNum = toNumber(input.order);
    if (Number.isFinite(orderNum) && orderNum >= 0) role.order = orderNum;
  }
  if (typeof input.localModifiedAt === "string" && input.localModifiedAt) role.localModifiedAt = input.localModifiedAt;
  return role;
}

function sanitizeNamedRef<T extends { id: number; name: string; localModifiedAt?: string }>(
  input: unknown,
): T | null {
  if (!isPlainObject(input)) return null;
  const id = toNumber(input.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(input.name, GROUP_MAX);
  if (!name) return null;
  const ref = { id, name } as T;
  if (typeof input.localModifiedAt === "string" && input.localModifiedAt) ref.localModifiedAt = input.localModifiedAt;
  return ref;
}

export function sanitizeDiscipline(input: unknown): Discipline | null {
  return sanitizeNamedRef<Discipline>(input);
}

export function sanitizeGrade(input: unknown): Grade | null {
  return sanitizeNamedRef<Grade>(input);
}

// --- Plan sanitizer --------------------------------------------------------

/**
 * Validates and normalises a raw plan object (from any load path: JSON, CSV,
 * or Markdown). Accepts `unknown` so all three paths can share one guard.
 *
 * Rules:
 *   - granularity: "week" passes through; anything else becomes "month".
 *   - currency: any non-empty trimmed string is preserved; missing → DEFAULT (EUR).
 *   - startDate / endDate: if either is missing or malformed, the entire date
 *     window is replaced by the default window (today … +11 months) while
 *     granularity and currency are still honored.
 *   - Swaps start/end when reversed.
 */
export function sanitizePlan(input: unknown, today: string): ResourcePlan {
  const fallback = defaultResourcePlan(today);
  const raw = isPlainObject(input) ? input : {};
  const startDate = sanitizeIsoDate(raw.startDate);
  const endDate = sanitizeIsoDate(raw.endDate);
  const granularity: PlanGranularity = raw.granularity === "week" ? "week" : "month";
  const currency = typeof raw.currency === "string" && raw.currency.trim() ? raw.currency.trim() : fallback.currency;
  const budgetFollowsPlan = raw.budgetFollowsPlan === true || raw.budgetFollowsPlan === "true";
  if (!startDate || !endDate) {
    return { startDate: fallback.startDate, endDate: fallback.endDate, granularity, currency, ...(budgetFollowsPlan ? { budgetFollowsPlan: true } : {}) };
  }
  const [s, e] = endDate < startDate ? [endDate, startDate] : [startDate, endDate];
  return { startDate: s, endDate: e, granularity, currency, ...(budgetFollowsPlan ? { budgetFollowsPlan: true } : {}) };
}

// --- Budget planner sanitizers ---------------------------------------------

export const BUDGET_NAME_MAX = 200;
export const PO_NUMBER_MAX = 64;
export const AMOUNT_MAX = 1_000_000_000;
const BUDGET_TYPE_SET: ReadonlySet<BudgetType> = new Set(BUDGET_TYPES);

function sanitizeAmount(n: unknown): number | undefined {
  if (typeof n === "string" && n.trim() === "") return undefined; // empty CSV/MD cell = absent, not 0
  const num = toNumber(n);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.min(AMOUNT_MAX, Math.round(num * 100) / 100);
}

function sanitizePercentComplete(n: unknown): number | undefined {
  if (typeof n === "string" && n.trim() === "") return undefined; // empty CSV/MD cell = absent, not 0
  const num = toNumber(n);
  if (!Number.isFinite(num)) return undefined;
  return Math.min(100, Math.max(0, num));
}

export function sanitizeIdList(input: unknown): number[] {
  let arr: unknown[];
  if (Array.isArray(input)) arr = input;
  // "." separates a resourceIds cell nested inside an allocation (roleId;resourceIds;...);
  // ";" separates a bare top-level id-list column (e.g. BudgetBucket.taskIds).
  else if (typeof input === "string") arr = input.split(/[.;]/);
  else return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of arr) {
    const n = typeof item === "string" ? Number(item.trim()) : toNumber(item);
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

// Allocation text encoding (CSV/MD-safe). One allocation =
//   roleId ; resourceIds(.-joined) ; budgetHours(periodmap) ; actualHours(periodmap)
// Allocations joined by "~". Period maps reuse encode/decodePeriodMap ("k=v|k=v").
export function encodeAllocations(allocs: readonly BucketAllocation[] | undefined): string {
  if (!Array.isArray(allocs) || allocs.length === 0) return "";
  return allocs
    .map((a) =>
      [a.roleId, a.resourceIds.join("."), encodePeriodMap(a.budgetHours), encodePeriodMap(a.actualHours)].join(";"),
    )
    .join("~");
}

export function decodeAllocations(s: unknown): BucketAllocation[] {
  if (typeof s !== "string" || !s) return [];
  const out: BucketAllocation[] = [];
  for (const part of s.split("~")) {
    if (!part.trim()) continue;
    const [roleIdStr = "", idsStr = "", budgetStr = "", actualStr = ""] = part.split(";");
    const roleId = Number(roleIdStr);
    if (!Number.isFinite(roleId) || roleId <= 0) continue;
    out.push({
      roleId,
      resourceIds: sanitizeIdList(idsStr),
      budgetHours: decodePeriodMap(budgetStr),
      actualHours: decodePeriodMap(actualStr),
    });
  }
  return out;
}

function sanitizeAllocation(input: unknown): BucketAllocation | null {
  if (!isPlainObject(input)) return null;
  const roleId = toNumber(input.roleId);
  if (!Number.isFinite(roleId) || roleId <= 0) return null;
  return {
    roleId,
    resourceIds: sanitizeIdList(input.resourceIds),
    budgetHours: coercePeriodMap(input.budgetHours, HOURS_MAP_MAX),
    actualHours: coercePeriodMap(input.actualHours, HOURS_MAP_MAX),
  };
}

function sanitizeAllocations(input: unknown): BucketAllocation[] {
  if (typeof input === "string") return decodeAllocations(input);
  if (!Array.isArray(input)) return [];
  return input.map(sanitizeAllocation).filter((a): a is BucketAllocation => a !== null);
}

// Discipline-allocation text encoding (blended mode). Mirrors encodeAllocations
// but keyed by disciplineId. One allocation =
//   disciplineId ; resourceIds(.-joined) ; budgetHours(periodmap) ; actualHours(periodmap)
export function encodeDisciplineAllocations(allocs: readonly DisciplineAllocation[] | undefined): string {
  if (!Array.isArray(allocs) || allocs.length === 0) return "";
  return allocs
    .map((a) =>
      [a.disciplineId, a.resourceIds.join("."), encodePeriodMap(a.budgetHours), encodePeriodMap(a.actualHours)].join(";"),
    )
    .join("~");
}

export function decodeDisciplineAllocations(s: unknown): DisciplineAllocation[] {
  if (typeof s !== "string" || !s) return [];
  const out: DisciplineAllocation[] = [];
  for (const part of s.split("~")) {
    if (!part.trim()) continue;
    const [idStr = "", idsStr = "", budgetStr = "", actualStr = ""] = part.split(";");
    const disciplineId = Number(idStr);
    if (!Number.isFinite(disciplineId) || disciplineId <= 0) continue;
    out.push({
      disciplineId,
      resourceIds: sanitizeIdList(idsStr),
      budgetHours: decodePeriodMap(budgetStr),
      actualHours: decodePeriodMap(actualStr),
    });
  }
  return out;
}

function sanitizeDisciplineAllocation(input: unknown): DisciplineAllocation | null {
  if (!isPlainObject(input)) return null;
  const disciplineId = toNumber(input.disciplineId);
  if (!Number.isFinite(disciplineId) || disciplineId <= 0) return null;
  return {
    disciplineId,
    resourceIds: sanitizeIdList(input.resourceIds),
    budgetHours: coercePeriodMap(input.budgetHours, HOURS_MAP_MAX),
    actualHours: coercePeriodMap(input.actualHours, HOURS_MAP_MAX),
  };
}

function sanitizeDisciplineAllocations(input: unknown): DisciplineAllocation[] {
  if (typeof input === "string") return decodeDisciplineAllocations(input);
  if (!Array.isArray(input)) return [];
  return input.map(sanitizeDisciplineAllocation).filter((a): a is DisciplineAllocation => a !== null);
}

export function sanitizeBudgetBucket(input: unknown): BudgetBucket | null {
  if (!isPlainObject(input)) return null;
  const id = toNumber(input.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(input.name, BUDGET_NAME_MAX);
  if (!name) return null;

  const type: BudgetType =
    typeof input.type === "string" && BUDGET_TYPE_SET.has(input.type as BudgetType)
      ? (input.type as BudgetType)
      : "tm";
  const currency = isBudgetCurrency(input.currency) ? input.currency : SUPPORTED_CURRENCIES[0];
  const status: BucketStatus = input.status === "closed" ? "closed" : "open";

  const startDate = sanitizeIsoDate(input.startDate);
  const endDate = sanitizeIsoDate(input.endDate);
  const [start, end] = startDate && endDate && endDate < startDate ? [endDate, startDate] : [startDate, endDate];

  const bucket: BudgetBucket = {
    id, name, type, currency,
    startDate: start, endDate: end,
    status,
    allocations: sanitizeAllocations(input.allocations),
  };
  const po = sanitizeText(input.poNumber, PO_NUMBER_MAX); if (po) bucket.poNumber = po;
  if (type === "fixed") {
    const amt = sanitizeAmount(input.fixedPriceAmount);
    if (amt !== undefined) bucket.fixedPriceAmount = amt;
  }
  const succ = toNumber(input.successorId);
  if (Number.isFinite(succ) && succ > 0 && succ !== id) bucket.successorId = succ;
  if (status === "closed") {
    const cd = sanitizeIsoDate(input.closedDate);
    if (cd) bucket.closedDate = cd;
  }
  const fx = sanitizeAmount(input.fxRateOverride);
  if (fx !== undefined && fx > 0) bucket.fxRateOverride = fx;
  if (input.order !== undefined && input.order !== null && input.order !== "") {
    const orderNum = toNumber(input.order);
    if (Number.isInteger(orderNum) && orderNum >= 0) bucket.order = orderNum;
  }
  if (typeof input.planningMode === "string" && (PLANNING_MODES as readonly string[]).includes(input.planningMode))
    bucket.planningMode = input.planningMode as PlanningMode;
  const disc = sanitizeDisciplineAllocations(input.disciplineAllocations);
  if (disc.length > 0) bucket.disciplineAllocations = disc;
  const ri = sanitizeAmount(input.rateOverrideInternal); if (ri !== undefined) bucket.rateOverrideInternal = ri;
  const re = sanitizeAmount(input.rateOverrideExternal); if (re !== undefined) bucket.rateOverrideExternal = re;
  if (typeof input.localModifiedAt === "string" && input.localModifiedAt) bucket.localModifiedAt = input.localModifiedAt;
  const taskIds = sanitizeIdList(input.taskIds);
  if (taskIds.length > 0) bucket.taskIds = taskIds;
  const pc = sanitizePercentComplete(input.percentComplete);
  if (pc !== undefined) bucket.percentComplete = pc;
  return bucket;
}

export function sanitizeFxRates(input: unknown): FxRates | null {
  if (!isPlainObject(input)) return null;
  if (input.base !== "EUR") return null;
  const date = sanitizeIsoDate(input.date);
  if (!date) return null;
  const fetchedAt = typeof input.fetchedAt === "string" && input.fetchedAt ? input.fetchedAt : "";
  if (!fetchedAt) return null;
  const ratesIn = isPlainObject(input.rates) ? input.rates : {};
  const rates: Record<string, number> = {};
  for (const code of SUPPORTED_CURRENCIES) {
    const n = toNumber((ratesIn as Record<string, unknown>)[code]);
    if (Number.isFinite(n) && n > 0) rates[code] = Math.round(n * 1e6) / 1e6;
  }
  rates.EUR = 1;
  return { base: "EUR", date, fetchedAt, rates };
}
