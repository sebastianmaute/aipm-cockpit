import {
  ABSENCE_TYPES,
  type Absence,
  type AbsenceType,
  DEFAULT_WEEK_HOURS,
  DEPENDENCY_TYPES,
  type DependencyType,
  MAX_HOURS_PER_DAY,
  type Priority,
  type Shift,
  type Task,
  type TaskDependency,
  type WeekHours,
} from "./types";

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
