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
  | "shift.deleted";

export interface ActivityEntry {
  /** Monotonic id within the current log; not a timestamp. Used as a React key. */
  id: number;
  /** ISO 8601 UTC timestamp captured at append time. */
  timestamp: string;
  kind: ActivityKind;
  /** Positional args interpolated into the i18n message at render time. */
  args: (string | number)[];
}

const ACTIVITY_STORAGE_KEY = "lop-app:activity-log";
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
};

const ACTIVITY_KINDS: ReadonlySet<ActivityKind> = new Set(
  Object.keys(ACTIVITY_KIND_TO_KEY) as ActivityKind[],
);

/** Top-level grouping derived from the kind string prefix. Used by the
 *  Activity panel's group filter (All / Tasks / RAID / Bulk / Jira). */
export type ActivityGroup = "tasks" | "raid" | "bulk" | "jira";

export function activityGroupOf(kind: ActivityKind): ActivityGroup {
  if (kind.startsWith("task.")) return "tasks";
  if (kind.startsWith("raid.")) return "raid";
  if (kind.startsWith("bulk.")) return "bulk";
  return "jira";
}

function isActivityKind(v: unknown): v is ActivityKind {
  return typeof v === "string" && ACTIVITY_KINDS.has(v as ActivityKind);
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
    const valid = parsed.filter(isActivityEntry);
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
  const entry: ActivityEntry = {
    id: current.length > 0 ? current[current.length - 1].id + 1 : 1,
    timestamp: new Date().toISOString(),
    kind,
    args,
  };
  const next = [...current, entry];
  return next.length > ACTIVITY_MAX_ENTRIES
    ? next.slice(-ACTIVITY_MAX_ENTRIES)
    : next;
}
