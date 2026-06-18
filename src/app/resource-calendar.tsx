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

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { localeFor } from "./date-format";
import { type Lang, t } from "./i18n";
import type { Absence, AbsenceType, Resource } from "./types";
import { resourceDisplayName, splitName } from "./resource-foundation";
import { TABLE_HEAD_CLASS } from "./table-styles";

interface CalendarAssignee {
  /** Case-folded join key used to look up matching absences. */
  key: string;
  /** Original-case display name for the row label. */
  display: string;
  /** First non-empty email observed for this assignee (may be ""). */
  email: string;
}

interface Props {
  lang: Lang;
  rows: readonly CalendarAssignee[];
  absences: readonly Absence[];
  today: string;
  holidaySet: ReadonlySet<string>;
  onAddAbsence: (seed?: Partial<Absence>) => void;
  onEditAbsence: (absence: Absence) => void;
  resources: readonly Resource[];
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
  /** Inclusive ISO window the grid renders, resolved by the parent. */
  startDate: string;
  endDate: string;
}

const CELL_PX = 40;
const ASSIGNEE_COL_PX = 180;

interface CalendarDay {
  iso: string;
  dayOfMonth: number;
  /** Month label shown on the first day and at each month transition. */
  monthLabel: string;
  isWeekend: boolean;
  isHoliday: boolean;
  isToday: boolean;
}

function absenceCellBg(type: AbsenceType): string {
  switch (type) {
    case "vacation":
      return "bg-AIPM-blue/30 hover:bg-AIPM-blue/40 dark:bg-AIPM-blue/25 dark:hover:bg-AIPM-blue/35";
    case "sick":
      return "bg-AIPM-pink/30 hover:bg-AIPM-pink/40 dark:bg-AIPM-pink/25 dark:hover:bg-AIPM-pink/35";
    case "training":
      return "bg-AIPM-purple/30 hover:bg-AIPM-purple/40 dark:bg-AIPM-purple/25 dark:hover:bg-AIPM-purple/35";
    default:
      return "bg-AIPM-medium-grey/45 hover:bg-AIPM-medium-grey/55 dark:bg-AIPM-medium-grey/35 dark:hover:bg-AIPM-medium-grey/45";
  }
}

function absenceGlyph(type: AbsenceType): string {
  switch (type) {
    case "vacation":
      return "V";
    case "sick":
      return "S";
    case "training":
      return "T";
    default:
      return "O";
  }
}

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

function ResourceCalendarInner({
  lang,
  rows,
  absences,
  today,
  holidaySet,
  onAddAbsence,
  onEditAbsence,
  resources,
  onEditResource,
  onAddResource,
  startDate,
  endDate,
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
        monthLabel: monthChange ? d.toLocaleDateString(loc, { month: "short" }) : "",
        isWeekend: dow === 0 || dow === 6,
        isHoliday: holidaySet.has(iso),
        isToday: iso === today,
      });
      prevMonth = month;
    }
    return out;
  }, [startDate, endDate, today, holidaySet, lang]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div ref={scrollRef} data-calendar-scroll className="min-h-0 flex-1 overflow-auto rounded-md border border-line pr-2">
        <table className="border-separate border-spacing-0 text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 border-b border-r border-line bg-AIPM-dark-blue px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-white"
                style={{ minWidth: ASSIGNEE_COL_PX, width: ASSIGNEE_COL_PX }}
              >
                {t(lang, "assignee")}
              </th>
              {days.map((d) => (
                <th
                  key={d.iso}
                  title={
                    d.isToday
                      ? `${d.iso} (${t(lang, "resourcesToday")})`
                      : d.iso
                  }
                  className={[
                    "sticky top-0 z-20 border-b border-r border-line px-0 py-1 text-center text-[10px] font-medium tracking-wide",
                    d.isToday
                      ? "bg-AIPM-green/20 text-AIPM-dark-blue dark:bg-AIPM-green/20 dark:text-AIPM-light-grey"
                      : d.isHoliday
                        ? "bg-AIPM-purple/15 text-AIPM-dark-blue dark:bg-AIPM-purple/20 dark:text-AIPM-light-grey"
                        : d.isWeekend
                          ? "bg-AIPM-dark-blue text-white"
                          : "bg-AIPM-dark-blue text-white",
                  ].join(" ")}
                  style={{ minWidth: CELL_PX, width: CELL_PX }}
                >
                  <div className="leading-tight">
                    <div className="h-3 text-[9px] font-semibold uppercase">
                      {d.monthLabel}
                    </div>
                    <div className="tabular-nums">{d.dayOfMonth}</div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowAbs = absencesByKey.get(row.key) ?? [];
              return (
                <tr key={row.key}>
                  <td
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
                          className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green"
                        >
                          {row.display}
                        </button>
                      );
                    })()}
                  </td>
                  {days.map((d) => {
                    const hit = rowAbs.find(
                      (a) => d.iso >= a.startDate && d.iso <= a.endDate,
                    );
                    const baseBg = hit
                      ? absenceCellBg(hit.type)
                      : d.isToday
                        ? "bg-AIPM-green/15 hover:bg-AIPM-green/25 dark:bg-AIPM-green/15 dark:hover:bg-AIPM-green/25"
                        : d.isHoliday
                          ? "bg-AIPM-purple/10 hover:bg-AIPM-purple/20 dark:bg-AIPM-purple/15 dark:hover:bg-AIPM-purple/25"
                          : d.isWeekend
                            ? "bg-surface-muted hover:bg-AIPM-medium-grey/20 dark:hover:bg-AIPM-medium-grey/20"
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
                        className="border-b border-r border-line p-0"
                        style={{
                          minWidth: CELL_PX,
                          width: CELL_PX,
                          height: CELL_PX,
                        }}
                      >
                        <button
                          type="button"
                          onClick={handleClick}
                          title={tip}
                          aria-label={tip}
                          className={`flex h-full w-full items-center justify-center text-[11px] font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-inset focus:ring-AIPM-green ${baseBg}`}
                        >
                          {hit ? (
                            <span className="text-foreground">
                              {absenceGlyph(hit.type)}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <LegendChip
          className="bg-AIPM-blue/30 dark:bg-AIPM-blue/25"
          label={t(lang, "absenceTypeVacation")}
        />
        <LegendChip
          className="bg-AIPM-pink/30 dark:bg-AIPM-pink/25"
          label={t(lang, "absenceTypeSick")}
        />
        <LegendChip
          className="bg-AIPM-purple/30 dark:bg-AIPM-purple/25"
          label={t(lang, "absenceTypeTraining")}
        />
        <LegendChip
          className="bg-AIPM-medium-grey/45 dark:bg-AIPM-medium-grey/35"
          label={t(lang, "absenceTypeOther")}
        />
        <LegendChip
          className="bg-AIPM-green/20 dark:bg-AIPM-green/20"
          label={t(lang, "resourcesToday")}
        />
        <LegendChip
          className="bg-AIPM-purple/15 dark:bg-AIPM-purple/20"
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
