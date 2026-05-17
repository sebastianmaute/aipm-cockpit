"use client";

// Resource Planner panel — view shell + per-assignee list view.
//
// Two views, switchable via a SegmentedControl in the header:
//   - "list"     — stats table (open/overdue counts + upcoming absences).
//                  Phases 1 + 2 of the planner.
//   - "calendar" — 30-day grid (rows × days). Phase 3. Rendered by the
//                  sibling <ResourceCalendar /> component.
//
// Both views share the same per-assignee aggregation: trim + lowercase
// the assignee name so "Alex Example" and "Alex Example" land in the same
// row; display uses the first observed original casing. See
// docs/RESOURCE-PLANNER-PLAN.md.

import { memo, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { ResourceCalendar } from "./resource-calendar";
import { SegmentedControl } from "./segmented-control";
import {
  type Absence,
  DEFAULT_WEEK_HOURS,
  type Shift,
  type Task,
  type WeekHours,
} from "./types";

interface Props {
  lang: Lang;
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  today: string;
  holidaySet: ReadonlySet<string>;
  onAddAbsence: (seed?: Partial<Absence>) => void;
  onEditAbsence: (absence: Absence) => void;
  /** Open the shift modal for a row. `existingShift` is the shift to edit,
   *  or null when the row has no shift yet (modal opens in create mode
   *  pre-filled with the row's assignee). */
  onEditShift: (
    existingShift: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
}

type View = "list" | "calendar";

interface AssigneeRow {
  key: string;          // case-folded join key
  display: string;      // first observed original casing
  email: string;        // first non-empty email observed
  openCount: number;
  overdueCount: number;
  upcoming: Absence[];  // sorted by startDate asc, within 60-day window
  shift: Shift | null;  // matching shift (case-folded join), or null = default
  weeklyHours: number;  // sum of hoursPerWeekday — uses DEFAULT_WEEK_HOURS when shift is null
}

function sumHours(h: WeekHours): number {
  return h.reduce((a, b) => a + (b || 0), 0);
}

const DEFAULT_WEEKLY_HOURS_TOTAL = sumHours(DEFAULT_WEEK_HOURS);

function localeFor(lang: Lang): string {
  if (lang === "de") return "de-DE";
  if (lang === "en-GB") return "en-GB";
  return "en-US";
}

function shortDateRange(a: Absence, lang: Lang): string {
  const loc = localeFor(lang);
  const start = new Date(a.startDate);
  const end = new Date(a.endDate);
  const sameDay = a.startDate === a.endDate;
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit" };
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    return sameDay ? a.startDate : `${a.startDate}–${a.endDate}`;
  }
  if (sameDay) return start.toLocaleDateString(loc, fmt);
  return `${start.toLocaleDateString(loc, fmt)}–${end.toLocaleDateString(loc, fmt)}`;
}

function ResourcesPanelInner({
  lang,
  tasks,
  absences,
  shifts,
  today,
  holidaySet,
  onAddAbsence,
  onEditAbsence,
  onEditShift,
}: Props) {
  const [view, setView] = useState<View>("list");

  const rows = useMemo<AssigneeRow[]>(() => {
    const byKey = new Map<string, AssigneeRow>();
    const upsert = (
      rawAssignee: string,
      rawEmail: string | undefined,
    ): AssigneeRow | null => {
      const trimmed = rawAssignee.trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      let row = byKey.get(key);
      if (!row) {
        row = {
          key,
          display: trimmed,
          email: rawEmail?.trim() ?? "",
          openCount: 0,
          overdueCount: 0,
          upcoming: [],
          shift: null,
          weeklyHours: DEFAULT_WEEKLY_HOURS_TOTAL,
        };
        byKey.set(key, row);
      } else if (!row.email && rawEmail) {
        row.email = rawEmail.trim();
      }
      return row;
    };

    // Tasks contribute the assignee + open/overdue counts.
    for (const task of tasks) {
      const row = upsert(task.assignee, task.assigneeEmail);
      if (!row) continue;
      if (!task.completedDate) {
        row.openCount++;
        if (task.dueDate && task.dueDate < today) row.overdueCount++;
      }
    }

    // Absences contribute upcoming (next 60 days) + ensure the assignee
    // exists even if they have no tasks yet.
    const horizon = (() => {
      const d = new Date(today);
      if (Number.isNaN(d.valueOf())) return null;
      d.setUTCDate(d.getUTCDate() + 60);
      return d.toISOString().slice(0, 10);
    })();
    for (const a of absences) {
      const row = upsert(a.assignee, a.assigneeEmail);
      if (!row) continue;
      if (a.endDate < today) continue;
      if (horizon && a.startDate > horizon) continue;
      row.upcoming.push(a);
    }
    // Shifts contribute weekly-hours + ensure the assignee row exists.
    for (const s of shifts) {
      const row = upsert(s.assignee, s.assigneeEmail);
      if (!row) continue;
      row.shift = s;
      row.weeklyHours = sumHours(s.hoursPerWeekday);
    }
    for (const row of byKey.values()) {
      row.upcoming.sort((x, y) => x.startDate.localeCompare(y.startDate));
    }

    return Array.from(byKey.values()).sort((a, b) =>
      a.display.localeCompare(b.display),
    );
  }, [tasks, absences, shifts, today]);

  // Header: title + (when there are rows) view-toggle + "+ Add absence".
  const renderHeader = (showToggle: boolean) => (
    <header className="mb-3 flex shrink-0 items-baseline justify-between gap-2">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
        {t(lang, "tabResources")}
        {rows.length > 0 && (
          <span className="ml-2 text-sm font-normal text-AIPM-medium-grey">
            {t(lang, "tasksCount", rows.length)}
          </span>
        )}
      </h2>
      <div className="flex items-center gap-3">
        {showToggle && (
          <SegmentedControl<View>
            value={view}
            ariaLabel={t(lang, "tabResources")}
            options={[
              { value: "list", label: t(lang, "resourcesViewList") },
              { value: "calendar", label: t(lang, "resourcesViewCalendar") },
            ]}
            onChange={setView}
          />
        )}
        <button
          type="button"
          onClick={() => onAddAbsence()}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
        >
          {t(lang, "resourcesAddAbsence")}
        </button>
      </div>
    </header>
  );

  if (rows.length === 0) {
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        {renderHeader(false)}
        <div className="mt-3 flex-1 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-AIPM-medium-grey dark:border-zinc-800">
          {t(lang, "resourcesEmpty")}
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {renderHeader(true)}
      {view === "list" ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 shadow-sm dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">{t(lang, "assignee")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "email")}</th>
                <th className="px-3 py-2 font-medium text-right">
                  {t(lang, "resourcesOpenTasks")}
                </th>
                <th className="px-3 py-2 font-medium text-right">
                  {t(lang, "resourcesOverdueTasks")}
                </th>
                <th className="px-3 py-2 font-medium text-right">
                  {t(lang, "resourcesWeeklyHours")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t(lang, "resourcesUpcomingAbsences")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((row) => (
                <tr key={row.key} className="align-top">
                  <td className="px-3 py-2 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
                    {row.display}
                  </td>
                  <td className="px-3 py-2 text-AIPM-medium-grey">
                    {row.email || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-AIPM-dark-grey dark:text-AIPM-light-grey">
                    {row.openCount}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      row.overdueCount > 0
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-AIPM-medium-grey"
                    }`}
                  >
                    {row.overdueCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <button
                      type="button"
                      onClick={() =>
                        onEditShift(row.shift, {
                          display: row.display,
                          email: row.email,
                        })
                      }
                      title={
                        row.shift
                          ? t(lang, "resourcesEditShift")
                          : t(lang, "resourcesDefaultShift")
                      }
                      className={`rounded-md border border-transparent px-2 py-0.5 text-xs shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                        row.shift
                          ? "text-AIPM-dark-grey dark:text-AIPM-light-grey"
                          : "text-AIPM-medium-grey italic"
                      }`}
                    >
                      {row.weeklyHours}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-AIPM-medium-grey">
                    {row.upcoming.length === 0 ? (
                      "—"
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {row.upcoming.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => onEditAbsence(a)}
                              title={a.note ?? ""}
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
                            >
                              <span>{shortDateRange(a, lang)}</span>
                              <span className="text-[10px] uppercase tracking-wide text-AIPM-medium-grey">
                                {a.type}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ResourceCalendar
          lang={lang}
          rows={rows}
          absences={absences}
          today={today}
          holidaySet={holidaySet}
          onAddAbsence={onAddAbsence}
          onEditAbsence={onEditAbsence}
        />
      )}
    </section>
  );
}

export const ResourcesPanel = memo(ResourcesPanelInner);
