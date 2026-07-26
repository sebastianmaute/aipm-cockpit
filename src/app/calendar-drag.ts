// Pure resolution of a calendar grid gesture (drag-move, drag-reassign,
// edge-resize) into an Absence patch. i18n-free, clock-free, no React.
//
// The component decides WHICH gesture happened; this module decides what the
// gesture MEANS. Everything the caller needs to write is in `patch` — the
// caller never recomputes a date.

import { clampRangeEnd } from "./date-range";
import { resourceDisplayName } from "./resource-foundation";
import type { Absence, Resource } from "./types";

export type DragMode = "move" | "resize-start" | "resize-end";

export interface DragDropRow {
  /** Original-case display name of the target row. */
  display: string;
  /** First email observed for that row; "" when unknown. */
  email: string;
  /** Backing directory resource, when the row has one. */
  resource: Resource | undefined;
}

export interface CalendarDragInput {
  absence: Absence;
  /** The date cell the gesture STARTED on. */
  grabbedDate: string;
  /** The date cell the gesture ENDED on. */
  dropDate: string;
  currentRowKey: string;
  dropRowKey: string;
  mode: DragMode;
  /** Required only when dropRowKey differs from currentRowKey. */
  dropRow?: DragDropRow;
}

export interface CalendarDragResult {
  kind: "move" | "reassign" | "resize";
  patch: Partial<Absence>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toUtc(iso: string): number | null {
  if (!ISO_DATE.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Resolve a grid gesture into an Absence patch, or `null` when it is a no-op
 * or the input is unusable. A `null` result must write nothing — that is what
 * keeps a stray click from being recorded as an edit.
 *
 * The patch always carries BOTH dates, even when only one moved, so the caller
 * writes one coherent range and an undo entry restores one coherent range.
 */
export function resolveCalendarDrag(input: CalendarDragInput): CalendarDragResult | null {
  const { absence, grabbedDate, dropDate, currentRowKey, dropRowKey, mode, dropRow } = input;

  // Validate every date up front — a malformed stored or dropped date must
  // never fall through into NaN-driven arithmetic below.
  if (toUtc(dropDate) === null) return null;
  if (toUtc(grabbedDate) === null) return null;
  if (toUtc(absence.startDate) === null) return null;
  if (toUtc(absence.endDate) === null) return null;

  const rowChanged = dropRowKey !== currentRowKey;

  if (mode === "resize-start") {
    if (dropDate === absence.startDate) return null;
    // Clamp forwards: a start dragged past the end collapses to a single day.
    const nextEnd = clampRangeEnd(dropDate, absence.endDate);
    return { kind: "resize", patch: { startDate: dropDate, endDate: nextEnd } };
  }

  if (mode === "resize-end") {
    if (dropDate === absence.endDate) return null;
    // Clamp backwards: an end dragged before the start collapses to a single day.
    const nextEnd = clampRangeEnd(absence.startDate, dropDate);
    return { kind: "resize", patch: { startDate: absence.startDate, endDate: nextEnd } };
  }

  const deltaDays = Math.round((toUtc(dropDate)! - toUtc(grabbedDate)!) / DAY_MS);
  if (deltaDays === 0 && !rowChanged) return null;

  const patch: Partial<Absence> = {
    startDate: addDays(absence.startDate, deltaDays),
    endDate: addDays(absence.endDate, deltaDays),
  };

  if (!rowChanged) return { kind: "move", patch };

  // A reassign rewrites all three identity fields together. Writing the name
  // without the FK would leave the absence pointing at the previous person's
  // resource record, which every downstream rollup reads.
  const res = dropRow?.resource;
  return {
    kind: "reassign",
    patch: {
      ...patch,
      assignee: res ? resourceDisplayName(res) : (dropRow?.display ?? absence.assignee),
      assigneeEmail: (res?.email || dropRow?.email) || undefined,
      resourceId: res?.id,
    },
  };
}
