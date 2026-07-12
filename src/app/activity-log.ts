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
  | "discipline.deleted"
  | "grade.deleted"
  | "settings.updated"
  | "doc.linkAdded"
  | "doc.linkRemoved"
  | "history.restore"
  | "calendar.autoPulled"
  | "ai.inlineEdit"
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
  /** Monotonic id within the current log; not a timestamp. Used as a React key. */
  id: number;
  /** ISO 8601 UTC timestamp captured at append time. */
  timestamp: string;
  kind: ActivityKind;
  /** Positional args interpolated into the i18n message at render time. */
  args: (string | number)[];
  /** Optional per-field diff for UPDATE events (audit detail). Omitted when the
   *  update produced no field changes. Per-device only (localStorage) — NOT a
   *  persisted Workspace field, excluded from exports/Turso. */
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

/** Validate a persisted `changes` payload; returns undefined when malformed. */
function sanitizeChanges(v: unknown): readonly FieldChange[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || !v.every(isFieldChange)) return undefined;
  return v.slice(0, MAX_FIELD_CHANGES) as FieldChange[];
}

const ACTIVITY_STORAGE_KEY = "aipm-cockpit:activity-log";
const ACTIVITY_MAX_ENTRIES = 500;

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
  "discipline.deleted": "activityDisciplineDeleted",
  "grade.deleted": "activityGradeDeleted",
  "settings.updated": "activitySettingsUpdated", // no args — no {0}/{1} placeholder
  "doc.linkAdded": "activityDocLinkAdded",
  "doc.linkRemoved": "activityDocLinkRemoved",
  "history.restore": "activityHistoryRestore",
  "calendar.autoPulled": "activityCalendarAutoPulled",
  "ai.inlineEdit": "activityAiInlineEdit",
  "undo": "activityUndo",
  "redo": "activityRedo",
};

const ACTIVITY_KINDS: ReadonlySet<ActivityKind> = new Set(
  Object.keys(ACTIVITY_KIND_TO_KEY) as ActivityKind[],
);

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

function isActivityKind(v: unknown): v is ActivityKind {
  return typeof v === "string" && ACTIVITY_KINDS.has(v as ActivityKind);
}

/** Strip a malformed `changes` payload from an otherwise-valid entry. */
function normalizeEntryChanges(e: ActivityEntry): ActivityEntry {
  const changes = sanitizeChanges((e as { changes?: unknown }).changes);
  if (changes) return { ...e, changes };
  if ((e as { changes?: unknown }).changes === undefined) return e;
  // A malformed changes payload was present — rebuild without it.
  return { id: e.id, timestamp: e.timestamp, kind: e.kind, args: e.args };
}

function isActivityEntry(v: unknown): v is ActivityEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Partial<ActivityEntry>;
  return (
    typeof e.id === "number" &&
    typeof e.timestamp === "string" &&
    isActivityKind(e.kind) &&
    Array.isArray(e.args)
  );
}

export function loadActivityLog(): ActivityEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isActivityEntry).map(normalizeEntryChanges);
    return valid.length > ACTIVITY_MAX_ENTRIES
      ? valid.slice(-ACTIVITY_MAX_ENTRIES)
      : valid;
  } catch {
    return [];
  }
}

export function saveActivityLog(entries: readonly ActivityEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const capped =
      entries.length > ACTIVITY_MAX_ENTRIES
        ? entries.slice(-ACTIVITY_MAX_ENTRIES)
        : entries;
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // localStorage full / disabled — non-fatal; user just won't see history.
  }
}

export function clearActivityLog(): void {
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
    id: current.length > 0 ? current[current.length - 1].id + 1 : 1,
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
