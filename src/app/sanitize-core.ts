// src/app/sanitize-core.ts — primitive value/field sanitizers + length caps
// shared by the per-entity sanitizers in sanitize-entities.ts. Re-exported
// via sanitize.ts (the barrel). i18n-free, pure.
import {
  DEPENDENCY_TYPES,
  type DependencyType,
  type Priority,
  type Task,
  type TaskDependency,
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
export function toNumber(n: unknown): number {
  return typeof n === "number"
    ? n
    : typeof n === "string" || typeof n === "boolean"
      ? Number(n)
      : NaN;
}

function clipText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  // ★★ NEGATIVE max first, and it is NOT the same case as max === 0. At 0 the
  // back-off below is inert (charCodeAt(-1) is NaN, every NaN comparison is
  // false) and slice(0, 0) is "". At a NEGATIVE max, `slice`'s end index counts
  // from the END, so slice(0, -1) returns nearly the whole string — over cap,
  // and able to end on a lone surrogate itself ("a𐀀" → "a\ud800"). That
  // predates this fix, but it defeats the invariant the fix exists to establish,
  // so clamp it rather than reasoning that no caller passes one (§22 flags that
  // `max` here is a per-field argument, not one constant).
  if (max <= 0) return "";
  if (s.length <= max) return s;
  // ★★ `slice` counts UTF-16 CODE UNITS, so a cap landing inside an astral
  // character (emoji, rarer CJK, most symbols above the BMP) kept its LONE HIGH
  // SURROGATE. That is not a character: encoding it to UTF-8 replaces it with
  // U+FFFD, permanently. JSON.stringify escapes it as "\ud83d" and survives, so
  // the JSON and IndexedDB backends did NOT corrupt while CSV and Markdown DID —
  // a backend-dependent silent corruption, harder to diagnose than a uniform one
  // because the same workspace reads correctly or incorrectly depending only on
  // where it was stored. Back the cut off by one so the character is dropped
  // WHOLE. `capHtmlText` (rich-text-plain.ts) carries the identical fix for the
  // rich-text cap; this one closes every plain-text field behind sanitizeText /
  // sanitizeMultiline plus sanitizeVoiceTranscript.
  const last = s.charCodeAt(max - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return s.slice(0, cut);
}

/** Trim + cap. Use for short single-line fields. */
export function sanitizeText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return clipText(s.trim(), max);
}

/** Cap only (preserve user-entered whitespace). Use for textareas. */
export function sanitizeMultiline(s: unknown, max: number): string {
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

/**
 * Decode an optional foreign-key id: a positive integer, else `undefined`.
 * Entity ids are 1-based (see `nextId`), so blank / 0 / negative / NaN all
 * mean "unlinked". This is the canonical FK-decode guard — prefer it over
 * `Number(x) || undefined`, which keeps negative ids (a negative is truthy).
 */
export function fkIdOrUndefined(raw: unknown): number | undefined {
  const n = toNumber(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
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

/** Strips characters that conflict with serialization separators (|) and chip parsing (,).
 *
 *  ★★ The cap goes through `sanitizeText` (hence `clipText`) rather than a raw
 *  `.slice`, so it inherits the surrogate back-off — a bare
 *  `.trim().slice(0, LABEL_MAX)` returned a LONE HIGH SURROGATE for a label
 *  ending in an emoji at the boundary, which is §22's defect exactly and was
 *  still live here after §22 was closed on `clipText` alone. `sanitizeText` is
 *  `clipText(s.trim(), max)`, so the replace→trim→cap ORDER is unchanged.
 *  ★ `describeLabelStrip` (sanitize-report.ts) mirrors this by contract — its
 *  docstring says so. Change both together. */
export function sanitizeLabel(s: unknown): string {
  if (typeof s !== "string") return "";
  return sanitizeText(s.replace(/[|,\r\n\t]+/g, " "), LABEL_MAX);
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
 * Append a validated `(taskId, type)` dependency to `out`, deduping on the
 * `${tid}:${type}` key via `seen`. Shared by the object-shaped and the
 * string-encoded decoders. Returns `true` once the list reaches
 * `DEPENDENCIES_MAX_COUNT` (the caller should then stop).
 */
function pushUniqueDependency(
  out: TaskDependency[],
  seen: Set<string>,
  tid: number,
  type: DependencyType,
): boolean {
  const key = `${tid}:${type}`;
  if (seen.has(key)) return false;
  seen.add(key);
  out.push({ taskId: tid, type });
  return out.length >= DEPENDENCIES_MAX_COUNT;
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
    if (pushUniqueDependency(out, seen, tid, type)) break;
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
    if (pushUniqueDependency(out, seen, tid, type)) break;
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

