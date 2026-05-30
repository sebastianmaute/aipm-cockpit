"use client";

import { useMemo } from "react";
import { shortDateRange } from "./date-format";
import { type Lang, t } from "./i18n";
import { buildResourceWorkload } from "./resource-workload-rows";
import type { Absence, Resource, Shift, Task } from "./types";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetColWidthsButton } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";

const WORKLOAD_COL_WIDTHS = {
  assignee: 160,
  email: 180,
  openTasks: 110,
  overdue: 110,
  weeklyHours: 120,
  upcoming: 200,
} as const;
type WorkloadCol = keyof typeof WORKLOAD_COL_WIDTHS;

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  today: string;
  onEditResource: (r: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
  onEditAbsence: (a: Absence) => void;
  onEditShift: (
    existing: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
}

export function ResourceWorkload({
  lang,
  resources,
  tasks,
  absences,
  shifts,
  today,
  onEditResource,
  onAddResource,
  onEditAbsence,
  onEditShift,
}: Props) {
  const { managed, unlinked } = useMemo(
    () => buildResourceWorkload(resources, tasks, absences, shifts, today),
    [resources, tasks, absences, shifts, today],
  );

  const { colWidths, startColResize: _startColResize, resetColWidths } = useColumnResize<WorkloadCol>(
    "workload",
    WORKLOAD_COL_WIDTHS,
  );
  const startColResize = _startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-end">
        <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
      <table className="w-full text-left text-sm">
        <thead className={TABLE_HEAD_CLASS}>
          <tr>
            <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.assignee, minWidth: colWidths.assignee }}>
              {t(lang, "assignee")}
              <ColumnResizeHandle col="assignee" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.email, minWidth: colWidths.email }}>
              {t(lang, "email")}
              <ColumnResizeHandle col="email" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.openTasks, minWidth: colWidths.openTasks }}>
              {t(lang, "resourcesOpenTasks")}
              <ColumnResizeHandle col="openTasks" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.overdue, minWidth: colWidths.overdue }}>
              {t(lang, "resourcesOverdueTasks")}
              <ColumnResizeHandle col="overdue" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.weeklyHours, minWidth: colWidths.weeklyHours }}>
              {t(lang, "resourcesWeeklyHours")}
              <ColumnResizeHandle col="weeklyHours" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.upcoming, minWidth: colWidths.upcoming }}>
              {t(lang, "resourcesUpcomingAbsences")}
              <ColumnResizeHandle col="upcoming" onMouseDown={startColResize} />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {managed.map((row) => (
            <tr key={`res-${row.resource.id}`} className="align-top">
              <td className="px-3 py-2 font-medium text-foreground">
                <button
                  type="button"
                  onClick={() => onEditResource(row.resource)}
                  className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green"
                  title={row.display}
                >
                  {row.display}
                </button>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.email || "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {row.openCount}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  row.overdueCount > 0
                    ? "font-medium text-AIPM-pink"
                    : "text-muted-foreground"
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
                  className={`rounded-md border border-transparent px-2 py-0.5 text-xs hover:border-AIPM-dark-blue hover:bg-surface-muted ${
                    row.shift
                      ? "text-foreground"
                      : "text-muted-foreground italic"
                  }`}
                >
                  {row.weeklyHours}
                </button>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
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
                          className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                        >
                          <span>{shortDateRange(a, lang)}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
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

          {unlinked.length > 0 && (
            <>
              <tr>
                <td
                  colSpan={6}
                  className="bg-surface-muted px-3 py-1.5"
                >
                  <span className="font-semibold text-foreground">
                    {t(lang, "resourcesUnlinked")}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t(lang, "resourcesUnlinkedHint")}
                  </span>
                </td>
              </tr>
              {unlinked.map((row) => (
                <tr
                  key={`unl-${row.display.toLowerCase()}`}
                  className="align-top"
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    <span>{row.display}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onAddResource({
                          firstName: row.firstName,
                          lastName: row.lastName,
                          email: row.email || undefined,
                        })
                      }
                      className="ml-2 rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-normal text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                    >
                      {t(lang, "resourcesAddAsResource")}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.email || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {row.openCount}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      row.overdueCount > 0
                        ? "font-medium text-AIPM-pink"
                        : "text-muted-foreground"
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
                      className={`rounded-md border border-transparent px-2 py-0.5 text-xs hover:border-AIPM-dark-blue hover:bg-surface-muted ${
                        row.shift
                          ? "text-foreground"
                          : "text-muted-foreground italic"
                      }`}
                    >
                      {row.weeklyHours}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
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
                              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                            >
                              <span>{shortDateRange(a, lang)}</span>
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
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
            </>
          )}
        </tbody>
      </table>
    </div>
    </div>
  );
}
