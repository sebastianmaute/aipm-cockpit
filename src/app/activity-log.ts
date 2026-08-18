// Activity log — chronological record of CRUD-ish user actions. It is
// PER-PROJECT WORKSPACE DATA now (`Workspace.activityLog`), persisted as a
// meta-blob on all six write paths; it was a per-device localStorage blob until
// the activity-log-workspace-data slice, and `dropLegacyActivityLog` below
// removes that old key.
//
// ★★ STORED ON EVERY BACKEND, EXPORTED ON NONE — the two are separate
// questions and the original device-local design conflated them. There is no
// `activityLog` key in EXPORT_SECTION_KEYS, and the CSV/Markdown emit sites
// gate on `config === undefined`, so the log never reaches a document handed to
// a client: an entry's `changes` carries old/new values for up to
// MAX_FIELD_CHANGES fields, which is internal audit detail.
//
// Capped at ACTIVITY_MAX_ENTRIES; oldest entries are dropped on overflow so a
// long-lived project's stored blob can't grow unbounded.

import type { TranslationKey } from "./i18n";

export type ActivityKind =
  | "task.created"
  | "task.updated"
  | "task.deleted"
  | "task.completed"
  | "task.reopened"
  | "raid.created"
  | "raid.updated"
  | "raid.deleted"
  | "raid.statusChanged"
  | "raid.autoIssue"
  | "bulk.edit"
  // ★★ SEPARATE FROM `bulk.edit` ON PURPOSE. A mass delete is irreversible on
  // the chat path (tool writes take no undo capture), so the log is the ONLY
  // account of it — describing it as an "edit" understates what happened. Same
  // `bulk.` prefix, so `activityGroupOf` files it under the same group.
  | "bulk.delete"
  | "bulk.inquiries"
  | "jira.sync"
  | "absence.created"
  | "absence.updated"
  | "absence.deleted"
  | "shift.created"
  | "shift.updated"
  | "shift.deleted"
  | "calendarEvent.created"
  | "calendarEvent.updated"
  | "calendarEvent.deleted"
  | "milestone.created"
  | "milestone.updated"
  | "milestone.deleted"
  | "change.created"
  | "change.updated"
  | "change.deleted"
  | "stakeholder.created"
  | "stakeholder.updated"
  | "stakeholder.deleted"
  | "resource.created"
  | "resource.updated"
  | "resource.deleted"
  | "role.created"
  | "role.updated"
  | "role.deleted"
  | "budget.created"
  | "budget.updated"
  | "budget.deleted"
  | "discipline.deleted"
  | "grade.deleted"
  | "settings.updated"
  | "doc.linkAdded"
  | "doc.linkRemoved"
  | "history.restore"
  | "calendar.autoPulled"
  /** ★★★ NO LONGER WRITTEN — historical only, and it must STAY in this union.
   *  `use-inline-entity-edit` wrote one of these ON TOP of the per-`runTool`
   *  row the chat dispatcher already logs for the same entity, with the same
   *  id, the same title and the same `actor: "ai"`. Dropping the redundant
   *  summary left the change fully recorded and removed a row that could be
   *  FALSE: `updateTask` silently `return null`s on an id a concurrent writer
   *  deleted, while the caller still counted the call as applied, so the
   *  summary claimed an edit nothing had made.
   *  ★★ Removing the member would not be a cleanup: the log is shared workspace
   *  data, entries persist, and `sanitizeActivityEntry` deliberately KEEPS an
   *  unknown-but-string kind so an older client cannot delete a newer client's
   *  rows. Delete this and every stored row renders as `activityUnknownKind`.
   *  Do NOT write it again — the per-entity rows are the audit trail. */
  | "ai.inlineEdit"
  | "ai.taskDedup"
  | "ai.insightRecommendation"
  | "ai.allocationPlan"
  | "ai.raciSuggest"
  | "ai.documentWrite"
  | "undo"
  | "redo";

/** One field-level change on an UPDATE event, for the audit-diff detail. */
export interface FieldChange {
  /** Raw entity field key (e.g. "status", "dueDate"). */
  field: string;
  /** Previous value, stringified + length-capped. */
  from: string;
  /** New value, stringified + length-capped. */
  to: string;
}

/** Who caused an entry.
 *
 *  ★★★ There is deliberately no "system" member. No writer could produce one
 *  today, and a value nothing emits is a value nothing tests — the same
 *  objection that makes a decorative field worse than no field.
 *
 *  ★★ The TS type is a closed union while `sanitizeActivityEntry` admits ANY
 *  string, exactly as `kind: ActivityKind` already does. Any lookup keyed on
 *  actor therefore needs an own-property guard, never a bare index. */
export type ActivityActor = "user" | "ai" | "integration";

export interface ActivityEntry {
  /** Globally unique: `"<deviceId>-<sessionNonce>-<counter>"`. Was a number,
   *  monotonic only within ONE device's log — which is exactly why two
   *  devices collided once the log became shared workspace data. The middle
   *  segment exists because `deviceId` is persisted (localStorage) while the
   *  counter is module scope: a page reload restores the SAME device id but
   *  resets the counter to 0, so `"<deviceId>-<counter>"` alone re-mints
   *  `<dev>-1` on every reload and two different entries collide. The
   *  per-session nonce is minted fresh each module evaluation and never
   *  persisted, so a reload can no longer repeat a prior session's ids. */
  id: string;
  /** ISO 8601 UTC timestamp captured at append time. Always `toISOString()`
   *  shape: `mergeActivityLogs` sorts these with a LEXICOGRAPHIC compare, and
   *  because it caps by slicing the head after sorting, a wrongly-ordered value
   *  is permanently dropped rather than merely misplaced. */
  timestamp: string;
  kind: ActivityKind;
  /** Positional args interpolated into the i18n message at render time. */
  args: (string | number)[];
  /** Who caused this entry. ABSENT on every entry written before the B2b
   *  release, and absence is NOT "user" — those entries have a genuinely
   *  unknown actor. Never default it at read time. */
  actor?: ActivityActor;
  /** Optional per-field diff for UPDATE events (audit detail). Omitted when the
   *  update produced no field changes. */
  changes?: readonly FieldChange[];
}

/** Max field-changes recorded per entry, and max chars per value. */
export const MAX_FIELD_CHANGES = 12;
const MAX_FIELD_VALUE_LEN = 120;

/** Fields never worth diffing: identity + auto-managed bookkeeping. */
const DEFAULT_DIFF_SKIP: ReadonlySet<string> = new Set([
  "id",
  "localModifiedAt",
  "outlookEventId",
]);

function fieldValueToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.length > MAX_FIELD_VALUE_LEN ? `${s.slice(0, MAX_FIELD_VALUE_LEN)}…` : s;
}

/**
 * Diff two entity snapshots into a sorted list of changed PRIMITIVE fields.
 * Skips identity/bookkeeping keys and any field whose value is an array/object
 * on either side (labels, raci, allocations — too noisy for an audit line).
 * PURE; caps count + per-value length. `today`/clock-free. When more than
 * MAX_FIELD_CHANGES fields changed, keeps the FIRST cap-many by field name
 * (alphabetical) — bounded audit line, not a ranked "most important" set.
 */
export function diffFields<T extends object>(
  prev: T,
  next: T,
  skip: ReadonlySet<string> = DEFAULT_DIFF_SKIP,
): FieldChange[] {
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(p), ...Object.keys(n)])).sort();
  const out: FieldChange[] = [];
  for (const key of keys) {
    if (skip.has(key)) continue;
    const a = p[key];
    const b = n[key];
    // Skip non-primitive (array/object) values on either side.
    if ((typeof a === "object" && a !== null) || (typeof b === "object" && b !== null)) {
      continue;
    }
    const from = fieldValueToString(a);
    const to = fieldValueToString(b);
    if (from !== to) out.push({ field: key, from, to });
    if (out.length >= MAX_FIELD_CHANGES) break;
  }
  return out;
}

/** camelCase/underscored field key → lowercase space-separated words for the
 *  audit-diff display (e.g. "dueDate" → "due date"). English-only, pure. */
export function humanizeFieldName(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

function isFieldChange(v: unknown): v is FieldChange {
  if (!v || typeof v !== "object") return false;
  const c = v as Partial<FieldChange>;
  return typeof c.field === "string" && typeof c.from === "string" && typeof c.to === "string";
}

/** Validate a persisted `changes` payload; returns undefined when malformed.
 *  Rejects the WHOLE payload on one bad element rather than filtering: a
 *  partial diff reads as a complete one, which is worse than no diff. */
function sanitizeChanges(v: unknown): readonly FieldChange[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || !v.every(isFieldChange)) return undefined;
  return v.slice(0, MAX_FIELD_CHANGES) as FieldChange[];
}

const ACTIVITY_STORAGE_KEY = "aipm-cockpit:activity-log";
export const ACTIVITY_MAX_ENTRIES = 500;

const DEVICE_ID_KEY = "aipm-cockpit:device-id";

let deviceIdCache: string | null = null;
let sessionNonce: string | null = null;
let counter = 0;

/** Short random token. Not cryptographic — the only property required is
 *  non-collision between devices and between sessions on one device. */
function mintToken(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Per-device identifier, minted once and reused. NOT a secret — it must never
 * join the `SecretId` union. `clearAppConfig()` wipes it; a regenerated id is
 * harmless, because the only property required of it is non-collision with
 * other devices.
 *
 * ★ Called from event handlers only, never a component render body — the
 * react-hooks purity rule makes `Date.now()` / `Math.random()` there fatal.
 */
export function getDeviceId(): string {
  if (deviceIdCache) return deviceIdCache;
  if (typeof window === "undefined") {
    // SSR: no localStorage to persist into. Mint an ephemeral id for this
    // render only — never cached, so a real client call still hydrates from
    // (or seeds) localStorage on its own.
    return mintToken();
  }
  let id: string | null = null;
  try {
    id = window.localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    // localStorage disabled — fall through and mint an ephemeral id.
  }
  if (!id) {
    id = mintToken();
    try {
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      // non-fatal: an ephemeral id still cannot collide with another device.
    }
  }
  deviceIdCache = id;
  return id;
}

/**
 * Per-SESSION token, minted once per module evaluation and never persisted.
 *
 * ★★★ This exists because `counter` is module scope while `deviceId` is in
 * localStorage: a reload resets the counter but restores the device id, so
 * `"<deviceId>-<counter>"` alone re-mints `<dev>-1` on every page load. Two
 * genuinely different entries then share an id, `mergeActivityLogs` unions by
 * id, and one of them is silently discarded — the exact loss this whole slice
 * exists to prevent, moved from cross-device to cross-session. Measured with a
 * `vi.resetModules()` probe before this was added; pinned by the
 * "does not re-mint the same id after a module reload" test.
 *
 * ★ Deliberately NOT persisted. Persisting it would make it a second device id;
 * the point is that it changes on every load.
 */
function getSessionNonce(): string {
  if (!sessionNonce) sessionNonce = mintToken();
  return sessionNonce;
}

/** Maps each kind to the translation key whose template formats the entry. */
export const ACTIVITY_KIND_TO_KEY: Record<ActivityKind, TranslationKey> = {
  "task.created": "activityTaskCreated",
  "task.updated": "activityTaskUpdated",
  "task.deleted": "activityTaskDeleted",
  "task.completed": "activityTaskCompleted",
  "task.reopened": "activityTaskReopened",
  "raid.created": "activityRaidCreated",
  "raid.updated": "activityRaidUpdated",
  "raid.deleted": "activityRaidDeleted",
  "raid.statusChanged": "activityRaidStatusChanged",
  "raid.autoIssue": "activityRaidAutoIssue",
  "bulk.edit": "activityBulkEdit",
  "bulk.delete": "activityBulkDelete",
  "bulk.inquiries": "activityBulkInquiries",
  "jira.sync": "activityJiraSync",
  "absence.created": "activityAbsenceCreated",
  "absence.updated": "activityAbsenceUpdated",
  "absence.deleted": "activityAbsenceDeleted",
  "shift.created": "activityShiftCreated",
  "shift.updated": "activityShiftUpdated",
  "shift.deleted": "activityShiftDeleted",
  "calendarEvent.created": "activityCalendarEventCreated",
  "calendarEvent.updated": "activityCalendarEventUpdated",
  "calendarEvent.deleted": "activityCalendarEventDeleted",
  "milestone.created": "activityMilestoneCreated",
  "milestone.updated": "activityMilestoneUpdated",
  "milestone.deleted": "activityMilestoneDeleted",
  "change.created": "activityChangeCreated",
  "change.updated": "activityChangeUpdated",
  "change.deleted": "activityChangeDeleted",
  "stakeholder.created": "activityStakeholderCreated",
  "stakeholder.updated": "activityStakeholderUpdated",
  "stakeholder.deleted": "activityStakeholderDeleted",
  "resource.created": "activityResourceCreated",
  "resource.updated": "activityResourceUpdated",
  "resource.deleted": "activityResourceDeleted",
  "role.created": "activityRoleCreated",
  "role.updated": "activityRoleUpdated",
  "role.deleted": "activityRoleDeleted",
  "budget.created": "activityBudgetCreated",
  "budget.updated": "activityBudgetUpdated",
  "budget.deleted": "activityBudgetDeleted",
  "discipline.deleted": "activityDisciplineDeleted",
  "grade.deleted": "activityGradeDeleted",
  "settings.updated": "activitySettingsUpdated", // no args — no {0}/{1} placeholder
  "doc.linkAdded": "activityDocLinkAdded",
  "doc.linkRemoved": "activityDocLinkRemoved",
  "history.restore": "activityHistoryRestore",
  "calendar.autoPulled": "activityCalendarAutoPulled",
  "ai.inlineEdit": "activityAiInlineEdit",
  "ai.taskDedup": "activityAiTaskDedup",
  "ai.insightRecommendation": "activityAiInsightRecommendation",
  "ai.allocationPlan": "activityAiAllocationPlan",
  "ai.raciSuggest": "activityAiRaciSuggest",
  "ai.documentWrite": "activityAiDocumentWrite",
  "undo": "activityUndo",
  "redo": "activityRedo",
};

/** Top-level grouping derived from the kind string prefix. Used by the
 *  Activity panel's group filter (All / Tasks / RAID / Bulk / Jira / General). */
export type ActivityGroup = "tasks" | "raid" | "bulk" | "jira" | "general";

export function activityGroupOf(kind: ActivityKind): ActivityGroup {
  if (kind.startsWith("task.")) return "tasks";
  if (kind.startsWith("raid.")) return "raid";
  if (kind.startsWith("bulk.")) return "bulk";
  if (kind.startsWith("jira.")) return "jira";
  return "general";
}

/**
 * Translation key formatting a stored `kind`, or null when THIS build does not
 * know it — an entry written by a newer release, which is kept rather than
 * dropped (see `sanitizeActivityEntry`) and rendered generically.
 *
 * ★★ The own-property check is load-bearing, not defensive noise: a bare
 * `ACTIVITY_KIND_TO_KEY[kind]` resolves `kind: "toString"` to
 * `Function.prototype.toString`, `t()` then looks that up in the dict, misses,
 * and throws on `undefined.replace` — the same full-screen crash an unknown
 * kind used to cause.
 */
export function activityMessageKey(kind: string): TranslationKey | null {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_KIND_TO_KEY, kind)
    ? ACTIVITY_KIND_TO_KEY[kind as ActivityKind]
    : null;
}

/**
 * The workspace LOAD boundary for the whole log. DOM-free — it runs under
 * bare node in `scripts/generate-sample-workspace.ts`. Drops malformed
 * entries, strips a malformed per-entry `changes` payload, and caps to the
 * newest ACTIVITY_MAX_ENTRIES.
 *
 * ★ It lives HERE rather than in workspace.ts because every part it is built
 * from — the entry shape, the per-entry rules, the cap — is owned by this
 * module; the version in workspace.ts was a shell importing all three back.
 */
export function sanitizeActivityLog(v: unknown): ActivityEntry[] {
  if (!Array.isArray(v)) return [];
  const valid = v.map((e) => sanitizeActivityEntry(e)).filter((e): e is ActivityEntry => e !== null);
  return valid.length > ACTIVITY_MAX_ENTRIES ? valid.slice(-ACTIVITY_MAX_ENTRIES) : valid;
}

/**
 * Per-entry validation behind `sanitizeActivityLog` above. Returns null for an
 * entry to drop. DOM-free.
 *
 * ★★★ AN UNKNOWN-BUT-WELL-FORMED (string) `kind` IS KEPT ON PURPOSE, unlike
 * the retired localStorage-era `isActivityEntry`, which dropped it. That was
 * right for a device-local blob and is WRONG here: the log is shared workspace
 * data now, the loaded value becomes app state, and the autosave writes that
 * state straight back to the backend — so an older client dropping a kind a
 * newer release added would DELETE those entries from the shared project. A
 * generic render (`activityMessageKey` → null → the `activityUnknownKind`
 * fallback) is strictly better than silent cross-version data loss.
 *
 * ★ A non-string / absent `kind` is CORRUPTION rather than forward-compat and
 * IS dropped — `activityGroupOf` calls `kind.startsWith`, and there is nothing
 * honest to display. A malformed `changes` payload is stripped while the entry
 * itself is kept: the audit record is still real, only its diff detail is not.
 * A non-string `actor` makes the same trade for the same reason, while a string
 * one this release does not know is KEPT, exactly as an unknown `kind` is.
 *
 * ★ An untouched entry is returned BY REFERENCE and a repaired one is built by
 * SPREAD, never from a known-field list — a field a newer release adds to
 * `ActivityEntry` must survive an older client's load+save round trip for the
 * same reason the unknown kind must.
 */
export function sanitizeActivityEntry(v: unknown): ActivityEntry | null {
  if (!v || typeof v !== "object") return null;
  const e = v as {
    id?: unknown; timestamp?: unknown; kind?: unknown; args?: unknown;
    changes?: unknown; actor?: unknown;
  };
  if (typeof e.id !== "string" || e.id.length === 0) return null;
  if (typeof e.timestamp !== "string") return null;
  if (typeof e.kind !== "string") return null;
  if (!Array.isArray(e.args)) return null;

  // ★★ The early return guards on ALL THREE repairs. Keeping it at `changes ===
  // undefined` alone would return a hostile actor untouched whenever `changes`
  // happened to be absent — the COMMON case, so the bug would be invisible in
  // most fixtures. `argsBad` joined it for the same reason (§164): this branch
  // returns the ORIGINAL object by reference, so a repair omitted here does not
  // happen at all on the overwhelmingly common `changes === undefined` path.
  const actorBad = e.actor !== undefined && typeof e.actor !== "string";
  // ★★ DENSIFY FIRST. `Array.prototype.some`/`map` SKIP HOLES, so a sparse
  //   `args` (`new Array(2)`) reported clean, took the by-reference fast path
  //   below, and rendered "undefined" in the audit row — the same class of
  //   silent wrongness the coercion exists to prevent, arriving through the one
  //   shape neither method can see. `Array.from` turns each hole into an
  //   explicit `undefined`, which then fails the type test and is coerced like
  //   any other bad element.
  // ★★ NOT FROM A HAND-EDITED JSON BLOB — an earlier wording cited `[1, , 3]`
  //   "from a hand-edited blob" as the motivating case and that is impossible:
  //   JSON has no hole literal, so no JSON/CSV/MD/Turso load path can produce
  //   one. The only real producer is a structured-clone write into IndexedDB.
  //   The guard is still worth its cost, but do not justify it with a source
  //   that cannot reach it — that is how a guard gets deleted later by someone
  //   who checks the stated reason and finds it false.
  // ★ It trades an O(1) early exit for an O(n) materialisation on every entry:
  //   `.some` short-circuits and skips holes, `Array.from` walks the whole
  //   array first. Accepted — `args` is a handful of elements.
  const args: unknown[] = Array.from(e.args);
  const argsBad = args.some((a) => typeof a !== "string" && typeof a !== "number");
  if (e.changes === undefined && !actorBad && !argsBad) return v as ActivityEntry;

  const repaired: Record<string, unknown> = { ...(v as object) };
  if (actorBad) delete repaired.actor;
  // ★★★ COERCE IN PLACE — never FILTER, and never drop the entry (§164).
  //   `args` is POSITIONAL: renderers call `t(lang, key, ...entry.args)` and the
  //   dict interpolates `{0}`/`{1}`. Removing a bad element therefore SHIFTS
  //   every later argument into the wrong slot, turning a crash into silently
  //   wrong audit text — which is worse, because nothing looks broken. Dropping
  //   the whole ENTRY is also wrong: the log is shared workspace data that the
  //   autosave writes straight back, the same reason an unknown-but-string
  //   `kind` is KEPT above, so a client meeting one corrupt row would delete it
  //   for everyone. Substituting "" preserves arity, the row, and every other
  //   argument.
  // ★★ Why this must exist at the LOAD boundary and not at the reader: `t()`
  //   interpolates with `String(a)`, and a non-callable own `toString` makes
  //   ToPrimitive fall through to `Object.prototype.valueOf`, which hands the
  //   object back and THROWS "Cannot convert object to primitive value". The
  //   Activity panel had a local guard; `renderActivityEntry` did not, and it
  //   runs inside `runTool` — so one hand-edited JSON blob killed a chat turn
  //   rather than failing to paint a table. Two consumers had to rediscover it.
  if (argsBad) {
    repaired.args = args.map((a) => (typeof a === "string" || typeof a === "number" ? a : ""));
  }
  if (e.changes !== undefined) {
    const changes = sanitizeChanges(e.changes);
    if (changes) repaired.changes = changes;
    else delete repaired.changes;
  }
  return repaired as unknown as ActivityEntry;
}

/**
 * Removes the pre-upgrade device-local log. The entries are NOT imported: the
 * old key was a single global stream with no project id, so on a device that
 * had opened several projects every entry would be mis-attributed to whichever
 * project happened to be open. Dropping is the only honest option — recorded in
 * CHANGELOG.md and surfaced as a version highlight.
 */
export function dropLegacyActivityLog(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACTIVITY_STORAGE_KEY);
  } catch {
    // non-fatal
  }
}

/**
 * Returns a new array with the entry appended and the array capped at
 * ACTIVITY_MAX_ENTRIES (oldest entries dropped). Pure — caller owns state.
 */
export function appendActivity(
  current: readonly ActivityEntry[],
  kind: ActivityKind,
  ...args: (string | number)[]
): ActivityEntry[] {
  return appendActivityEntry(current, kind, args);
}

/**
 * Like `appendActivity` but with an explicit `args` array, an optional per-field
 * `changes` diff (UPDATE audit detail) and an optional `actor`.
 *
 * ★★ BOTH OPTIONALS ARE CONDITIONAL SPREADS, NOT PLAIN PROPERTIES, and that is
 * load-bearing rather than tidiness: `{ actor }` with an undefined `actor` puts
 * an `actor: undefined` key on EVERY entry, which changes the JSON bytes on all
 * six write paths and breaks the byte-stability fixtures. The tests assert
 * `"actor" in entry === false` precisely because `toBeUndefined()` cannot tell
 * an omitted key from a present-and-undefined one.
 *
 * ★ `appendActivity` gets no actor parameter: it ends in a rest parameter, so
 * nothing can follow it. A caller wanting an actor uses this function (or the
 * `logActivityAs` hook variant, where the actor LEADS for the same reason).
 */
export function appendActivityEntry(
  current: readonly ActivityEntry[],
  kind: ActivityKind,
  args: (string | number)[],
  changes?: readonly FieldChange[],
  actor?: ActivityActor,
): ActivityEntry[] {
  const entry: ActivityEntry = {
    id: `${getDeviceId()}-${getSessionNonce()}-${++counter}`,
    timestamp: new Date().toISOString(),
    kind,
    args,
    ...(changes && changes.length > 0 ? { changes } : {}),
    ...(actor ? { actor } : {}),
  };
  const next = [...current, entry];
  return next.length > ACTIVITY_MAX_ENTRIES
    ? next.slice(-ACTIVITY_MAX_ENTRIES)
    : next;
}
