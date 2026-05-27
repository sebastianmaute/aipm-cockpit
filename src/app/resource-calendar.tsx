"use client";

// Resource calendar grid — 30-day view, rows are assignees, columns are
// consecutive dates starting from today. Cells are color-coded by absence
// type. Weekend and public-holiday columns get muted shading; today's
// column is highlighted. Clicking an empty cell opens the absence modal
// pre-filled with the row's assignee and that date; clicking an absence
// cell opens it for edit.
//
// Phase 3 of the Resource Planner (see docs/RESOURCE-PLANNER-PLAN.md).

import { memo, useMemo } from "react";
import { localeFor } from "./date-format";
import { type Lang, t } from "./i18n";
import type { Absence, AbsenceType, Resource } from "./types";
import { resourceDisplayName, splitName } from "./resource-foundation";

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
}

const CALENDAR_DAYS = 30;
const CELL_PX = 36;
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
      return "bg-blue-200 hover:bg-blue-300 dark:bg-blue-900/70 dark:hover:bg-blue-800/70";
    case "sick":
      return "bg-red-200 hover:bg-red-300 dark:bg-red-900/70 dark:hover:bg-red-800/70";
    case "training":
      return "bg-amber-200 hover:bg-amber-300 dark:bg-amber-900/70 dark:hover:bg-amber-800/70";
    default:
      return "bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-600 dark:hover:bg-zinc-500";
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
}: Props) {
  const days = useMemo<CalendarDay[]>(() => {
    const out: CalendarDay[] = [];
    const start = new Date(today);
    if (Number.isNaN(start.valueOf())) return out;
    const loc = localeFor(lang);
    let prevMonth = -1;
    for (let i = 0; i < CALENDAR_DAYS; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      const month = d.getUTCMonth();
      const monthChange = i === 0 || month !== prevMonth;
      out.push({
        iso,
        dayOfMonth: d.getUTCDate(),
        monthLabel: monthChange
          ? d.toLocaleDateString(loc, { month: "short" })
          : "",
        isWeekend: dow === 0 || dow === 6,
        isHoliday: holidaySet.has(iso),
        isToday: iso === today,
      });
      prevMonth = month;
    }
    return out;
  }, [today, holidaySet, lang]);

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
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 border-b border-r border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
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
                    "sticky top-0 z-20 border-b border-r border-zinc-200 px-0 py-1 text-center text-[10px] font-medium tracking-wide dark:border-zinc-800",
                    d.isToday
                      ? "bg-AIPM-light-blue/30 text-AIPM-dark-blue dark:bg-AIPM-dark-blue/30 dark:text-AIPM-light-blue"
                      : d.isHoliday
                        ? "bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300"
                        : d.isWeekend
                          ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500"
                          : "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400",
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
                    className="sticky left-0 z-10 border-b border-r border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950"
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
                          className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-dark-blue dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
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
                        ? "bg-AIPM-light-blue/20 hover:bg-AIPM-light-blue/40 dark:bg-AIPM-dark-blue/20 dark:hover:bg-AIPM-dark-blue/40"
                        : d.isHoliday
                          ? "bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/20 dark:hover:bg-purple-950/40"
                          : d.isWeekend
                            ? "bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900/50 dark:hover:bg-zinc-800/50"
                            : "bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900";
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
                        className="border-b border-r border-zinc-200 p-0 dark:border-zinc-800"
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
                          className={`flex h-full w-full items-center justify-center text-[11px] font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-inset focus:ring-AIPM-dark-blue ${baseBg}`}
                        >
                          {hit ? (
                            <span className="text-AIPM-dark-grey dark:text-AIPM-light-grey">
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-AIPM-medium-grey">
        <LegendChip
          className="bg-blue-200 dark:bg-blue-900/70"
          label={t(lang, "absenceTypeVacation")}
        />
        <LegendChip
          className="bg-red-200 dark:bg-red-900/70"
          label={t(lang, "absenceTypeSick")}
        />
        <LegendChip
          className="bg-amber-200 dark:bg-amber-900/70"
          label={t(lang, "absenceTypeTraining")}
        />
        <LegendChip
          className="bg-zinc-300 dark:bg-zinc-600"
          label={t(lang, "absenceTypeOther")}
        />
        <LegendChip
          className="bg-AIPM-light-blue/30 dark:bg-AIPM-dark-blue/30"
          label={t(lang, "resourcesToday")}
        />
        <LegendChip
          className="bg-purple-100 dark:bg-purple-950/30"
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
        className={`inline-block h-3 w-3 rounded-sm border border-zinc-300 dark:border-zinc-700 ${className}`}
      />
      {label}
    </span>
  );
}

export const ResourceCalendar = memo(ResourceCalendarInner);
