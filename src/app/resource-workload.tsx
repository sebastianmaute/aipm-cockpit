"use client";

import { useMemo } from "react";
import { shortDateRange } from "./date-format";
import { type Lang, t } from "./i18n";
import { buildResourceWorkload } from "./resource-workload-rows";
import type { Absence, RaidItem, Resource, Shift, Task } from "./types";
import { INNER_TABLE_CLASS } from "./view-styles";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { ColumnResizeHandle } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { WorkloadOverdueTriage } from "./resource-workload-triage";

export const WORKLOAD_COL_WIDTHS = {
  assignee: 160,
  email: 180,
  openTasks: 110,
  overdue: 110,
  openRaid: 90,
  weeklyHours: 120,
  util: 100,
  upcoming: 200,
} as const;
export type WorkloadCol = keyof typeof WORKLOAD_COL_WIDTHS;

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  raid: readonly RaidItem[];
  /** When false (RAID module off), the "Open RAID" column is hidden. */
  raidEnabled: boolean;
  today: string;
  onEditResource: (r: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
  onEditAbsence: (a: Absence) => void;
  onEditShift: (
    existing: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
  /** Canonical near-term period key (periods[0]) — the one the over-allocation
   *  alert flags; null when there's no plan. */
  nearTermPeriodKey: string | null;
  /** resource.id → near-term utilization percent (for the >100% highlight). */
  nearTermPctByResource: ReadonlyMap<number, number>;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  /** Reassign an overdue task to a resource (null = unassign). */
  onReassignTask: (taskId: number, resource: Resource | null) => void;
  /** Reschedule an overdue task's due date. */
  onRescheduleTask: (taskId: number, iso: string) => void;
  colResize: {
    colWidths: Record<WorkloadCol, number>;
    startColResize: (col: WorkloadCol, e: React.MouseEvent) => void;
    resetColWidths: () => void;
  };
}

export function ResourceWorkload({
  lang,
  resources,
  tasks,
  absences,
  shifts,
  raid,
  raidEnabled,
  today,
  onEditResource,
  onAddResource,
  onEditAbsence,
  onEditShift,
  nearTermPeriodKey,
  nearTermPctByResource,
  onSetUtilization,
  onReassignTask,
  onRescheduleTask,
  colResize,
}: Props) {
  const { managed, unlinked } = useMemo(
    () => buildResourceWorkload(resources, tasks, absences, shifts, raid, today),
    [resources, tasks, absences, shifts, raid, today],
  );

  const { colWidths } = colResize;
  const startColResize = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    // max-h-full (not h-full): the card shrinks to its content so a short
    // workload list (reference resources are NOT replicated, so even the huge
    // sample has only a handful) does not stretch a mostly-empty table down past
    // the viewport; it still scrolls if the list ever exceeds the pane.
    <div className="flex max-h-full min-h-0 flex-col">
      <div className={INNER_TABLE_CLASS}>
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
            {raidEnabled && (
              <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.openRaid, minWidth: colWidths.openRaid }}>
                {t(lang, "workloadOpenRaid")}
                <ColumnResizeHandle col="openRaid" onMouseDown={startColResize} />
              </th>
            )}
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.weeklyHours, minWidth: colWidths.weeklyHours }}>
              {t(lang, "resourcesWeeklyHours")}
              <ColumnResizeHandle col="weeklyHours" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.util, minWidth: colWidths.util }}>
              {t(lang, "workloadNearTermUtil")}
              <ColumnResizeHandle col="util" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.upcoming, minWidth: colWidths.upcoming }}>
              {t(lang, "resourcesUpcomingAbsences")}
              <ColumnResizeHandle col="upcoming" onMouseDown={startColResize} />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {managed.map((row) => (
            <tr key={`res-${row.resource.id}`} className="cursor-pointer align-top hover:bg-surface-muted" onClick={() => onEditResource(row.resource)}>
              <td className="px-3 py-2 font-medium text-foreground">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEditResource(row.resource); }}
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
              <td className="px-3 py-2 text-right tabular-nums" onClick={(e) => e.stopPropagation()}>
                {row.overdueCount > 0 ? (
                  <WorkloadOverdueTriage
                    lang={lang}
                    rowDisplay={row.display}
                    overdueTasks={row.overdueTasks}
                    resources={resources}
                    onReassignTask={onReassignTask}
                    onRescheduleTask={onRescheduleTask}
                  />
                ) : (
                  <span className="text-muted-foreground">{row.overdueCount}</span>
                )}
              </td>
              {raidEnabled && (
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                  {row.raidOpenCount}
                </td>
              )}
              <td className="px-3 py-2 text-right tabular-nums">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditShift(row.shift, {
                      display: row.display,
                      email: row.email,
                    });
                  }}
                  title={
                    row.shift
                      ? t(lang, "resourcesEditShift")
                      : t(lang, "resourcesDefaultShift")
                  }
                  className={`rounded-md border border-transparent px-2 py-0.5 text-xs hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE} ${
                    row.shift
                      ? "text-foreground"
                      : "text-muted-foreground italic"
                  }`}
                >
                  {row.weeklyHours}
                </button>
              </td>
              <td className="px-3 py-2 text-right tabular-nums" onClick={(e) => e.stopPropagation()}>
                {nearTermPeriodKey ? (
                  <input
                    type="number"
                    min={0}
                    step={row.resource.utilizationMode === "percent" ? 5 : 1}
                    value={row.resource.utilization[nearTermPeriodKey] ?? ""}
                    aria-label={t(lang, "workloadNearTermUtilLabel", row.display)}
                    onChange={(e) =>
                      onSetUtilization(row.resource.id, nearTermPeriodKey, Number(e.target.value) || 0)
                    }
                    className={`w-16 rounded border px-1 py-0.5 text-right tabular-nums dark:bg-surface ${FOCUS_RING} ${TRANSITION} ${
                      (nearTermPctByResource.get(row.resource.id) ?? 0) > 100
                        ? "border-AIPM-pink-strong font-medium text-AIPM-pink-strong"
                        : "border-line text-foreground"
                    }`}
                  />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
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
                          onClick={(e) => { e.stopPropagation(); onEditAbsence(a); }}
                          title={a.note ?? ""}
                          className={`inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
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
                  colSpan={raidEnabled ? 8 : 7}
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
                      className={`ml-2 rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-normal text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
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
                        ? "font-medium text-AIPM-pink-strong"
                        : "text-muted-foreground"
                    }`}
                  >
                    {row.overdueCount}
                  </td>
                  {raidEnabled && (
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {row.raidOpenCount}
                    </td>
                  )}
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
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
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
                              className={`inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
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
