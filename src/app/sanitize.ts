import {
  ABSENCE_TYPES,
  type Absence,
  type AbsenceType,
  DEFAULT_WEEK_HOURS,
  DEPENDENCY_TYPES,
  type DependencyType,
  MAX_HOURS_PER_DAY,
  type Milestone,
  type PlanGranularity,
  type Priority,
  type ResourcePlan,
  type Shift,
  type Task,
  type TaskDependency,
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
  CHANGE_TYPES,
  CHANGE_STATUSES,
  type ChangeItem,
  type ChangeType,
  type ChangeStatus,
  STAKEHOLDER_CATEGORIES,
  RACI_ROLES,
  type Stakeholder,
  type RaciRole,
  type StakeholderCategory,
  type InfluenceInterest,
  type ContactPerson,
  type ProjectMeta,
  type IdentityType,
  type Deployment,
  type RegulatoryRequirement,
} from "./types";
import {
  IDENTITY_TYPE_SET,
  DEPLOYMENT_SET,
  REGULATORY_SET,
  REGULATORY_NOT_APPLICABLE,
} from "./project-options";
import { NACE_SECTION_SET } from "./nace-sections";
import { defaultResourcePlan, splitName } from "./resource-foundation";
import { sanitizeDocumentLinks } from "./document-link";

// --- Length caps -----------------------------------------------------------

export const TASK_NAME_MAX = 500;
export const ASSIGNEE_MAX = 200;
export const EMAIL_MAX = 320; // RFC 5321
export const TEXTAREA_MAX = 5000;
const VOICE_TRANSCRIPT_MAX = 1000;
export const CHAT_MESSAGE_MAX = 10000;
export const GROUP_MAX = 100;
export const LABEL_MAX = 50;
export const LABELS_MAX_COUNT = 20;
const DEPENDENCIES_MAX_COUNT = 20;

// --- Email validation ------------------------------------------------------

export function isValidEmail(s: string): boolean {
  return /^\S+@\S+\.\S+$/.test(s.trim());
}

// --- Generic helpers -------------------------------------------------------

/**
 * Safe numeric coercion for untrusted input. Only primitives are coerced;
 * objects, arrays, and symbols become NaN so callers fall back to their
 * "invalid" branch.
 *
 * Why not just `Number(x)`: a JSON object whose `toString`/`valueOf` own-key is
 * a non-function (e.g. `JSON.parse('{"toString":null}')`) makes `Number(x)` AND
 * `String(x)` THROW "Cannot convert object to primitive value". Since these
 * sanitizers guard the file-import / chat-tool / CSV boundary — all of which can
 * deliver such objects — every coercion of untrusted data must go through here.
 */
function toNumber(n: unknown): number {
  return typeof n === "number"
    ? n
    : typeof n === "string" || typeof n === "boolean"
      ? Number(n)
      : NaN;
}

function clipText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max) : s;
}

/** Trim + cap. Use for short single-line fields. */
function sanitizeText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return clipText(s.trim(), max);
}

/** Cap only (preserve user-entered whitespace). Use for textareas. */
function sanitizeMultiline(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return clipText(s, max);
}

// --- Domain helpers --------------------------------------------------------

export function sanitizeTaskName(s: unknown): string {
  return sanitizeText(s, TASK_NAME_MAX);
}

export function sanitizeAssignee(s: unknown): string {
  return sanitizeText(s, ASSIGNEE_MAX);
}

export function sanitizeEmail(s: unknown): string {
  return sanitizeText(s, EMAIL_MAX);
}

export function sanitizeBlockers(s: unknown): string {
  return sanitizeMultiline(s, TEXTAREA_MAX);
}

export function sanitizeNotes(s: unknown): string {
  return sanitizeMultiline(s, TEXTAREA_MAX);
}

export function sanitizeVoiceTranscript(s: string): string {
  return clipText(s, VOICE_TRANSCRIPT_MAX);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns the input unchanged if it's a valid YYYY-MM-DD in 1900..2100, else "". */
export function sanitizeIsoDate(s: unknown): string {
  if (typeof s !== "string" || !ISO_DATE_RE.test(s)) return "";
  const y = Number(s.slice(0, 4));
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return "";
  return s;
}

const PRIORITIES_SET = new Set<Priority>(["Low", "Medium", "High", "Urgent"]);

export function sanitizePriority(p: unknown, fallback: Priority = "Medium"): Priority {
  return typeof p === "string" && PRIORITIES_SET.has(p as Priority)
    ? (p as Priority)
    : fallback;
}

export function sanitizeNonNegInt(n: unknown): number {
  const num = toNumber(n);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Optional canonical-minutes guard for task effort fields
 * (originalEstimateMinutes / timeSpentMinutes). Mirrors the budget `order`
 * guard: keep the value only when present, non-empty, and a finite
 * non-negative integer. An empty CSV cell ("") or any malformed value
 * becomes `undefined` (unset) — never 0.
 */
export function sanitizeOptionalMinutes(n: unknown): number | undefined {
  if (n === undefined || n === null || n === "") return undefined;
  const num = toNumber(n);
  if (!Number.isInteger(num) || num < 0) return undefined;
  return num;
}

export function sanitizeGroup(s: unknown): string {
  return sanitizeText(s, GROUP_MAX);
}

/** Strips characters that conflict with serialization separators (|) and chip parsing (,). */
export function sanitizeLabel(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/[|,\r\n\t]+/g, " ").trim().slice(0, LABEL_MAX);
}

export function sanitizeLabels(input: unknown): string[] {
  let arr: unknown[];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === "string") arr = input.split("|");
  else return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const clean = sanitizeLabel(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= LABELS_MAX_COUNT) break;
  }
  return out;
}

// --- Dependencies ---------------------------------------------------------

function isDependencyType(v: unknown): v is DependencyType {
  return typeof v === "string" && (DEPENDENCY_TYPES as readonly string[]).includes(v);
}

/**
 * Sanitize a list of task dependencies for a given task.
 *
 * Drops entries that:
 *   • Aren't shaped `{ taskId: number, type: DependencyType }`
 *   • Reference a missing task id (not in `knownTaskIds`)
 *   • Reference the task itself (self-loops are nonsensical)
 *   • Duplicate an earlier (taskId, type) pair
 *   • Exceed `DEPENDENCIES_MAX_COUNT`
 *
 * Does NOT check for cycles across the full task graph — that's a
 * cross-task concern handled by the form layer at insert time. Sanitize
 * is meant as the cheap, per-task guard.
 */
export function sanitizeDependencies(
  input: unknown,
  knownTaskIds: ReadonlySet<number>,
  ownTaskId: number | null,
): TaskDependency[] {
  if (!Array.isArray(input)) return [];
  const out: TaskDependency[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!isPlainObject(item)) continue;
    const tid = item.taskId;
    const type = item.type;
    if (typeof tid !== "number" || !Number.isFinite(tid)) continue;
    if (!isDependencyType(type)) continue;
    if (ownTaskId !== null && tid === ownTaskId) continue;
    if (!knownTaskIds.has(tid)) continue;
    const key = `${tid}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ taskId: tid, type });
    if (out.length >= DEPENDENCIES_MAX_COUNT) break;
  }
  return out;
}

/**
 * Walk the dependency graph upward (from `candidatePredecessorId` through its
 * own dependencies) looking for `ownTaskId`. If found, adding a dependency on
 * `candidatePredecessorId` would create a cycle.
 *
 * Treats `taskById` as a snapshot — callers should pass the current tasks
 * list as a Map keyed by id.
 */
export function wouldCreateDependencyCycle(
  ownTaskId: number,
  candidatePredecessorId: number,
  taskById: ReadonlyMap<number, Task>,
): boolean {
  if (ownTaskId === candidatePredecessorId) return true;
  const visited = new Set<number>();
  const stack: number[] = [candidatePredecessorId];
  while (stack.length) {
    const id = stack.pop() as number;
    if (id === ownTaskId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const t = taskById.get(id);
    if (!t?.dependencies) continue;
    for (const d of t.dependencies) stack.push(d.taskId);
  }
  return false;
}

// --- CSV / Markdown encoding for dependencies -----------------------------
//
// The Browser and JSON file backends round-trip Task objects through
// JSON.parse / JSON.stringify, so `dependencies` is preserved automatically.
// The CSV and Markdown backends serialize each field as a string column —
// we need a compact text encoding for the dependency list.
//
// Format: `TYPE:ID` per entry, entries joined by `|`. Example:
//   "FS:12|SS:7|FF:3"
// Empty list → empty string. Parsing is permissive: malformed parts are
// dropped silently rather than failing the whole row.

/** Encode a dependency list to a single CSV/MD-safe string. */
export function serializeDependencies(deps: TaskDependency[] | undefined): string {
  if (!Array.isArray(deps) || deps.length === 0) return "";
  return deps
    .filter((d) => isDependencyType(d?.type) && Number.isFinite(d?.taskId))
    .map((d) => `${d.type}:${d.taskId}`)
    .join("|");
}

/** Decode a CSV/MD column back to a dependency list (no cross-task validation). */
export function parseDependenciesString(s: unknown): TaskDependency[] {
  if (typeof s !== "string" || s.length === 0) return [];
  const out: TaskDependency[] = [];
  const seen = new Set<string>();
  for (const raw of s.split("|")) {
    const part = raw.trim();
    if (!part) continue;
    const sep = part.indexOf(":");
    if (sep <= 0) continue;
    const type = part.slice(0, sep).trim();
    const idStr = part.slice(sep + 1).trim();
    if (!isDependencyType(type)) continue;
    const tid = Number(idStr);
    if (!Number.isFinite(tid) || tid <= 0) continue;
    const key = `${tid}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ taskId: tid, type });
    if (out.length >= DEPENDENCIES_MAX_COUNT) break;
  }
  return out;
}

/**
 * After parsing a full task list from disk, run this once to drop dependency
 * entries pointing at task ids that didn't survive (e.g. file was hand-edited).
 * Returns a NEW array; tasks without dangling references are returned as-is
 * for reference equality.
 */
export function dropDanglingDependencies(tasks: Task[]): Task[] {
  const knownIds = new Set(tasks.map((t) => t.id));
  return tasks.map((t) => {
    if (!t.dependencies || t.dependencies.length === 0) return t;
    const clean = t.dependencies.filter(
      (d) => d.taskId !== t.id && knownIds.has(d.taskId),
    );
    if (clean.length === t.dependencies.length) return t;
    return { ...t, dependencies: clean };
  });
}

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
    localModifiedAt:
      typeof raw.localModifiedAt === "string"
        ? raw.localModifiedAt
        : undefined,
    resourceId: toNumber(raw.resourceId) || undefined,
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
    localModifiedAt:
      typeof raw.localModifiedAt === "string"
        ? raw.localModifiedAt
        : undefined,
  };
}

// --- Resource Planner v2 sanitizers ----------------------------------------

const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2]|W[0-4]\d|W5[0-3])$/;
const HOURS_MAP_MAX = 1000; // sane upper bound for a single period's hours

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

function optText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s || undefined;
}

function optMultiline(v: unknown): string | undefined {
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
  if (typeof input.localModifiedAt === "string" && input.localModifiedAt) resource.localModifiedAt = input.localModifiedAt;
  return resource;
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
  if (!startDate || !endDate) {
    return { startDate: fallback.startDate, endDate: fallback.endDate, granularity, currency };
  }
  const [s, e] = endDate < startDate ? [endDate, startDate] : [startDate, endDate];
  return { startDate: s, endDate: e, granularity, currency };
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

export function sanitizeIdList(input: unknown): number[] {
  let arr: unknown[];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === "string") arr = input.split(".");
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

/** Accept only well-formed milestones from untrusted JSON. id>0, name+date
 *  required; linkedTaskIds reduced to positive finite ints. */
export function sanitizeMilestone(input: unknown): Milestone | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;
  const date = sanitizeIsoDate(o.date);
  if (!date) return null;
  const linkedTaskIds = Array.isArray(o.linkedTaskIds)
    ? o.linkedTaskIds.map((n) => toNumber(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const m: Milestone = { id: Math.floor(id), name, date, linkedTaskIds };
  const achievedDate = sanitizeIsoDate(o.achievedDate);
  if (achievedDate) m.achievedDate = achievedDate;
  const description = sanitizeText(o.description, TEXTAREA_MAX);
  if (description) m.description = description;
  const localModifiedAt = sanitizeText(o.localModifiedAt, TEXTAREA_MAX);
  if (localModifiedAt) m.localModifiedAt = localModifiedAt;
  return m;
}

// --- Change-log sanitizer --------------------------------------------------

const CHANGE_TYPE_SET = new Set<string>(CHANGE_TYPES);
const CHANGE_STATUS_SET = new Set<string>(CHANGE_STATUSES);
const CHANGE_IMPACT_SET = new Set<string>(["Low", "Medium", "High", "Critical"]);

/** Accept only well-formed change items from untrusted JSON. id>0 + title required. */
export function sanitizeChangeItem(input: unknown): ChangeItem | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const title = sanitizeText(o.title, BUDGET_NAME_MAX);
  if (!title) return null;

  const type = (typeof o.type === "string" && CHANGE_TYPE_SET.has(o.type)) ? (o.type as ChangeType) : "Other";
  const status = (typeof o.status === "string" && CHANGE_STATUS_SET.has(o.status)) ? (o.status as ChangeStatus) : "Proposed";

  const item: ChangeItem = {
    id: Math.floor(id),
    title,
    description: sanitizeText(o.description, TEXTAREA_MAX),
    type,
    status,
    raisedDate: sanitizeIsoDate(o.raisedDate),
    linkedTaskIds: sanitizeIdList(o.linkedTaskIds),
    linkedRaidIds: sanitizeIdList(o.linkedRaidIds),
    stakeholderIds: sanitizeIdList(o.stakeholderIds),
  };
  if (typeof o.impact === "string" && CHANGE_IMPACT_SET.has(o.impact)) item.impact = o.impact as ChangeItem["impact"];
  const impactDesc = sanitizeText(o.impactDescription, TEXTAREA_MAX); if (impactDesc) item.impactDescription = impactDesc;
  const days = toNumber(o.scheduleImpactDays); if (Number.isFinite(days) && days >= 0) item.scheduleImpactDays = days;
  const cost = toNumber(o.costImpact); if (Number.isFinite(cost) && cost >= 0) item.costImpact = cost;
  const reqBy = sanitizeText(o.requestedBy, BUDGET_NAME_MAX); if (reqBy) item.requestedBy = reqBy;
  const decBy = sanitizeText(o.decisionBy, BUDGET_NAME_MAX); if (decBy) item.decisionBy = decBy;
  const decDate = sanitizeIsoDate(o.decisionDate); if (decDate) item.decisionDate = decDate;
  const notes = sanitizeText(o.resolutionNotes, TEXTAREA_MAX); if (notes) item.resolutionNotes = notes;
  const lma = sanitizeText(o.localModifiedAt, TEXTAREA_MAX); if (lma) item.localModifiedAt = lma;
  const dl = sanitizeDocumentLinks((input as Record<string, unknown>).documentLinks);
  if (dl.length) item.documentLinks = dl;
  return item;
}

// --- Stakeholder + RACI ----------------------------------------------------

const STAKEHOLDER_CATEGORY_SET = new Set<string>(STAKEHOLDER_CATEGORIES);
const INFLUENCE_INTEREST_SET = new Set<string>(["Low", "Medium", "High"]);
const RACI_SET = new Set<string>(RACI_ROLES);
const RACI_KEY_RE = /^\d+$/;

/** Encode a RACI map "milestoneId=letter|…"; drops malformed entries. */
export function encodeRaciMap(map: Record<string, RaciRole> | undefined): string {
  if (!map) return "";
  return Object.entries(map)
    .filter(([k, v]) => RACI_KEY_RE.test(k) && RACI_SET.has(v))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
}

/** Decode "k=v|k=v" back to a RACI map; drops malformed keys/letters. */
export function decodeRaciMap(s: unknown): Record<string, RaciRole> {
  if (typeof s !== "string" || !s) return {};
  const out: Record<string, RaciRole> = {};
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (RACI_KEY_RE.test(key) && RACI_SET.has(val)) out[key] = val as RaciRole;
  }
  return out;
}

function coerceRaciMap(input: unknown): Record<string, RaciRole> {
  if (typeof input === "string") return decodeRaciMap(input);
  if (!isPlainObject(input)) return {};
  const out: Record<string, RaciRole> = {};
  for (const [k, v] of Object.entries(input)) {
    if (RACI_KEY_RE.test(k) && typeof v === "string" && RACI_SET.has(v)) {
      out[k] = v as RaciRole;
    }
  }
  return out;
}

/** Accept only well-formed stakeholders from untrusted JSON. id>0 + name required. */
export function sanitizeStakeholder(input: unknown): Stakeholder | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;

  const category = (typeof o.category === "string" && STAKEHOLDER_CATEGORY_SET.has(o.category))
    ? (o.category as StakeholderCategory) : "Other";
  const influence = (typeof o.influence === "string" && INFLUENCE_INTEREST_SET.has(o.influence))
    ? (o.influence as InfluenceInterest) : "Medium";
  const interest = (typeof o.interest === "string" && INFLUENCE_INTEREST_SET.has(o.interest))
    ? (o.interest as InfluenceInterest) : "Medium";

  const item: Stakeholder = {
    id: Math.floor(id),
    name,
    category,
    influence,
    interest,
    raci: coerceRaciMap(o.raci),
  };
  const org = sanitizeText(o.organization, BUDGET_NAME_MAX); if (org) item.organization = org;
  const title = sanitizeText(o.title, BUDGET_NAME_MAX); if (title) item.title = title;
  const email = sanitizeText(o.email, BUDGET_NAME_MAX); if (email) item.email = email;
  const notes = sanitizeText(o.notes, TEXTAREA_MAX); if (notes) item.notes = notes;
  const rid = toNumber(o.resourceId);
  if (Number.isFinite(rid) && rid > 0) item.resourceId = Math.floor(rid);
  const lma = sanitizeText(o.localModifiedAt, TEXTAREA_MAX); if (lma) item.localModifiedAt = lma;
  const dl = sanitizeDocumentLinks((input as Record<string, unknown>).documentLinks);
  if (dl.length) item.documentLinks = dl;
  return item;
}

// --- Project meta sanitizer ------------------------------------------------

function sanitizeContactPerson(input: unknown): ContactPerson | null {
  if (!isPlainObject(input)) return null;
  const name = sanitizeText(input.name, BUDGET_NAME_MAX);
  if (!name) return null;
  const email = sanitizeEmail(input.email);
  const synced = typeof input.synced === "boolean" ? input.synced : false;
  return { name, email, synced };
}

/** Coerce an unknown value to a string array, map through text sanitizer,
 *  drop empties, and de-dupe (case-sensitive). */
function sanitizeStringArray(input: unknown, cap: number): string[] {
  const arr: unknown[] = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const s = sanitizeText(item, cap);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Full-record sanitizer for inbound ProjectMeta data (file imports, chat
 * tools, form round-trips). Returns null when any required field is absent
 * or invalid.
 */
export function sanitizeProjectMeta(
  input: unknown,
  opts: { lenientRequiredArrays?: boolean } = {},
): ProjectMeta | null {
  if (!isPlainObject(input)) return null;
  const o = input;

  // Required short-text fields — empty string means invalid.
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;
  const code = sanitizeText(o.code, BUDGET_NAME_MAX);
  if (!code) return null;
  const projectManager = sanitizeText(o.projectManager, BUDGET_NAME_MAX);
  if (!projectManager) return null;
  const customer = sanitizeText(o.customer, BUDGET_NAME_MAX);
  if (!customer) return null;
  const products = sanitizeText(o.products, BUDGET_NAME_MAX);
  if (!products) return null;
  const profitCenter = sanitizeText(o.profitCenter, BUDGET_NAME_MAX);
  if (!profitCenter) return null;

  // Required enum fields.
  const naceSectionRaw = sanitizeText(o.naceSection, 4);
  if (!NACE_SECTION_SET.has(naceSectionRaw)) return null;
  const naceSection = naceSectionRaw;

  const deploymentRaw = sanitizeText(o.deployment, BUDGET_NAME_MAX);
  if (!DEPLOYMENT_SET.has(deploymentRaw)) return null;
  const deployment = deploymentRaw as Deployment;

  // Required dates — both must be present and valid.
  const startDate = sanitizeIsoDate(o.startDate);
  const endDate = sanitizeIsoDate(o.endDate);
  if (!startDate || !endDate) return null;

  // Required array: keyStakeholdersInternal / keyStakeholdersExternal.
  const keyStakeholdersInternal = sanitizeStringArray(o.keyStakeholdersInternal, BUDGET_NAME_MAX);
  if (!opts.lenientRequiredArrays && keyStakeholdersInternal.length === 0) return null;
  const keyStakeholdersExternal = sanitizeStringArray(o.keyStakeholdersExternal, BUDGET_NAME_MAX);
  if (!opts.lenientRequiredArrays && keyStakeholdersExternal.length === 0) return null;

  // Required array: regulatory — filter to known set, de-dupe, collapse "Not applicable".
  const rawRegArr: unknown[] = Array.isArray(o.regulatory) ? o.regulatory : [];
  const regulatoryFiltered: RegulatoryRequirement[] = [];
  const regulatorySeen = new Set<string>();
  for (const item of rawRegArr) {
    if (typeof item !== "string" || !REGULATORY_SET.has(item)) continue;
    if (regulatorySeen.has(item)) continue;
    regulatorySeen.add(item);
    regulatoryFiltered.push(item as RegulatoryRequirement);
  }
  if (!opts.lenientRequiredArrays && regulatoryFiltered.length === 0) return null;
  const regulatory: RegulatoryRequirement[] = regulatoryFiltered.includes(REGULATORY_NOT_APPLICABLE)
    ? [REGULATORY_NOT_APPLICABLE]
    : regulatoryFiltered;

  // Optional enum array: identityTypes — filter + de-dupe; empty [] is allowed.
  const rawIdArr: unknown[] = Array.isArray(o.identityTypes) ? o.identityTypes : [];
  const identityTypesSeen = new Set<string>();
  const identityTypes: IdentityType[] = [];
  for (const item of rawIdArr) {
    if (typeof item !== "string" || !IDENTITY_TYPE_SET.has(item)) continue;
    if (identityTypesSeen.has(item)) continue;
    identityTypesSeen.add(item);
    identityTypes.push(item as IdentityType);
  }

  // contactPersons — keep only valid entries; empty [] is allowed.
  const rawCp: unknown[] = Array.isArray(o.contactPersons) ? o.contactPersons : [];
  const contactPersons: ContactPerson[] = rawCp
    .map(sanitizeContactPerson)
    .filter((cp): cp is ContactPerson => cp !== null);

  // Build required-fields-first object (sanitizeStakeholder style).
  const meta: ProjectMeta = {
    name,
    code,
    projectManager,
    keyStakeholdersInternal,
    keyStakeholdersExternal,
    customer,
    naceSection,
    identityTypes,
    products,
    deployment,
    startDate,
    endDate,
    profitCenter,
    contactPersons,
    regulatory,
  };

  // Optional text fields (short, trimmed).
  const description = sanitizeText(o.description, TEXTAREA_MAX); if (description) meta.description = description;
  const sponsor = sanitizeText(o.sponsor, BUDGET_NAME_MAX); if (sponsor) meta.sponsor = sponsor;
  const platform = sanitizeText(o.platform, BUDGET_NAME_MAX); if (platform) meta.platform = platform;
  const quotes = sanitizeText(o.quotes, TEXTAREA_MAX); if (quotes) meta.quotes = quotes;
  const salesforceUrl = sanitizeText(o.salesforceUrl, BUDGET_NAME_MAX); if (salesforceUrl) meta.salesforceUrl = salesforceUrl;
  const sharepointUrl = sanitizeText(o.sharepointUrl, BUDGET_NAME_MAX); if (sharepointUrl) meta.sharepointUrl = sharepointUrl;
  const confluenceUrl = sanitizeText(o.confluenceUrl, BUDGET_NAME_MAX); if (confluenceUrl) meta.confluenceUrl = confluenceUrl;
  const docRepoLocation = sanitizeText(o.docRepoLocation, BUDGET_NAME_MAX); if (docRepoLocation) meta.docRepoLocation = docRepoLocation;
  const notes = sanitizeText(o.notes, TEXTAREA_MAX); if (notes) meta.notes = notes;

  // Optional identityCount — coerce, require finite >= 0, floor.
  if (o.identityCount !== undefined && o.identityCount !== null && o.identityCount !== "") {
    const n = toNumber(o.identityCount);
    if (Number.isFinite(n) && n >= 0) meta.identityCount = Math.floor(n);
  }

  return meta;
}
