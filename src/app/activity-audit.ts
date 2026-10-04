// src/app/activity-audit.ts — the INTERNAL activity-log download (open-followups §510).
//
// The activity log is storage-only on every export and document path (docs/AGENTS/activity-log.md):
// an entry's `changes` carry old and new field values that must never reach a document handed to a
// client. This file is the one deliberate exception, and it is not an export section: an audit
// extraction for the people running the app, built here and downloaded from Settings (expert mode)
// as JSON marked internal. Owner ruling 2026-10-04: the field changes ARE included (they are the audit
// detail), and on a multi-project Turso database the file covers every project in the portfolio.
//
// ★★ The Settings placement is NOT access control. The app has no roles (§508), and expert mode is a
// preference anyone can switch on. What bounds the file is the storage credential: on Turso it holds
// exactly what a SQL client with the same token can already read.
//
// Pure: the caller supplies the logs, the clock and the version.

import type { ActivityActor, ActivityEntry, FieldChange } from "./activity-log";
import { activityMessage } from "./activity-message";

export const ACTIVITY_AUDIT_CLASSIFICATION = "internal — contains audit values; do not share with clients";

/** Every project in the portfolio (multi-project Turso), or the project open now (any other storage). */
export type ActivityAuditScope = "portfolio" | "current";

export interface ActivityAuditSource {
  id: string;
  name: string;
  archived: boolean;
  log: readonly ActivityEntry[];
  /** The STORED log could not be read at all. For any other project `log` is then empty for that
   *  reason, not for want of activity — the file must say so, or an auditor reads "nothing happened".
   *  The project open now contributes its live log instead, so it can carry this flag beside entries:
   *  the flag still describes the stored row. */
  logUnreadable?: boolean;
  /** Stored entries missing from `log`: malformed ones the sanitizer dropped, plus any beyond the
   *  `ACTIVITY_MAX_ENTRIES` cap it keeps. */
  entriesDropped?: number;
}

export interface ActivityAuditEntry {
  id: string;
  timestamp: string;
  kind: string;
  args: (string | number)[];
  /** Absent on entries written before actors were recorded: unknown, never defaulted. */
  actor?: ActivityActor;
  /** The entry rendered in English, so the file reads without the app. */
  message: string;
  changes?: readonly FieldChange[];
}

export interface ActivityAudit {
  classification: typeof ACTIVITY_AUDIT_CLASSIFICATION;
  exportedAt: string;
  appVersion: string;
  scope: ActivityAuditScope;
  projects: { id: string; name: string; archived: boolean; logUnreadable?: true; entriesDropped?: number; entries: ActivityAuditEntry[] }[];
}

function auditEntry(e: ActivityEntry): ActivityAuditEntry {
  return {
    id: e.id,
    timestamp: e.timestamp,
    kind: e.kind,
    args: [...e.args],
    ...(e.actor !== undefined ? { actor: e.actor } : {}),
    message: activityMessage("en-US", e.kind, e.args),
    ...(e.changes !== undefined ? { changes: e.changes.map((c) => ({ ...c })) } : {}),
  };
}

/** The download's content: projects by name, each project's entries oldest first (timestamps are
 *  canonical ISO strings, so a string compare is chronological — see `ActivityEntry.timestamp`). */
export function buildActivityAudit(scope: ActivityAuditScope, sources: readonly ActivityAuditSource[], now: Date, appVersion: string): ActivityAudit {
  return {
    classification: ACTIVITY_AUDIT_CLASSIFICATION,
    exportedAt: now.toISOString(),
    appVersion,
    scope,
    projects: [...sources]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        archived: s.archived,
        ...(s.logUnreadable ? { logUnreadable: true as const } : {}),
        ...(s.entriesDropped ? { entriesDropped: s.entriesDropped } : {}),
        entries: [...s.log].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0)).map(auditEntry),
      })),
  };
}

export function activityAuditFileName(now: Date): string {
  return `aipm-cockpit-INTERNAL-activity-audit-${now.toISOString().slice(0, 10)}.json`;
}
