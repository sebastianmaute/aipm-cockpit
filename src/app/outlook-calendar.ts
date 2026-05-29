// src/app/outlook-calendar.ts
//
// Pure core for the Outlook calendar import (M4). No React, no window, no
// fetch — the Graph token + I/O live in use-outlook-calendar.ts. Filters
// /me/calendarView events to "time away" and merges the selected ones into
// Absence records on the resource calendar.

import type { Absence, AbsenceType } from "./types";
import { isoAddDays } from "./due-dates";

/** Raw Graph /me/calendarView item (subset we $select). */
export interface GraphEvent {
  id?: string;
  subject?: string | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  isAllDay?: boolean | null;
  showAs?: string | null;
}

/** Normalized event, already filtered to time-away. */
export interface OutlookEvent {
  sourceId: string;
  subject: string;
  startDate: string; // "YYYY-MM-DD" inclusive
  endDate: string;   // "YYYY-MM-DD" inclusive
  isAllDay: boolean;
  showAs: string;
}

/** Time-away = an all-day block or an explicit Out-of-Office event. */
export function isTimeAway(raw: GraphEvent): boolean {
  return raw.isAllDay === true || raw.showAs === "oof";
}

function dateSlice(dt?: string | null): string | null {
  if (typeof dt !== "string") return null;
  const m = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function mapGraphEvent(raw: GraphEvent, index: number): OutlookEvent | null {
  if (!isTimeAway(raw)) return null;
  const startDate = dateSlice(raw.start?.dateTime);
  if (!startDate) return null;
  const isAllDay = raw.isAllDay === true;
  const endRaw = dateSlice(raw.end?.dateTime) ?? startDate;
  // Graph all-day `end` is exclusive (one-day event ends next midnight) →
  // pull it back a day to an inclusive end. Timed OOF events use the slice.
  let endDate = isAllDay ? isoAddDays(endRaw, -1) : endRaw;
  if (endDate < startDate) endDate = startDate; // defensive clamp
  return {
    sourceId: (typeof raw.id === "string" && raw.id) ? raw.id : `event-${index}`,
    subject: (raw.subject ?? "").trim(),
    startDate,
    endDate,
    isAllDay,
    showAs: typeof raw.showAs === "string" ? raw.showAs : "",
  };
}

/** Stable dedupe key: normalized assignee + date range. */
export function dedupeKey(assignee: string, startDate: string, endDate: string): string {
  return `${assignee.trim().toLowerCase()}|${startDate}|${endDate}`;
}

export interface AbsenceImportTarget {
  assignee: string;
  assigneeEmail?: string;
  resourceId?: number;
}

/**
 * Merge selected events (with their chosen types) into the absence list,
 * attributed to `target` (the signed-in user). Dedups against existing
 * absences by assignee+date-range. New ids continue from max(existing)+1.
 * Pure: the caller passes the `localModifiedAt` stamp. Immutable.
 */
export function eventsToAbsences(
  rows: readonly { event: OutlookEvent; type: AbsenceType }[],
  existing: readonly Absence[],
  target: AbsenceImportTarget,
  stamp: string,
): Absence[] {
  const seen = new Set(existing.map((a) => dedupeKey(a.assignee, a.startDate, a.endDate)));
  let nextId = existing.length > 0 ? Math.max(...existing.map((a) => a.id)) + 1 : 1;
  const created: Absence[] = [];
  for (const { event, type } of rows) {
    const key = dedupeKey(target.assignee, event.startDate, event.endDate);
    if (seen.has(key)) continue;
    seen.add(key);
    const absence: Absence = {
      id: nextId++,
      assignee: target.assignee,
      startDate: event.startDate,
      endDate: event.endDate,
      type,
      localModifiedAt: stamp,
    };
    if (target.assigneeEmail) absence.assigneeEmail = target.assigneeEmail;
    if (event.subject) absence.note = event.subject;
    if (target.resourceId !== undefined) absence.resourceId = target.resourceId;
    created.push(absence);
  }
  return [...existing, ...created];
}
