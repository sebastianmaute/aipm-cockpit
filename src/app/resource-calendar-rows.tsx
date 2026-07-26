"use client";

// Presentational row/cell rendering for the resource calendar grid, extracted
// from resource-calendar.tsx (the gantt-chrome/gantt-rows split convention)
// as the panel approaches the 800-line size ratchet. Pure — all data and
// handlers come in as props; CalendarRows owns no state.
//
// Shared with the orchestrator: the CalendarDay/CalendarAssignee types and
// the CELL_PX/ASSIGNEE_COL_PX layout constants live HERE (both the header row
// in resource-calendar.tsx and this file's cells need them) and are imported
// back by resource-calendar.tsx. This file imports nothing from
// resource-calendar.tsx, so that's a one-way dependency — no cycle.

import type { RefObject } from "react";
import { type Lang, t } from "./i18n";
import type { Absence, AbsenceType, Resource } from "./types";
import { absenceBg, absenceGlyph } from "./absence-style";
import { splitName } from "./resource-foundation";
import { INTERACTIVE } from "./interaction-styles";
import { resolveCalendarDrag, type DragMode } from "./calendar-drag";
import { DragHandle } from "./drag-handle";

export const CELL_PX = 40;
export const ASSIGNEE_COL_PX = 180;

export interface CalendarAssignee {
  /** Case-folded join key used to look up matching absences. */
  key: string;
  /** Original-case display name for the row label. */
  display: string;
  /** First non-empty email observed for this assignee (may be ""). */
  email: string;
}

export interface CalendarDay {
  iso: string;
  dayOfMonth: number;
  /** Localised short weekday, e.g. "Mon" / "Mo". */
  weekdayLabel: string;
  /** ISO-8601 week number (1-53) of this date. */
  isoWeek: number;
  /** Month label shown on the first day and at each month transition. */
  monthLabel: string;
  isWeekend: boolean;
  isHoliday: boolean;
  isToday: boolean;
}

/** The gesture currently in flight, tracked in a ref (not state) so the drop
 *  handler reads it synchronously without tearing the ghost mid-drag. */
export type CalendarDragState =
  | { absenceId: number; grabbedDate: string; rowKey: string; mode: DragMode }
  | null;

function localTypeLabel(type: AbsenceType, lang: Lang): string {
  switch (type) {
    case "vacation":
      return t(lang, "absenceTypeVacation");
    case "sick":
      return t(lang, "absenceTypeSick");
    case "training":
      return t(lang, "absenceTypeTraining");
    default:
      return t(lang, "absenceTypeOther");
  }
}

interface CalendarRowsProps {
  lang: Lang;
  visibleRows: readonly CalendarAssignee[];
  days: readonly CalendarDay[];
  resourceByKey: ReadonlyMap<string, Resource>;
  absences: readonly Absence[];
  /** Absence (if any) covering a given row+date — shared with the parent's
   *  keyboard move-mode entry check, so both agree on the same predicate. */
  hitFor: (rowKey: string, dateIso: string) => Absence | undefined;
  focusRow: number;
  focusCol: number;
  setFocusCell: (cell: { row: number; col: number }) => void;
  dragRef: RefObject<CalendarDragState>;
  suppressClickRef: RefObject<boolean>;
  onAddAbsence: (seed?: Partial<Absence>) => void;
  onEditAbsence: (absence: Absence) => void;
  /** Commit a drag/resize/reassign. Omit to make the grid read-only (popout). */
  onMoveAbsence?: (id: number, patch: Partial<Absence>, kind: "move" | "reassign" | "resize") => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
}

/** The `<tbody>` of the resource calendar grid: one row per assignee, one
 *  cell per date. Moved verbatim out of resource-calendar.tsx — no behaviour
 *  change, matching the gantt-chrome/gantt-rows split convention. */
export function CalendarRows({
  lang,
  visibleRows,
  days,
  resourceByKey,
  absences,
  hitFor,
  focusRow,
  focusCol,
  setFocusCell,
  dragRef,
  suppressClickRef,
  onAddAbsence,
  onEditAbsence,
  onMoveAbsence,
  onEditResource,
  onAddResource,
}: CalendarRowsProps) {
  return (
    <tbody>
      {visibleRows.map((row, rowIndex) => {
        return (
          <tr key={row.key} role="row">
            <td
              role="rowheader"
              className="sticky left-0 z-10 border-b border-r border-line bg-surface px-2 py-1"
              style={{
                minWidth: ASSIGNEE_COL_PX,
                width: ASSIGNEE_COL_PX,
              }}
            >
              {(() => {
                const res = resourceByKey.get(row.key);
                return (
                  <button
                    type="button"
                    onClick={() =>
                      res
                        ? onEditResource(res)
                        : onAddResource({ ...splitName(row.display), email: row.email || undefined })
                    }
                    title={row.display}
                    className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green"
                  >
                    {row.display}
                  </button>
                );
              })()}
            </td>
            {days.map((d, colIndex) => {
              const hit = hitFor(row.key, d.iso);
              const baseBg = hit
                ? absenceBg(hit.type)
                : d.isToday
                  ? "bg-ui-green/15 hover:bg-ui-green/25 dark:bg-ui-green/15 dark:hover:bg-ui-green/25"
                  : d.isHoliday
                    ? "bg-ui-purple/10 hover:bg-ui-purple/20 dark:bg-ui-purple/15 dark:hover:bg-ui-purple/25"
                    : d.isWeekend
                      ? "bg-surface-muted hover:bg-ui-medium-grey/20 dark:hover:bg-ui-medium-grey/20"
                      : "bg-surface hover:bg-surface-muted";
              const handleClick = hit
                ? () => onEditAbsence(hit)
                : () =>
                    onAddAbsence({
                      assignee: row.display,
                      assigneeEmail: row.email || undefined,
                      startDate: d.iso,
                      endDate: d.iso,
                    });
              const tip = hit
                ? `${localTypeLabel(hit.type, lang)} — ${hit.startDate}${
                    hit.startDate === hit.endDate
                      ? ""
                      : `–${hit.endDate}`
                  }${hit.note ? `: ${hit.note}` : ""}`
                : `${row.display} — ${d.iso}`;
              return (
                <td
                  key={d.iso}
                  role="gridcell"
                  className="relative border-b border-r border-line p-0"
                  style={{
                    minWidth: CELL_PX,
                    width: CELL_PX,
                    height: CELL_PX,
                  }}
                >
                  <button
                    type="button"
                    data-cell={`${rowIndex}-${colIndex}`}
                    draggable={!!hit && !!onMoveAbsence}
                    onDragStart={(e) => {
                      if (!hit || !onMoveAbsence) return;
                      dragRef.current = { absenceId: hit.id, grabbedDate: d.iso, rowKey: row.key, mode: "move" };
                      e.dataTransfer.effectAllowed = "move";
                      // Firefox requires data to be set or the drag never starts.
                      e.dataTransfer.setData("text/plain", String(hit.id));
                    }}
                    onDragOver={(e) => {
                      if (!dragRef.current || !onMoveAbsence) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      const drag = dragRef.current;
                      dragRef.current = null;
                      if (!drag || !onMoveAbsence) return;
                      e.preventDefault();
                      suppressClickRef.current = true;
                      const moving = absences.find((a) => a.id === drag.absenceId);
                      if (!moving) return;
                      const result = resolveCalendarDrag({
                        absence: moving,
                        grabbedDate: drag.grabbedDate,
                        dropDate: d.iso,
                        mode: drag.mode,
                        target: row.key === drag.rowKey
                          ? { kind: "same-row" }
                          : {
                              kind: "other-row",
                              rowKey: row.key,
                              row: { display: row.display, email: row.email, resource: resourceByKey.get(row.key) },
                            },
                      });
                      if (result) onMoveAbsence(moving.id, result.patch, result.kind);
                    }}
                    onDragEnd={() => { dragRef.current = null; }}
                    tabIndex={rowIndex === focusRow && colIndex === focusCol ? 0 : -1}
                    onClick={() => {
                      if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                      setFocusCell({ row: rowIndex, col: colIndex });
                      handleClick();
                    }}
                    title={tip}
                    aria-label={tip}
                    className={`flex h-full w-full items-center justify-center text-[11px] font-semibold tabular-nums focus:ring-inset ${INTERACTIVE} ${baseBg}`}
                  >
                    {hit ? (
                      <span className="text-foreground">
                        {absenceGlyph(hit.type)}
                      </span>
                    ) : null}
                  </button>
                  {hit && onMoveAbsence && d.iso === hit.startDate ? (
                    <span
                      title={t(lang, "calendarResizeStart")}
                      onDragEnd={() => { dragRef.current = null; }}
                      className="absolute inset-y-0 left-0 w-2"
                    >
                      <DragHandle
                        draggable
                        onDragStart={(e) => {
                          dragRef.current = { absenceId: hit.id, grabbedDate: d.iso, rowKey: row.key, mode: "resize-start" };
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(hit.id));
                          e.stopPropagation();
                        }}
                        className="h-full w-full cursor-ew-resize"
                      />
                    </span>
                  ) : null}
                  {hit && onMoveAbsence && d.iso === hit.endDate ? (
                    <span
                      title={t(lang, "calendarResizeEnd")}
                      onDragEnd={() => { dragRef.current = null; }}
                      className="absolute inset-y-0 right-0 w-2"
                    >
                      <DragHandle
                        draggable
                        onDragStart={(e) => {
                          dragRef.current = { absenceId: hit.id, grabbedDate: d.iso, rowKey: row.key, mode: "resize-end" };
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(hit.id));
                          e.stopPropagation();
                        }}
                        className="h-full w-full cursor-ew-resize"
                      />
                    </span>
                  ) : null}
                </td>
              );
            })}
          </tr>
        );
      })}
    </tbody>
  );
}
