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

/** True when `s`, trimmed, holds neither `,` nor `;` — the two delimiters
 *  `sanitizeEmailList` splits a delimited string on. An address carrying one
 *  is torn in two whenever it reaches the writer inside a delimited STRING
 *  (open-followups §422). No format validation beyond that, and deliberately
 *  never called on a load or decode path. */
export function isDelimiterSafeEmail(s: string): boolean {
  return !/[,;]/.test(s.trim());
}

/** The two reasons a write boundary refuses an email value. */
export type EmailRefusal = "invalid" | "delimiter";

/** ★ THE WRITE PREDICATE: a loose-format address (`isValidEmail`) that is also
 *  delimiter-safe (`isDelimiterSafeEmail`). Neither component changes, and no
 *  load or decode path calls this. */
export function isWriteSafeEmail(s: string): boolean {
  return isValidEmail(s) && isDelimiterSafeEmail(s);
}

/** ★★★ THE ONE SCALAR WRITE RULE for every email field, refusing a value only
 *  when it CHANGES:
 *  1. a blank `incoming` is never refused — clearing is always legal;
 *  2. an `incoming` equal, trimmed, to `stored` is never refused, even when the
 *     stored value is itself unsafe (a create passes `stored = undefined`);
 *  3. an `incoming` equal, trimmed, to one of `copySources` is never refused —
 *     a copy of a person's STORED email made by a picker or a reassign;
 *  4. otherwise `"invalid"` when `isValidEmail` fails, `"delimiter"` when
 *     `isDelimiterSafeEmail` fails, else null. `"a,b@x.com"` passes
 *     `isValidEmail`, so it yields `"delimiter"`. */
export function emailWriteRefusal(
  incoming: string,
  stored: string | undefined,
  copySources: readonly (string | undefined)[] = [],
): EmailRefusal | null {
  const next = incoming.trim();
  if (next === "") return null;
  if (stored !== undefined && next === stored.trim()) return null;
  if (copySources.some((source) => source !== undefined && source.trim() === next)) return null;
  if (!isValidEmail(next)) return "invalid";
  if (!isDelimiterSafeEmail(next)) return "delimiter";
  return null;
}

/** ★★★ THE LIST FORM OF `emailWriteRefusal`, for `resource.emails` — the address
 *  an incoming value would store unsafely, or undefined. Every `emails` write
 *  boundary asks THIS with the same arguments: `createResource` (stored =
 *  undefined), `updateResource` (stored = the row's `emails`), the resource
 *  editor's save (stored = the resource as of when the modal opened) and
 *  `describeEntityCalls` (stored = the item's `emails`, judged on the RAW
 *  incoming value), so the card and the write cannot disagree.
 *  - ARRAY: the first string member that is non-blank, NOT already present
 *    (trimmed) in `stored`, and not `isWriteSafeEmail`. An array is written
 *    verbatim, so re-sending a stored member changes nothing and is allowed.
 *  - STRING: first, a stored delimiter-unsafe address the string contains
 *    (`sanitizeEmailList` would re-split it); then the first member the
 *    `[;,]` split produces that is new and not `isWriteSafeEmail`.
 *  - Anything else: undefined.
 *  ★ It stops NEW unsafe addresses only; stored ones keep loading. An address
 *   already torn by a past CSV, Markdown or Turso save cannot be rebuilt — the
 *   accepted limit recorded in open-followups §533.
 *  ★★ `normalize` (M1): judge each member `Name <addr>`-unwrapped, as the AI
 *   writers, the inline card and (M-C4) the human resource editor do, because
 *   each of them STORES the unwrapped member. It defaults to off, but since
 *   M-C4 every production caller passes `true` — reproduce:
 *   `git grep -n "findTornEmail(" -- "src/app/*.ts" "src/app/*.tsx" ":!*.test.*"`.
 *   The stored-torn check on a STRING always reads the raw string. */
export function findTornEmail(
  incoming: unknown,
  stored: readonly string[] | undefined,
  normalize = false,
): string | undefined {
  const storedList = (stored ?? []).filter((e): e is string => typeof e === "string");
  const storedTrimmed = new Set(storedList.map((e) => e.trim()));
  const shaped = (e: string): string => (normalize ? normalizeEmailShape(e.trim()) : e);
  const isNewUnsafe = (e: string): boolean =>
    e.trim() !== "" && !storedTrimmed.has(e.trim()) && !isWriteSafeEmail(e);
  if (Array.isArray(incoming)) {
    return incoming.find((e): e is string => typeof e === "string" && isNewUnsafe(shaped(e)));
  }
  if (typeof incoming === "string") {
    const torn = storedList.find((e) => !isDelimiterSafeEmail(e) && incoming.includes(e.trim()));
    if (torn !== undefined) return torn;
    return incoming.split(/[;,]/).map((e) => shaped(e.trim())).find(isNewUnsafe);
  }
  return undefined;
}

// --- Email load clean-up (spec Part 2) --------------------------------------

const NAME_ADDRESS_RE = /^[^<>]*<([^<>]+)>$/;

/** ★ Only a provably equivalent shape: a scalar `Name <addr>` whose inner
 *  `addr` is `isWriteSafeEmail` becomes `addr`. Anything else — including
 *  `Name <a,b@x.com>` — is returned UNCHANGED, so nothing ever refuses, drops or
 *  rewrites a value it cannot prove equal.
 *  ★★★ M1 (pre-release review): NOT load-side only, which this said while five
 *  AI writers already unwrapped through their sanitizers and two did not. It is
 *  now ONE behaviour: every LOAD path and every AI email WRITE unwraps (the
 *  writers store `sanitizeLoadedEmail`, `refuseEmailWrite` judges the unwrapped
 *  value, `findTornEmail`'s `normalize` flag does it for `resource.emails`, and
 *  the inline card's email readers show it). ★ M-C4: the HUMAN editors now judge
 *  and store the same unwrapped value (`sanitizeLoadedEmail` /
 *  `sanitizeLoadedStakeholderEmail`, and this function per `resource.emails`
 *  member) instead of what the person typed. */
export function normalizeEmailShape(value: string): string {
  const match = NAME_ADDRESS_RE.exec(value.trim());
  if (!match) return value;
  const inner = match[1].trim();
  return isWriteSafeEmail(inner) ? inner : value;
}

/** The list form, for `Resource.emails`: each member is unwrapped as above,
 *  and a member holding several addresses splits into separate members only
 *  when EVERY part is write-safe. */
export function normalizeEmailListShape(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const member of list) {
    const scalar = normalizeEmailShape(member);
    if (scalar !== member) { out.push(scalar); continue; }
    const parts = member.split(/[;,]/).map((p) => normalizeEmailShape(p.trim())).filter((p) => p !== "");
    if (parts.length > 1 && parts.every(isWriteSafeEmail)) out.push(...parts);
    else out.push(member);
  }
  return out;
}

/** Row helper for load paths that cast rows instead of sanitizing them
 *  (IndexedDB, the JSON RAID map). Same reference when nothing changes. */
export function withNormalizedEmailField<T extends object>(row: T, field: keyof T & string): T {
  const value = (row as Record<string, unknown>)[field];
  if (typeof value !== "string") return row;
  const next = normalizeEmailShape(value);
  return next === value ? row : { ...row, [field]: next };
}

/** A loaded scalar email: unwrap `Name <addr>` FIRST, then trim + cap. The
 *  order is load-bearing — capping first can cut the closing `>` off a long
 *  `Name <addr>`, which would then be stored torn instead of unwrapped.
 *  ★ ONE argument (`sanitize-point-free.guard.test.ts`): the stakeholder's
 *  narrower cap is its own named form, `sanitizeLoadedStakeholderEmail`. */
export function sanitizeLoadedEmail(s: unknown): string {
  return typeof s === "string" ? sanitizeText(normalizeEmailShape(s), EMAIL_MAX) : "";
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

/** A `YYYY-MM-DD` string that is a REAL calendar date in 1900..2100, returned
 *  verbatim; otherwise "". ★ §539: the shape and year alone let "2026-13-01",
 *  "2026-00-10" and "2026-02-30" through. The `Date.UTC` round trip rejects a
 *  month outside 1..12 and a day past the month's real length (leap years
 *  included). Such a value is unusable — `<input type="date">` blanks it, and
 *  date math either rolls a day overflow silently into the next month or turns
 *  a month overflow into NaN — so write paths refuse it and load paths blank an
 *  OPTIONAL date field with it. ★ A REQUIRED date on a load path is read with
 *  `requiredIsoDateOnLoad` (sanitize-load-date.ts) instead, which keeps the raw
 *  value with a diagnostic: blanking it would drop the whole record. */
export function sanitizeIsoDate(s: unknown): string {
  if (typeof s !== "string" || !ISO_DATE_RE.test(s)) return "";
  const y = Number(s.slice(0, 4));
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return "";
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) return "";
  return s;
}

/** How an entity sanitizer reads a REQUIRED date field: `sanitizeIsoDate` on
 *  write paths (the extra arguments are ignored), `requiredIsoDateOnLoad`
 *  (sanitize-load-date.ts) on load paths. */
export type RequiredDateReader = (value: unknown, entity: string, id: unknown, field: string) => string;

const PRIORITIES_SET = new Set<Priority>(["Low", "Medium", "High", "Urgent"]);

/** ★ ONE argument, so it is safe point-free (`sanitize-point-free.guard.test.ts`);
 *  an optional `fallback` would have received the map INDEX. */
export function sanitizePriority(p: unknown): Priority {
  return sanitizePriorityOr(p, "Medium");
}

/** `sanitizePriority` with the caller's fallback — e.g. the stored priority, so
 *  an invalid model value leaves the task where it was. The fallback is a
 *  required `Priority`, so a point-free pass fails tsc instead of taking the index. */
export function sanitizePriorityOr(p: unknown, fallback: Priority): Priority {
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
 * Optional canonical-minutes guard for every task effort field. Mirrors the
 * budget `order` guard: keep the value only when present, non-empty, and a
 * finite non-negative integer. An empty CSV cell ("") or any malformed value
 * becomes `undefined` (unset) — never 0.
 * ★ The fields are deliberately NOT enumerated here. An earlier revision named
 *   two and a third one falsified it; the list is what rots, not the rule.
 *   Read today's set off a decode site, which cannot self-match this comment:
 *   `grep -n "sanitizeOptionalMinutes" src/app/csv-codecs-decode.ts`
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

