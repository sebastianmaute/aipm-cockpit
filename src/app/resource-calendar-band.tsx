"use client";

// Meetings band — lanes of recurring-event occurrences rendered as extra
// <tbody> rows ABOVE the assignee rows, INSIDE THE SAME <table> as the
// resource-calendar grid — that shared table is what keeps the band's day
// columns aligned with the day headers and the assignee rows below it.
//
// ★★ Band cells deliberately carry `data-band-cell`, NOT `data-cell`: the
// grid's roving-tabindex model (resource-calendar.tsx onGridKeyDown) indexes
// `data-cell` by row/column and treats exactly one such element as the tab
// stop. A band cell caught in that selector would silently add a second tab
// stop — precisely the class of regression Task 6's own test only caught
// after being rewritten to scan the whole table body instead of a narrower
// selector.

import { type Lang, t } from "./i18n";
import { CalendarChip } from "./calendar-chip";
import type { CalendarEvent } from "./calendar-event";
import type { Occurrence } from "./recurrence";
import { CELL_PX, ASSIGNEE_COL_PX, type CalendarDay } from "./resource-calendar-rows";

/** Band rows are shorter than the assignee rows (CELL_PX) — a chip needs
 *  less vertical room than an absence cell's centered glyph. */
const BAND_ROW_PX = 22;

interface Props {
  lang: Lang;
  /** One lane per rendered <tr>, from packOccurrenceLanes — already windowed
   *  and sorted by the orchestrator. */
  lanes: readonly (readonly Occurrence[])[];
  days: readonly CalendarDay[];
  eventsById: ReadonlyMap<number, CalendarEvent>;
  onEditEvent: (event: CalendarEvent) => void;
  /** Drag-reschedule an occurrence to a different date. Omit to make the
   *  band read-only (mirrors onMoveAbsence's popout convention). */
  onMoveOccurrence?: (occurrence: Occurrence, toDate: string) => void;
}

/** Pure presentational — all data and handlers come in as props, matching
 *  the CalendarRows / gantt-chrome split convention. Renders nothing when
 *  there are no lanes, so a calendar with no events adds no empty band row. */
export function CalendarBand({ lang, lanes, days, eventsById, onEditEvent, onMoveOccurrence }: Props) {
  if (lanes.length === 0) return null;
  return (
    <tbody data-calendar-band>
      {lanes.map((lane, laneIndex) => {
        // One lookup per lane per render — lanes are small (a handful of
        // concurrent meetings at most), so a Map here is not worth memoizing.
        const byDate = new Map(lane.map((o) => [o.date, o] as const));
        return (
          <tr key={laneIndex} role="row">
            <td
              role="rowheader"
              className="sticky left-0 z-10 border-b border-r border-line bg-surface-muted px-2 py-1 text-xs font-medium text-muted-foreground"
              style={{ minWidth: ASSIGNEE_COL_PX, width: ASSIGNEE_COL_PX }}
            >
              {laneIndex === 0 ? t(lang, "calendarMeetings") : ""}
            </td>
            {days.map((d) => {
              const occ = byDate.get(d.iso);
              const event = occ ? eventsById.get(occ.eventId) : undefined;
              // Title + date + time makes every chip's name row-unique even
              // when the same series repeats daily — a bare title would
              // collide across every occurrence (WCAG 2.4.6).
              const label = occ && event
                ? `${event.title} – ${occ.date} ${occ.time}${occ.isMoved ? ` (${t(lang, "calendarOccurrenceMoved")})` : ""}`
                : "";
              return (
                <td
                  key={d.iso}
                  role="gridcell"
                  className="border-b border-r border-line bg-surface-muted p-0"
                  style={{ minWidth: CELL_PX, width: CELL_PX, height: BAND_ROW_PX }}
                  onDragOver={(e) => { if (onMoveOccurrence) e.preventDefault(); }}
                  onDrop={(e) => {
                    if (!onMoveOccurrence) return;
                    e.preventDefault();
                    const draggedId = Number(e.dataTransfer.getData("text/plain"));
                    // Search ALL lanes (not just this one) — the dragged chip
                    // may have started in a different lane than it lands in.
                    const dragged = lanes.flat().find((o) => o.eventId === draggedId && o.date !== d.iso);
                    if (dragged) onMoveOccurrence(dragged, d.iso);
                  }}
                >
                  {occ && event ? (
                    <CalendarChip
                      data-band-cell={`${laneIndex}-${d.iso}`}
                      draggable={!!onMoveOccurrence}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(occ.eventId)); }}
                      onClick={() => onEditEvent(event)}
                      ariaLabel={label}
                      time={occ.time}
                      title={event.title}
                      moved={occ.isMoved}
                    />
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
