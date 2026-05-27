import {
  ABSENCE_TYPES,
  type Absence,
  type AbsenceType,
  DEFAULT_WEEK_HOURS,
  DEPENDENCY_TYPES,
  type DependencyType,
  MAX_HOURS_PER_DAY,
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
  type BudgetType,
  type BucketStatus,
  type FxRates,
  BUDGET_TYPES,
  SUPPORTED_CURRENCIES,
  isBudgetCurrency,
} from "./types";
import { defaultResourcePlan, splitName } from "./resource-foundation";

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
  const num = typeof n === "number" ? n : Number(n);
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
  const num = typeof n === "number" ? n : Number(n);
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
  const id = Number(raw.id);
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
    resourceId: Number(raw.resourceId) || undefined,
  };
}

// --- Shift sanitizers ------------------------------------------------------

function clampHour(n: unknown): number {
  const num = typeof n === "number" ? n : Number(n);
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
  const id = Number(raw.id);
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
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.min(clampMax, Math.max(0, n));
  }
  return out;
}

export function sanitizeUtilizationMode(s: unknown): UtilizationMode {
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
  const id = Number(input.id);
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
  const roleIdNum = Number(input.roleId);
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
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

export function sanitizeRole(input: unknown): Role | null {
  if (!isPlainObject(input)) return null;
  const id = Number(input.id);
  const disciplineId = Number(input.disciplineId);
  const gradeId = Number(input.gradeId);
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
  const id = Number(input.id);
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

const BUDGET_NAME_MAX = 200;
const PO_NUMBER_MAX = 64;
const AMOUNT_MAX = 1_000_000_000;
const BUDGET_TYPE_SET: ReadonlySet<BudgetType> = new Set(BUDGET_TYPES);

function sanitizeAmount(n: unknown): number | undefined {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.min(AMOUNT_MAX, Math.round(num * 100) / 100);
}

function sanitizeIdList(input: unknown): number[] {
  let arr: unknown[];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === "string") arr = input.split(".");
  else return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of arr) {
    const n = typeof item === "number" ? item : Number(String(item).trim());
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
  const roleId = Number(input.roleId);
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

export function sanitizeBudgetBucket(input: unknown): BudgetBucket | null {
  if (!isPlainObject(input)) return null;
  const id = Number(input.id);
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
  const succ = Number(input.successorId);
  if (Number.isFinite(succ) && succ > 0 && succ !== id) bucket.successorId = succ;
  if (status === "closed") {
    const cd = sanitizeIsoDate(input.closedDate);
    if (cd) bucket.closedDate = cd;
  }
  const fx = sanitizeAmount(input.fxRateOverride);
  if (fx !== undefined && fx > 0) bucket.fxRateOverride = fx;
  if (input.order !== undefined && input.order !== null && input.order !== "") {
    const orderNum = typeof input.order === "number" ? input.order : Number(input.order);
    if (Number.isInteger(orderNum) && orderNum >= 0) bucket.order = orderNum;
  }
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
    const n = Number((ratesIn as Record<string, unknown>)[code]);
    if (Number.isFinite(n) && n > 0) rates[code] = Math.round(n * 1e6) / 1e6;
  }
  rates.EUR = 1;
  return { base: "EUR", date, fetchedAt, rates };
}
