"use client";

// Resource calendar grid — renders day columns over an explicit [startDate, endDate]
// window passed by the parent. Rows are assignees, columns are consecutive dates.
// Cells are color-coded by absence
// type. Weekend and public-holiday columns get muted shading; today's
// column is highlighted. Clicking an empty cell opens the absence modal
// pre-filled with the row's assignee and that date; clicking an absence
// cell opens it for edit.
//
// Phase 3 of the Resource Planner (see docs/RESOURCE-PLANNER-PLAN.md).

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { localeFor } from "./date-format";
import { type Lang, t } from "./i18n";
import type { Absence, Resource } from "./types";
import { resourceDisplayName } from "./resource-foundation";
import { isoWeekParts } from "./resource-capacity";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { resolveCalendarDrag } from "./calendar-drag";
import { iso, parseUtc } from "./calendar-window";
import {
  CalendarRows,
  CELL_PX,
  ASSIGNEE_COL_PX,
  type CalendarAssignee,
  type CalendarDay,
  type CalendarDragState,
} from "./resource-calendar-rows";

const DAY_MS = 86_400_000;

/** Shift an ISO date by N days (negative = earlier). Falls back to the input
 *  unchanged on an unparseable date — callers only ever feed it a stored
 *  Absence date (sanitizer-validated) or another `iso()` result. */
function addIsoDays(dateIso: string, days: number): string {
  const d = parseUtc(dateIso);
  return d ? iso(new Date(d.valueOf() + days * DAY_MS)) : dateIso;
}

interface Props {
  lang: Lang;
  rows: readonly CalendarAssignee[];
  absences: readonly Absence[];
  today: string;
  holidaySet: ReadonlySet<string>;
  onAddAbsence: (seed?: Partial<Absence>) => void;
  onEditAbsence: (absence: Absence) => void;
  /** Commit a drag/resize/reassign. Omit to make the grid read-only (popout). */
  onMoveAbsence?: (id: number, patch: Partial<Absence>, kind: "move" | "reassign" | "resize") => void;
  resources: readonly Resource[];
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
  /** Inclusive ISO window the grid renders, resolved by the parent. */
  startDate: string;
  endDate: string;
  /** When false, rows backed by an external resource are hidden. Default true. */
  includeExternals?: boolean;
}

/** Rendered height of the ISO week-band header row (py-0.5 + text-[10px]).
 *  The day-header row sticks BELOW the band by exactly this much, so the two
 *  must move together — change the band row's padding/font and change this. */
const WEEK_BAND_ROW_PX = 18;

function ResourceCalendarInner({
  lang,
  rows,
  absences,
  today,
  holidaySet,
  onAddAbsence,
  onEditAbsence,
  onMoveAbsence,
  resources,
  onEditResource,
  onAddResource,
  startDate,
  endDate,
  includeExternals = true,
}: Props) {
  const days = useMemo<CalendarDay[]>(() => {
    const out: CalendarDay[] = [];
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) return out;
    const loc = localeFor(lang);
    let prevMonth = -1;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      const month = d.getUTCMonth();
      const monthChange = out.length === 0 || month !== prevMonth;
      out.push({
        iso,
        dayOfMonth: d.getUTCDate(),
        weekdayLabel: d.toLocaleDateString(loc, { weekday: "short" }),
        isoWeek: isoWeekParts(d).week,
        monthLabel: monthChange ? d.toLocaleDateString(loc, { month: "short" }) : "",
        isWeekend: dow === 0 || dow === 6,
        isHoliday: holidaySet.has(iso),
        isToday: iso === today,
      });
      prevMonth = month;
    }
    return out;
  }, [startDate, endDate, today, holidaySet, lang]);

  // Contiguous runs of same-ISO-week columns, for the header band's colSpans.
  // Derived from `days` alone so it can never disagree with the day row.
  const weekRuns = useMemo<{ week: number; span: number }[]>(() => {
    const runs: { week: number; span: number }[] = [];
    for (const d of days) {
      const last = runs[runs.length - 1];
      if (last && last.week === d.isoWeek) last.span += 1;
      else runs.push({ week: d.isoWeek, span: 1 });
    }
    return runs;
  }, [days]);

  // Optionally hide external-resource rows (calendar-scoped preference). Rows
  // with no backing resource are never external, so they always show. Keyed the
  // same way as resourceByKey / CalendarAssignee.key (case-folded display name).
  const visibleRows = useMemo<readonly CalendarAssignee[]>(() => {
    if (includeExternals) return rows;
    const externalKeys = new Set<string>();
    for (const r of resources) {
      if (r.isExternal) externalKeys.add(resourceDisplayName(r).trim().toLowerCase());
    }
    return rows.filter((row) => !externalKeys.has(row.key));
  }, [rows, resources, includeExternals]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLTableElement | null>(null);

  // The gesture currently in flight. A ref (not state) because the drop handler
  // reads it synchronously and re-rendering mid-drag would tear the ghost.
  const dragRef = useRef<CalendarDragState>(null);
  // Set by a completed drag so the click browsers fire afterwards is
  // ignored — otherwise every drag also opens the absence editor.
  const suppressClickRef = useRef(false);

  // A keyboard move in progress (Alt+Arrow armed it). Committing only on
  // Enter is deliberate: one undo entry per intent, not one per arrow press —
  // mirrors the drag-drop path (Task 5b).
  const [pendingMove, setPendingMove] = useState<
    { absenceId: number; dayDelta: number; rowDelta: number } | null
  >(null);
  // Drives the aria-live announcement's "Move cancelled" flash after Escape;
  // cleared as soon as a fresh move starts so a stale cancellation can't
  // linger into the next one.
  const [justCancelled, setJustCancelled] = useState(false);

  // Roving-tabindex focus target for the 2-D day-cell grid (#27). Exactly one
  // day cell is a tab stop; arrow keys move DOM focus + this marker. Clamped on
  // read so a window/row change that shrinks the grid can't strand the marker
  // off-range (which would leave NO cell tab-reachable).
  const [focusCell, setFocusCell] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const rowCount = visibleRows.length;
  const colCount = days.length;
  const focusRow = rowCount > 0 ? Math.min(focusCell.row, rowCount - 1) : 0;
  const focusCol = colCount > 0 ? Math.min(focusCell.col, colCount - 1) : 0;

  // APG grid keyboard model. Rows = assignees, columns = dates: Arrow moves one
  // cell on either axis, Home/End = row ends, Ctrl+Home/End = grid corners,
  // PageUp/Down = ±1 week within the window. Enter/Space stay native (the cell
  // is a <button> whose onClick adds/edits the absence).
  function onGridKeyDown(e: React.KeyboardEvent<HTMLTableElement>) {
    if (rowCount === 0 || colCount === 0) return;
    // Only day cells rove — ignore keys unless a day cell holds focus, so the
    // assignee row-header button (outside the roving set) keeps its arrow keys.
    if (!(document.activeElement as HTMLElement | null)?.matches?.("[data-cell]")) return;

    // A keyboard move is being previewed: Alt+Arrow adjusts the pending
    // delta, Enter commits it as ONE resolveCalendarDrag call (one undo
    // entry, not one per arrow press), Escape discards. Every other key is
    // left alone here rather than falling into the roving switch below — a
    // plain (non-Alt) arrow can't also walk the focus cursor while a move is
    // in flight. "Left alone" (not preventDefault'd) so Tab still escapes the
    // cell; there is nothing else on a grid cell for an unhandled key to do.
    if (pendingMove) {
      if (e.key === "Escape") {
        e.preventDefault();
        setPendingMove(null);
        setJustCancelled(true);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const moving = absences.find((a) => a.id === pendingMove.absenceId);
        const originRow = visibleRows[focusRow];
        const targetIndex = Math.min(Math.max(focusRow + pendingMove.rowDelta, 0), Math.max(rowCount - 1, 0));
        const targetRow = visibleRows[targetIndex];
        if (moving && originRow && targetRow && onMoveAbsence) {
          const result = resolveCalendarDrag({
            absence: moving,
            grabbedDate: moving.startDate,
            dropDate: addIsoDays(moving.startDate, pendingMove.dayDelta),
            mode: "move",
            target: targetRow.key === originRow.key
              ? { kind: "same-row" }
              : {
                  kind: "other-row",
                  rowKey: targetRow.key,
                  row: { display: targetRow.display, email: targetRow.email, resource: resourceFor(targetRow.key) },
                },
          });
          if (result) onMoveAbsence(moving.id, result.patch, result.kind);
        }
        setPendingMove(null);
        return;
      }
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        setPendingMove((p) => p && {
          ...p,
          dayDelta: p.dayDelta + (e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0),
          rowDelta: p.rowDelta + (e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0),
        });
      }
      return;
    }

    // No move pending: Alt+Arrow on a cell that HOLDS an absence enters move
    // mode, seeded with that keypress's own delta (the same press both
    // starts the mode and previews its first step). A cell with no absence
    // falls through untouched to the existing roving behaviour below.
    if (onMoveAbsence && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const originRow = visibleRows[focusRow];
      const originDay = days[focusCol];
      const hit = originRow && originDay ? hitFor(originRow.key, originDay.iso) : undefined;
      if (hit) {
        e.preventDefault();
        setJustCancelled(false);
        setPendingMove({
          absenceId: hit.id,
          dayDelta: e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0,
          rowDelta: e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0,
        });
        return;
      }
    }

    let r = focusRow;
    let c = focusCol;
    switch (e.key) {
      case "ArrowLeft": c = Math.max(0, c - 1); break;
      case "ArrowRight": c = Math.min(colCount - 1, c + 1); break;
      case "ArrowUp": r = Math.max(0, r - 1); break;
      case "ArrowDown": r = Math.min(rowCount - 1, r + 1); break;
      case "Home":
        if (e.ctrlKey) { r = 0; c = 0; } else { c = 0; }
        break;
      case "End":
        if (e.ctrlKey) { r = rowCount - 1; c = colCount - 1; } else { c = colCount - 1; }
        break;
      case "PageUp": c = Math.max(0, c - 7); break;
      case "PageDown": c = Math.min(colCount - 1, c + 7); break;
      default: return;
    }
    e.preventDefault();
    setFocusCell({ row: r, col: c });
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${r}-${c}"]`)
      ?.focus();
  }

  // Index of today's column within the window (−1 when today is out of range).
  const todayIndex = useMemo(() => days.findIndex((d) => d.isToday), [days]);

  // On open, scroll today to the horizontal centre (Gantt-style). No-op when
  // today is outside the window. Re-runs on window change and on today-index
  // change (so a midnight rollover also re-centres).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || todayIndex < 0) return;
    const todayCentre = ASSIGNEE_COL_PX + todayIndex * CELL_PX + CELL_PX / 2;
    const target = todayCentre - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target));
  }, [todayIndex, startDate, endDate]);

  // Group absences by case-folded assignee key once per absences change so
  // per-cell lookup is O(absences-for-this-row) rather than O(absences-total).
  const absencesByKey = useMemo<Map<string, Absence[]>>(() => {
    const m = new Map<string, Absence[]>();
    for (const a of absences) {
      const key = a.assignee.trim().toLowerCase();
      if (!key) continue;
      const list = m.get(key);
      if (list) list.push(a);
      else m.set(key, [a]);
    }
    return m;
  }, [absences]);

  // Case-folded display-name → Resource, matching how CalendarAssignee.key is
  // built upstream (assignee.trim().toLowerCase()). Last-wins on name collision.
  const resourceByKey = useMemo<Map<string, Resource>>(() => {
    const m = new Map<string, Resource>();
    for (const r of resources) m.set(resourceDisplayName(r).trim().toLowerCase(), r);
    return m;
  }, [resources]);

  // The absence (if any) covering a given row+date. Shared by the row
  // renderer below and the keyboard move-mode entry check in onGridKeyDown,
  // so both agree on exactly the same predicate.
  const hitFor = useCallback(
    (rowKey: string, dateIso: string): Absence | undefined =>
      (absencesByKey.get(rowKey) ?? []).find((a) => dateIso >= a.startDate && dateIso <= a.endDate),
    [absencesByKey],
  );

  // Read-through accessor for resourceByKey used from onGridKeyDown (a plain
  // function, not JSX-inline) — kept as its own memoized callback because the
  // React Compiler could not preserve resourceByKey's memoization when
  // onGridKeyDown called `.get()` on it directly (verified: reverting this
  // indirection reproduces `react-hooks/preserve-manual-memoization`).
  const resourceFor = useCallback(
    (key: string): Resource | undefined => resourceByKey.get(key),
    [resourceByKey],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div ref={scrollRef} data-calendar-scroll className="min-h-0 flex-1 overflow-auto rounded-md border border-line pr-2">
        <table
          ref={gridRef}
          role="grid"
          aria-label={t(lang, "resourcesViewCalendar")}
          onKeyDown={onGridKeyDown}
          className="border-separate border-spacing-0 text-sm"
        >
          <thead className={TABLE_HEAD_CLASS}>
            <tr role="row">
              {/* Corner spacer: holds the assignee column's position so the
                  band <th>s above line up with the day columns below. */}
              <th
                aria-hidden="true"
                className="sticky left-0 top-0 z-30 border-b border-r border-line bg-ui-dark-blue px-3 py-0.5"
                style={{ minWidth: ASSIGNEE_COL_PX, width: ASSIGNEE_COL_PX }}
              />
              {weekRuns.map((run, i) => (
                <th
                  key={`${run.week}-${i}`}
                  role="columnheader"
                  colSpan={run.span}
                  className="sticky top-0 z-20 border-b border-r border-line bg-ui-dark-blue px-1 py-0.5 text-center text-[10px] font-semibold tracking-wide text-white"
                >
                  {`${t(lang, "calendarWeekAbbrev")}${run.week}`}
                </th>
              ))}
            </tr>
            <tr role="row">
              <th
                role="columnheader"
                className="sticky left-0 z-30 border-b border-r border-line bg-ui-dark-blue px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-white"
                style={{ minWidth: ASSIGNEE_COL_PX, width: ASSIGNEE_COL_PX, top: WEEK_BAND_ROW_PX }}
              >
                {t(lang, "assignee")}
              </th>
              {days.map((d) => (
                <th
                  key={d.iso}
                  role="columnheader"
                  title={
                    d.isToday
                      ? `${d.iso} (${t(lang, "resourcesToday")})`
                      : d.iso
                  }
                  className={[
                    "sticky z-20 border-b border-r border-line px-0 py-1 text-center text-[10px] font-medium tracking-wide",
                    d.isToday
                      ? "bg-ui-green/20 text-ui-dark-blue dark:bg-ui-green/20 dark:text-ui-light-grey"
                      : d.isHoliday
                        ? "bg-ui-purple/15 text-ui-dark-blue dark:bg-ui-purple/20 dark:text-ui-light-grey"
                        : d.isWeekend
                          ? "bg-ui-dark-blue text-white"
                          : "bg-ui-dark-blue text-white",
                  ].join(" ")}
                  style={{ minWidth: CELL_PX, width: CELL_PX, top: WEEK_BAND_ROW_PX }}
                >
                  <div className="leading-tight">
                    <div className="h-3 text-[9px] font-semibold uppercase">
                      {d.monthLabel}
                    </div>
                    <div className="text-[9px] uppercase opacity-80">{d.weekdayLabel}</div>
                    <div className="tabular-nums">{d.dayOfMonth}</div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <CalendarRows
            lang={lang}
            visibleRows={visibleRows}
            days={days}
            resourceByKey={resourceByKey}
            absences={absences}
            hitFor={hitFor}
            focusRow={focusRow}
            focusCol={focusCol}
            setFocusCell={setFocusCell}
            dragRef={dragRef}
            suppressClickRef={suppressClickRef}
            onAddAbsence={onAddAbsence}
            onEditAbsence={onEditAbsence}
            onMoveAbsence={onMoveAbsence}
            onEditResource={onEditResource}
            onAddResource={onAddResource}
          />
        </table>
      </div>
      {/* The only feedback a screen-reader user gets that keyboard move mode
          is active (or was just cancelled) — visually silent by design. */}
      <div aria-live="polite" className="sr-only">
        {pendingMove
          ? t(lang, "calendarMoveModeOn")
          : justCancelled
            ? t(lang, "calendarMoveModeCancelled")
            : ""}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <LegendChip
          className="bg-ui-blue/30 dark:bg-ui-blue/25"
          label={t(lang, "absenceTypeVacation")}
        />
        <LegendChip
          className="bg-ui-pink/30 dark:bg-ui-pink/25"
          label={t(lang, "absenceTypeSick")}
        />
        <LegendChip
          className="bg-ui-purple/30 dark:bg-ui-purple/25"
          label={t(lang, "absenceTypeTraining")}
        />
        <LegendChip
          className="bg-ui-medium-grey/45 dark:bg-ui-medium-grey/35"
          label={t(lang, "absenceTypeOther")}
        />
        <LegendChip
          className="bg-ui-green/20 dark:bg-ui-green/20"
          label={t(lang, "resourcesToday")}
        />
        <LegendChip
          className="bg-ui-purple/15 dark:bg-ui-purple/20"
          label={t(lang, "resourcesHoliday")}
        />
      </div>
    </div>
  );
}

function LegendChip({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden="true"
        className={`inline-block h-3 w-3 rounded-sm border border-line ${className}`}
      />
      {label}
    </span>
  );
}

export const ResourceCalendar = memo(ResourceCalendarInner);
