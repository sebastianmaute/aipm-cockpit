// Pure resolution of a calendar grid gesture (drag-move, drag-reassign,
// edge-resize) into an Absence patch. i18n-free, clock-free, no React.
//
// The component decides WHICH gesture happened; this module decides what the
// gesture MEANS. Everything the caller needs to write is in `patch` — the
// caller never recomputes a date.

import { clampRangeEnd } from "./date-range";
import { iso, parseUtc } from "./calendar-window";
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

/**
 * Where a drag/resize gesture ended, keyed so an incomplete row change can't
 * be expressed: a caller can say "this landed on a different row" only by
 * also supplying which row — there is no state where `other-row` is missing
 * its `row`, so the resolver never has to guess or silently degrade.
 */
export type DropTarget =
  | { kind: "same-row" }
  | { kind: "other-row"; rowKey: string; row: DragDropRow };

export interface CalendarDragInput {
  absence: Absence;
  /** The date cell the gesture STARTED on. */
  grabbedDate: string;
  /** The date cell the gesture ENDED on. */
  dropDate: string;
  mode: DragMode;
  target: DropTarget;
}

export interface CalendarDragResult {
  kind: "move" | "reassign" | "resize";
  patch: Partial<Absence>;
}

const DAY_MS = 86_400_000;

/**
 * Resolve a grid gesture into an Absence patch, or `null` when it is a no-op
 * or the input is unusable. A `null` result must write nothing — that is what
 * keeps a stray click from being recorded as an edit.
 *
 * The patch always carries BOTH dates, even when only one moved, so the caller
 * writes one coherent range and an undo entry restores one coherent range.
 */
export function resolveCalendarDrag(input: CalendarDragInput): CalendarDragResult | null {
  const { absence, grabbedDate, dropDate, mode, target } = input;

  // Validate every date up front via the shared UTC parser (calendar-window.ts) —
  // it checks shape and range, not full calendar validity, but that's enough:
  // grid dates come from real iterated Date objects and stored dates are
  // sanitizer-validated, so a malformed value here only ever means "unusable
  // input", and it must never fall through into date arithmetic below.
  const dropUtc = parseUtc(dropDate);
  const grabbedUtc = parseUtc(grabbedDate);
  const startUtc = parseUtc(absence.startDate);
  const endUtc = parseUtc(absence.endDate);
  if (!dropUtc || !grabbedUtc || !startUtc || !endUtc) return null;

  const rowChanged = target.kind === "other-row";

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

  const deltaDays = Math.round((dropUtc.valueOf() - grabbedUtc.valueOf()) / DAY_MS);
  if (deltaDays === 0 && !rowChanged) return null;

  const patch: Partial<Absence> = {
    startDate: iso(new Date(startUtc.valueOf() + deltaDays * DAY_MS)),
    endDate: iso(new Date(endUtc.valueOf() + deltaDays * DAY_MS)),
  };

  if (!rowChanged) return { kind: "move", patch };

  // A reassign rewrites all three identity fields together. Writing the name
  // without the FK would leave the absence pointing at the previous person's
  // resource record, which every downstream rollup reads. `target.row` is
  // guaranteed present here by the DropTarget union, so there is no
  // missing-row fallback left to trust.
  const res = target.row.resource;
  return {
    kind: "reassign",
    patch: {
      ...patch,
      assignee: res ? resourceDisplayName(res) : target.row.display,
      assigneeEmail: (res?.email || target.row.email) || undefined,
      resourceId: res?.id,
    },
  };
}
