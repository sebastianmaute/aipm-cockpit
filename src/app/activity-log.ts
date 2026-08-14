// Activity log — chronological record of CRUD-ish user actions, persisted to
// localStorage so it survives reloads but stays out of the workspace export
// path. The user instruction was "non-persistent, not written to file, just
// local storage" — interpreted as: keep entries in this browser only, never
// in any CSV/MD/JSON file the user might export or share.
//
// Capped at ACTIVITY_MAX_ENTRIES; oldest entries are dropped on overflow so
// the localStorage value can't grow unbounded.

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
  /** Optional per-field diff for UPDATE events (audit detail). Omitted when the
   *  update produced no field changes. */
  changes?: readonly FieldChange[];
}

/** Max field-changes recorded per entry, and max chars per value. */
const MAX_FIELD_CHANGES = 12;
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
 * Per-entry validation for the workspace LOAD boundary (`sanitizeActivityLog`
 * in workspace.ts). Returns null for an entry to drop. DOM-free.
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
 *
 * ★ An untouched entry is returned BY REFERENCE and a repaired one is built by
 * SPREAD, never from a known-field list — a field a newer release adds to
 * `ActivityEntry` must survive an older client's load+save round trip for the
 * same reason the unknown kind must.
 */
export function sanitizeActivityEntry(v: unknown): ActivityEntry | null {
  if (!v || typeof v !== "object") return null;
  const e = v as { id?: unknown; timestamp?: unknown; kind?: unknown; args?: unknown; changes?: unknown };
  if (typeof e.id !== "string" || e.id.length === 0) return null;
  if (typeof e.timestamp !== "string") return null;
  if (typeof e.kind !== "string") return null;
  if (!Array.isArray(e.args)) return null;
  if (e.changes === undefined) return v as ActivityEntry;
  const changes = sanitizeChanges(e.changes);
  if (changes) return { ...(v as ActivityEntry), changes };
  const stripped: Record<string, unknown> = { ...(v as object) };
  delete stripped.changes;
  return stripped as unknown as ActivityEntry;
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
 * Like `appendActivity` but with an explicit `args` array and an optional
 * per-field `changes` diff (UPDATE audit detail). An empty/absent `changes`
 * list omits the key entirely, keeping changes-less entries byte-identical to
 * the plain `appendActivity` path.
 */
export function appendActivityEntry(
  current: readonly ActivityEntry[],
  kind: ActivityKind,
  args: (string | number)[],
  changes?: readonly FieldChange[],
): ActivityEntry[] {
  const entry: ActivityEntry = {
    id: `${getDeviceId()}-${getSessionNonce()}-${++counter}`,
    timestamp: new Date().toISOString(),
    kind,
    args,
    ...(changes && changes.length > 0 ? { changes } : {}),
  };
  const next = [...current, entry];
  return next.length > ACTIVITY_MAX_ENTRIES
    ? next.slice(-ACTIVITY_MAX_ENTRIES)
    : next;
}
